# RawNode Framework Overlay

This directory contains only the framework-level integration files. The complete event implementation remains under `src/events` at the package root.

Apply the release in this order:

1. Replace the framework's `src/events` directory with the package `src/events` directory.
2. Replace `src/foundation/providers/EventServiceProvider.js` with the wrapper in this overlay.
3. Merge `config/events.js`, preserving existing application listener and subscriber declarations.
4. Keep the existing `#events` and `#events/*` package import mappings; the uploaded framework already defines them.
5. Boot first with `EVENTS_PROFILE=compat`, run the compatibility suite, then enable production bounds.

The provider registers the dispatcher, Redis bridge, broadcasting, contracts, codecs, outbox, queue, scheduler, workflows, event store, projections, and console commands lazily. Optional subsystems do not allocate operational resources until enabled or explicitly resolved.
