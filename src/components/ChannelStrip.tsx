/*
 * ChannelStrip — one row of the patch matrix: a named source routed to the
 * monitor. Enable toggle (subscribe/unsubscribe), dB fader, live meter, and a
 * state badge whose colour encodes the WebRTC subscription state.
 */

import type { ChannelRow, ChannelState } from '../patchbay/types'
import { Fader } from './ui/Fader'
import { Meter } from './ui/Meter'
import { Toggle } from './ui/Toggle'

const STATE_TONE: Record<ChannelState, 'live' | 'arm' | 'danger' | 'idle'> = {
  live: 'live',
  connecting: 'arm',
  idle: 'idle',
  failed: 'danger',
  closed: 'idle',
}

const STATE_LABEL: Record<ChannelState, string> = {
  live: 'live',
  connecting: 'connecting',
  idle: 'idle',
  failed: 'failed',
  closed: 'closed',
}

interface ChannelStripProps {
  row: ChannelRow
  onToggle(name: string, on: boolean): void
  onDb(name: string, db: number): void
  onSolo(name: string, on: boolean): void
}

export function ChannelStrip({ row, onToggle, onDb, onSolo }: ChannelStripProps) {
  const waiting = row.enabled && !row.present
  const tone = waiting ? 'arm' : STATE_TONE[row.subState]
  const stateLabel = waiting ? 'waiting for publisher' : STATE_LABEL[row.subState]

  return (
    <div className="strip" data-enabled={row.enabled} data-present={row.present}>
      <div className="strip__head">
        <Toggle
          on={row.enabled}
          onChange={(on) => onToggle(row.name, on)}
          label={`Patch ${row.name} into the monitor`}
        />
        <div className="strip__id">
          <span className="strip__name">{row.name}</span>
          <span className="strip__meta mono">
            {row.sourceId ?? '—'}
            {row.clientId ? ` · ${row.clientId}` : ''}
          </span>
        </div>
        <span className="strip__state" data-tone={tone}>
          <span className="strip__state-dot" />
          {stateLabel}
        </span>
        <button
          type="button"
          className="strip__solo mono"
          data-on={row.soloed}
          aria-pressed={row.soloed}
          aria-label={`Solo ${row.name}`}
          title="solo"
          onClick={() => onSolo(row.name, !row.soloed)}
        >
          S
        </button>
      </div>
      <div className="strip__controls">
        <Meter analyser={row.analyser} label={`${row.name} level`} />
        <Fader db={row.db} onChange={(db) => onDb(row.name, db)} label={`${row.name} gain`} />
      </div>
    </div>
  )
}
