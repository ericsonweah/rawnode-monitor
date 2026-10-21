'use strict';

import formatLog from '../../submodules/formatter/formatLog.js';
import buildLogEntry from '../../submodules/formatter/buildLogEntry.js';
import colors from '../../submodules/colors/index.js';

const endTimestamp = colors.rgb(184, 197, 209);
const plain = (record) => {
  let formatted = `[${record.timestamp}] [${String(record.level).toUpperCase()}] ${record.message}`;
  if (record.data != null) {
    let data;
    try { data = typeof record.data === 'string' ? record.data : JSON.stringify(record.data); }
    catch { data = String(record.data); }
    formatted += ` => ${data}`;
  }
  return { timestamp: record.timestamp, level: record.level, message: record.message, formatted, data: record.data };
};

export class LegacyRecordFactory {
  constructor(options = {}) {
    this.colors = options.colors !== false;
    this.serialize = options.serialize === true;
    this.style = options.style || 'advanced';
  }

  create(record) {
    if (!this.colors || this.style === 'simple') return plain(record);
    const data = record.data == null ? record.data : record.data;
    try {
      const formatter = formatLog({ timestamp: record.timestamp, level: record.level, message: record.message, data });
      const formatted = this.serialize ? JSON.stringify(formatter) : formatter;
      return buildLogEntry({
        timestamp: endTimestamp(record.timestamp),
        level: record.level,
        message: record.message,
        formatted,
        data: colors.green(data),
        color: colors.white,
      });
    } catch {
      return plain(record);
    }
  }
}

export default LegacyRecordFactory;
