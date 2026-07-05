import { describe, expect, it } from 'vitest'
import { DB_MAX, DB_MIN, dbToGain, formatDb, gainToDb, rmsToMeter } from './level'

describe('dbToGain', () => {
  it('maps 0 dB to unity gain', () => {
    expect(dbToGain(0)).toBeCloseTo(1, 6)
  })

  it('maps −6 dB to ~0.501', () => {
    expect(dbToGain(-6)).toBeCloseTo(0.50119, 4)
  })

  it('treats the floor and below as silence', () => {
    expect(dbToGain(DB_MIN)).toBe(0)
    expect(dbToGain(-1000)).toBe(0)
  })

  it('clamps above the max', () => {
    expect(dbToGain(999)).toBeCloseTo(dbToGain(DB_MAX), 6)
  })

  it('is silence for non-finite input', () => {
    expect(dbToGain(NaN)).toBe(0)
  })
})

describe('gainToDb', () => {
  it('round-trips with dbToGain within range', () => {
    for (const db of [-48, -24, -12, -6, 0, 3, 6]) {
      expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 4)
    }
  })

  it('maps zero/negative to the floor', () => {
    expect(gainToDb(0)).toBe(DB_MIN)
    expect(gainToDb(-1)).toBe(DB_MIN)
  })
})

describe('formatDb', () => {
  it('shows −∞ at or below the floor', () => {
    expect(formatDb(DB_MIN)).toBe('−∞')
    expect(formatDb(-Infinity)).toBe('−∞')
  })

  it('signs values and uses a unicode minus', () => {
    expect(formatDb(0)).toBe('0.0')
    expect(formatDb(3)).toBe('+3.0')
    expect(formatDb(-12.5)).toBe('−12.5')
  })
})

describe('rmsToMeter', () => {
  it('is 0 at silence and 1 at full scale', () => {
    expect(rmsToMeter(0)).toBe(0)
    expect(rmsToMeter(1)).toBe(1)
  })

  it('is monotonic and bounded for mid levels', () => {
    const a = rmsToMeter(0.01) // −40 dB
    const b = rmsToMeter(0.1) // −20 dB
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThanOrEqual(1)
  })

  it('floors sub-floor levels to 0', () => {
    expect(rmsToMeter(0.0001, -60)).toBe(0) // −80 dB < −60 floor
  })
})
