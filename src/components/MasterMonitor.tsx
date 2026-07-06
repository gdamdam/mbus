/*
 * MasterMonitor — the summed monitor bus: every patched channel mixes here,
 * out to the browser's audio output. Mute, master fader, master meter, and a
 * live-channel count.
 */

import type { MasterState } from '../patchbay/types'
import { Fader } from './ui/Fader'
import { Meter } from './ui/Meter'

interface MasterMonitorProps {
  master: MasterState
  onDb(db: number): void
  onMuted(muted: boolean): void
  onRecording(recording: boolean): void
}

export function MasterMonitor({ master, onDb, onMuted, onRecording }: MasterMonitorProps) {
  return (
    <section className="master" aria-label="Master monitor">
      <div className="master__head">
        <span className="eyebrow">Master monitor</span>
        <span className="master__count mono">
          {master.liveCount} live · {master.channelCount} ch
        </span>
      </div>
      <div className="master__controls">
        <button
          type="button"
          className="master__mute"
          data-muted={master.muted}
          aria-pressed={master.muted}
          onClick={() => onMuted(!master.muted)}
        >
          {master.muted ? 'muted' : 'mute'}
        </button>
        <button
          type="button"
          className="master__rec"
          data-recording={master.recording}
          aria-pressed={master.recording}
          title={master.recording ? 'stop and save WAV' : 'record the monitor to WAV'}
          onClick={() => onRecording(!master.recording)}
        >
          <span className="master__rec-dot" />
          {master.recording ? 'stop' : 'rec'}
        </button>
        <Meter analyser={master.analyser} label="Master level" />
        <Fader db={master.db} onChange={onDb} label="Master gain" />
      </div>
    </section>
  )
}
