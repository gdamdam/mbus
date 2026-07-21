# One-time browser setup for mbus audio routing

If an mbus channel stays stuck on **"connecting"** and never turns **"live"** — even
though the instrument shows *bus on* and mbus shows *bridge connected* — this page
is the fix. It is a **one-time, per-machine** browser setting. No app or bridge
change is involved.

## Why it's needed

mbus streams audio **tab-to-tab over WebRTC**, peer-to-peer, using *host candidates
only* (no STUN/TURN — [audio never leaves your machine](../README.md#privacy)). To
set up that peer connection the two tabs must exchange their local network
addresses ("ICE candidates").

By default Chrome and Firefox **hide your local IP** behind a random `*.local`
[mDNS](https://en.wikipedia.org/wiki/Multicast_DNS) name — a privacy feature so
random websites can't read your LAN address. Those names resolve fine between two
tabs of the **same** origin, but the suite apps live on **different** subdomains
(`mchord.mpump.live`, `mbus.mpump.live`, …). Across origins the peer's `.local`
name is never resolved, no connection path is found, and the channel sits on
"connecting" forever. (Signaling and audio negotiation actually succeed — only the
network transport stalls.)

## The fix: expose local IPs for m-suite origins only

We use the browser's built-in **`WebRtcLocalIpsAllowedUrls`** policy. It exposes
your real local IP **only for the origins you list** (the m-suite apps), so those
tabs connect instantly over your loopback/LAN. Every **other** website keeps full
mDNS privacy. This is deliberately narrower than the global "Anonymize local IPs"
flag, and it keeps audio peer-to-peer (no relay server).

> **It must be a _mandatory_ (managed) policy.** Because this policy relaxes
> privacy, Chrome **ignores it at "Recommended" level**. How you reach mandatory
> differs by OS:
> - **macOS** — a user-domain `defaults write` is never "forced" (Chrome files it
>   under Recommended), and writes into `/Library/Managed Preferences` don't
>   persist. The only non-MDM route is a **configuration profile** (the bundled
>   `.mobileconfig`), approved once in System Settings. No `sudo` needed.
> - **Windows** — `HKCU\Software\Policies` is already mandatory; no admin needed.
> - **Linux** — the managed-policy dir is root-owned; needs `sudo`.

Origins used below (Chrome's url-pattern format matches a bare host *exactly* —
it does **not** expand to subdomains — so the app subdomains need a `*.` wildcard):

- `https://*.mpump.live` — every app subdomain (`mchord.mpump.live`, `mbus.mpump.live`, …)
- `https://mpump.live` — the apex, in case an app is served there
- `localhost`, `127.0.0.1` — running the apps from a local dev server

### Chrome / Chromium / Brave / Edge

**Easiest (from this repo):** the script does the right thing per OS — on macOS
it clears any stale copy and opens the profile for you to approve; on Linux it
tells you the `sudo` line:

```bash
node scripts/setup-webrtc-policy.mjs          # apply (macOS/Windows: no sudo)
sudo node scripts/setup-webrtc-policy.mjs     # Linux: actually write the file
node scripts/setup-webrtc-policy.mjs --remove # revert
```

**Or do it by hand for your OS:**

macOS — install the bundled **configuration profile** (this is what makes the
policy *mandatory*; a plain `defaults write` only ever reaches Recommended):
```bash
defaults delete com.google.Chrome WebRtcLocalIpsAllowedUrls 2>/dev/null  # drop any stale Recommended-level copy
open scripts/mpump-webrtc-chrome.mobileconfig                            # stage the profile
```
Then approve it: **System Settings › General › Device Management ›
"m-suite WebRTC local IP allowlist" › Install**. (macOS will flag it "Unsigned" —
expected for a locally-shipped profile.)

Windows (Command Prompt) — `HKCU\…\Policies` is mandatory, **no admin needed**:
```bat
reg add "HKCU\Software\Policies\Google\Chrome\WebRtcLocalIpsAllowedUrls" /v 1 /t REG_SZ /d "https://*.mpump.live" /f
reg add "HKCU\Software\Policies\Google\Chrome\WebRtcLocalIpsAllowedUrls" /v 2 /t REG_SZ /d "https://mpump.live" /f
reg add "HKCU\Software\Policies\Google\Chrome\WebRtcLocalIpsAllowedUrls" /v 3 /t REG_SZ /d "localhost" /f
reg add "HKCU\Software\Policies\Google\Chrome\WebRtcLocalIpsAllowedUrls" /v 4 /t REG_SZ /d "127.0.0.1" /f
```

Linux — managed-policy file (root-owned, mandatory):
```bash
sudo mkdir -p /etc/opt/chrome/policies/managed
echo '{ "WebRtcLocalIpsAllowedUrls": ["https://*.mpump.live", "https://mpump.live", "localhost", "127.0.0.1"] }' | sudo tee /etc/opt/chrome/policies/managed/mpump-webrtc.json
```

> Brave/Edge read the same policy under their own keys
> (`…\Policies\BraveSoftware\Brave`, `…\Policies\Microsoft\Edge`; macOS managed
> domains `com.brave.Browser`, `com.microsoft.Edge`). Substitute as needed.

### Firefox

Firefox has no per-origin policy; use `about:config`:

1. Open `about:config`, accept the warning.
2. Find **`media.peerconnection.ice.obfuscate_host_addresses.blocklist`**.
3. Set its value to: `mpump.live,localhost`
   (comma-separated hosts that are **exempted** from obfuscation; add specific
   subdomains like `mchord.mpump.live,mbus.mpump.live` if the bare domain isn't
   honored on your build).

## Apply, then verify

1. **Fully quit** the browser (⌘Q / Ctrl+Q — closing the window is not enough) and
   relaunch. Policies load at startup.
2. Chrome: open `chrome://policy`, search **`WebRtcLocalIpsAllowedUrls`** — it
   should list `https://*.mpump.live` … with **Level: Mandatory** (if it says
   *Recommended*, it will not work — you applied it at user level, not managed).
   Chrome may now show a cosmetic "managed by your organization" note; that's
   expected for a local managed policy.
3. Reopen an instrument (*bus on*, playing) and mbus. The channel should flip to
   **live** within a second or two, and the master monitor should show it as a
   live channel.
4. Confirm at `chrome://webrtc-internals`: candidates should now be real IPs
   (e.g. `192.168.x.x`) instead of `*.local`, and ICE should reach `connected`.

## Reverting

Run the script with `--remove` (Linux needs `sudo`), then restart the browser.
On macOS that means removing the profile in **System Settings › General › Device
Management** (or `sudo profiles remove -identifier live.mpump.webrtc`). Nothing
else in the suite depends on this setting.
