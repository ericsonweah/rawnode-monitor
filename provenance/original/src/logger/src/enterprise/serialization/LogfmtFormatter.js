'use strict';

function quote(value) {
  const text = String(value ?? '');
  return /[\s="\\]/.test(text) ? JSON.stringify(text) : text;
}

export class LogfmtFormatter {
  format(record, serializer) {
    const fields = {
      time: record.timestamp,
      level: record.level,
      message: record.message,
      channel: record.channel,
      service: record.service,
      request_id: record.requestId,
      trace_id: record.traceId,
      span_id: record.spanId,
      tenant_id: record.tenantId,
    };
    const output = [];
    for (const [key, value] of Object.entries(fields)) if (value != null && value !== '') output.push(`${key}=${quote(value)}`);
    if (record.data != null) output.push(`data=${quote(serializer.stringify(record.data))}`);
    if (record.error != null) output.push(`error=${quote(serializer.stringify(record.error))}`);
    return output.join(' ');
  }
}

export default LogfmtFormatter;
