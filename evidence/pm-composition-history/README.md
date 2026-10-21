# Historical PM composition pins

These records establish successful composition for the exact bytes identified in each directory. They do not represent the current PM release candidate.

- `f7e512c44`: superseded by PM after final corrections to callback deadlines, signal handler cleanup, quoted/positional secret redaction and environment documentation.
- `340b2fa87`: final status withdrawn after PM's independent rereview found that log closure could miss an in-flight detach/flush. Its previous passing composition remains a true historical test result; those tests did not establish correctness of the newly identified log-shutdown race.

Monitor's runtime package remained unchanged through both updates: SHA-256 `b246ee9eff0b3579f05c886f05ec485719bb1b4847c97c4eefa99dead480baad`.

The earlier Monitor evidence ZIP with SHA-256 `e5080a29cfaa52e6ad4c0dd8071c02d8c0e9f10cee5ec8bed59775a00e03e8c4` is preserved separately in the task workspace's `artifacts/history/`; it is superseded by the current delivery receipt after replacement-pin checks complete. No Library identity was created for that archive.
