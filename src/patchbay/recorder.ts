/*
 * recorder.ts — capture an AudioNode's output to per-channel Float32 buffers.
 *
 * A tiny AudioWorkletProcessor accumulates render quanta into ~0.25 s batches
 * and posts one transferable message per batch instead of one per quantum —
 * roughly two orders of magnitude fewer allocations and messages, so the
 * capture stays quiet on the audio thread. Buffers are merged on stop and
 * encoded by the pure wav.ts. The worklet module is loaded from a Blob URL,
 * so no build-time worklet plumbing is needed (the processor owns no DSP).
 * The capture node pins its input to stereo so the WAV shape is predictable
 * regardless of what the master bus happens to carry.
 */

import { concatChannelChunks } from './wav'

const PROCESSOR_NAME = 'mbus-capture'

// How much audio each posted message carries. Larger => fewer allocations and
// messages, but a longer tail to flush at stop and more transient memory.
const BATCH_SECONDS = 0.25

// Worklet-side code, kept dependency-free and inert. It copies incoming quanta
// (the engine reuses the input buffers, so a copy is unavoidable) into a
// batch buffer and transfers it once full — transferring avoids a structured
// clone. A `flush` message drains the trailing partial batch and acks so the
// main thread never loses the tail of a recording.
const WORKLET_SOURCE = `
const BATCH_SECONDS = ${BATCH_SECONDS}
registerProcessor('${PROCESSOR_NAME}', class extends AudioWorkletProcessor {
  constructor() {
    super()
    this.cap = Math.max(128, Math.round(sampleRate * BATCH_SECONDS))
    this.buf = null // Float32Array[] of length \`channels\`, each \`cap\` frames
    this.fill = 0
    this.channels = 0
    this.port.onmessage = () => {
      this.flushPartial()
      this.port.postMessage({ flushed: true })
    }
  }
  alloc(channels) {
    this.buf = new Array(channels)
    for (let c = 0; c < channels; c++) this.buf[c] = new Float32Array(this.cap)
    this.channels = channels
    this.fill = 0
  }
  flushFull() {
    const out = this.buf
    this.port.postMessage(out, out.map((c) => c.buffer))
    this.buf = null
    this.fill = 0
  }
  flushPartial() {
    if (!this.buf || this.fill === 0) { this.buf = null; return }
    const out = this.buf.map((c) => c.slice(0, this.fill))
    this.port.postMessage(out, out.map((c) => c.buffer))
    this.buf = null
    this.fill = 0
  }
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channels = input.length
    const frames = input[0].length
    if (this.buf && this.channels !== channels) this.flushPartial()
    let read = 0
    while (read < frames) {
      if (!this.buf) this.alloc(channels)
      const space = this.cap - this.fill
      const n = space < frames - read ? space : frames - read
      for (let c = 0; c < channels; c++) {
        this.buf[c].set(input[c].subarray(read, read + n), this.fill)
      }
      this.fill += n
      read += n
      if (this.fill === this.cap) this.flushFull()
    }
    return true
  }
})
`

/** Contexts whose audioWorklet already has the capture module. */
const registered = new WeakSet<AudioContext>()

async function ensureModule(ctx: AudioContext): Promise<void> {
  if (registered.has(ctx)) return
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
    registered.add(ctx)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface MonitorRecorderOptions {
  /** Hard cap on capture length; `onLimit` fires once when it is reached. */
  maxSeconds?: number
  onLimit?: () => void
}

export interface MonitorRecorder {
  readonly sampleRate: number
  /** Seconds captured so far. */
  seconds(): number
  /**
   * Detach and return one merged Float32Array per channel. Idempotent.
   * Async because the worklet holds up to one batch (~0.25 s) that must be
   * flushed across the thread boundary before the capture is complete.
   */
  stop(): Promise<Float32Array[]>
}

const DEFAULT_MAX_SECONDS = 600

/** Start capturing `tap`'s output (usually the master bus) into memory. */
export async function startMonitorRecorder(
  ctx: AudioContext,
  tap: AudioNode,
  options: MonitorRecorderOptions = {},
): Promise<MonitorRecorder> {
  const maxSeconds = options.maxSeconds ?? DEFAULT_MAX_SECONDS
  await ensureModule(ctx)

  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  })

  const blocks: Float32Array[][] = []
  let frames = 0
  let limitFired = false
  const maxFrames = Math.floor(maxSeconds * ctx.sampleRate)

  // Set while a flush round-trip is pending; the worklet's ack resolves it.
  let flushResolve: (() => void) | null = null

  node.port.onmessage = (e: MessageEvent<Float32Array[] | { flushed: true }>) => {
    const data = e.data
    if (!Array.isArray(data)) {
      flushResolve?.() // ack for the trailing partial batch
      return
    }
    if (frames >= maxFrames) {
      if (!limitFired) {
        limitFired = true
        options.onLimit?.()
      }
      return
    }
    blocks.push(data)
    frames += data[0]?.length ?? 0
  }

  tap.connect(node)

  // Ask the worklet to post its trailing partial batch, then wait for the ack
  // (with a fallback so a torn-down worklet can never hang the stop).
  function flushWorklet(): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        flushResolve = null
        resolve()
      }
      flushResolve = done
      try {
        node.port.postMessage('flush')
      } catch {
        done()
        return
      }
      setTimeout(done, 250)
    })
  }

  async function finish(): Promise<Float32Array[]> {
    await flushWorklet()
    try {
      tap.disconnect(node)
    } catch {
      /* graph may already be torn down */
    }
    node.port.onmessage = null
    node.port.close()
    const merged = concatChannelChunks(blocks)
    blocks.length = 0
    return merged
  }

  let stopping: Promise<Float32Array[]> | null = null
  return {
    sampleRate: ctx.sampleRate,
    seconds: () => frames / ctx.sampleRate,
    stop(): Promise<Float32Array[]> {
      if (!stopping) stopping = finish()
      return stopping
    },
  }
}

/** Offer an encoded WAV as a file download (browser-only, best-effort). */
export function downloadWav(data: ArrayBuffer, filename: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  } finally {
    // Deferred so the click's navigation can still read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}
