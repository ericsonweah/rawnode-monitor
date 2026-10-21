'use strict';

export { default as LoggerRuntime, LoggerRuntime as Runtime, createLogger as createRuntimeLogger } from './core/LoggerRuntime.js';
export { default as LevelRegistry, DEFAULT_LEVELS } from './core/LevelRegistry.js';
export { default as DeliveryQueue } from './core/DeliveryQueue.js';
export { default as LoggerLifecycle } from './core/LoggerLifecycle.js';
export { default as InternalDiagnostics } from './core/InternalDiagnostics.js';
export { default as TransportAdapter, COMPATIBILITY_VIEW } from './core/TransportAdapter.js';
export { default as TransportDispatcher } from './core/TransportDispatcher.js';

export { default as createLogger } from './public/createLogger.js';
export { default as LoggerBuilder } from './public/LoggerBuilder.js';
export { default as LoggerFacade } from './public/LoggerFacade.js';
export { default as NullLogger, nullLogger } from './public/NullLogger.js';

export { default as ContextManager, globalContextManager, globalContextManager as defaultContextManager } from './context/ContextManager.js';
export { default as RecordFactory, resolveMessageAndError } from './records/RecordFactory.js';
export { default as ErrorNormalizer } from './records/ErrorNormalizer.js';

export { default as SafeSerializer, defaultSerializer, truncateUtf8 } from './serialization/SafeSerializer.js';
export { default as TextFormatter } from './serialization/TextFormatter.js';
export { default as JsonFormatter } from './serialization/JsonFormatter.js';
export { default as NdjsonFormatter } from './serialization/NdjsonFormatter.js';
export { default as LogfmtFormatter } from './serialization/LogfmtFormatter.js';

export { default as Redactor, sanitizeString, DEFAULT_KEYS as DEFAULT_REDACTION_KEYS } from './security/Redactor.js';
export { default as SensitiveFieldRegistry, DEFAULT_PATTERNS as DEFAULT_SENSITIVE_PATTERNS } from './security/SensitiveFieldRegistry.js';
export { default as ControlCharacterSanitizer } from './security/ControlCharacterSanitizer.js';
export { default as AuditChain, stableStringify as stableAuditStringify } from './security/AuditChain.js';

export { default as ProcessorRegistry } from './processing/ProcessorRegistry.js';
export { default as SamplingProcessor } from './processing/SamplingProcessor.js';
export { default as DeduplicationProcessor } from './processing/DeduplicationProcessor.js';
export { default as PluginManager } from './plugins/PluginManager.js';

export { default as LoggerMetrics } from './observability/LoggerMetrics.js';
export { default as LoggerHealth } from './observability/LoggerHealth.js';

export { default as BaseEnterpriseTransport } from './transports/BaseTransport.js';
export { default as EnterpriseConsoleTransport } from './transports/ConsoleTransport.js';
export { default as EnterpriseFileTransport, default as AsyncFileTransport } from './transports/FileTransport.js';
export { default as AuditFileTransport } from './transports/AuditFileTransport.js';
export { default as MemoryTransport } from './transports/MemoryTransport.js';
export { default as StreamTransport } from './transports/StreamTransport.js';
export { default as CallbackTransport } from './transports/CallbackTransport.js';
export { default as NullTransport } from './transports/NullTransport.js';
export { default as RedisStreamTransport } from './transports/RedisStreamTransport.js';
export { default as TcpTransport } from './transports/TcpTransport.js';
export { default as UdpTransport } from './transports/UdpTransport.js';
export { default as HttpBatchTransport } from './transports/HttpBatchTransport.js';

export { default as LoggerConfiguration, LoggerConfigurationError, cloneLoggerConfiguration, mergeLoggerConfiguration } from './config/LoggerConfiguration.js';
export { default as defaultLoggerConfiguration } from '../../config/logger.js';

export { default as ChannelManager } from './channels/ChannelManager.js';
export { default as Channel } from './channels/Channel.js';
export { default as StackChannel } from './channels/StackChannel.js';

export { default as InspectorTransport } from './inspector/InspectorTransport.js';
export { default as InspectorServer } from './inspector/InspectorServer.js';

export { default as LoggerServiceProvider } from './integrations/LoggerServiceProvider.js';
export { default as ProcessErrorHandler } from './integrations/ProcessErrorHandler.js';
export { default as HttpLoggingMiddleware, createHttpLoggingMiddleware } from './integrations/HttpLoggingMiddleware.js';
export { default as EventLoggingBridge } from './integrations/EventLoggingBridge.js';
export { default as SwappableLogger } from './integrations/SwappableLogger.js';

export { default as LoggerRecorder } from './testing/LoggerRecorder.js';
export { default as FakeClock } from './testing/FakeClock.js';

export {
  COMPATIBILITY_PROFILES,
  COMPATIBILITY_PROFILES as LOGGER_PROFILES,
  resolveCompatibilityProfile,
  resolveCompatibilityProfile as resolveLoggerProfile,
} from './compatibility/CompatibilityProfile.js';

export { runDoctor, runCli, runLoggerBenchmark, tailLogFile } from './console/index.js';
