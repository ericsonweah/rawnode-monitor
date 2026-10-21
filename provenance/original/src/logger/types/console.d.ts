export function runDoctor(options?: Record<string, unknown>): Promise<Record<string, unknown>>;
export function runCli(args?: string[]): Promise<number>;
export function runLoggerBenchmark(options?: Record<string, unknown>): Promise<Record<string, unknown>>;
export function tailLogFile(file: string, count?: number, maxBytes?: number): Promise<string>;
