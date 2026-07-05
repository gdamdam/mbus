# mbus signaling protocol — v1

Status: **v1, implemented**. Transport: the existing link-bridge WebSocket
(`ws://localhost:19876`), shared with Ableton Link sync traffic.

mbus lets one browser tab stream live audio to another over a local WebRTC
peer connection. The bridge is **signaling only**: it maintains a directory of
announced audio outputs and relays opaque SDP/ICE blobs between clients. No
audio ever touches the bridge.

## Design constraints

- **Coexistence.** Link messages (`"type": "link"`, `"set_tempo"`,
  `"set_playing"`) are untouched. All mbus messages are namespaced under
  `"type": "mbus/*"`. Existing Link clients (mpump, mfx, mspectr, …) filter on
  `msg.type === "link"` and ignore everything else, so they are unaffected by
  mbus traffic — verified against mpump's and mfx's client source.
- **Old bridge, new client.** An old bridge deserializes inbound messages into
  a closed enum; unknown types fail to parse and are silently dropped. A new
  client therefore detects an old bridge by sending `mbus/hello` and timing
  out waiting for `mbus/welcome` (the client library uses 2 s), then reports
  `bridge-too-old` and disables itself gracefully.
- **New bridge, old client.** Clients that never send `mbus/hello` are treated
  as Link-only: they receive Link broadcasts exactly as before and **no** mbus
  traffic at all.
- **Targeted delivery.** Link state remains a broadcast to every connection.
  mbus messages are routed point-to-point (or to the set of mbus-registered
  clients, for directory snapshots). SDP offers are never sprayed to
  unrelated tabs.
- **Local-first.** The bridge listens on the local network only. It never
  parses signal payloads. No accounts, no tracking, no internet.

## Terms

- **client** — one WebSocket connection that has completed `mbus/hello`.
  Identified by a bridge-assigned `clientId` (opaque string, unique per
  bridge run, e.g. `"c3"`).
- **source** — one announced audio output. Identified by a bridge-assigned
  `sourceId` (opaque string, e.g. `"s7"`). A client may announce any number
  of sources. A source dies with its client's connection.
- **mbus-registered** — a connection that has sent a valid `mbus/hello` and
  received `mbus/welcome`.

## Versioning

`mbus/hello` carries `"mbus": <int>` — the highest protocol version the
client speaks. The bridge replies in `mbus/welcome` with the version the
session will use: `min(clientVersion, bridgeVersion)`. This document
specifies version **1**. A bridge MUST reject a hello with `mbus < 1`
(`mbus/error`, code `unsupported-version`). Clients MUST treat unknown
*fields* in any message as ignorable; unknown message *types* are dropped
silently (both directions). That is the compatibility contract that lets v2
add messages without breaking v1 peers.

## Messages — client → bridge

All messages are JSON text frames with a `"type"` discriminator.

### `mbus/hello`
```json
{ "type": "mbus/hello", "mbus": 1 }
```
Registers the connection for mbus. Everything below (except nothing — hello
is first) requires registration; the bridge answers pre-hello mbus messages
with `mbus/error` code `not-registered`.

### `mbus/announce`
```json
{ "type": "mbus/announce", "name": "mchord" }
```
Publish an audio output under a human-readable name (non-empty string,
≤ 64 chars after trimming; else `mbus/error` code `bad-name`). Names are
labels, not keys — duplicates are allowed; `sourceId` is the key. The bridge
assigns a `sourceId`, confirms with `mbus/announced` to the announcer, and
pushes a fresh `mbus/sources` snapshot to all registered clients.

### `mbus/unannounce`
```json
{ "type": "mbus/unannounce", "sourceId": "s7" }
```
Withdraw a source. Only the announcing client may withdraw it
(`mbus/error` code `not-owner` otherwise; `no-such-source` if unknown).
Triggers a `mbus/sources` snapshot.

### `mbus/request`
```json
{ "type": "mbus/request", "sourceId": "s7" }
```
Ask to receive audio from a source. The bridge forwards it to the source's
owner (see bridge → client `mbus/request`). Unknown source →
`mbus/error` code `no-such-source` with `re: "mbus/request"`.

### `mbus/signal`
```json
{ "type": "mbus/signal", "to": "c3", "payload": { } }
```
Relay an opaque payload to another registered client. The bridge stamps the
sender and delivers it as a bridge → client `mbus/signal`. The bridge never
inspects `payload`. Unknown/departed target → `mbus/error` code
`no-such-client`.

## Messages — bridge → client

