/*
 * patchbayStore tests — the store's intent/side-effect sequencing, exercised
 * through the injectable client/audio seams (no browser, no Web Audio).
 * The pure re-wire policy itself is covered in reconcile.test.ts; these tests
 * pin the store-level behavior around the async AudioContext gesture gate.
 */

import { describe, expect, it } from 'vitest'
import type { MbusClient, SourceInfo } from 'mbus-client'
import { createPatchbayStore } from './patchbayStore'
import type { PatchbayAudio } from './audioGraph'
import { PATCH_STORAGE_KEY, parsePatch, type PatchStorage } from './persist'

interface FakeWorld {
  client: MbusClient
  audio: PatchbayAudio
  pushSources(sources: SourceInfo[]): void
  resolveContext(): Promise<void>
  subscribed: string[]
  /** Latest setChannelAudible value per sourceId. */
  audible: Map<string, boolean>
}

/** Minimal client + audio doubles: enough surface for the store, no audio. */
function makeFakes(): FakeWorld {
  const sourceListeners: Array<(s: SourceInfo[]) => void> = []
  const subscribed: string[] = []

  const client = {
    connect() {},
    disconnect() {},
    getState: () => 'connected',
    getClientId: () => 'me',
    getSources: () => [],
    onState: () => () => {},
    onSources(cb: (s: SourceInfo[]) => void) {
      sourceListeners.push(cb)
      return () => {}
    },
    publishOutput() {
      throw new Error('not used')
    },
    subscribe(sourceId: string) {
      subscribed.push(sourceId)
      return {
        sourceId,
        node: {} as AudioNode,
        getState: () => 'connecting' as const,
        onState: () => () => {},
        close() {},
      }
    },
  } as unknown as MbusClient

  // ensureContext resolves only when the test says so — that's the window the
  // real store leaves open between the enable click and the audio being ready.
  let releaseContext: (() => void) | null = null
  const contextGate = new Promise<void>((resolve) => {
    releaseContext = resolve
  })
  const fakeCtx = {} as AudioContext
  let ctxReady = false

  const audible = new Map<string, boolean>()

  const audio = {
    async ensureContext() {
      await contextGate
      ctxReady = true
      return fakeCtx
    },
    getContext: () => (ctxReady ? fakeCtx : null),
    addChannel: () => ({}) as AnalyserNode,
    removeChannel() {},
    setChannelGain() {},
    setChannelAudible(sourceId: string, on: boolean) {
      audible.set(sourceId, on)
    },
    masterAnalyser: () => null,
    setMasterGain() {},
    setMuted() {},
    close() {},
  } as unknown as PatchbayAudio

  return {
    client,
    audio,
    pushSources(sources) {
      for (const cb of sourceListeners) cb(sources)
    },
    async resolveContext() {
      releaseContext?.()
      // Let the store's .then() chains run.
      await Promise.resolve()
      await Promise.resolve()
    },
    subscribed,
    audible,
  }
}

const TONE: SourceInfo = { sourceId: 's1', name: 'tone', clientId: 'c1' }

function memoryStorage(initial?: string): PatchStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(PATCH_STORAGE_KEY, initial)
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

describe('patchbayStore setEnabled', () => {
  it('reflects the enable in the snapshot immediately, before audio is ready', () => {
    const w = makeFakes()
    const store = createPatchbayStore({ client: w.client, audio: w.audio, storage: null })
    store.start()
    w.pushSources([TONE])

    store.setEnabled('tone', true)

    const row = store.getSnapshot().channels.find((c) => c.name === 'tone')
    expect(row?.enabled).toBe(true)
  })

  it('subscribes once the context resolves', async () => {
    const w = makeFakes()
    const store = createPatchbayStore({ client: w.client, audio: w.audio, storage: null })
    store.start()
    w.pushSources([TONE])

    store.setEnabled('tone', true)
    expect(w.subscribed).toEqual([])
    await w.resolveContext()

    expect(w.subscribed).toEqual(['s1'])
    const row = store.getSnapshot().channels.find((c) => c.name === 'tone')
    expect(row?.subState).toBe('connecting')
  })

  it('a quick disable during the pending enable wins (no resurrection)', async () => {
    const w = makeFakes()
    const store = createPatchbayStore({ client: w.client, audio: w.audio, storage: null })
    store.start()
    w.pushSources([TONE])

    store.setEnabled('tone', true)
    store.setEnabled('tone', false) // user toggles straight back off
    await w.resolveContext()

    expect(w.subscribed).toEqual([])
    const row = store.getSnapshot().channels.find((c) => c.name === 'tone')
    expect(row?.enabled).toBe(false)
  })
})

