import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMbusClient, type PeerConnectionLike, type WebSocketLike } from './client.js'

/** Flush pending microtasks + macrotask so async signal handlers settle. */
const tick = () => new Promise((r) => setTimeout(r, 0))

class FakeSocket implements WebSocketLike {
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true
    this.readyState = 3
    this.onclose?.()
  }
  serverOpen(): void {
    this.readyState = 1
    this.onopen?.()
  }
  serverSend(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }
  sentJson(): unknown[] {
    return this.sent.map((s) => JSON.parse(s))
  }
}

class FakePc implements PeerConnectionLike {
  tracks: MediaStreamTrack[] = []
  localDesc: RTCSessionDescriptionInit | null = null
  remoteDesc: RTCSessionDescriptionInit | null = null
  candidates: Array<RTCIceCandidateInit | null> = []
  closed = false
  connectionState = 'new'
  onicecandidate: ((e: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null =
    null
  ontrack:
    | ((e: { track: MediaStreamTrack; streams: readonly MediaStream[] }) => void)
    | null = null
  onconnectionstatechange: (() => void) | null = null

  addTrack(track: MediaStreamTrack): unknown {
    this.tracks.push(track)
    return undefined
  }
  createOffer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: 'offer', sdp: 'offer-sdp' })
  }
  createAnswer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: 'answer', sdp: 'answer-sdp' })
  }
  setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDesc = desc
    return Promise.resolve()
  }
  setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDesc = desc
    return Promise.resolve()
  }
  addIceCandidate(candidate?: RTCIceCandidateInit): Promise<void> {
    this.candidates.push(candidate ?? null)
    return Promise.resolve()
  }
  close(): void {
    this.closed = true
    this.connectionState = 'closed'
  }
}

