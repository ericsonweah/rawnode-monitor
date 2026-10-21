"use strict";

/**
 * Typed errors for color functions.
 */
class ColorParseError extends Error {
  constructor(message, input) {
    super(message);
    this.name = "ColorParseError";
    if (input !== undefined) this.input = input;
  }
}
class ColorRangeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ColorRangeError";
  }
}

export default { ColorParseError, ColorRangeError };
export  { ColorParseError, ColorRangeError };
