/*
 * patchbayStore.ts — the patchbay as an external store.
 *
 * Everything imperative lives here: the mbus client, the Web Audio graph, the
 * live subscriptions, and the user's routing intent. React consumes it through
 * useSyncExternalStore (see usePatchbay.ts) — the idiomatic bridge for a
 * mutable external system, so the 60 fps metering and RTC churn never round-trip
 * through React and there is no setState-in-effect cascade.
 *
 * The store emits a fresh immutable snapshot only on a *structural* change
 * (directory, subscription state, enable, fader, mute); per-frame meter levels
 * are read straight off the AnalyserNodes in the snapshot by the <Meter>
 * component, never through here.
 */

import {
  createMbusClient,
  type BridgeState,
  type MbusClient,
  type SourceInfo,
  type Subscription,
} from 'mbus-client'
import { createPatchbayAudio, type PatchbayAudio } from './audioGraph'
import { dbToGain } from './level'
import { reconcile, type DesiredChannel } from './reconcile'
import type { ChannelRow, ChannelState, MasterState } from './types'

export interface PatchbaySnapshot {
  bridgeState: BridgeState
  channels: ChannelRow[]
  master: MasterState
}

export interface PatchbayStore {
  start(): void
  destroy(): void
  subscribe(listener: () => void): () => void
  getSnapshot(): PatchbaySnapshot
  setEnabled(name: string, enabled: boolean): void
  setChannelDb(name: string, db: number): void
  setMasterDb(db: number): void
  setMuted(muted: boolean): void
}

interface ActiveSub {
  name: string
  sub: Subscription
  unsub: () => void
}

interface LiveInfo {
  sourceId: string
  subState: ChannelState
  analyser: AnalyserNode
}

export function createPatchbayStore(): PatchbayStore {
  const client: MbusClient = createMbusClient()
  const audio: PatchbayAudio = createPatchbayAudio()

  let bridgeState: BridgeState = 'idle'
  let sources: SourceInfo[] = []
  const desired = new Map<string, DesiredChannel>()
  const active = new Map<string, ActiveSub>()
  const live = new Map<string, LiveInfo>()
  let masterDb = 0
  let muted = false

  const listeners = new Set<() => void>()
  let snapshot: PatchbaySnapshot = build()
  let offState: (() => void) | null = null
  let offSources: (() => void) | null = null

  function build(): PatchbaySnapshot {
    const byName = new Map<string, SourceInfo>()
    for (const s of sources) if (!byName.has(s.name)) byName.set(s.name, s)
    const names = new Set<string>([...byName.keys(), ...desired.keys()])
    const rows: ChannelRow[] = []
    for (const name of names) {
      const s = byName.get(name) ?? null
      const info = live.get(name) ?? null
      const intent = desired.get(name)
      rows.push({
        name,
        sourceId: s?.sourceId ?? info?.sourceId ?? null,
        clientId: s?.clientId ?? null,
        present: s !== null,
        enabled: intent?.enabled ?? false,
        db: intent?.db ?? 0,
        subState: info?.subState ?? 'idle',
        analyser: info?.analyser ?? null,
      })
    }
    // Present sources first, then absent-but-enabled; alphabetical within each.
    rows.sort((a, b) => Number(b.present) - Number(a.present) || a.name.localeCompare(b.name))

    let liveCount = 0
    for (const info of live.values()) if (info.subState === 'live') liveCount++

    const master: MasterState = {
      db: masterDb,
      muted,
      analyser: audio.masterAnalyser(),
      liveCount,
    }
    return { bridgeState, channels: rows, master }
  }

  function emit(): void {
    snapshot = build()
    for (const l of [...listeners]) l()
  }

  /** Diff intent against the directory and apply subscribe/close side effects. */
  function reconcileNow(): void {
    const activeMap = new Map<string, string>()
    for (const [sourceId, a] of active) activeMap.set(sourceId, a.name)
    const desiredObj: Record<string, DesiredChannel> = {}
    for (const [name, d] of desired) desiredObj[name] = d
    const plan = reconcile(sources, desiredObj, activeMap)

    for (const sourceId of plan.close) {
      const a = active.get(sourceId)
      if (a) {
        a.unsub()
        a.sub.close()
        active.delete(sourceId)
      }
      audio.removeChannel(sourceId)
      dropLiveBySourceId(sourceId)
    }

    const ctx = audio.getContext()
    if (ctx) {
      for (const s of plan.subscribe) {
        const sub = client.subscribe(s.sourceId, ctx)
        const analyser = audio.addChannel(s.sourceId, sub.node)
        audio.setChannelGain(s.sourceId, dbToGain(desired.get(s.name)?.db ?? 0))
        const unsub = sub.onState((subState) => {
          const existing = live.get(s.name)
          if (existing && existing.sourceId === s.sourceId) {
            live.set(s.name, { ...existing, subState })
          }
          if (subState === 'failed' || subState === 'closed') {
            active.delete(s.sourceId)
            audio.removeChannel(s.sourceId)
          }
          emit()
        })
        active.set(s.sourceId, { name: s.name, sub, unsub })
        live.set(s.name, { sourceId: s.sourceId, subState: sub.getState(), analyser })
      }
    }
  }

  function dropLiveBySourceId(sourceId: string): void {
    for (const [name, info] of live) {
      if (info.sourceId === sourceId) live.delete(name)
    }
  }

  return {
    start(): void {
      offState = client.onState((s) => {
        bridgeState = s
        emit()
      })
      offSources = client.onSources((s) => {
        sources = s
        reconcileNow()
        emit()
      })
      client.connect()
      emit()
    },

    destroy(): void {
      offState?.()
      offSources?.()
      offState = null
      offSources = null
      for (const { unsub, sub } of active.values()) {
        unsub()
        sub.close()
      }
      active.clear()
      live.clear()
      client.disconnect()
      audio.close()
    },

    subscribe(listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    getSnapshot: () => snapshot,

    setEnabled(name, enabled): void {
      const prev = desired.get(name)
      if (enabled) {
        // The click is the user gesture that lets the AudioContext start.
        void audio.ensureContext().then(() => {
          desired.set(name, { enabled: true, db: prev?.db ?? 0 })
          reconcileNow()
          emit()
        })
      } else {
        desired.set(name, { enabled: false, db: prev?.db ?? 0 })
        reconcileNow()
        emit()
      }
    },

    setChannelDb(name, db): void {
      const prev = desired.get(name)
      desired.set(name, { enabled: prev?.enabled ?? false, db })
      const info = live.get(name)
      if (info) audio.setChannelGain(info.sourceId, dbToGain(db))
      emit()
    },

    setMasterDb(db): void {
      masterDb = db
      audio.setMasterGain(dbToGain(db))
      emit()
    },

    setMuted(next): void {
      muted = next
      audio.setMuted(next)
      emit()
    },
  }
}
