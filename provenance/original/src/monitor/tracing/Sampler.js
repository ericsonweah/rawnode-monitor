'use strict';

export const SamplingDecision = Object.freeze({ DROP: 'drop', RECORD: 'record', RECORD_AND_SAMPLE: 'record-and-sample' });

export class AlwaysOnSampler { shouldSample() { return { decision: SamplingDecision.RECORD_AND_SAMPLE, attributes: null }; } description() { return 'AlwaysOnSampler'; } }
export class AlwaysOffSampler { shouldSample() { return { decision: SamplingDecision.DROP, attributes: null }; } description() { return 'AlwaysOffSampler'; } }

export class TraceIdRatioSampler {
  constructor(ratio = 1) { this.ratio = Math.max(0, Math.min(1, Number(ratio) || 0)); this.upperBound = BigInt(Math.floor(this.ratio * Number.MAX_SAFE_INTEGER)); }
  shouldSample(context) {
    if (this.ratio >= 1) return { decision: SamplingDecision.RECORD_AND_SAMPLE, attributes: null };
    if (this.ratio <= 0) return { decision: SamplingDecision.DROP, attributes: null };
    const lower = BigInt(`0x${String(context.traceId).slice(-13)}`);
    return { decision: lower <= this.upperBound ? SamplingDecision.RECORD_AND_SAMPLE : SamplingDecision.DROP, attributes: null };
  }
  description() { return `TraceIdRatioSampler{${this.ratio}}`; }
}

export class ParentBasedSampler {
  constructor(root = new AlwaysOnSampler()) { this.root = root; }
  shouldSample(context, options = {}) {
    const parent = options.parent;
    if (!parent) return this.root.shouldSample(context, options);
    return { decision: parent.sampled ? SamplingDecision.RECORD_AND_SAMPLE : SamplingDecision.DROP, attributes: null };
  }
  description() { return `ParentBased{${this.root.description?.() || 'custom'}}`; }
}

export function resolveSampler(options = {}) {
  if (options.sampler?.shouldSample) return options.sampler;
  const root = options.sampleRate >= 1 ? new AlwaysOnSampler() : options.sampleRate <= 0 ? new AlwaysOffSampler() : new TraceIdRatioSampler(options.sampleRate);
  return options.parentBased === false ? root : new ParentBasedSampler(root);
}