### `mbus/welcome`
```json
{ "type": "mbus/welcome", "clientId": "c2", "mbus": 1,
  "sources": [ { "sourceId": "s1", "name": "mchord", "clientId": "c1" } ] }
```
Registration confirmed; carries the negotiated version and the current
directory so a new client needs no separate fetch.

### `mbus/announced`
```json
{ "type": "mbus/announced", "sourceId": "s7", "name": "mchord" }
```
Sent only to the announcer: your `mbus/announce` got this `sourceId`.
Announcements are confirmed in order, so an announcer may match
`mbus/announced` replies to its `mbus/announce` sends FIFO.

### `mbus/sources`
```json
{ "type": "mbus/sources",
  "sources": [ { "sourceId": "s1", "name": "mchord", "clientId": "c1" } ] }
```
Full directory snapshot, pushed to every registered client whenever the
directory changes (announce, unannounce, client disconnect). Snapshots are
idempotent and self-contained — receivers reconcile against them rather than
tracking deltas. A source vanishing from the snapshot is also how
subscribers learn a publisher died (there is deliberately no `peer-gone`
message in v1; the RTCPeerConnection's own state covers the media path).

### `mbus/request`
```json
{ "type": "mbus/request", "sourceId": "s7", "from": "c2" }
```
Forwarded to the source's owner: client `from` wants your source `s7`.
The owner is expected to open an RTCPeerConnection and reply with an offer
via `mbus/signal`.

### `mbus/signal`
```json
{ "type": "mbus/signal", "from": "c1", "payload": { } }
```
Relayed opaque payload from `from`.

### `mbus/error`
```json
{ "type": "mbus/error", "code": "no-such-source",
  "message": "unknown sourceId", "re": "mbus/request" }
```
Codes in v1: `unsupported-version`, `not-registered`, `bad-name`,
`no-such-source`, `not-owner`, `no-such-client`, `bad-message`. `re` names
the offending inbound message type when known. Errors are advisory — the
connection stays open.

## Signal payload convention (client contract, opaque to the bridge)

The client library exchanges these payloads over `mbus/signal`. The bridge
relays them blindly; they are specified here so independent client
implementations interoperate:

```json
{ "kind": "offer",  "sourceId": "s7", "sdp": "<offer sdp>" }
{ "kind": "answer", "sourceId": "s7", "sdp": "<answer sdp>" }
{ "kind": "ice",    "sourceId": "s7", "candidate": { /* RTCIceCandidateInit */ } }
{ "kind": "ice",    "sourceId": "s7", "candidate": null }
```
`sourceId` scopes the exchange: one RTCPeerConnection per
(source, subscriber) pair. The **publisher is the offerer** (it learns of the
subscriber via `mbus/request`, adds its track, and offers `sendonly`).
`candidate: null` signals end-of-candidates. Trickle ICE is assumed; no STUN
or TURN servers are configured (host candidates only — this is a
localhost/LAN system by design).

## Lifecycle invariants

1. A connection is Link-only until `mbus/hello`; it never receives mbus
   messages before `mbus/welcome`.
2. `sourceId` and `clientId` are opaque, bridge-assigned, and never reused
   within a bridge run. Neither survives a reconnect: on a new connection a
   client MUST re-hello and re-announce, and subscribers re-request.
3. On disconnect the bridge drops the client's sources and pushes a
   `mbus/sources` snapshot to the remaining registered clients.
4. The bridge never originates `mbus/signal` or `mbus/request`; it only
   relays. Everything in `payload` is end-to-end between clients.
5. Link broadcast cadence and content are byte-for-byte unchanged from the
   pre-mbus bridge.

## Sequence — happy path

```
subscriber                bridge                 publisher
    │  mbus/hello           │                        │
    │──────────────────────▶│◀───────────────────────│ mbus/hello
    │◀────────────────────  │  ──────────────────────▶ mbus/welcome
    │        welcome        │                        │
    │                       │◀───────────────────────│ mbus/announce "mchord"
    │◀── mbus/sources ──────│───── mbus/announced ──▶│
    │  mbus/request s1      │                        │
    │──────────────────────▶│── mbus/request from:c2─▶
    │                       │◀── mbus/signal offer ──│
    │◀── mbus/signal offer ─│                        │
    │── mbus/signal answer ─▶── mbus/signal answer ──▶
    │◀───────── mbus/signal ice (both ways, until null) ─────▶
    │                       │                        │
    │═══════════ WebRTC audio, peer-to-peer ═════════│
```
