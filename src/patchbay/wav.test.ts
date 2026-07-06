/*
 * wav tests — canonical header fields, quantization rails, interleaving, and
 * the chunk-concat feeding path. Golden numbers follow the RIFF/WAVE spec.
 */

import { describe, expect, it } from 'vitest'
import { concatChannelChunks, encodeWav } from './wav'

const readTag = (view: DataView, offset: number): string =>
  String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )

describe('encodeWav', () => {
  it('writes a canonical 44-byte header for stereo 48 kHz', () => {
    const buf = encodeWav([new Float32Array(4), new Float32Array(4)], { sampleRate: 48000 })
    const view = new DataView(buf)

    expect(buf.byteLength).toBe(44 + 4 * 2 * 2)
    expect(readTag(view, 0)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 16)
    expect(readTag(view, 8)).toBe('WAVE')
    expect(readTag(view, 12)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(2) // channels
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint32(28, true)).toBe(48000 * 4) // byteRate
    expect(view.getUint16(32, true)).toBe(4) // blockAlign
    expect(view.getUint16(34, true)).toBe(16) // bit depth
    expect(readTag(view, 36)).toBe('data')
    expect(view.getUint32(40, true)).toBe(16)
  })

  it('interleaves L/R frames', () => {
    const left = Float32Array.from([0.5, -0.5])
    const right = Float32Array.from([1, -1])
    const view = new DataView(encodeWav([left, right], { sampleRate: 44100 }))

    expect(view.getInt16(44, true)).toBe(Math.round(0.5 * 32767))
    expect(view.getInt16(46, true)).toBe(32767)
    expect(view.getInt16(48, true)).toBe(Math.round(-0.5 * 32767))
    expect(view.getInt16(50, true)).toBe(-32767)
  })

  it('clamps over-range samples and zeroes NaN', () => {
    const view = new DataView(
      encodeWav([Float32Array.from([2, -2, NaN])], { sampleRate: 44100 }),
    )
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32767)
    expect(view.getInt16(48, true)).toBe(0)
  })

  it('rejects empty channel lists, mismatched lengths and bad sample rates', () => {
    expect(() => encodeWav([], { sampleRate: 44100 })).toThrow(/at least one channel/)
    expect(() =>
      encodeWav([new Float32Array(2), new Float32Array(3)], { sampleRate: 44100 }),
    ).toThrow(/expected 2/)
    expect(() => encodeWav([new Float32Array(1)], { sampleRate: 44100.5 })).toThrow(
      /positive integer/,
    )
  })
})

describe('concatChannelChunks', () => {
  it('concatenates per-block channel chunks into one buffer per channel', () => {
    const merged = concatChannelChunks([
      [Float32Array.from([1, 2]), Float32Array.from([5, 6])],
      [Float32Array.from([3]), Float32Array.from([7])],
    ])
    expect(merged).toHaveLength(2)
    expect([...merged[0]]).toEqual([1, 2, 3])
    expect([...merged[1]]).toEqual([5, 6, 7])
  })

  it('returns [] for no blocks and throws on a channel-count change', () => {
    expect(concatChannelChunks([])).toEqual([])
    expect(() =>
      concatChannelChunks([[new Float32Array(1)], [new Float32Array(1), new Float32Array(1)]]),
    ).toThrow(/expected 1/)
  })
})
