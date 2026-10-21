export interface MonitorStudioHandle {
 refresh(): Promise<void>; navigate(view: string): Promise<void>;
 snapshot(): { destroyed: boolean; view: string; connected: boolean; streaming: boolean; polling: boolean };
 destroy(): void;
}
export function mountMonitorStudio(root?: HTMLElement, options?: { fetch?: typeof fetch; EventSource?: typeof EventSource }): MonitorStudioHandle;
