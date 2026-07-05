/**
 * mbus-client — tab-to-tab WebRTC audio for the m-suite.
 * AGPL-3.0-or-later. See docs/protocol.md for the wire protocol.
 */

export { createMbusClient } from './client.js'
export type {
  BridgeState,
  MbusClient,
  MbusClientOptions,
  PeerConnectionLike,
  Publication,
  PublicationState,
  Subscription,
  SubscriptionState,
  WebSocketLike,
} from './client.js'
export {
  DEFAULT_WS_URLS,
  MBUS_VERSION,
  outbound,
  parseServerMessage,
  parseSignalPayload,
} from './protocol.js'
export type { ServerMessage, SignalPayload, SourceInfo } from './protocol.js'
