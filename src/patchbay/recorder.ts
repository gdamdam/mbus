/*
 * recorder.ts — capture an AudioNode's output to per-channel Float32 buffers.
 *
 * A tiny AudioWorkletProcessor copies each render quantum of its input to the
 * main thread; buffers are merged on stop and encoded by the pure wav.ts.
 * The worklet module is loaded from a Blob URL, so no build-time worklet
 * plumbing is needed (the processor is a dozen lines and owns no DSP).
 * The capture node pins its input to stereo so the WAV shape is predictable
 * regardless of what the master bus happens to carry.
 */

import { concatChannelChunks } from './wav'

const PROCESSOR_NAME = 'mbus-capture'

// Worklet-side code, kept dependency-free and inert: copy the input's channel
// data and post it. Transferring the copies avoids a second structured clone.
const WORKLET_SOURCE = `
registerProcessor('${PROCESSOR_NAME}', class extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input.length > 0) {
      const copies = input.map((ch) => ch.slice(0))
      this.port.postMessage(copies, copies.map((c) => c.buffer))
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
  /** Detach and return one merged Float32Array per channel. Idempotent. */
  stop(): Float32Array[]
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

  node.port.onmessage = (e: MessageEvent<Float32Array[]>) => {
    if (frames >= maxFrames) {
      if (!limitFired) {
        limitFired = true
        options.onLimit?.()
      }
      return
    }
    blocks.push(e.data)
    frames += e.data[0]?.length ?? 0
  }

  tap.connect(node)

  let stopped: Float32Array[] | null = null
  return {
    sampleRate: ctx.sampleRate,
    seconds: () => frames / ctx.sampleRate,
    stop(): Float32Array[] {
      if (stopped) return stopped
      try {
        tap.disconnect(node)
      } catch {
        /* graph may already be torn down */
      }
      node.port.onmessage = null
      node.port.close()
      stopped = concatChannelChunks(blocks)
      blocks.length = 0
      return stopped
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
