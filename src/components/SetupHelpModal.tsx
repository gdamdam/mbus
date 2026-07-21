/*
 * SetupHelpModal — shown at startup only when the local-IP probe reports the
 * browser is masking local IPs behind mDNS (see setup/localIpCheck.ts). In that
 * state every channel would sit on "connecting" forever, so we explain the
 * one-time WebRtcLocalIpsAllowedUrls fix and point at the full guide. Content
 * is tailored to the detected browser/OS since the step differs on each.
 */

import { useState } from 'react'

interface Fix {
  browser: string
  steps: string[]
}

/** Best-effort browser/OS detection → the shortest accurate instruction. */
function detectFix(): Fix {
  const ua = navigator.userAgent
  const platform = (
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ''
  ).toLowerCase()
  const isMac = platform.includes('mac')
  const isWin = platform.includes('win')

  if (/firefox/i.test(ua)) {
    return {
      browser: 'Firefox',
      steps: [
        'Open about:config and accept the warning.',
        'Set media.peerconnection.ice.obfuscate_host_addresses.blocklist to: mpump.live,localhost',
        'Restart Firefox.',
      ],
    }
  }
  if (isMac) {
    return {
      browser: 'Chrome (macOS)',
      steps: [
        'In the mbus repo run:  npm run setup:webrtc',
        'Approve the profile: System Settings › General › Device Management › “m-suite WebRTC local IP allowlist” › Install.',
        'Fully quit Chrome (⌘Q) and relaunch.',
      ],
    }
  }
  if (isWin) {
    return {
      browser: 'Chrome (Windows)',
      steps: ['In the mbus repo run:  npm run setup:webrtc', 'Fully quit Chrome and relaunch.'],
    }
  }
  return {
    browser: 'Chrome (Linux)',
    steps: ['In the mbus repo run:  sudo node scripts/setup-webrtc-policy.mjs', 'Fully quit Chrome and relaunch.'],
  }
}

interface SetupHelpModalProps {
  /** Called on close; `dontShowAgain` is the checkbox state at dismissal. */
  onClose(dontShowAgain: boolean): void
}

export function SetupHelpModal({ onClose }: SetupHelpModalProps) {
  const fix = detectFix()
  const [dontShowAgain, setDontShowAgain] = useState(false)

  return (
    <div className="modal-scrim" onClick={() => onClose(dontShowAgain)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="setup-help-title" className="modal__title">
          One-time setup for audio routing
        </h2>
        <p className="modal__body">
          Your browser is masking local network addresses (mDNS), so mbus can’t open the
          peer-to-peer audio connection to the other m-suite tabs — channels will stay stuck on{' '}
          <strong>“connecting.”</strong> A one-time, scoped browser setting fixes it and keeps mDNS
          privacy on every other site.
        </p>

        <div className="modal__fix">
          <p className="modal__fix-head mono">{fix.browser}</p>
          <ol className="modal__steps">
            {fix.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        <p className="modal__note">
          Full guide (all platforms, verify &amp; revert):{' '}
          <span className="mono">mbus/docs/webrtc-local-ip-setup.md</span>
        </p>

        <div className="modal__actions">
          <label className="modal__dismiss">
            <input type="checkbox" onChange={(e) => setDontShowAgain(e.target.checked)} />
            Don’t show this again
          </label>
          <button type="button" className="modal__close" onClick={() => onClose(dontShowAgain)}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
