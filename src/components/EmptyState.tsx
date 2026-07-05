/*
 * EmptyState — shown when the bridge is unreachable or advertises no sources.
 * The bridge-absent case carries a one-line install pointer (the patchbay is
 * useless without the link-bridge companion); the no-sources case just waits.
 */

import type { BridgeState } from 'mbus-client'

export function EmptyState({ state }: { state: BridgeState }) {
  if (state === 'bridge-too-old') {
    return (
      <div className="empty">
        <h2 className="empty__title">Bridge too old</h2>
        <p className="empty__body">
          The link-bridge is running but predates mbus. Update the{' '}
          <strong>mpump link-bridge</strong> to a build with mbus signaling, then reload.
        </p>
      </div>
    )
  }

  if (state === 'connected') {
    return (
      <div className="empty">
        <h2 className="empty__title">No sources yet</h2>
        <p className="empty__body">
          Connected. Publish an output from an instrument (e.g. <code>mfx</code>,{' '}
          <code>mchord</code>) and it will appear here to patch.
        </p>
      </div>
    )
  }

  // idle / connecting / disconnected — bridge not (yet) reachable.
  return (
    <div className="empty">
      <h2 className="empty__title">Bridge not running</h2>
      <p className="empty__body">
        mbus needs the local <strong>mpump link-bridge</strong> on{' '}
        <code className="mono">ws://localhost:19876</code>. Start it, then this page connects
        automatically.
      </p>
      <p className="empty__hint mono">cd link-bridge &amp;&amp; npm run tauri dev</p>
    </div>
  )
}
