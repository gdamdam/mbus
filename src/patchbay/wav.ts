/*
 * wav.ts — pure PCM WAV encoding for the monitor capture.
 *
 * Adapted from mtape's `src/recording/wav.ts` (same suite, AGPL-3.0-or-later;
 * see NOTICE) trimmed to the 16-bit case — a monitor bounce doesn't need the
 * 24-bit studio path. PURE: no DOM, no Web Audio, no Blob — emits a plain
 * ArrayBuffer the caller can wrap however it likes.
 */

export interface WavEncodeOptions {
  sampleRate: number
}

// Full-scale for 16-bit: 2^15 - 1. Scaling by the positive max keeps +1.0
// exactly at full-scale and -1.0 symmetric, so neither rail can wrap.
const FULL_SCALE = 32767
const BYTES_PER_SAMPLE = 2

/**
 * Interleave `channels` (mono/stereo/N>=1) and encode as 16-bit PCM WAV.
 * All channels must share the same length.
 */
export function encodeWav(channels: Float32Array[], opts: WavEncodeOptions): ArrayBuffer {
  const numChannels = channels.length
  if (numChannels < 1) {
    throw new Error('encodeWav: at least one channel is required')
  }
  const frames = channels[0].length
  for (let c = 1; c < numChannels; c++) {
    if (channels[c].length !== frames) {
      throw new Error(
        `encodeWav: channel ${c} has ${channels[c].length} samples, expected ${frames} to match channel 0`,
      )
    }
  }
  if (!Number.isInteger(opts.sampleRate) || opts.sampleRate <= 0) {
    throw new Error(`encodeWav: sampleRate must be a positive integer, got ${opts.sampleRate}`)
  }

  const blockAlign = numChannels * BYTES_PER_SAMPLE
  const byteRate = opts.sampleRate * blockAlign
  const dataSize = frames * blockAlign
  // RIFF chunks are word-aligned; 16-bit frames are always even-sized, so no
  // pad byte is ever needed here (mtape's 24-bit path is where it matters).
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeTag(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeTag(view, 8, 'WAVE')
  writeTag(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size for PCM
  view.setUint16(20, 1, true) // audioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, opts.sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bit depth
  writeTag(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < numChannels; c++) {
      view.setInt16(offset, quantize(channels[c][f]), true)
      offset += 2
    }
  }
  return buffer
}

/** Clamp to [-1,1] (NaN → 0) then round to the nearest integer sample. */
function quantize(sample: number): number {
  const s = Number.isFinite(sample) ? Math.min(1, Math.max(-1, sample)) : 0
  return Math.round(s * FULL_SCALE)
}

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let i = 0; i < tag.length; i++) {
    view.setUint8(offset + i, tag.charCodeAt(i))
  }
}

/**
 * Concatenate a stream of per-block channel chunks (as posted by the capture
 * worklet: each block is `[ch0, ch1, ...]`) into one buffer per channel.
 * The channel count is taken from the first block; blocks with a different
 * channel count throw (our capture node pins the count, so it's a bug).
 */
export function concatChannelChunks(blocks: readonly Float32Array[][]): Float32Array[] {
  if (blocks.length === 0) return []
  const numChannels = blocks[0].length
  let frames = 0
  for (const block of blocks) {
    if (block.length !== numChannels) {
      throw new Error(
        `concatChannelChunks: block has ${block.length} channels, expected ${numChannels}`,
      )
    }
    frames += block[0]?.length ?? 0
  }
  const out = Array.from({ length: numChannels }, () => new Float32Array(frames))
  let offset = 0
  for (const block of blocks) {
    for (let c = 0; c < numChannels; c++) out[c].set(block[c], offset)
    offset += block[0]?.length ?? 0
  }
  return out
}