function fakeAudioGraph() {
  const track = { id: 't1' } as unknown as MediaStreamTrack
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream
  const gain = { name: 'gain' }
  const mediaSource = { connect: vi.fn() }
  const ctx = {
    createMediaStreamDestination: vi.fn(() => ({ stream })),
    createGain: vi.fn(() => gain),
    createMediaStreamSource: vi.fn(() => mediaSource),
  } as unknown as AudioContext
  const node = { context: ctx, connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode
  return { ctx, node, stream, track, gain, mediaSource }
}

function makeHarness(overrides: Parameters<typeof createMbusClient>[0] = {}) {
  const sockets: FakeSocket[] = []
  const pcs: FakePc[] = []
  const client = createMbusClient({
    urls: ['ws://a', 'ws://b'],
    autoRetry: false,
    helloTimeoutMs: 60_000, // never fires in tests unless faked
    webSocketFactory: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    peerConnectionFactory: () => {
      const pc = new FakePc()
      pcs.push(pc)
      return pc
    },
    ...overrides,
  })
  return { client, sockets, pcs }
}

const WELCOME = { type: 'mbus/welcome', clientId: 'c1', mbus: 1, sources: [] }

/** Connect and complete the hello/welcome handshake. */
function handshake(h: ReturnType<typeof makeHarness>, welcome: unknown = WELCOME): FakeSocket {
  h.client.connect()
  const s = h.sockets[0]!
  s.serverOpen()
  s.serverSend(welcome)
  return s
}

afterEach(() => {
  vi.useRealTimers()
})

describe('connection lifecycle', () => {
  it('sends hello on open and reaches connected on welcome', () => {
    const h = makeHarness()
    const states: string[] = []
    h.client.onState((s) => states.push(s))
    const s = handshake(h, {
      ...WELCOME,
      clientId: 'c7',
      sources: [{ sourceId: 's1', name: 'mchord', clientId: 'c2' }],
    })
    expect(s.sentJson()[0]).toEqual({ type: 'mbus/hello', mbus: 1 })
    expect(states).toEqual(['connecting', 'connected'])
    expect(h.client.getClientId()).toBe('c7')
    expect(h.client.getSources()).toEqual([{ sourceId: 's1', name: 'mchord', clientId: 'c2' }])
  })

  it('declares bridge-too-old when no welcome arrives (old bridge drops hello)', () => {
    vi.useFakeTimers()
    const h = makeHarness({ helloTimeoutMs: 2000 })
    h.client.connect()
    const s = h.sockets[0]!
    s.serverOpen()
    // The old bridge keeps broadcasting Link state; it must not count as a welcome.
    s.serverSend({ type: 'link', tempo: 120, beat: 0, phase: 0, playing: false, peers: 0, clients: 1 })
    vi.advanceTimersByTime(2000)
    expect(h.client.getState()).toBe('bridge-too-old')
    expect(s.closed).toBe(true)
  })

  it('sweeps to the next URL when the socket constructor throws', () => {
    let calls = 0
    const good = new FakeSocket()
    const h = makeHarness({
      urls: ['ws://blocked', 'ws://ok'],
      webSocketFactory: (url: string) => {
        calls++
        if (url === 'ws://blocked') throw new Error('SecurityError')
        return good
      },
    })
    h.client.connect()
    expect(calls).toBe(2)
    good.serverOpen()
    expect(good.sent.length).toBe(1) // hello went to the second URL
  })

  it('ignores Link traffic and malformed frames while connected', () => {
    const h = makeHarness()
    const s = handshake(h)
    s.serverSend({ type: 'link', tempo: 140 })
    s.onmessage?.({ data: 'garbage{{' })
    s.onmessage?.({ data: new ArrayBuffer(2) })
    expect(h.client.getState()).toBe('connected')
  })

  it('disconnect() returns to idle and tears down peer state', async () => {
    const h = makeHarness()
    const g = fakeAudioGraph()
    const s = handshake(h)
    const sub = h.client.subscribe('s9', g.ctx)
    s.serverSend({ type: 'mbus/signal', from: 'c2', payload: { kind: 'offer', sourceId: 's9', sdp: 'o' } })
    await tick()
    h.client.disconnect()
    expect(h.client.getState()).toBe('idle')
    expect(sub.getState()).toBe('failed')
    expect(h.pcs[0]!.closed).toBe(true)
  })
})

describe('publishing', () => {
  it('announces on welcome (publish-before-connect works) and adopts the sourceId', () => {
    const h = makeHarness()
    const g = fakeAudioGraph()
    const pub = h.client.publishOutput(g.node, 'mchord')
    expect(pub.getState()).toBe('announcing')
    const s = handshake(h)
    expect(s.sentJson()[1]).toEqual({ type: 'mbus/announce', name: 'mchord' })
    s.serverSend({ type: 'mbus/announced', sourceId: 's5', name: 'mchord' })
    expect(pub.getSourceId()).toBe('s5')
    expect(pub.getState()).toBe('announced')
  })

  it('answers a request with a sendonly offer and relays ICE', async () => {
    const h = makeHarness()
    const g = fakeAudioGraph()
    const pub = h.client.publishOutput(g.node, 'mchord')
    const s = handshake(h)
    s.serverSend({ type: 'mbus/announced', sourceId: 's5', name: 'mchord' })
    s.serverSend({ type: 'mbus/request', sourceId: 's5', from: 'c9' })
    await tick()

    const pc = h.pcs[0]!
    expect(g.node.connect).toHaveBeenCalled() // node → MediaStreamDestination
    expect(pc.tracks).toEqual([g.track])
    expect(pc.localDesc).toEqual({ type: 'offer', sdp: 'offer-sdp' })
    const offer = s.sentJson().find((m) => (m as { payload?: { kind?: string } }).payload?.kind === 'offer')
    expect(offer).toEqual({
      type: 'mbus/signal',
      to: 'c9',
      payload: { kind: 'offer', sourceId: 's5', sdp: 'offer-sdp' },
    })
    expect(pub.subscriberCount()).toBe(1)

    // answer comes back
    s.serverSend({ type: 'mbus/signal', from: 'c9', payload: { kind: 'answer', sourceId: 's5', sdp: 'a' } })
    await tick()
    expect(pc.remoteDesc).toEqual({ type: 'answer', sdp: 'a' })

    // local ICE is relayed; end-of-candidates sends null
    pc.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'cand-1' }) } })
    pc.onicecandidate?.({ candidate: null })
    const ice = s.sentJson().filter((m) => (m as { payload?: { kind?: string } }).payload?.kind === 'ice')
    expect(ice).toEqual([
      { type: 'mbus/signal', to: 'c9', payload: { kind: 'ice', sourceId: 's5', candidate: { candidate: 'cand-1' } } },
      { type: 'mbus/signal', to: 'c9', payload: { kind: 'ice', sourceId: 's5', candidate: null } },
    ])

    // remote ICE reaches the publisher pc
    s.serverSend({ type: 'mbus/signal', from: 'c9', payload: { kind: 'ice', sourceId: 's5', candidate: { candidate: 'r1' } } })
    await tick()
    expect(pc.candidates).toEqual([{ candidate: 'r1' }])
  })

  it('ignores requests for sources it does not own', async () => {
    const h = makeHarness()
    const s = handshake(h)
    s.serverSend({ type: 'mbus/request', sourceId: 's404', from: 'c9' })
    await tick()
    expect(h.pcs.length).toBe(0)
  })

  it('stop() withdraws the source and closes subscriber connections', async () => {
    const h = makeHarness()
    const g = fakeAudioGraph()
    const pub = h.client.publishOutput(g.node, 'mchord')
    const s = handshake(h)
    s.serverSend({ type: 'mbus/announced', sourceId: 's5', name: 'mchord' })
    s.serverSend({ type: 'mbus/request', sourceId: 's5', from: 'c9' })
    await tick()
    pub.stop()
    expect(s.sentJson().at(-1)).toEqual({ type: 'mbus/unannounce', sourceId: 's5' })
    expect(h.pcs[0]!.closed).toBe(true)
    expect(pub.getState()).toBe('stopped')
    expect(g.node.disconnect).toHaveBeenCalled()
  })

  it('re-announces automatically after a reconnect', () => {
    const h = makeHarness({ autoRetry: false })
    const g = fakeAudioGraph()
    const pub = h.client.publishOutput(g.node, 'mchord')
    const s1 = handshake(h)
    s1.serverSend({ type: 'mbus/announced', sourceId: 's5', name: 'mchord' })
    expect(pub.getSourceId()).toBe('s5')

    // bridge drops; reconnect by hand (autoRetry off in tests)
    s1.close()
    expect(pub.getState()).toBe('announcing')
    expect(pub.getSourceId()).toBeNull()
    h.client.disconnect()
    h.client.connect()
    const s2 = h.sockets[1]!
    s2.serverOpen()
    s2.serverSend(WELCOME)
    expect(s2.sentJson()[1]).toEqual({ type: 'mbus/announce', name: 'mchord' })
    s2.serverSend({ type: 'mbus/announced', sourceId: 's12', name: 'mchord' })
    expect(pub.getSourceId()).toBe('s12')
  })
})

