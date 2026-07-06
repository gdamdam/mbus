/*
 * persist.ts — pure (de)serialization of the user's patch.
 *
 * The patch — per-name enable + fader position, plus the master fader/mute —
 * is keyed by source *name*, the only identity that survives publisher
 * restarts and page reloads (sourceIds are ephemeral, per docs/protocol.md).
 * That makes a saved patch dovetail with re-wire-by-name: on load the intent
 * map is seeded from storage and reconcile re-wires as sources appear.
 *
 * PURE: no localStorage, no DOM — callers hand in a Storage-like object.
 * Parsing is defensive: storage content is user-editable, so anything
 * malformed degrades to "no saved patch" rather than throwing.
 */

import type { DesiredChannel } from './reconcile'
import { DB_MAX, DB_MIN } from './level'

/** Bump when the shape changes; old versions are discarded, not migrated. */
export const PATCH_STORAGE_KEY = 'mbus.patch.v1'

export interface PersistedPatch {
  channels: Record<string, DesiredChannel>
  master: { db: number; muted: boolean }
}

/** The subset of Storage the patchbay needs (injectable for tests). */
export type PatchStorage = Pick<Storage, 'getItem' | 'setItem'>

const clampDb = (v: number): number => Math.min(DB_MAX, Math.max(DB_MIN, v))

export function serializePatch(patch: PersistedPatch): string {
  return JSON.stringify(patch)
}

/** Parse a stored patch; null on anything malformed (never throws). */
export function parsePatch(raw: string | null): PersistedPatch | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>

  const master = obj.master
  if (typeof master !== 'object' || master === null) return null
  const m = master as Record<string, unknown>
  if (typeof m.db !== 'number' || !Number.isFinite(m.db)) return null
  if (typeof m.muted !== 'boolean') return null

  if (typeof obj.channels !== 'object' || obj.channels === null) return null
  const channels: Record<string, DesiredChannel> = {}
  for (const [name, ch] of Object.entries(obj.channels as Record<string, unknown>)) {
    if (typeof ch !== 'object' || ch === null) continue
    const c = ch as Record<string, unknown>
    if (typeof c.enabled !== 'boolean') continue
    if (typeof c.db !== 'number' || !Number.isFinite(c.db)) continue
    channels[name] = { enabled: c.enabled, db: clampDb(c.db) }
  }

  return { channels, master: { db: clampDb(m.db), muted: m.muted } }
}

/** Load the saved patch, or null when absent/corrupt/storage-unavailable. */
export function loadPatch(storage: PatchStorage | null): PersistedPatch | null {
  if (!storage) return null
  try {
    return parsePatch(storage.getItem(PATCH_STORAGE_KEY))
  } catch {
    return null // storage access can throw (privacy modes); treat as absent
  }
}

/** Save the patch, best-effort (quota/privacy failures are silent). */
export function savePatch(storage: PatchStorage | null, patch: PersistedPatch): void {
  if (!storage) return
  try {
    storage.setItem(PATCH_STORAGE_KEY, serializePatch(patch))
  } catch {
    /* quota exceeded or privacy mode — persistence is best-effort */
  }
}

/** The browser's localStorage, or null where unavailable (tests, privacy modes). */
export function defaultPatchStorage(): PatchStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
