# mbus phase 1 — handoff

Phase 1 built the design-risky foundation: the wire protocol
(`docs/protocol.md`), the signaling relay inside link-bridge, the
`mbus-client` library, a two-page audio spike, and the codec/latency
findings (`docs/dsp.md`). Phase 2 builds the patchbay UI, README,
deployment, and the mfx pilot on top of this.

## What lives where

- `mpump/link-bridge/src-tauri/src/mbus.rs` — the relay: registry +
  routing, pure state transitions, fully unit-tested (`cargo test`,
  30 tests incl. the pre-existing Link ones).
- `mpump/link-bridge/src-tauri/src/main.rs` — wiring: per-connection
  mpsc channel merged with the Link broadcast via `tokio::select!`;
  mbus parse attempted first, then the Link `ClientMessage` enum,
  anything else ignored (pre-mbus behavior).
- `packages/mbus-client` — dependency-free strict TS. `npm run check`
  = build + 24 vitest tests.
- `spike/` — `sender.html`, `receiver.html`, `loopback.html` (latency +
  codec probes), `serve.mjs` (zero-dep static server).

## Protocol invariants (do not break these)

1. **Link is untouched.** Link broadcast content/cadence is byte-identical
   to the pre-mbus bridge; `set_tempo`/`set_playing` parse exactly as
   before. mbus rides the same socket under namespaced `"type": "mbus/*"`.
2. **No hello, no mbus.** A connection that never sends `mbus/hello`
   receives zero mbus traffic. Old clients verified safe (they filter on
   `msg.type === "link"`).
3. **Old bridge detection is a timeout, not an error.** Old bridges
   silently drop unknown message types, so new clients wait 2 s for
   `mbus/welcome`, then report `bridge-too-old` and stop.
4. **Ids are opaque, bridge-assigned, never reused within a run, and never
   survive reconnect.** Everything (client lib included) must re-hello,
   re-announce, re-request after a drop. Corollary: a sourceId absent from
   a directory snapshot will never appear later — fail fast.
5. **The bridge never inspects `payload`.** SDP/ICE are end-to-end between
   clients; the payload schema in protocol.md is a client-side contract.
6. **Directory updates are full snapshots**, idempotent, pushed on every
   change. A vanished source is also the "publisher died" signal (no
   peer-gone message in v1).
7. **Targeted delivery.** mbus messages go point-to-point (or to registered
   clients for snapshots) — never broadcast, so offers/ICE don't leak to
   unrelated tabs.
8. **Errors are advisory** (`mbus/error {code, message, re}`); the
   connection stays open.

## Client API contract (`mbus-client`)

```ts
const client = createMbusClient()            // factory, no singleton
client.connect() / client.disconnect()
client.getState()      // idle|connecting|connected|bridge-too-old|disconnected
client.onState(cb); client.onSources(cb); client.getSources()

const pub = client.publishOutput(node, 'mchord')   // works offline;
pub.getSourceId(); pub.onState(cb); pub.stop()     // re-announced on reconnect

const sub = client.subscribe(sourceId, audioCtx)
sub.node               // stable GainNode, patch it into your graph NOW
sub.onState(cb)        // connecting|live|failed|closed
sub.close()
```

Why this surface (this is the seed of `mcore`):

- **Factory over module singleton** (mfx's `createLinkBridge` idiom, not
  mpump's module state): testable without global teardown, allows a page to
  run several clients (the loopback page does), and `mcore` cannot assume
  one-instrument-per-page.
- **`publishOutput` is a declarative intent**, not an RPC: it works before
  the bridge is up and self-heals across reconnects (fresh sourceId each
  time). Instruments shouldn't have to sequence "wait for bridge, then
  announce".
- **`subscribe().node` is a stable GainNode** created synchronously; remote
  audio is wired into it when live. Callers patch their graph once and
  never re-patch on RTC state changes.
- **Events are plain callbacks returning unsubscribe functions** — the
  house pattern in every m-suite Link client; framework-agnostic by
  construction.
- **WebSocket/RTCPeerConnection factories are injectable** — that's how the
  whole protocol is tested in Node with no browser, and how instruments can
  interpose logging later.

## Sharp edges

- **crbug.com/121673**: in Chromium, remote WebRTC audio is *silent*
  through `MediaStreamAudioSourceNode` unless the MediaStream also feeds a
  media element. The client lib attaches a muted `Audio` element internally
  on track arrival. Do not "clean up" that element — it is load-bearing.
- **Publisher is the offerer.** The subscriber only sends `mbus/request`
  and answers. If you invert this you'll fight `ontrack` timing.
- **One subscription per sourceId per client** — `subscribe()` throws on a
  duplicate. Two subscriptions to one source from the same client would
  make the two offers indistinguishable (the signal payload is keyed by
  sourceId + peer clientId).
- **A re-request replaces the publisher-side connection** for that
  (source, subscriber) pair — deliberate, so a reloaded subscriber tab
  doesn't leak stale RTCPeerConnections.
- **No STUN/TURN**, host candidates only. Correct for localhost/LAN;
  anything beyond is a non-goal.
- **Autoplay**: `AudioContext` still needs a user gesture; the spike pages
  gate on a click. The muted sink element is exempt.
- **Announce/announced matching is FIFO** (protocol guarantees per-client
  ordering). Don't reorder announces client-side.
- **Firefox HTTPS pages**: only the `ws://localhost` hostname variant is
  exempt from mixed-content blocking (bug 1376309) — the URL list order in
  `protocol.ts` (localhost first) is deliberate; Safari blocks all loopback
  ws:// from HTTPS (needs the bridge to serve wss:// someday — deferred).

## Deliberate deferrals (phase 2+ decides, don't backfill silently)

- Patchbay UI, README, deployment, mfx pilot (phase 2's scope).
- Opus tuning (`maxaveragebitrate=510000`, `cbr=1`, `ptime`) via SDP
  munging in the client lib — knobs listed in dsp.md.
- Subscriptions do not auto-resubscribe by *name* after a publisher
  restart (ids die with connections; the patchbay should re-wire by name).
- `mbus/error` correlation ids (errors don't reference a request id).
- Remote relay, video, MIDI routing, latency compensation: non-goals.
- Bridge-side wss:// for Safari-from-HTTPS.

## Running the spike

1. Bridge (extended, from this work):
   `cd mpump/link-bridge/src-tauri && cargo run`
   (the Tauri window appears; WS on ws://localhost:19876)
2. Pages: `node mbus/spike/serve.mjs` → http://localhost:8137
3. Open `/spike/sender.html`, click **start tone + publish**.
4. Open `/spike/receiver.html` in another tab, click the
   `▶ spike-tone` button → 220 Hz sine plays; the level meter moves
   (`window.__rms > 0` is the programmatic check).
5. Latency numbers for dsp.md: open `/spike/loopback.html`, click
   **run measurement** (and **dump codec capabilities** per browser).

Verification status at handoff: `cargo test` 30/30, `cargo build` clean,
`npm run check` (tsc strict + 24 vitest) clean. Live audio **passed**
2026-07-06 on Chromium 149 through the extended bridge: sender→receiver
tab audio at the expected RMS, loopback one-way latency median ≈56 ms
(measured; see dsp.md).

Two dev-run notes: a plain `cargo run` of the bridge shows a *blank
window* because debug builds load `devUrl` (localhost:1420) — use
`npm run tauri dev` in `link-bridge/` for the UI; the WS server runs
either way. And browser-native ESM needs explicit `.js` extensions in
import specifiers — already done in `mbus-client`; keep it that way, the
package is consumed unbundled.
