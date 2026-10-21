import logger, {
  createLogger,
  Logger,
  AdvancedLogger,
  LoggerRuntime,
  LoggerBuilder,
  LoggerConfiguration,
  MemoryTransport,
  EnterpriseFileTransport,
  ChannelManager,
  createHttpLoggingMiddleware,
  InspectorTransport,
  InspectorServer,
  LoggerRecorder,
  runDoctor,
  type LogRecord,
  type LoggerLike,
} from 'rawnode-logger';
import { TcpTransport, HttpBatchTransport } from 'rawnode-logger/transports';
import { FakeClock } from 'rawnode-logger/testing';
import { LoggerServiceProvider } from 'rawnode-logger/integrations';
import loggerConfig from 'rawnode-logger/config';

const memory = new MemoryTransport({ maxItems: 100 });
const enterprise = createLogger<{ requestId?: string }>({ level: 'debug', transports: [memory] });
enterprise.info('hello', { ok: true });
enterprise.child({ requestId: 'req-1' }).warn('warning');
const child: LoggerLike = enterprise.channel('audit');
child.error(new Error('failure'));
const record: LogRecord | undefined = memory.all()[0];
void record?.traceId;

const runtime = new LoggerRuntime({ transports: [memory] });
runtime.processor((value) => value, { phase: 'after-redaction' });
const builder: LoggerBuilder = Logger.create().production().level('debug').transport(memory);
const built: AdvancedLogger = builder.done();
const file = new EnterpriseFileTransport({ directory: 'logs', filename: 'app.log' });
const tcp = new TcpTransport({ port: 9000 });
const http = new HttpBatchTransport({ url: 'http://127.0.0.1:9001/logs' });
void [file, tcp, http];

const channels = new ChannelManager({ default: 'memory', channels: { memory: { driver: 'memory' } } });
channels.channel().info('channel');
const middleware = createHttpLoggingMiddleware(enterprise);
void middleware;
const inspectorTransport = new InspectorTransport();
const inspector = new InspectorServer(inspectorTransport, { port: 0 });
void inspector;
const recorder = new LoggerRecorder({ clock: new FakeClock().callback() });
recorder.assertNotLogged('error');
const configuration = new LoggerConfiguration(loggerConfig);
void configuration.snapshot();
void LoggerServiceProvider;
void runDoctor();
void logger;
await enterprise.close();
await runtime.close();
await built.close();
