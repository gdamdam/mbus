/*
 * level.ts — pure gain/level math for the patchbay.
 *
 * The mixer works in decibels (musician-facing) but Web Audio GainNodes take a
 * linear multiplier, so conversions live here, deterministic and unit-tested.
 * No Web Audio, no DOM.
 */

/** Fader range, in dB. Unity (0 dB) is pass-through; +6 gives a little makeup. */
export const DB_MIN = -60
export const DB_MAX = 6
/** dB at or below this is treated as silence (linear gain 0). */
const DB_FLOOR = DB_MIN

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Convert a dB value to a linear amplitude multiplier for a GainNode. */
export function dbToGain(db: number): number {
  const d = Number.isFinite(db) ? db : DB_FLOOR
  if (d <= DB_FLOOR) return 0
  return 10 ** (clamp(d, DB_MIN, DB_MAX) / 20)
}

/** Convert a linear amplitude to dB (−Infinity-safe: 0 → DB_MIN). */
export function gainToDb(gain: number): number {
  const g = Number.isFinite(gain) && gain > 0 ? gain : 0
  if (g <= 0) return DB_MIN
  return clamp(20 * Math.log10(g), DB_MIN, DB_MAX)
}

/** Human label for a dB fader value, e.g. "0.0", "−12.5", "−∞". */
export function formatDb(db: number): string {
  if (!Number.isFinite(db) || db <= DB_FLOOR) return '−∞'
  const r = Math.round(db * 10) / 10
  const sign = r > 0 ? '+' : r < 0 ? '−' : ''
  return `${sign}${Math.abs(r).toFixed(1)}`
}

/**
 * Map an RMS amplitude (0..1) to a 0..1 meter fill using a dB scale, so the
 * meter reads like a real level meter rather than a linear-amplitude bar.
 * `floorDb` sets the bottom of the visible range (default −60 dB).
 */
export function rmsToMeter(rms: number, floorDb = -60): number {
  const r = Number.isFinite(rms) && rms > 0 ? rms : 0
  if (r <= 0) return 0
  const db = 20 * Math.log10(r)
  if (db <= floorDb) return 0
  if (db >= 0) return 1
  return 1 - db / floorDb
}
