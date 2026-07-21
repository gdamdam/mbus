<div align="center">

# mbus

**Patch it. Monitor it. Never leave the browser.**

<pre>
 ┌───────┐   announce    ┌───────────┐    hello   ┌───────┐
 │ mchord│ ─────────────▶│link-bridge│◀────────── │ mbus  │
 └───┬───┘               │ signaling │            └───┬───┘
     │   WebRTC audio (Opus, peer-to-peer)            ▼
     └────────────────────────────────────────▶  ▮▮▮▯▯ 🔊
</pre>

[![version](https://img.shields.io/badge/version-0.3.0-46d6b4)](./package.json)
[![license](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-52%20passing-2ea043)](#verification)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](./tsconfig.json)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Web Audio](https://img.shields.io/badge/Web%20Audio-WebRTC-ff6d00)](https://developer.mozilla.org/docs/Web/API/Web_Audio_API)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8)](#progressive-web-app)

### [▶ Open it live → mbus.mpump.live](https://mbus.mpump.live)

</div>

---

`mbus` is the **audio patchbay** for the mpump family of browser instruments. Every instrument can publish its output as a named *source*; `mbus` discovers those sources through the local **link-bridge** and lets you patch any of them into a **monitor** with a per-channel fader and level meter, summed to a master bus. Audio flows **tab-to-tab over WebRTC**, peer-to-peer — it never touches a server, and it never touches the bridge (the bridge only relays the WebRTC handshake). Local-first and offline-capable: no account, no cookies, no telemetry.

## Highlights

- **Live source discovery** — every output announced to the link-bridge shows up as a channel, the instant it is published, and disappears when its publisher goes away.
- **Patch matrix → monitor** — enable any source to subscribe to it; each connection has its own **dB fader** and **level meter**, and everything sums into a **master monitor** (mute + master fader + master meter) out to your speakers.
- **Re-wire by name** — subscriptions are keyed by the source's *name*, not its ephemeral connection id. Reload the publishing instrument and `mbus` automatically re-subscribes to the same-named source when it comes back — no re-patching.
- **Graceful without the bridge** — with no link-bridge running, `mbus` shows a clear empty state with a one-line start pointer and keeps retrying in the background; it connects the moment the bridge appears.
- **Patch memory** — enabled channels, fader positions, and the master fader/mute are remembered per source *name* in `localStorage` and re-applied on load; the first click or keypress resumes audio (autoplay policy) and the saved patch re-wires itself as sources appear.
- **Solo + clip** — per-channel **solo** (soloing routes everything else out of the master, after the meter tap, so all meters keep moving) and a latching **clip LED** on every meter; the master monitor shows a live/total channel count.
- **Output-device routing** — a selector on the master monitor routes the mix to any audio output (`AudioContext.setSinkId`, Chromium-only; hidden elsewhere). Session-only — device ids aren't reliable across sessions.
- **Monitor capture** — record the master monitor and save it as a **16-bit PCM WAV**, entirely in the browser (an `AudioWorklet` tap; nothing is uploaded anywhere).
- **Peer-to-peer, local-first** — audio is a direct WebRTC connection between browser tabs (host candidates only, no STUN/TURN). No relay, no cloud, no audio ever leaves your machine.
- **Installable PWA** — offline after one visit, local-first, no account.

## Run locally

`mbus` needs the companion **mpump link-bridge** running locally so instruments can find each other. Start the bridge, then the app:

```bash
# 1. the link-bridge (from the mpump repo) — provides ws://localhost:19876
cd link-bridge && npm run tauri dev

# 2. mbus
npm install
npm run dev
```

Open the URL Vite prints. Audio starts on your first interaction (enabling a channel), per browser autoplay policy.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) and production build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm run test` | Vitest (run once) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | Type-check without emit |
| `npm run check` | **typecheck + lint + test + build** (the full gate) |

The `mbus-client` library lives in `packages/mbus-client` and has its own gate (`npm --prefix packages/mbus-client run check`).

## How it works

```text
 publisher tab                 link-bridge                     mbus patchbay tab
 ─────────────                 ws://localhost:19876             ─────────────────
 instrument out                (signaling only —               mbus-client
   │  mbus-client               no audio, no internet)            │  hello / subscribe
   │  announce "name" ───────────▶  directory + relay  ◀──────────┘
   │                                     │  request/offer/answer/ice
   └──────────── WebRTC peer audio (Opus 48 kHz) ─────────────▶ channelGain ─▶ masterGain ─▶ 🔊
                                                                    └▶ meter      └▶ meter
```

- **The bridge is signaling only.** It maintains a directory of announced sources and relays opaque SDP/ICE between tabs. No audio ever reaches it; it rides the same WebSocket as Ableton Link sync, namespaced under `mbus/*`, so Link traffic is untouched.
- **The library is authoritative.** `packages/mbus-client` (built in phase 1, the seed of a future shared `mcore`) owns the wire protocol, the RTC lifecycle, and the reconnect/absence handling. The app consumes its public API unmodified and stays out of the library.
- **The app is the monitor endpoint.** Because WebRTC audio is peer-to-peer, `mbus` patches sources into *its own* monitor bus — it doesn't route audio between two other tabs (each subscribing instrument, e.g. `mfx`, pulls the audio it wants for itself). See the protocol and DSP notes in [`docs/`](./docs).
- **Validation at the boundary.** All bridge traffic and relayed SDP/ICE pass through the library's total sanitizer before reaching the app — a local process can still be buggy or hostile.

## Verification

```bash
npm run check   # typecheck + lint + 52 tests + production build
```

Tests are deterministic and live next to the code: the dB/level math (`patchbay/level.ts`), the re-wire-by-name **reconciliation** policy (`patchbay/reconcile.ts` — publisher restart, publisher death, duplicate names, enable/disable), the store's enable/solo/persistence sequencing (`patchbay/patchbayStore.ts`, via injected client/audio doubles), the patch (de)serialization (`patchbay/persist.ts`), and the WAV encoder (`patchbay/wav.ts`). Vitest runs in a Node environment, so **live audio and RTC behaviour are covered by a manual QA checklist**, not unit tests:

- [ ] **Discovery** — publish a source from an instrument (or `spike/sender.html`); it appears as a channel; unpublish and it disappears.
- [ ] **Patch + monitor** — enable a channel; audio reaches the master monitor; the channel and master meters move.
- [ ] **Per-channel gain** — the fader changes that channel's contribution; master fader + mute affect the sum.
- [ ] **Re-wire by name** — reload the publishing instrument; the same-named channel re-subscribes automatically without re-patching.
- [ ] **Patch memory** — reload `mbus`; enabled channels and fader positions come back, and audio resumes on the first click.
- [ ] **Solo** — soloing one channel silences the others in the monitor while every meter keeps moving; clearing it restores the mix.
- [ ] **Clip LED** — drive a hot signal; the meter's right-edge LED latches red and decays after ~1.5 s.
- [ ] **WAV capture** — record the monitor, stop, and the downloaded `.wav` plays back what was heard.
- [ ] **Bridge absent** — with no bridge, the empty state + start pointer show; starting the bridge connects automatically.
- [ ] **Bridge too old** — a pre-mbus bridge is detected (2 s timeout) and reported, not spun on.
- [ ] **PWA** — installs, and the shell loads offline after the first visit (the monitor still needs the bridge + peers).

A ready-made publisher/subscriber pair for manual testing lives in `spike/` (`node spike/serve.mjs`, then open the sender/receiver pages; see [`HANDOFF.md`](./HANDOFF.md)).

## Browser notes & limitations

These are **measured on this project's hardware** (Chromium 149, macOS/Apple silicon, 2026-07-06 — see [`docs/dsp.md`](./docs/dsp.md) for method), not generic claims:

- **Codec: Opus is the floor.** Raw PCM (L16) is *not* negotiable — a forced L16 offer is rejected outright by Chromium (`m=audio 0`, no packets), and no browser advertises L16 for WebRTC audio. `mbus` streams Opus at 48 kHz; quality is transparent for instrument audio but it is a lossy codec, not a bit-exact wire.
- **Latency: ~55–60 ms one-way** through the full path (Opus encode → RTP over loopback → decode → jitter buffer → Web Audio), measured on localhost (median 56 ms, min 43 ms across trials). This is fine for monitoring, re-amping and live-set routing; it is **not** sample-accurate sync. Ableton Link (not the audio path) remains the timing authority. Automatic latency compensation is an explicit non-goal.
- **Jitter-buffer warmup.** The first ~1 s after a channel goes live is NetEQ warmup and can swallow a transient; steady-state is stable.
- **Localhost / LAN only.** Host ICE candidates only, no STUN/TURN — correct for same-machine and LAN, out of scope beyond that. No remote relay.
- **Safari** blocks all loopback `ws://` from an HTTPS page, so the hosted app cannot reach a local bridge from Safari yet (a bridge-served `wss://` is a deferred future). **Firefox** only exempts the `localhost` hostname (not `127.0.0.1`) from mixed-content blocking — the client tries `localhost` first for this reason. **Chromium** accepts all loopback variants.
- Audio starts on the first user gesture (enabling a channel), per browser autoplay policy.
- **One-time local-IP setup.** Because the apps live on different subdomains, browsers' default mDNS masking of local IPs stops the cross-origin peer connection from forming — the channel gets stuck on "connecting". A one-time, per-origin browser policy fixes it while keeping mDNS privacy everywhere else: see [`docs/webrtc-local-ip-setup.md`](./docs/webrtc-local-ip-setup.md) (or run `npm run setup:webrtc`).

## Privacy

Everything is local. No account, no cookies, no telemetry, no fingerprinting. The link-bridge listens on the local machine only and never sees audio — only the directory of source names and the opaque WebRTC handshake blobs it relays between your tabs. Audio is a direct peer-to-peer connection between browser tabs and is never sent to any server.

## Repository map

```text
packages/mbus-client/   the wire protocol + RTC client library (phase 1, unmodified here)
docs/                   protocol.md · dsp.md (measured codec/latency findings)
spike/                  zero-dep publisher/subscriber pages for manual testing
src/
  main.tsx              entry, service-worker registration, font imports
  App.tsx / App.css     patchbay shell + component styling
  patchbay/             the core (framework-light)
    patchbayStore.ts    external store: owns the client, audio graph, subscriptions (tested)
    usePatchbay.ts      thin useSyncExternalStore binding
    audioGraph.ts       channel gain → solo route → master monitor, AnalyserNode meter taps
    reconcile.ts        pure re-wire-by-name policy (tested)
    level.ts            pure dB / meter math (tested)
    persist.ts          pure patch (de)serialization for localStorage (tested)
    wav.ts              pure 16-bit PCM WAV encoder, adapted from mtape (tested)
    recorder.ts         AudioWorklet monitor capture + WAV download
    types.ts            render-facing contracts
  components/           BridgeStatus · ChannelStrip · MasterMonitor · EmptyState
    ui/                 Meter · Fader · Toggle
  styles/               theme tokens + global CSS
public/                 manifest, service worker, icon, CNAME
.github/workflows/      CI + GitHub Pages deploy
```

## Progressive Web App

`public/manifest.webmanifest` + `public/sw.js` make `mbus` installable. The hand-rolled service worker precaches the app shell and hashed assets, so the interface loads offline after a single successful load. (Monitoring still needs the local bridge and at least one publishing peer — offline caching covers the app, not the live audio graph.)

## Deployment

Pushes to `main` are deployed by GitHub Actions (`.github/workflows/ci.yml` runs the full `npm run check` gate; `.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages), served at the custom domain **[mbus.mpump.live](https://mbus.mpump.live)**. It's a root-domain deploy, so the build is root-relative (`base: '/'`) and `public/CNAME` pins the domain across deploys (no `gh-pages` branch).

One-time setup:

- **Settings → Pages → Source** → **GitHub Actions**
- add DNS: `CNAME  mbus → <owner>.github.io` (per your DNS provider)

## Family

mbus is part of the **mpump** family of browser-native instruments — [mpump](https://mpump.live), [mchord](https://mchord.mpump.live), [mkeys](https://mkeys.mpump.live), [mdrone](https://mdrone.mpump.live), [mgrains](https://mgrains.mpump.live), [mspectr](https://mspectr.mpump.live), [mscope](https://mscope.mpump.live), [mloop](https://mloop.mpump.live), [mvox](https://mvox.mpump.live), [mfx](https://mfx.mpump.live), and [mtape](https://mtape.mpump.live) — all at `*.mpump.live`. mbus is the **patchbay**: the connective tissue that lets the others hear each other. Reused code is credited in [`NOTICE`](./NOTICE).

## License

[GNU Affero General Public License v3.0 or later](./LICENSE) — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
