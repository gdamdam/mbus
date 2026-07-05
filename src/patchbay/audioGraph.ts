/*
 * audioGraph.ts — the patchbay's Web Audio wiring.
 *
 * Signal flow, per subscribed source:
 *
 *   mbus-client Subscription.node ─▶ channelGain ─▶ masterGain ─▶ destination
 *                                         └▶ channelAnalyser        └▶ masterAnalyser
 *
 * The client hands us a stable GainNode per subscription (created in *our*
 * AudioContext); we own everything downstream: a per-channel fader + meter tap,
 * summed into a master bus with its own fader, mute and meter. Metering uses
 * AnalyserNodes (read by the <Meter> component's own rAF loop) — no
 * AudioWorklet is needed for level display.
 *
 * The AudioContext is created lazily, on the first enable, because a context
 * must be resumed from a user gesture (autoplay policy). A factory (not a
 * module singleton) so the app owns exactly one and tests could make their own.
 */

const ANALYSER_FFT = 1024

interface ChannelNodes {
  gain: GainNode
  analyser: AnalyserNode
}

export interface PatchbayAudio {
  /** Create + resume the context on first use (call from a user gesture). */
  ensureContext(): Promise<AudioContext>
  /** True once the context exists (so callers can pass it to subscribe()). */
  getContext(): AudioContext | null
  /** Wire a subscription's node into a fresh channel; returns its meter tap. */
  addChannel(sourceId: string, node: AudioNode): AnalyserNode
  removeChannel(sourceId: string): void
  setChannelGain(sourceId: string, linear: number): void
  masterAnalyser(): AnalyserNode | null
  setMasterGain(linear: number): void
  setMuted(muted: boolean): void
  close(): void
}

export function createPatchbayAudio(): PatchbayAudio {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let masterMeter: AnalyserNode | null = null
  let masterLinear = 1
  let muted = false
  const channels = new Map<string, ChannelNodes>()

  function buildMaster(context: AudioContext): void {
    master = context.createGain()
    master.gain.value = muted ? 0 : masterLinear
    masterMeter = context.createAnalyser()
    masterMeter.fftSize = ANALYSER_FFT
    master.connect(masterMeter)
    master.connect(context.destination)
  }

  return {
    async ensureContext(): Promise<AudioContext> {
      if (!ctx) {
        ctx = new AudioContext()
        buildMaster(ctx)
      }
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume()
        } catch {
          /* resume may reject if not from a gesture; the next enable retries */
        }
      }
      return ctx
    },

    getContext: () => ctx,

    addChannel(sourceId, node): AnalyserNode {
      if (!ctx || !master) throw new Error('mbus: audio context not ready')
      // Replace any existing channel for this id (defensive; reconcile avoids it).
      this.removeChannel(sourceId)
      const gain = ctx.createGain()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = ANALYSER_FFT
      node.connect(gain)
      gain.connect(analyser)
      gain.connect(master)
      channels.set(sourceId, { gain, analyser })
      return analyser
    },

    removeChannel(sourceId): void {
      const ch = channels.get(sourceId)
      if (!ch) return
      try {
        ch.gain.disconnect()
        ch.analyser.disconnect()
      } catch {
        /* graph may already be torn down */
      }
      channels.delete(sourceId)
    },

    setChannelGain(sourceId, linear): void {
      const ch = channels.get(sourceId)
      if (ch && ctx) ch.gain.gain.setTargetAtTime(linear, ctx.currentTime, 0.01)
    },

    masterAnalyser: () => masterMeter,

    setMasterGain(linear): void {
      masterLinear = linear
      if (master && ctx && !muted) master.gain.setTargetAtTime(linear, ctx.currentTime, 0.01)
    },

    setMuted(next): void {
      muted = next
      if (master && ctx) master.gain.setTargetAtTime(next ? 0 : masterLinear, ctx.currentTime, 0.01)
    },

    close(): void {
      for (const id of [...channels.keys()]) this.removeChannel(id)
      if (ctx) {
        void ctx.close().catch(() => {})
        ctx = null
        master = null
        masterMeter = null
      }
    },
  }
}
