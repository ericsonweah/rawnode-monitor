import type { LoggerLike } from './index.js';
export class LoggerServiceProvider {
  static dependencies: string[];
  static priority: number;
  constructor(app: unknown, options?: Record<string, unknown>);
  logger: LoggerLike | null;
  register(): Promise<LoggerLike>;
  boot(): Promise<void>;
  tearDown(options?: Record<string, unknown>): Promise<void>;
  shutdown(options?: Record<string, unknown>): Promise<void>;
}
export class HttpLoggingMiddleware {
  constructor(logger: LoggerLike, options?: Record<string, unknown>);
  handle(req: any, res: any, next: Function): Promise<unknown>;
}
export function createHttpLoggingMiddleware(logger: LoggerLike, options?: Record<string, unknown>): (req: any, res: any, next: Function) => Promise<unknown>;
export class ProcessErrorHandler { constructor(logger: LoggerLike, options?: Record<string, unknown>); attach(): this; detach(): void; }
export class EventLoggingBridge { constructor(events: any, logger: LoggerLike, options?: Record<string, unknown>); listen(event: string, level?: string, mapper?: Function | null): this; close(): void; }
export class SwappableLogger { constructor(target?: LoggerLike | null); swap(target: LoggerLike): LoggerLike | null; current(): LoggerLike | null; [key: string]: any; }

export interface SwappableLogger extends LoggerLike {}