describe('subscribing', () => {
  it('requests, answers the offer, and goes live on track arrival', async () => {
    const h = makeHarness()
    const g = fakeAudioGraph()
    const s = handshake(h)
    const sub = h.client.subscribe('s5', g.ctx)
    const states: string[] = []
    sub.onState((st) => states.push(st))
    expect(s.sentJson().at(-1)).toEqual({ type: 'mbus/request', sourceId: 's5' })
    expect(sub.node).toBe(g.gain) // stable node available immediately

    s.serverSend({ type: 'mbus/signal', from: 'c2', payload: { kind: 'offer', sourceId: 's5', sdp: 'o' } })
    await tick()
    const pc = h.pcs[0]!
    expect(pc.remoteDesc).toEqual({ type: 'offer', sdp: 'o' })
    expect(s.sentJson().at(-1)).toEqual({
      type: 'mbus/signal',
      to: 'c2',
      payload: { kind: 'answer', sourceId: 's5', sdp: 'answer-sdp' },
    })

    // remote ICE routed to the subscriber pc (only from the offering peer)
    s.serverSend({ type: 'mbus/signal', from: 'c2', payload: { kind: 'ice', sourceId: 's5', candidate: { candidate: 'x' } } })
    s.serverSend({ type: 'mbus/signal', from: 'c999', payload: { kind: 'ice', sourceId: 's5', candidate: { candidate: 'spoof' } } })
    await tick()
    expect(pc.candidates).toEqual([{ candidate: 'x' }])

    const stream = { id: 'remote' } as unknown as MediaStream
    pc.ontrack?.({ track: g.track, streams: [stream] })
    expect(g.ctx.createMediaStreamSource).toHaveBeenCalledWith(stream)
    expect(g.mediaSource.connect).toHaveBeenCalledWith(g.gain)
    expect(states).toEqual(['live'])
  })

  it('requests on welcome when subscribed before the bridge connected', () => {
    const h = makeHarness()
    const g = fakeAudioGraph()
    const sub = h.client.subscribe('s5', g.ctx)
    expect(sub.getState()).toBe('connecting')
    const s = handshake(h, {
      ...WELCOME,
      sources: [{ sourceId: 's5', name: 'mchord', clientId: 'c2' }],
    })
    expect(s.sentJson().at(-1)).toEqual({ type: 'mbus/request', sourceId: 's5' })
  })

  it('fails a pre-connect subscription whose id is not in the welcome directory', () => {
    // sourceIds are never reused within a bridge run, so an id absent from
    // the welcome snapshot can never appear later — fail fast, not hang.
    const h = makeHarness()
    const g = fakeAudioGraph()
    const sub = h.client.subscribe('s-stale', g.ctx)
    handshake(h)
    expect(sub.getState()).toBe('failed')
  })

  it('fails the subscription when its source vanishes from the directory', async () => {
    const h = makeHarness()
    const g = fakeAudioGraph()
    const s = handshake(h, {
      ...WELCOME,
      sources: [{ sourceId: 's5', name: 'mchord', clientId: 'c2' }],
    })
    const sub = h.client.subscribe('s5', g.ctx)
    s.serverSend({ type: 'mbus/signal', from: 'c2', payload: { kind: 'offer', sourceId: 's5', sdp: 'o' } })
    await tick()
    s.serverSend({ type: 'mbus/sources', sources: [] })
    expect(sub.getState()).toBe('failed')
    expect(h.pcs[0]!.closed).toBe(true)
  })

  it('throws on duplicate subscribe, allows re-subscribe after close', () => {
    const h = makeHarness()
    const g = fakeAudioGraph()
    handshake(h)
    const sub = h.client.subscribe('s5', g.ctx)
    expect(() => h.client.subscribe('s5', g.ctx)).toThrow(/already subscribed/)
    sub.close()
    expect(sub.getState()).toBe('closed')
    expect(() => h.client.subscribe('s5', g.ctx)).not.toThrow()
  })

  it('marks the subscription failed when the peer connection fails', async () => {
    const h = makeHarness()
    const g = fakeAudioGraph()
    const s = handshake(h)
    const sub = h.client.subscribe('s5', g.ctx)
    s.serverSend({ type: 'mbus/signal', from: 'c2', payload: { kind: 'offer', sourceId: 's5', sdp: 'o' } })
    await tick()
    const pc = h.pcs[0]!
    pc.connectionState = 'failed'
    pc.onconnectionstatechange?.()
    expect(sub.getState()).toBe('failed')
  })
})
