/*
 * persist tests — round-trip and defensive parsing of the stored patch.
 * Storage content is user-editable, so the parser must swallow anything.
 */

import { describe, expect, it } from 'vitest'
import {
  PATCH_STORAGE_KEY,
  loadPatch,
  parsePatch,
  savePatch,
  serializePatch,
  type PatchStorage,
  type PersistedPatch,
} from './persist'

const PATCH: PersistedPatch = {
  channels: {
    mchord: { enabled: true, db: -6 },
    mkeys: { enabled: false, db: 3.5 },
  },
  master: { db: -3, muted: false },
}

function memoryStorage(): PatchStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

describe('parsePatch', () => {
  it('round-trips a serialized patch', () => {
    expect(parsePatch(serializePatch(PATCH))).toEqual(PATCH)
  })

  it.each([
    ['null input', null],
    ['empty string', ''],
    ['not JSON', '{nope'],
    ['a scalar', '42'],
    ['missing master', '{"channels":{}}'],
    ['non-numeric master db', '{"channels":{},"master":{"db":"loud","muted":false}}'],
    ['non-finite master db', '{"channels":{},"master":{"db":null,"muted":false}}'],
    ['missing channels', '{"master":{"db":0,"muted":false}}'],
  ])('returns null for %s', (_label, raw) => {
    expect(parsePatch(raw)).toBeNull()
  })

  it('drops malformed channel entries but keeps valid ones', () => {
    const raw = JSON.stringify({
      channels: {
        good: { enabled: true, db: -12 },
        noDb: { enabled: true },
        badDb: { enabled: true, db: 'eleven' },
        badEnabled: { enabled: 'yes', db: 0 },
        scalar: 7,
      },
      master: { db: 0, muted: true },
    })
    expect(parsePatch(raw)).toEqual({
      channels: { good: { enabled: true, db: -12 } },
      master: { db: 0, muted: true },
    })
  })

  it('clamps out-of-range dB values into the fader range', () => {
    const raw = JSON.stringify({
      channels: { hot: { enabled: true, db: 99 }, cold: { enabled: false, db: -999 } },
      master: { db: 40, muted: false },
    })
    const parsed = parsePatch(raw)
    expect(parsed?.channels.hot.db).toBe(6)
    expect(parsed?.channels.cold.db).toBe(-60)
    expect(parsed?.master.db).toBe(6)
  })
})

describe('loadPatch / savePatch', () => {
  it('round-trips through a storage object', () => {
    const storage = memoryStorage()
    savePatch(storage, PATCH)
    expect(storage.data.has(PATCH_STORAGE_KEY)).toBe(true)
    expect(loadPatch(storage)).toEqual(PATCH)
  })

  it('tolerates a throwing storage (privacy mode)', () => {
    const throwing: PatchStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadPatch(throwing)).toBeNull()
    expect(() => savePatch(throwing, PATCH)).not.toThrow()
  })

  it('returns null when storage is unavailable', () => {
    expect(loadPatch(null)).toBeNull()
    expect(() => savePatch(null, PATCH)).not.toThrow()
  })
})
