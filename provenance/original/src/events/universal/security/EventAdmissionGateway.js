'use strict';

import { UniversalEventEnvelope } from '../envelope/UniversalEventEnvelope.js';
import { SeenEventWindow } from './SeenEventWindow.js';
import { byteLength, deepFreeze } from '../support/safe.js';

export class EventAdmissionGateway {
  constructor(options = {}) {
    this.profile = options.profile || {};
    this.definitions = options.definitions || null;
    this.cryptoProvider = options.cryptoProvider || null;
    this.authorizer = options.authorizer || null;
    this.authenticator = options.authenticator || null;
    this.tenantResolver = options.tenantResolver || null;
    this.seen = options.seen || new SeenEventWindow(options.seenOptions || {});
    this.limits = options.limits || this.profile.limits || {};
    this.stats = { admitted: 0, rejected: 0, duplicates: 0, invalid: 0, unauthorized: 0, unauthenticated: 0, unknown: 0, contractFailures: 0 };
  }

  async admit(input, context = {}) {
    const startedAt = Date.now();
    try {
      const rawBytes = typeof input === 'string' || input instanceof Uint8Array || input instanceof ArrayBuffer ? byteLength(input) : 0;
      if (this.limits.maxEnvelopeBytes > 0 && rawBytes > this.limits.maxEnvelopeBytes) return this._reject('EVENT_ENVELOPE_TOO_LARGE', 'packet-too-large', { rawBytes });
      const wireEnvelope = UniversalEventEnvelope.normalize(input, {
        acceptedVersions: this.profile.acceptedEnvelopeVersions || [1, 2, 3],
        limits: this.limits,
      });
      await UniversalEventEnvelope.verify(wireEnvelope, {
        acceptedVersions: this.profile.acceptedEnvelopeVersions || [1, 2, 3],
        cryptoProvider: this.cryptoProvider,
        requireSignature: context.remote === true
          ? this.profile.allowUnsignedRemote === false
          : this.profile.allowUnsignedLocal === false,
        maxHops: this.limits.maxHops,
        maxClockSkewMs: context.maxClockSkewMs,
      });
      if (!this.seen.checkAndAdd(wireEnvelope.id)) {
        this.stats.duplicates++;
        return this._reject('EVENT_DUPLICATE', 'duplicate', { envelope: wireEnvelope }, false);
      }

      const latestDefinition = this.definitions?.get?.(wireEnvelope.name) || null;
      const exactDefinition = this.definitions?.get?.(wireEnvelope.name, wireEnvelope.version) || null;
      if (!latestDefinition && this.profile.allowUnknownEvents === false) {
        this.stats.unknown++;
        return this._reject('EVENT_DEFINITION_UNKNOWN', 'unknown-event', { envelope: wireEnvelope });
      }

      let envelope = wireEnvelope;
      let definition = exactDefinition || latestDefinition;
      let upcast = null;
      if (latestDefinition && latestDefinition.version > wireEnvelope.version && context.upcast !== false) {
        try {
          upcast = this.definitions.upcast(
            wireEnvelope.name,
            wireEnvelope.version,
            wireEnvelope.content?.payload,
            latestDefinition.version,
            { envelope: wireEnvelope, context, phase: 'remote-inbound' },
          );
          envelope = upcastEnvelope(wireEnvelope, upcast, latestDefinition);
          definition = latestDefinition;
        } catch (error) {
          this.stats.contractFailures++;
          return this._reject(error.code || 'EVENT_UPCAST_FAILED', 'upcast-failed', {
            envelope: wireEnvelope,
            error: { name: error?.name || 'Error', code: error?.code || null, message: error?.message || String(error) },
          });
        }
      } else if (latestDefinition && !exactDefinition && this.profile.requireRemoteContracts) {
        this.stats.contractFailures++;
        return this._reject(
          wireEnvelope.version > latestDefinition.version
            ? 'EVENT_VERSION_UNSUPPORTED'
            : 'EVENT_DEFINITION_VERSION_UNKNOWN',
          wireEnvelope.version > latestDefinition.version
            ? 'future-version-unsupported'
            : 'definition-version-unknown',
          { envelope: wireEnvelope, latestVersion: latestDefinition.version },
        );
      }

      const tenant = this.tenantResolver
        ? await this.tenantResolver({ envelope, wireEnvelope, context })
        : envelope.context?.tenantId || context.tenant || null;
      if (this.profile.requireTenantResolution && !tenant) {
        return this._reject('EVENT_TENANT_UNRESOLVED', 'tenant-unresolved', { envelope });
      }
      const principal = this.authenticator
        ? await this.authenticator({ envelope, wireEnvelope, context, tenant })
        : context.principal || envelope.security?.principal || null;
      if (context.remote === true && this.profile.requireRemoteAuthentication && !principal && envelope.security?.authenticated !== true) {
        this.stats.unauthenticated++;
        return this._reject('EVENT_AUTHENTICATION_REQUIRED', 'authentication-required', { envelope });
      }
      const channel = envelope.routing?.channel;
      if (channel && this.authorizer) {
        const decision = await this.authorizer.authorize(channel, {
          envelope,
          wireEnvelope,
          context,
          tenant,
          principal,
          transport: context.transport,
          event: definition,
        });
        if (!decision.allowed) {
          this.stats.unauthorized++;
          return this._reject('EVENT_CHANNEL_DENIED', decision.reason || 'channel-denied', { envelope, decision });
        }
      }
      if (definition && (this.profile.remoteValidation !== false || context.validate === true)) {
        const validation = await this.definitions.validate(
          envelope.name,
          envelope.version,
          envelope.content?.payload,
          { eventContext: envelope.context, envelope, wireEnvelope, phase: 'remote-inbound' },
        );
        if (!validation.ok) {
          this.stats.contractFailures++;
          return this._reject('EVENT_CONTRACT_INVALID', 'contract-invalid', { envelope, errors: validation.errors });
        }
      }
      this.stats.admitted++;
      return deepFreeze({
        accepted: true,
        envelope,
        wireEnvelope,
        definition,
        tenant,
        principal,
        upcasted: !!upcast,
        originalVersion: wireEnvelope.version,
        startedAt,
        finishedAt: Date.now(),
      });
    } catch (error) { this.stats.invalid++; return this._reject(error.code || 'EVENT_ADMISSION_FAILED', error.message || 'admission-failed', { error }, error.retryable === true); }
  }

  _reject(code, reason, details = null, retryable = false) { this.stats.rejected++; return deepFreeze({ accepted: false, code, reason, retryable, details, finishedAt: Date.now() }); }
  snapshot() { return deepFreeze({ profile: this.profile.name || null, limits: { ...this.limits }, seen: this.seen.snapshot(), stats: { ...this.stats } }); }
}
function upcastEnvelope(envelope, upcast, definition) {
  return new UniversalEventEnvelope({
    ...envelope,
    version: upcast.version,
    content: {
      ...envelope.content,
      schema: `${envelope.name}@${upcast.version}`,
      payload: upcast.payload,
    },
    security: {
      ...envelope.security,
      signature: null,
      verified: true,
      verifiedKeyId: envelope.security?.keyId || null,
    },
    metadata: {
      ...(envelope.metadata || {}),
      admission: {
        ...((envelope.metadata || {}).admission || {}),
        upcasted: true,
        originalVersion: envelope.version,
        targetVersion: upcast.version,
        definitionId: definition?.id || null,
      },
    },
  });
}

export default EventAdmissionGateway;
