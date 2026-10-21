# Security

The safe serializer never invokes getters by default and applies depth, key, array, string, value, and total-record limits. It supports cycles, shared references, `BigInt`, errors and causes, maps, sets, dates, URLs, regexes, buffers, and typed arrays.

The redaction phase covers sensitive key names, explicit object paths, bearer credentials, JWT-like values, cookies, authorization headers, and secret URL query parameters. Sanitization handles CR/LF log forging, terminal controls, ANSI sequences, and Unicode bidi controls.

Inspector clients only receive post-redaction canonical records. Inspector history is bounded by both records and bytes, defaults to loopback, and supports token and origin controls.
