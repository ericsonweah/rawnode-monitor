# Channels and stacks

`ChannelManager` resolves named logging policy lazily. A channel owns one logger runtime; a stack routes one canonical event to several named channels.

Supported drivers: `console`, `file`, `daily`, `audit`, `memory`, `null`, `redis`, `redis-stream`, `tcp`, `tls`, `udp`, `http`, and `http-batch`.

Custom drivers receive `{ name, definition, manager, base, resolve }` and may return either a logger or a transport. Static stack graphs are checked for cycles before construction.

External resources can be resolved with `setBindingResolver`, allowing Redis and stream instances to remain owned by the application container.
