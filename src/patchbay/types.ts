/*
 * types.ts — the render-facing contracts the patchbay hook exposes to the UI.
 * The audio nodes and subscriptions themselves stay inside the hook; the UI
 * only ever sees these plain, per-render snapshots plus opaque AnalyserNodes.
 */

import type { SubscriptionState } from 'mbus-client'

/** A "not yet wired" channel — enabled intent exists but no live subscription. */
export type ChannelState = SubscriptionState | 'idle'

/** One row in the patch matrix: a named source and its monitor connection. */
export interface ChannelRow {
  /** The routing key: the source's advertised name (stable across restarts). */
  name: string
  /** The current sourceId carrying this name, or null if none is advertised. */
  sourceId: string | null
  /** The owning client id, for display. */
  clientId: string | null
  /** Whether a source with this name is currently in the bridge directory. */
  present: boolean
  /** User intent: is this channel patched into the monitor? */
  enabled: boolean
  /** Solo: when any channel is solo'd, only solo'd channels reach the master. */
  soloed: boolean
  /** Fader position, in dB. */
  db: number
  /** WebRTC subscription state, or 'idle' when not subscribed. */
  subState: ChannelState
  /** Meter tap for this channel, or null when not subscribed. */
  analyser: AnalyserNode | null
}

export interface MasterState {
  db: number
  muted: boolean
  analyser: AnalyserNode | null
  /** Selected output device id ('' = system default). */
  outputDeviceId: string
  /** Available outputs (empty until enumerated; populated only when routable). */
  outputDevices: ReadonlyArray<{ deviceId: string; label: string }>
  /** True when the browser supports AudioContext.setSinkId (Chromium). */
  canRouteOutput: boolean
  /** Number of channels currently carrying live audio. */
  liveCount: number
  /** Number of sources currently advertised in the bridge directory. */
  channelCount: number
  /** Whether the monitor is being captured to a WAV right now. */
  recording: boolean
}
