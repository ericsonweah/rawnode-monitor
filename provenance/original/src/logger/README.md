# RawNode Logger

RawNode Logger is a zero-dependency, ESM-first logging runtime for RawNode and modern Node.js. It preserves the existing RawNode logger API while adding structured records, bounded delivery queues, context propagation, redaction, asynchronous rotation, durable audit logs, network transports, health metrics, a production CLI, and first-party testing tools.

## Compatibility first

Existing imports and calls remain valid:

```js
import logger, {
  Logger,
  AdvancedLogger,
  ConsoleTransport,
  FileTransport,
  Config,
  colors,
} from 'rawnode-logger';

logger.info('Application started');
Logger.create().level('debug').transport(new ConsoleTransport()).done();
```

The historical fourteen levels are retained in their original order:

`emergency`, `alert`, `critical`, `error`, `urgent`, `priority`, `warn`, `notice`, `success`, `info`, `debug`, `metric`, `metrics`, `important`.

The existing constructors default to the `v1` compatibility profile. The additive `createLogger()` factory defaults to the production profile.

## Production quick start

```js
import {
  createLogger,
  EnterpriseConsoleTransport,
  EnterpriseFileTransport,
} from 'rawnode-logger';

const logger = createLogger({
  service: 'billing-api',
  environment: process.env.APP_ENV || 'production',
  level: 'info',
  transports: [
    new EnterpriseConsoleTransport({ structured: true }),
    new EnterpriseFileTransport({
      logDirectory: 'storage/logs',
      fileName: 'billing.ndjson',
      maxSize: 25 * 1024 * 1024,
      compressOnRotate: true,
      retention: { maxFiles: 14, maxAgeMs: 14 * 24 * 60 * 60 * 1000 },
    }),
  ],
});

logger.info('Invoice created', { invoiceId: 'inv_42' });
await logger.logAsync('critical', 'Settlement failed', { settlementId: 'stl_9' });
await logger.close();
```

## Structured context and fluent loggers

```js
const requestLog = logger.forRequest(req, { tenantId: 'tenant-7' });
requestLog.info('Request accepted');

await requestLog
  .channel('security')
  .with({ userId: 'user-4' })
  .withTags('authentication', 'policy')
  .logAsync('notice', 'Policy evaluated', { decision: 'allow' });

const elapsed = logger.time('rawmongo.users.find');
await users.findOne({ email });
elapsed.end('metric', { collection: 'users' });
```

Child loggers share the parent runtime, queues, transports, metrics, and context store. They only carry immutable context and policy.

## Channels and stacks

```js
import { ChannelManager } from 'rawnode-logger/channels';

const logs = new ChannelManager({
  default: 'stack',
  base: { profile: 'production', service: 'orders' },
  channels: {
    stack: { driver: 'stack', channels: ['console', 'daily'] },
    console: { driver: 'console', structured: true },
    daily: {
      driver: 'file',
      directory: 'storage/logs',
      filename: 'orders.ndjson',
      compress: true,
    },
  },
});

logs.channel().info('Order accepted', { orderId: 'ord_1' });
await logs.close();
```

Built-in drivers include console, file/daily, audit, memory, null, stream, callback, Redis Streams, TCP/TLS, UDP, and HTTP batch. Custom drivers are registered with `manager.extend(name, factory)`.

## Security

The production profile enables safe serialization, redaction, control-character sanitization, and ANSI stripping before records reach transports. It handles cycles, `BigInt`, errors with causes, maps, sets, buffers, hostile getters, nested secrets, authorization headers, cookies, JWTs, and URL query secrets.

```js
const logger = createLogger({
  security: {
    enabled: true,
    paths: ['data.customer.ssn'],
    replacement: '[REDACTED]',
  },
});
```

For append-only security and compliance events, use `AuditFileTransport`. Each record is chained with an HMAC and can be verified through the CLI.

## Lifecycle and delivery semantics

Fire-and-forget methods remain compatible and return `undefined`. Use `logAsync()` when the caller needs a delivery result. Use `flush()` before process handoff and `close()` during teardown.

```js
logger.info('Queued');
await logger.flush({ timeoutMs: 5000, throwOnError: true });
await logger.close();
```

Queues are bounded by item count and bytes. Low-severity records can be shed according to policy, while non-droppable levels use bounded emergency overcommit and a direct stderr fallback instead of silent loss.

## Testing

```js
import { createLoggerHarness } from 'rawnode-logger/testing';

const harness = createLoggerHarness();
harness.logger.info('Created', { id: 42 });
await harness.flush();
harness.assertLogged('info', /Created/);
await harness.close();
```

## CLI

```bash
rawnode-logger doctor --json
rawnode-logger health --json
rawnode-logger channels --json
rawnode-logger levels --json
rawnode-logger config --json
rawnode-logger bench --iterations 25000 --json
rawnode-logger rotate daily --json
rawnode-logger verify-audit storage/logs/audit/audit.ndjson --json
rawnode-logger tail storage/logs/application.log --lines 100
```

Configuration output masks secrets unless `--reveal` is explicitly supplied.

## Package subpaths

Official subpaths include `/enterprise`, `/public`, `/core`, `/transports`, `/serialization`, `/formatters`, `/security`, `/observability`, `/channels`, `/processing`, `/plugins`, `/context`, `/records`, `/testing`, `/integrations`, `/inspector`, `/console`, `/config`, `/colors`, and `/legacy`.

See `docs/` for production configuration, transport details, security, observability, structured records, and benchmarking methodology.
