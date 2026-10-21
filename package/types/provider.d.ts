import type { MonitorRuntime, MonitorManager } from './index.js';
export interface MonitorProviderOptions { allowsBackgroundAutoStart?: (app: unknown) => boolean; assetsRoot?: string; }
export class MonitorServiceProvider {
 static dependencies: string[]; static priority: number;
 constructor(app: unknown, options?: MonitorProviderOptions);
 runtime: MonitorRuntime | null; manager: MonitorManager | null;
 register(): this; boot(): Promise<this>; teardown(): Promise<void>;
}
export default MonitorServiceProvider;
