import type { LogRecord, LoggerRuntime } from './index.js';
import { MemoryTransport } from './transports.js';
export class FakeClock {
  constructor(start?: number);
  now: number;
  tick(ms?: number): number;
  set(value: number): number;
  callback(): () => number;
}
export class LoggerRecorder {
  constructor(options?: Record<string, unknown>);
  logger: LoggerRuntime;
  transport: MemoryTransport;
  records(): LogRecord[];
  latest(count?: number): LogRecord[];
  clear(): number;
  flush(): Promise<LogRecord[]>;
  close(): Promise<void>;
  assertCount(expected: number): this;
  assertLogged(level: string, matcher?: string | RegExp | ((record: LogRecord) => boolean) | null): this;
  assertNotLogged(level: string, matcher?: string | RegExp | ((record: LogRecord) => boolean) | null): this;
}
export function createLoggerHarness(options?: Record<string, unknown>): LoggerRecorder;
export { MemoryTransport } from './transports.js';
