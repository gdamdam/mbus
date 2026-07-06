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
import { defaultPatchStorage, loadPatch, savePatch, type PatchStorage } from './persist'
import { downloadWav, startMonitorRecorder, type MonitorRecorder } from './recorder'
import { reconcile, type DesiredChannel } from './reconcile'
import { encodeWav } from './wav'
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
  setSolo(name: string, soloed: boolean): void
  setMasterDb(db: number): void
  setMuted(muted: boolean): void
  /** Capture the master monitor; stopping encodes and downloads a .wav. */
  setRecording(recording: boolean): void
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

/** Test seams: real client/audio/storage by default (house pattern — injectable). */
export interface PatchbayStoreDeps {
  client?: MbusClient
  audio?: PatchbayAudio
  /** Pass null to disable persistence entirely. */
  storage?: PatchStorage | null
}

export function createPatchbayStore(deps: PatchbayStoreDeps = {}): PatchbayStore {
  const client: MbusClient = deps.client ?? createMbusClient()
  const audio: PatchbayAudio = deps.audio ?? createPatchbayAudio()
  const storage: PatchStorage | null =
    deps.storage === undefined ? defaultPatchStorage() : deps.storage

  let bridgeState: BridgeState = 'idle'
  let sources: SourceInfo[] = []
  const desired = new Map<string, DesiredChannel>()
  const active = new Map<string, ActiveSub>()
  const live = new Map<string, LiveInfo>()
  /** Solo'd names — session-only intent (a persisted solo would reload silent). */
  const soloed = new Set<string>()
  let masterDb = 0
  let muted = false
  let recording = false

  // Seed intent from the saved patch: enables + fader positions come back by
  // name and reconcile re-wires them as their sources (re)appear. Audio still
  // needs a user gesture before anything sounds (see the resume hook in start).
  const saved = loadPatch(storage)
  if (saved) {
    for (const [name, ch] of Object.entries(saved.channels)) desired.set(name, ch)
    masterDb = saved.master.db
    muted = saved.master.muted
    audio.setMasterGain(dbToGain(masterDb))
    audio.setMuted(muted)
  }

  function persistNow(): void {
    savePatch(storage, {
      channels: Object.fromEntries(desired),
      master: { db: masterDb, muted },
    })
  }

  const listeners = new Set<() => void>()
  let snapshot: PatchbaySnapshot = build()
  let offState: (() => void) | null = null
  let offSources: (() => void) | null = null
  let offGesture: (() => void) | null = null

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
        soloed: soloed.has(name),
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
      channelCount: byName.size,
      recording,
    }
    return { bridgeState, channels: rows, master }
  }

  /** Solo policy: with no solos everything routes; otherwise only solo'd names. */
  function applySolo(): void {
    for (const [sourceId, a] of active) {
      audio.setChannelAudible(sourceId, soloed.size === 0 || soloed.has(a.name))
    }
  }

  // ── Monitor capture ──────────────────────────────────────────────────────
  // `recWanted` is the user's intent; `recorder` the live capture. They can
  // disagree while the async worklet setup is in flight — a stop click during
  // that window wins (same shape as the setEnabled gesture gate).
  let recorder: MonitorRecorder | null = null
  let recWanted = false
  const MAX_CAPTURE_SECONDS = 600 // ~10 min stereo Float32 ≈ 460 MB — a hard sanity cap

  function setRecordingImpl(on: boolean): void {
    if (on === recWanted) return
    recWanted = on
    if (on) {
      // The rec click is a user gesture, so it may also create the context.
      void audio.ensureContext().then(async (ctx) => {
        if (!recWanted || recorder) return
        const bus = audio.masterBus()
        if (!bus) return
        try {
          const r = await startMonitorRecorder(ctx, bus, {
            maxSeconds: MAX_CAPTURE_SECONDS,
            onLimit: () => setRecordingImpl(false),
          })
          if (!recWanted) {
            r.stop() // stopped while the worklet was loading — discard
            return
          }
          recorder = r
          recording = true
          emit()
        } catch {
          // audioWorklet unavailable — leave recording off.
          recWanted = false
        }
      })
    } else {
      const r = recorder
      recorder = null
      recording = false
      emit()
      if (r) {
        const channels = r.stop()
        if ((channels[0]?.length ?? 0) > 0) {
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')
          downloadWav(
            encodeWav(channels, { sampleRate: Math.round(r.sampleRate) }),
            `mbus-monitor-${stamp}.wav`,
          )
        }
      }
    }
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
    applySolo()
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
      // A patch restored from storage cannot sound until a user gesture lets
      // the AudioContext start — the first click/keypress anywhere resumes it
      // and wires up the remembered channels.
      if (typeof document !== 'undefined' && [...desired.values()].some((d) => d.enabled)) {
        const onGesture = (): void => {
          offGesture?.()
          offGesture = null
          void audio.ensureContext().then(() => {
            reconcileNow()
            emit()
          })
        }
        document.addEventListener('pointerdown', onGesture)
        document.addEventListener('keydown', onGesture)
        offGesture = () => {
          document.removeEventListener('pointerdown', onGesture)
          document.removeEventListener('keydown', onGesture)
        }
      }
      emit()
    },

    destroy(): void {
      offState?.()
      offSources?.()
      offGesture?.()
      offState = null
      offSources = null
      offGesture = null
      for (const { unsub, sub } of active.values()) {
        unsub()
        sub.close()
      }
      active.clear()
      live.clear()
      recWanted = false
      recording = false
      recorder?.stop() // discard, don't download — the app is going away
      recorder = null
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
      // Intent is recorded synchronously so the toggle reflects the click at
      // once and a quick opposite toggle wins over the pending context below.
      desired.set(name, { enabled, db: prev?.db ?? 0 })
      persistNow()
      // Disabling a solo'd channel drops its solo (a lingering solo on a dead
      // channel would silence the whole monitor for no visible reason).
      if (!enabled && soloed.delete(name)) applySolo()
      if (enabled) {
        // The click is the user gesture that lets the AudioContext start; the
        // deferred reconcile applies whatever intent is current by then.
        void audio.ensureContext().then(() => {
          reconcileNow()
          emit()
        })
      } else {
        reconcileNow()
      }
      emit()
    },

    setChannelDb(name, db): void {
      const prev = desired.get(name)
      desired.set(name, { enabled: prev?.enabled ?? false, db })
      persistNow()
      const info = live.get(name)
      if (info) audio.setChannelGain(info.sourceId, dbToGain(db))
      emit()
    },

    setSolo(name, on): void {
      if (on) soloed.add(name)
      else soloed.delete(name)
      applySolo()
      emit()
    },

    setMasterDb(db): void {
      masterDb = db
      persistNow()
      audio.setMasterGain(dbToGain(db))
      emit()
    },

    setMuted(next): void {
      muted = next
      persistNow()
      audio.setMuted(next)
      emit()
    },

    setRecording: setRecordingImpl,
  }
}
