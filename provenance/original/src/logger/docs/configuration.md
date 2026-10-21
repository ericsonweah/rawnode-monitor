# Configuration

`config/logger.js` defines the default profile, level, channel, service, environment, security, queue, channels, and process-handler policy. `LoggerConfiguration` deep-clones, safely merges, validates, freezes, and snapshots configuration without prototype pollution.

Environment variables include `LOG_PROFILE`, `LOG_LEVEL`, `LOG_CHANNEL`, `LOG_QUEUE_MAX_ITEMS`, `LOG_QUEUE_MAX_BYTES`, `LOG_QUEUE_OVERFLOW`, `LOG_DIRECTORY`, `LOG_FILE`, `LOG_FILE_MAX_BYTES`, `LOG_COMPRESS`, `LOG_RETENTION_FILES`, `LOG_AUDIT_SECRET`, and `LOG_PROCESS_ERRORS`.
