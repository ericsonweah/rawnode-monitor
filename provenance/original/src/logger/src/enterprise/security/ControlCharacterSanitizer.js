'use strict';

const ANSI = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const C0 = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export class ControlCharacterSanitizer {
  constructor(options = {}) {
    this.options = {
      escapeNewlines: true,
      stripAnsi: true,
      blockBidi: true,
      stripControls: true,
      ...options,
    };
  }

  sanitize(value, overrides = {}) {
    const options = { ...this.options, ...overrides };
    let text = String(value ?? '');
    if (options.stripAnsi) text = text.replace(ANSI, '');
    if (options.blockBidi) text = text.replace(BIDI, '');
    if (options.stripControls) text = text.replace(C0, '');
    if (options.escapeNewlines) text = text.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    return text;
  }
}

export { ANSI as ANSI_PATTERN, BIDI as BIDI_PATTERN };
export default ControlCharacterSanitizer;
