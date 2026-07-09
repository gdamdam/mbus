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
  /** Post-meter on/off stage (solo policy) — meters stay live while routed out. */
  route: GainNode
  /** The subscription's node feeding this channel — addChannel wired its edge
   *  into `gain`, so removeChannel severs it too. */
  node: AudioNode
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
  /** Route the channel into (true) or out of (false) the master sum, after the
   *  meter tap — a solo'd mix keeps every channel's meter moving. */
  setChannelAudible(sourceId: string, audible: boolean): void
  masterAnalyser(): AnalyserNode | null
  /** The summed master bus (post-fader, post-mute) — the capture tap point. */
  masterBus(): AudioNode | null
  setMasterGain(linear: number): void
  setMuted(muted: boolean): void
  /** True when this browser can route the context to a chosen output device
   *  (AudioContext.setSinkId — Chromium). */
  canSetOutputDevice(): boolean
  /** Route the monitor to an output device id ('' = system default). The
   *  choice is remembered and re-applied if the context is created later. */
  setOutputDevice(deviceId: string): Promise<void>
  close(): void
}

/** AudioContext.setSinkId is Chromium-only and absent from lib.dom. */
interface SinkableContext extends AudioContext {
  setSinkId(id: string): Promise<void>
}

function supportsSetSinkId(): boolean {
  return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype
}

export function createPatchbayAudio(): PatchbayAudio {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let masterMeter: AnalyserNode | null = null
  let masterLinear = 1
  let muted = false
  let sinkId = ''
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
        if (sinkId && supportsSetSinkId()) {
          void (ctx as SinkableContext).setSinkId(sinkId).catch(() => {
            /* device unplugged since it was chosen — stay on the default */
          })
        }
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
      const route = ctx.createGain()
      node.connect(gain)
      gain.connect(analyser)
      gain.connect(route)
      route.connect(master)
      channels.set(sourceId, { gain, analyser, route, node })
      return analyser
    },

    removeChannel(sourceId): void {
      const ch = channels.get(sourceId)
      if (!ch) return
      try {
        ch.node.disconnect(ch.gain)
        ch.gain.disconnect()
        ch.analyser.disconnect()
        ch.route.disconnect()
      } catch {
        /* graph may already be torn down */
      }
      channels.delete(sourceId)
    },

    setChannelGain(sourceId, linear): void {
      const ch = channels.get(sourceId)
      if (ch && ctx) ch.gain.gain.setTargetAtTime(linear, ctx.currentTime, 0.01)
    },

    setChannelAudible(sourceId, audible): void {
      const ch = channels.get(sourceId)
      if (ch && ctx) ch.route.gain.setTargetAtTime(audible ? 1 : 0, ctx.currentTime, 0.01)
    },

    masterAnalyser: () => masterMeter,

    masterBus: () => master,

    setMasterGain(linear): void {
      masterLinear = linear
      if (master && ctx && !muted) master.gain.setTargetAtTime(linear, ctx.currentTime, 0.01)
    },

    setMuted(next): void {
      muted = next
      if (master && ctx) master.gain.setTargetAtTime(next ? 0 : masterLinear, ctx.currentTime, 0.01)
    },

    canSetOutputDevice: () => supportsSetSinkId(),

    async setOutputDevice(deviceId): Promise<void> {
      sinkId = deviceId
      if (ctx && supportsSetSinkId()) {
        await (ctx as SinkableContext).setSinkId(deviceId)
      }
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
