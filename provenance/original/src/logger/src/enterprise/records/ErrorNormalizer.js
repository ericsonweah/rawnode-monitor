'use strict';

export class ErrorNormalizer {
  constructor(serializer, options = {}) {
    this.serializer = serializer;
    this.maxCauseDepth = Math.max(0, Number(options.maxCauseDepth) || 8);
    this.includeStack = options.includeStack !== false;
  }

  normalize(error, depth = 0) {
    if (error == null) return null;
    if (!(error instanceof Error)) {
      return {
        name: 'NonErrorThrown',
        message: typeof error === 'string' ? error : 'A non-Error value was thrown.',
        value: this.serializer.normalize(error),
      };
    }

    const output = {
      name: error.name || 'Error',
      message: error.message || '',
    };
    if (this.includeStack && error.stack) output.stack = error.stack;
    if (error.code !== undefined) output.code = this.serializer.normalize(error.code);
    if (error.status !== undefined) output.status = this.serializer.normalize(error.status);
    if (error.statusCode !== undefined) output.statusCode = this.serializer.normalize(error.statusCode);
    if (error.details !== undefined) output.details = this.serializer.normalize(error.details);
    if (error instanceof AggregateError) {
      output.errors = Array.from(error.errors || []).map((item) => (
        depth < this.maxCauseDepth ? this.normalize(item, depth + 1) : { name: 'MaxCauseDepth', message: 'Cause chain truncated.' }
      ));
    }
    if (error.cause !== undefined) {
      output.cause = depth < this.maxCauseDepth
        ? this.normalize(error.cause, depth + 1)
        : { name: 'MaxCauseDepth', message: 'Cause chain truncated.' };
    }
    return output;
  }
}

export default ErrorNormalizer;
