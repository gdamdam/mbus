# mbus DSP notes — codec floor and measured latency

Honest-numbers policy: everything in this file is either **measured on this
machine** (method stated, reproducible via `spike/loopback.html`) or clearly
flagged as *not measured*. No vendor-doc numbers are presented as
measurements.

## Question 1 — is raw PCM (L16) negotiable, or is Opus the floor?

**Answer: Opus is the practical floor. L16 is not negotiable in Chromium —
measured, not assumed.**

Measured on Chromium 149 (macOS, 2026-07-06), via DevTools-driven scripts
(the same probes live behind the "dump codec capabilities" button in
`spike/loopback.html`):

- `RTCRtpSender.getCapabilities('audio')` and
  `RTCRtpReceiver.getCapabilities('audio')` both return exactly:
  `opus 48000/2`, `red 48000/2`, `G722 8000/1`, `PCMU 8000/1`,
  `PCMA 8000/1`, `CN 8000/1`, `telephone-event`. **No L16 at any rate.**
- A real offer's `m=audio` section carries payloads
  `111(opus) 63(red) 9(G722) 0(PCMU) 8(PCMA) 13(CN) 110/126(tel-event)`.
- SDP-munging test, full local peer pair: forcing an **L16-only** offer is
  accepted by `setLocalDescription` (SDP parses fine), but the answering
  Chromium rejects the media section outright — its answer comes back
  `m=audio 0 UDP/TLS/RTP/SAVPF 96` (port 0 = m-line rejected). ICE never
  starts, `outbound-rtp` reports 0 packets. Control run in the same page
  with unmunged SDP: `connectionState: connected`, Opus (pt 111) selected,
  packets flowing. So the rejection is the codec, not the harness.

Not measured here: **Firefox** and **Safari** (no scripting harness for them
in this setup — worth 10 manual minutes with `spike/loopback.html` in each).
Their published capability lists likewise contain no L16 for WebRTC audio,
so the recommendation does not hinge on the gap, but treat their numbers as
unverified until the loopback page has been run in both.

### Recommendation

Accept Opus and configure it for transparency instead of chasing raw PCM:

- Opus at 48 kHz stereo is the default and the best available option;
  `maxaveragebitrate=510000`, `stereo=1;sprop-stereo=1`, and `cbr=1` in the
  answer's fmtp push it to near-transparent quality for instrument audio.
- Disable the speech-oriented track constraints — the client library should
  request `echoCancellation: false, noiseSuppression: false,
  autoGainControl: false` semantics; for `MediaStreamAudioDestinationNode`
  sources (our case) these processing stages are not applied anyway, but
  pin them if microphone sources ever enter the picture. (Deferred to the
  phase-2 pilot; the v0 spike uses default track settings.)
- Revisit only if a future Chromium ships `L16` or `pcm` capability —
  the munge probe in `spike/loopback.html` answers that in one click.

## Question 2 — localhost one-way latency through the full path

Method (`spike/loopback.html`): two mbus clients in one page share a single
`AudioContext`, i.e. one clock. An impulse is scheduled into the published
node at a known context time; an `AudioWorkletNode` on the subscribed node
stamps the context time of its arrival. The difference is true end-to-end
one-way latency: Opus encode → RTP over loopback → decode → jitter buffer →
Web Audio delivery. Detection resolution is one render quantum
(128 / 48000 ≈ 2.7 ms). Ten trials; min/median/max reported.

**Measured 2026-07-06, Chromium 149, macOS (Apple silicon), context at
44.1 kHz, bridge-signaled path through the extended link-bridge:**

- 10 impulse trials: 9 detected, 1 missed (swallowed by the codec/jitter
  path even after the 1.5 s settle window — expect occasional misses).
- One-way latency: **min 43.4 ms, median 56.3 ms, max 56.9 ms.**
  A second independent run gave median 59.0 ms — treat ~55–60 ms as the
  figure for this machine, not a universal constant.

Method caveats, observed while getting honest numbers:

- An `AudioWorkletNode` must be connected toward the destination or the
  graph never pulls it and `process()` never runs (its output here is
  silent, so the connection is inaudible).
- The first ~1 s after a subscription goes `live` is jitter-buffer warmup:
  NetEQ time-warps and can swallow a transient outright. The page waits
  1.5 s before trial 1.
- A stream-startup pop can trip the detector before the scheduled impulse;
  detections earlier than the scheduled send time are discarded and the
  detector re-arms.

Interpretation: the ~55–60 ms is dominated by the WebRTC receive jitter
buffer plus Opus framing, not the loopback network. It is fine for the
patchbay's monitoring/reamping/live-set routing use and **not** a
substitute for sample-accurate sync — which is why automatic latency
compensation is an explicit non-goal of phase 1, and why Ableton Link
(not the audio path) remains the timing authority.
