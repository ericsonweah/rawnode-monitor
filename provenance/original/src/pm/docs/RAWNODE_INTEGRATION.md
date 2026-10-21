# RawNode Integration

The automated path is:

```bash
rawnode-pm integrate --root /path/to/rawnode --dry-run
rawnode-pm integrate --root /path/to/rawnode
```

The integrator validates every anchor before writing, creates timestamped backups, writes atomically, and rolls back all touched files if any write fails.

The manual changes below use RawNode's required Anchor and Payload protocol.

## Register the runtime provider

**File**: `src/foundation/Application.js`

**Anchor**: Locate this exact block:

```js
import { ColorServiceProvider } from '#providers/ColorServiceProvider.js';
import TestServiceProvider from '#providers/TestServiceProvider.js';
import { EditorServiceProvider } from '#editor';
```

**Action**: Replace it with:

**Payload**:

```js
import { ColorServiceProvider } from '#providers/ColorServiceProvider.js';
import TestServiceProvider from '#providers/TestServiceProvider.js';
import { EditorServiceProvider } from '#editor';
import { RawNodePmServiceProvider } from 'rawnode-pm/integration/rawnode';
```

**File**: `src/foundation/Application.js`

**Anchor**: Locate this exact block:

```js
        this.register(TestServiceProvider);
        this.register(ConsoleServiceProvider);
        this.register(SdspaServiceProvider); // 👈 Register it here
```

**Action**: Replace it with:

**Payload**:

```js
        this.register(TestServiceProvider);
        this.register(RawNodePmServiceProvider);
        this.register(ConsoleServiceProvider);
        this.register(SdspaServiceProvider); // 👈 Register it here
```

## Track the hybrid server

**File**: `src/console/commands/ServeCommand.js`

**Anchor**: Locate this exact block:

```js
    const server = new HybridServer(
        tcpSkin || { onConnection:()=>{}, onData:()=>{}, onDisconnect:()=>{} }, 
        httpHandler,
        udpApp // 👈 Pass UDP App here
    );
```

**Action**: Replace it with:

**Payload**:

```js
    const server = new HybridServer(
        tcpSkin || { onConnection:()=>{}, onData:()=>{}, onDisconnect:()=>{} }, 
        httpHandler,
        udpApp // 👈 Pass UDP App here
    );

    // RawNode PM runtime integration: tracks active protocol sockets and enables
    // readiness-gated rolling replacement plus graceful connection draining.
    const pmRuntime = this.app.container.has('runtime.pm')
      ? this.app.resolve('runtime.pm')
      : null;
    pmRuntime?.trackServer(server, { name: 'hybrid' });
```

## Declare readiness only after listen

**File**: `src/console/commands/ServeCommand.js`

**Anchor**: Locate this exact block:

```js
    server.listen(port, () => {
        this.info(`RawNode Multi Protocol Server running on port ${port}`);
        this.info(`- HTTP/WebSocket: Ready`);
        if (tcpSkin) this.info(`- Raw TCP: Ready`);
        if (udpApp)  this.info(`- Reliable UDP: Ready (RUDP)`);
        
        this.line('Press Ctrl+C to stop');
    });
```

**Action**: Replace it with:

**Payload**:

```js
    server.listen(port, () => {
        pmRuntime?.ready({
          source: 'serve-command',
          port: Number(port),
          protocols: {
            http: true,
            websocket: !!wsService,
            tcp: !!tcpSkin,
            udp: !!udpApp,
          },
        });

        this.info(`RawNode Multi Protocol Server running on port ${port}`);
        this.info(`- HTTP/WebSocket: Ready`);
        if (tcpSkin) this.info(`- Raw TCP: Ready`);
        if (udpApp)  this.info(`- Reliable UDP: Ready (RUDP)`);
        
        this.line('Press Ctrl+C to stop');
    });
```

## Add the first-party configuration and manifest

Copy these shipped templates into the RawNode application root:

- `rawnode-pm/config/pm.js` -> `config/pm.js`
- `rawnode-pm/config/rawnode.process.example.mjs` -> `rawnode.process.mjs`

The automated integrator performs these copies only when the targets are missing, unless `--force` is explicitly supplied.

## Lifecycle behavior

`RawNodePmServiceProvider` starts the runtime agent only when `RAWNODE_PM_MANAGED=1` or `pm.runtime.enabled` is true. Unmanaged RawNode processes continue to run normally.

During shutdown, the runtime adapter:

1. marks readiness false;
2. dispatches `pm:runtime:draining`;
3. drains registered framework resources;
4. closes tracked servers;
5. waits for active connections until the deadline;
6. destroys remaining tracked sockets only after timeout;
7. dispatches `pm:runtime:shutting-down`;
8. calls RawNode application shutdown/provider teardown.
