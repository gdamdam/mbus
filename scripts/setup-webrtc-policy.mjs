#!/usr/bin/env node
/**
 * Apply (or revert) the Chrome policy that lets m-suite audio routing connect.
 *
 * Why this exists: mbus streams tab-to-tab over WebRTC with host candidates
 * only (no STUN/TURN — audio never leaves the machine). By default Chrome
 * hides local IPs behind random `*.local` mDNS names ("Anonymize local IPs
 * exposed by WebRTC"). Those names resolve fine between two tabs of the SAME
 * origin, but the suite apps live on different subdomains (mchord.mpump.live,
 * mbus.mpump.live, …). Cross-origin, the peer's `.local` candidate is never
 * resolved, so ICE never leaves 'new' and the channel sits on "connecting"
 * forever — signaling and media succeed, only the transport stalls.
 *
 * `WebRtcLocalIpsAllowedUrls` fixes this the surgical way: it exposes real
 * host IPs ONLY for the listed origins, so those tabs connect over loopback
 * instantly while every OTHER site keeps full mDNS privacy.
 *
 * It MUST be a *mandatory* (managed) policy — Chrome ignores this one at
 * "Recommended" level because it relaxes privacy. How you get "mandatory"
 * differs sharply per platform:
 *   - macOS: a user-domain `defaults write` is NOT "forced" → Chrome files it
 *     under Recommended and ignores it; and writes into /Library/Managed
 *     Preferences don't persist (cfprefsd owns it). The only non-MDM route is a
 *     CONFIGURATION PROFILE (the bundled .mobileconfig), approved once in
 *     System Settings. This script stages it and cleans up the stale user copy.
 *   - Windows: HKCU\Software\Policies is already mandatory → no admin needed.
 *   - Linux: /etc/opt/chrome/policies/managed is root-owned → needs sudo.
 *
 *   node scripts/setup-webrtc-policy.mjs            # apply
 *   node scripts/setup-webrtc-policy.mjs --remove   # revert
 *   node scripts/setup-webrtc-policy.mjs --print    # show actions, run nothing
 *
 * Chrome must be fully quit and relaunched to pick up the change; verify at
 * chrome://policy (Level must read "Mandatory"). Chrome-family only — see
 * docs/webrtc-local-ip-setup.md for Firefox and other browsers.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chrome's url-pattern format matches a BARE host exactly (apex only) — it does
// NOT expand to subdomains — so the suite apps need an explicit `*.` wildcard.
// `https://*.mpump.live` covers every app subdomain; the apex is listed too;
// `localhost`/`127.0.0.1` cover the Vite dev servers (each app on its own port
// is a separate origin, so dev hits the same cross-origin case).
const ORIGINS = ['https://*.mpump.live', 'https://mpump.live', 'localhost', '127.0.0.1']

const PROFILE = join(dirname(fileURLToPath(import.meta.url)), 'mpump-webrtc-chrome.mobileconfig')
const PROFILE_ID = 'live.mpump.webrtc'
// User-domain stores where an earlier (ineffective, Recommended-level) run may
// have left a copy — cleaned up so chrome://policy isn't misleading.
const MAC_USER = ['com.google.Chrome', 'org.chromium.Chromium']
const LINUX_POLICY_FILE = '/etc/opt/chrome/policies/managed/mpump-webrtc.json'

const remove = process.argv.includes('--remove')
const printOnly = process.argv.includes('--print')
const note = (s) => console.log(s)
const quote = (a) => (/\s/.test(a) ? JSON.stringify(a) : a)

/** Print a command, and run it unless we're only printing. */
function run(cmd, args, { ignoreFail = false } = {}) {
  note(`  ${cmd} ${args.map(quote).join(' ')}`)
  if (printOnly) return
  try {
    execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (err) {
    if (!ignoreFail) note(`  ! failed: ${String(err.stderr || err.message).trim()}`)
  }
}

function macOS() {
  // Clear any stale user-domain copy first (harmless if absent).
  for (const domain of MAC_USER)
    run('defaults', ['delete', domain, 'WebRtcLocalIpsAllowedUrls'], { ignoreFail: true })

  if (remove) {
    note('  Remove the profile: System Settings › General › Device Management ›')
    note('  "m-suite WebRTC local IP allowlist" › (–) Remove.')
    note(`  Or from a terminal:  sudo profiles remove -identifier ${PROFILE_ID}`)
    return
  }

  note('  Staging the configuration profile (this is what makes it Mandatory):')
  run('open', [PROFILE], { ignoreFail: true })
  note('')
  note('  Approve it once: System Settings › General › Device Management ›')
  note('  "m-suite WebRTC local IP allowlist" › Install (enter your password).')
}

function windows() {
  // HKCU\Software\Policies is mandatory-level on Windows — no admin needed.
  const key = 'HKCU\\Software\\Policies\\Google\\Chrome\\WebRtcLocalIpsAllowedUrls'
  if (remove) {
    run('reg', ['delete', key, '/f'], { ignoreFail: true })
  } else {
    // The policy is a list: one REG_SZ value per origin, named "1", "2", …
    ORIGINS.forEach((origin, i) =>
      run('reg', ['add', key, '/v', String(i + 1), '/t', 'REG_SZ', '/d', origin, '/f']),
    )
  }
}

function linux() {
  note(`  ${LINUX_POLICY_FILE}`)
  if (printOnly) return
  try {
    if (remove) {
      rmSync(LINUX_POLICY_FILE, { force: true })
    } else {
      mkdirSync(LINUX_POLICY_FILE.replace(/\/[^/]+$/, ''), { recursive: true })
      writeFileSync(LINUX_POLICY_FILE, JSON.stringify({ WebRtcLocalIpsAllowedUrls: ORIGINS }, null, 2))
    }
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      note('  ! needs root — re-run with sudo:')
      note(`      sudo node ${quote(process.argv[1])}${remove ? ' --remove' : ''}`)
    } else {
      note(`  ! failed: ${err.message}`)
    }
  }
}

note(`${remove ? 'Removing' : 'Applying (mandatory)'} WebRtcLocalIpsAllowedUrls = [${ORIGINS.join(', ')}]`)
note('')

switch (process.platform) {
  case 'darwin':
    macOS()
    break
  case 'win32':
    windows()
    break
  case 'linux':
    linux()
    break
  default:
    note(`  unsupported platform "${process.platform}" — see docs/webrtc-local-ip-setup.md`)
}

note('')
note('Then: fully quit Chrome (Cmd/Ctrl+Q, not just the window) and relaunch.')
note('Verify at chrome://policy — "WebRtcLocalIpsAllowedUrls", Level must be "Mandatory".')
