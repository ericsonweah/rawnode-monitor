'use strict';

import JsonFormatter from './JsonFormatter.js';

export class NdjsonFormatter extends JsonFormatter {
  format(record, serializer) {
    return `${super.format(record, serializer)}\n`;
  }
}

export default NdjsonFormatter;
