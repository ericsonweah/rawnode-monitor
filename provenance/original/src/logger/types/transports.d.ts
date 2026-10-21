import type { LogRecord, LoggerTransport, SafeSerializer } from './index.js';

export class BaseTransport implements LoggerTransport {
  constructor(options?: Record<string, unknown>);
  name: string;
  serializer: SafeSerializer;
  silent: boolean;
  closed: boolean;
  stats: Record<string, unknown>;
  writeRecord(record: LogRecord): void | Promise<void>;
  writeBatch(records: LogRecord[]): Promise<void>;
  flush(options?: Record<string, unknown>): Promise<void>;
  reopen(options?: Record<string, unknown>): Promise<unknown>;
  close(options?: Record<string, unknown>): Promise<void>;
  health(): Record<string, unknown>;
}
export class ConsoleTransport extends BaseTransport { constructor(options?: Record<string, unknown>); }
export class FileTransport extends BaseTransport {
  constructor(options?: Record<string, unknown>);
  filePath: string;
  logDirectory: string;
  fileName: string;
  rotate(options?: Record<string, unknown>): Promise<{ archive: string; source?: string; compressed?: boolean } | null>;
  ready(): Promise<this>;
}
export { FileTransport as AsyncFileTransport };
export class AuditFileTransport extends FileTransport {
  constructor(options: Record<string, unknown> & { key?: string | Uint8Array; secret?: string | Uint8Array; keyResolver?: Function });
  static verifyFile(filePath: string, options: Record<string, unknown> & { key?: string | Uint8Array; secret?: string | Uint8Array; keyResolver?: Function }): Promise<{ valid: boolean; ok: boolean; lines: number; count: number; failures: unknown[]; finalHash: string; sequence: number }>;
}
export class MemoryTransport extends BaseTransport {
  constructor(options?: { maxItems?: number; limit?: number; clone?: boolean; name?: string; serializer?: SafeSerializer });
  records: LogRecord[];
  all(): LogRecord[];
  latest(count?: number): LogRecord[];
  clear(): number;
  find(predicate: (record: LogRecord) => boolean): LogRecord | undefined;
  filter(predicate: (record: LogRecord) => boolean): LogRecord[];
  atLevel(level: string): LogRecord[];
}
export class StreamTransport extends BaseTransport { constructor(stream: unknown, options?: Record<string, unknown>); }
export class CallbackTransport extends BaseTransport { constructor(callback: (record: LogRecord) => unknown, options?: Record<string, unknown>); }
export class NullTransport extends BaseTransport {}
export class RedisStreamTransport extends BaseTransport { constructor(client: unknown, options?: Record<string, unknown>); }
export class TcpTransport extends BaseTransport { constructor(options: Record<string, unknown> & { port: number; host?: string }); connect(): Promise<unknown>; }
export class UdpTransport extends BaseTransport { constructor(options: Record<string, unknown> & { port: number; host?: string }); }
export class HttpBatchTransport extends BaseTransport { constructor(options: Record<string, unknown> & ({ url: string } | { endpoint: string })); }
export class TransportAdapter { constructor(transport: LoggerTransport, options?: Record<string, unknown>); enqueue(record: LogRecord, options?: Record<string, unknown>): Promise<unknown>; flush(options?: Record<string, unknown>): Promise<void>; close(options?: Record<string, unknown>): Promise<void>; health(): Record<string, unknown>; }
export class TransportDispatcher { constructor(options?: Record<string, unknown>); add(transport: LoggerTransport, options?: Record<string, unknown>): TransportAdapter; remove(value: unknown, options?: Record<string, unknown>): TransportAdapter | null; dispatch(record: LogRecord, options?: Record<string, unknown>): Promise<unknown>; flush(options?: Record<string, unknown>): Promise<unknown>; close(options?: Record<string, unknown>): Promise<unknown>; health(): Array<Record<string, unknown>>; }
export const COMPATIBILITY_VIEW: symbol;
