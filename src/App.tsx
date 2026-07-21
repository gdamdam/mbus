/*
 * App — the mbus patchbay shell.
 *
 * Header (identity + bridge status) · the patch matrix (a ChannelStrip per
 * discovered/wanted source) or an empty state · the master monitor footer.
 * All state and audio wiring live in usePatchbay; this file is composition.
 */

import { useEffect, useState } from 'react'
import './App.css'
import { BridgeStatus } from './components/BridgeStatus'
import { ChannelStrip } from './components/ChannelStrip'
import { EmptyState } from './components/EmptyState'
import { MasterMonitor } from './components/MasterMonitor'
import { SetupHelpModal } from './components/SetupHelpModal'
import { usePatchbay } from './patchbay/usePatchbay'
import { probeLocalIp } from './setup/localIpCheck'

// Set once the user opts out of the local-IP setup nudge.
const HELP_DISMISS_KEY = 'mbus.setup.hideLocalIpHelp'

export default function App() {
  const {
    bridgeState,
    channels,
    master,
    setEnabled,
    forget,
    setChannelDb,
    setSolo,
    setMasterDb,
    setMuted,
    setRecording,
    setOutputDevice,
  } = usePatchbay()

  // Re-probe every load: if the browser masks local IPs (mDNS), routing can't
  // connect, so nudge the user to the one-time fix — unless they opted out.
  const [showSetupHelp, setShowSetupHelp] = useState(false)
  useEffect(() => {
    if (localStorage.getItem(HELP_DISMISS_KEY)) return
    let cancelled = false
    void probeLocalIp().then((status) => {
      if (!cancelled && status === 'obfuscated') setShowSetupHelp(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <img className="app__mark" src={`${import.meta.env.BASE_URL}mbus-mark.svg`} alt="" />
          <div>
            <h1 className="app__title">mbus</h1>
            <p className="app__tagline">the m-suite audio patchbay</p>
          </div>
        </div>
        <BridgeStatus state={bridgeState} />
      </header>

      <main className="app__matrix">
        {channels.length === 0 ? (
          <EmptyState state={bridgeState} />
        ) : (
          <div className="matrix">
            {channels.map((row) => (
              <ChannelStrip
                key={row.name}
                row={row}
                onToggle={setEnabled}
                onDb={setChannelDb}
                onSolo={setSolo}
                onForget={forget}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="app__footer">
        <MasterMonitor
          master={master}
          onDb={setMasterDb}
          onMuted={setMuted}
          onRecording={setRecording}
          onOutputDevice={setOutputDevice}
        />
      </footer>

      {showSetupHelp && (
        <SetupHelpModal
          onClose={(dontShowAgain) => {
            if (dontShowAgain) localStorage.setItem(HELP_DISMISS_KEY, '1')
            setShowSetupHelp(false)
          }}
        />
      )}
    </div>
  )
}
