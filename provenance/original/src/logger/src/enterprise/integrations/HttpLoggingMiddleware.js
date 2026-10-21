'use strict';

import { randomUUID } from 'node:crypto';

function responseStatus(res) {
  return res?.statusCode ?? res?.raw?.statusCode ?? null;
}

export class HttpLoggingMiddleware {
  constructor(logger, options = {}) {
    if (!logger) throw new TypeError('HttpLoggingMiddleware requires a logger.');
    this.logger = logger;
    this.options = {
      requestLevel: options.requestLevel || 'info',
      responseLevel: options.responseLevel || 'info',
      errorLevel: options.errorLevel || 'error',
      requestIdHeader: String(options.requestIdHeader || 'x-request-id').toLowerCase(),
      logRequest: options.logRequest !== false,
      logResponse: options.logResponse !== false,
      includeHeaders: options.includeHeaders === true,
      requestIdFactory: options.requestIdFactory || randomUUID,
    };
  }

  async handle(req, res, next) {
    const started = process.hrtime.bigint();
    const headers = req?.headers || {};
    const requestId = req?.id || req?.requestId || headers[this.options.requestIdHeader] || this.options.requestIdFactory();
    req.requestId ||= requestId;
    try { res?.setHeader?.('X-Request-Id', requestId); } catch {}
    const context = {
      requestId,
      method: req?.method,
      path: (typeof req?.path === 'function' ? req.path() : req?.path) || req?.url,
      remoteAddress: req?.ip || req?.socket?.remoteAddress,
      protocol: req?.protocol || (req?.socket?.encrypted ? 'https' : 'http'),
      userAgent: headers['user-agent'],
      tenantId: req?.tenantId || req?.tenant?.id,
      userId: req?.user?.id || req?.user?._id || req?.user?.sub,
    };
    if (this.options.includeHeaders) context.headers = headers;
    const requestLogger = this.logger.child(context);

    return await this.logger.runWithContext(context, async () => {
      if (this.options.logRequest) requestLogger.log(this.options.requestLevel, 'HTTP request received');
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        if (this.options.logResponse) requestLogger.log(this.options.responseLevel, 'HTTP request completed', { statusCode: responseStatus(res), durationMs });
      };
      res?.once?.('finish', finish);
      res?.once?.('close', finish);
      try {
        const result = await next();
        if (!res?.once) finish();
        return result;
      } catch (error) {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        requestLogger.log(this.options.errorLevel, 'HTTP request failed', { statusCode: responseStatus(res), durationMs }, { error });
        throw error;
      }
    });
  }
}

export function createHttpLoggingMiddleware(logger, options = {}) {
  const middleware = new HttpLoggingMiddleware(logger, options);
  return middleware.handle.bind(middleware);
}

export default HttpLoggingMiddleware;
