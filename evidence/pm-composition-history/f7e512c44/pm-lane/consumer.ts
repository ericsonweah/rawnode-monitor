import {RawNodeRuntimeAdapter,RuntimeAgent} from '@rawnode/pm/runtime';
import {MonitorRuntime} from '@rawnode/monitor';
import {PMMonitorBridge} from '@rawnode/monitor/integrations';
const adapter=new RawNodeRuntimeAdapter();const runtime=new RuntimeAgent({adapter});const monitor=new MonitorRuntime({profile:'test'});
const bridge=new PMMonitorBridge(runtime,monitor);bridge.start();void bridge.close();
adapter.registerResource('monitor',{health:()=>monitor.health(),metrics:()=>monitor.metricsSnapshot(),diagnostics:()=>monitor.diagnostics()});const removed:boolean=adapter.unregisterResource('monitor');