describe('patchbayStore solo', () => {
  const KEYS: SourceInfo = { sourceId: 's2', name: 'keys', clientId: 'c2' }

  async function twoLiveChannels(w: FakeWorld) {
    const store = createPatchbayStore({ client: w.client, audio: w.audio, storage: null })
    store.start()
    w.pushSources([TONE, KEYS])
    store.setEnabled('tone', true)
    await w.resolveContext()
    store.setEnabled('keys', true)
    await w.resolveContext()
    return store
  }

  it('soloing one channel routes the others out of the master', async () => {
    const w = makeFakes()
    const store = await twoLiveChannels(w)

    store.setSolo('tone', true)

    expect(w.audible.get('s1')).toBe(true)
    expect(w.audible.get('s2')).toBe(false)
    expect(store.getSnapshot().channels.find((c) => c.name === 'tone')?.soloed).toBe(true)
  })

  it('clearing the last solo restores every channel', async () => {
    const w = makeFakes()
    const store = await twoLiveChannels(w)

    store.setSolo('tone', true)
    store.setSolo('tone', false)

    expect(w.audible.get('s1')).toBe(true)
    expect(w.audible.get('s2')).toBe(true)
  })

  it('disabling a solo’d channel drops its solo instead of silencing the mix', async () => {
    const w = makeFakes()
    const store = await twoLiveChannels(w)

    store.setSolo('tone', true)
    store.setEnabled('tone', false)

    expect(w.audible.get('s2')).toBe(true)
    expect(store.getSnapshot().channels.find((c) => c.name === 'tone')?.soloed).toBe(false)
  })

  it('a channel wired while a solo is engaged comes up routed out', async () => {
    const w = makeFakes()
    const store = createPatchbayStore({ client: w.client, audio: w.audio, storage: null })
    store.start()
    w.pushSources([TONE])
    store.setEnabled('tone', true)
    await w.resolveContext()
    store.setSolo('tone', true)

    w.pushSources([TONE, KEYS])
    store.setEnabled('keys', true)
    await w.resolveContext()

    expect(w.audible.get('s2')).toBe(false)
  })
})

describe('patchbayStore persistence', () => {
  it('restores enables, fader positions and master state from storage', () => {
    const storage = memoryStorage(
      JSON.stringify({
        channels: { tone: { enabled: true, db: -12 } },
        master: { db: -6, muted: true },
      }),
    )
    const w = makeFakes()
    const store = createPatchbayStore({ client: w.client, audio: w.audio, storage })
    store.start()
    w.pushSources([TONE])

    const snap = store.getSnapshot()
    const row = snap.channels.find((c) => c.name === 'tone')
    expect(row?.enabled).toBe(true)
    expect(row?.db).toBe(-12)
    expect(snap.master.db).toBe(-6)
    expect(snap.master.muted).toBe(true)
  })

  it('a restored channel appears even before its source is advertised', () => {
    const storage = memoryStorage(
      JSON.stringify({
        channels: { tone: { enabled: true, db: 0 } },
        master: { db: 0, muted: false },
      }),
    )
    const w = makeFakes()
    const store = createPatchbayStore({ client: w.client, audio: w.audio, storage })
    store.start()

    const row = store.getSnapshot().channels.find((c) => c.name === 'tone')
    expect(row).toBeDefined()
    expect(row?.present).toBe(false)
    expect(row?.enabled).toBe(true)
  })

  it('writes intent changes back to storage', () => {
    const storage = memoryStorage()
    const w = makeFakes()
    const store = createPatchbayStore({ client: w.client, audio: w.audio, storage })
    store.start()
    w.pushSources([TONE])

    store.setEnabled('tone', true)
    store.setChannelDb('tone', -9)
    store.setMasterDb(-3)
    store.setMuted(true)

    const saved = parsePatch(storage.data.get(PATCH_STORAGE_KEY) ?? null)
    expect(saved).toEqual({
      channels: { tone: { enabled: true, db: -9 } },
      master: { db: -3, muted: true },
    })
  })

  it('ignores corrupt storage content', () => {
    const storage = memoryStorage('{definitely not json')
    const w = makeFakes()
    const store = createPatchbayStore({ client: w.client, audio: w.audio, storage })
    store.start()
    w.pushSources([TONE])

    const row = store.getSnapshot().channels.find((c) => c.name === 'tone')
    expect(row?.enabled).toBe(false)
    expect(store.getSnapshot().master.db).toBe(0)
  })
})
