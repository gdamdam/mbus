/*
 * usePatchbay — the thin React binding over the patchbay store.
 *
 * The store (patchbayStore.ts) owns the mbus client, the audio graph and all
 * subscription lifecycle; this hook just creates one per mounted app, starts it,
 * and subscribes to its snapshots via useSyncExternalStore. Actions are bound
 * store methods (stable across renders).
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPatchbayStore, type PatchbaySnapshot } from './patchbayStore'

export interface Patchbay extends PatchbaySnapshot {
  setEnabled(name: string, enabled: boolean): void
  setChannelDb(name: string, db: number): void
  setMasterDb(db: number): void
  setMuted(muted: boolean): void
}

export function usePatchbay(): Patchbay {
  // Lazy state initializer — one store per mounted app, safe to read in render
  // (unlike a ref). The store itself is the mutable external system.
  const [store] = useState(createPatchbayStore)

  useEffect(() => {
    store.start()
    return () => store.destroy()
  }, [store])

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  return {
    ...snapshot,
    setEnabled: store.setEnabled,
    setChannelDb: store.setChannelDb,
    setMasterDb: store.setMasterDb,
    setMuted: store.setMuted,
  }
}
