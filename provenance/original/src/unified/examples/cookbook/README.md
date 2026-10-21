# RawNode Unified Usage Cookbook

Zero-dependency examples for the current `#unified` surface. The returned value
is the real callable RawNode HTTP application, decorated additively with native
WebSocket, TCP, UDP, lifecycle, health, metrics, diagnostics, and signal APIs.

## Import surface

```js
import Unified from '#unified';

const app = Unified({ profile: 'enterprise' });

app.http === app; // true
app.ws;           // SocketIOSkin
app.tcp;          // SocketSkin
app.udp;          // UDP/RUDP App
app.unified;      // UnifiedServer
```

`#rawnode-unified` and `#unified` are intended to resolve to the same module.
Static HTTP helpers remain available through `Unified.json()`,
`Unified.urlencoded()`, `Unified.text()`, `Unified.raw()`, `Unified.ndjson()`,
`Unified.multipart()`, `Unified.static()`, and `Unified.compress()`.

## Startup APIs

Use one startup style per application:

```js
const server = await app.start({ host: '127.0.0.1', port: 3000 });
```

or:

```js
const server = app.listen(3000, '127.0.0.1', () => {
  console.log(server.addresses());
});
```

Do not call `start()` and then `listen()` on the same running application.
`listen()` returns `UnifiedServer` synchronously; its callback receives no
arguments. Use the returned `server` variable or `app.addresses()`.

## UDP handler signature

The current UDP route contract is:

```js
app.udp.on('route', (body, response, request) => {
  response.reply({ ok: true });
});
```

- `response.reply(data, reliable)` replies on the request path.
- `response.send(path, data, reliable)` sends on an explicit path.

## Example map

1. `01-minimal-http` — smallest HTTP-only server.
2. `02-basic-all-protocols` — HTTP, WS, TCP, and UDP on one numeric port.
3. `03-listen-callback` — Node/Express-style callback startup.
4. `04-http` — middleware, grouped routes, rate limiting, compression, health.
5. `05-websocket` — handshake middleware, namespace, rooms, ACKs, browser client.
6. `06-tcp` — schemas, handlers, rooms, ACK requests, reconnecting client.
7. `07-udp` — cookie handshake, admission, RUDP requests, unreliable sends.
8. `08-combined` — one server plus clients for all four protocols.
9. `09-observability-and-drain` — health, metrics, diagnostics, explicit drain.
10. `10-lifecycle-plugin` — Unified lifecycle plugin hooks.
11. `11-optional-protocol` — deliberate degraded-mode policy.
12. `12-production` — hardened public endpoint with management protection.
13. `13-enterprise-tls` — HTTPS, WSS, secure RawNode TCP via ALPN, UDP same port.
14. `14-foundation-provider` — enterprise Foundation/container integration.
15. `15-proxy-protocol` — trusted L4 Proxy Protocol deployment.
16. `16-profile-and-protocol-matrix` — supported protocol combinations.

## Running

From the RawNode framework root:

```bash
node examples/unified/02-basic-all-protocols/server.js
```

For this standalone cookbook directory, copy the selected file into the
framework or preserve its relative location while running from the framework
root so package import aliases resolve.

HTTP probe:

```bash
curl -i http://127.0.0.1:3000/
curl -i -X POST http://127.0.0.1:3000/echo \
  -H 'content-type: application/json' \
  --data '{"hello":"http"}'
```

TCP and UDP clients:

```bash
node 06-tcp/client.js
node 07-udp/client.js
```

## Production rules

- Enterprise-family profiles reject ambiguous plaintext by default.
- WebSocket requires HTTP because it uses the HTTP upgrade registry.
- HTTP, WS, and TCP share one TCP listener; UDP owns a separate dgram socket on
  the same numeric port.
- TLS protects HTTP, WebSocket, and RawNode TCP. UDP requires its own codec
  encryption when payload confidentiality is required.
- Enable Proxy Protocol only for explicit trusted proxy addresses.
- Only one layer should own listeners and signals. In Foundation mode, disable
  lower-level HTTP/WS/TCP/UDP auto-listen behavior.
- Keep `closeExternal: false` when Unified reuses provider-owned runtimes.
- Protect diagnostics and Prometheus endpoints; they are not automatically public.
- Use a shared UDP handshake secret across workers and rolling replacements.

## Useful runtime calls

```js
await app.ready();
app.address();
app.addresses();
app.health();
app.metrics();
app.metrics('prometheus');
app.diagnostics();
app.snapshot();
app.beginDrain({ timeoutMs: 15_000 });
await app.waitForIdle(15_000);
await app.gracefulClose({ timeoutMs: 15_000, force: true });
```
