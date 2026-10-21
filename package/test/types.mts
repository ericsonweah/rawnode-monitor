import MonitorRuntime, { MetricRegistry, HealthRegistry, PMMonitorBridge, SignalKind, type HealthReport } from '@rawnode/monitor';
import { MonitorStudioManager, registerMonitorStudioRoutes } from '@rawnode/monitor/studio';
import { MonitorServiceProvider } from '@rawnode/monitor/provider';
import config from '@rawnode/monitor/config';
import { mountMonitorStudio } from '@rawnode/monitor/studio/client';
const monitor = new MonitorRuntime({ config, pm: {registerResource(){}} });
const metrics = new MetricRegistry({maxSeries:12});
metrics.counter('requests').inc({route:'/example'});
monitor.trace('task', async span => { span.setAttribute('fixture', true); });
const health: Promise<HealthReport> = monitor.readiness();
monitor.emitSignal(SignalKind.EVENT,{name:'fixture'});
const registry = new HealthRegistry({timeoutMs:25});registry.register('fixture',({signal})=>({ok:!signal.aborted}));
const bridge = new PMMonitorBridge({registerResource(){return ()=>{}}},monitor);bridge.start();bridge.close();
const studio = new MonitorStudioManager({monitor});registerMonitorStudioRoutes({get(){},post(){},delete(){}},{studio});
const provider = new MonitorServiceProvider({}, {allowsBackgroundAutoStart:()=>false});
declare const root: HTMLElement;
const ui=mountMonitorStudio(root);ui.destroy();
// @ts-expect-error signal kinds are a closed set
monitor.emitSignal('arbitrary-unbounded-kind',{});
// @ts-expect-error counters require numeric increments
metrics.counter('bad').add('not-a-number');
void health;void provider;
