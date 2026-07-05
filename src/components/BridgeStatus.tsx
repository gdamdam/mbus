/*
 * BridgeStatus — the link-bridge connection indicator in the header. A coloured
 * dot + label mapped from the client's BridgeState. Purely informational; the
 * client retries on its own.
 */

import type { BridgeState } from 'mbus-client'

const LABELS: Record<BridgeState, string> = {
  idle: 'idle',
  connecting: 'connecting…',
  connected: 'bridge connected',
  'bridge-too-old': 'bridge too old',
  disconnected: 'bridge offline',
}

/** Which status tone each state reads as. */
const TONE: Record<BridgeState, 'live' | 'arm' | 'danger' | 'idle'> = {
  idle: 'idle',
  connecting: 'arm',
  connected: 'live',
  'bridge-too-old': 'danger',
  disconnected: 'idle',
}

export function BridgeStatus({ state }: { state: BridgeState }) {
  return (
    <div className="bridge-status" data-tone={TONE[state]} title={`link-bridge: ${state}`}>
      <span className="bridge-status__dot" />
      <span className="bridge-status__label">{LABELS[state]}</span>
    </div>
  )
}
