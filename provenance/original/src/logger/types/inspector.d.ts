import type { LogRecord } from './index.js';
import { BaseTransport } from './transports.js';
export class InspectorTransport extends BaseTransport {
  constructor(options?: Record<string, unknown>);
  channel: string;
  maxBuffer: number;
  maxBufferBytes: number;
  bufferBytes: number;
  getBufferedLogs(options?: { level?: string; channel?: string; limit?: number; clone?: boolean }): LogRecord[];
  clear(): number;
  health(): Record<string, unknown>;
}
export class InspectorServer {
  constructor(transport: InspectorTransport, portOrOptions?: number | Record<string, unknown>);
  start(): Promise<unknown>;
  address(): unknown;
  broadcast(record: LogRecord): void;
  buildFrame(payload: unknown): Uint8Array;
  close(): Promise<void>;
}
