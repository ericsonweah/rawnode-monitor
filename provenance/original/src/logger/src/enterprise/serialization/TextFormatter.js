'use strict';

function dataText(data, serializer) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  return serializer.stringify(data);
}

export class TextFormatter {
  constructor(options = {}) {
    this.includeTimestamp = options.includeTimestamp !== false;
    this.includeLevel = options.includeLevel !== false;
    this.includeChannel = options.includeChannel === true;
    this.includeContext = options.includeContext === true;
    this.separator = options.separator || ' ';
  }

  format(record, serializer) {
    const parts = [];
    if (this.includeTimestamp) parts.push(`[${record.timestamp}]`);
    if (this.includeLevel) parts.push(`[${String(record.level).toUpperCase()}]`);
    if (this.includeChannel && record.channel) parts.push(`[${record.channel}]`);
    parts.push(String(record.message ?? ''));
    if (record.data != null) parts.push(`=> ${dataText(record.data, serializer)}`);
    if (this.includeContext && record.context && Object.keys(record.context).length) {
      parts.push(`context=${serializer.stringify(record.context)}`);
    }
    if (record.error) parts.push(`error=${serializer.stringify(record.error)}`);
    return parts.join(this.separator);
  }
}

export default TextFormatter;
