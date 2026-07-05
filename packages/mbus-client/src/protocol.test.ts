import { describe, expect, it } from 'vitest'
import { outbound, parseServerMessage, parseSignalPayload } from './protocol.js'

describe('parseServerMessage', () => {
  it('parses a welcome with directory', () => {
    const msg = parseServerMessage(
      JSON.stringify({
        type: 'mbus/welcome',
        clientId: 'c2',
        mbus: 1,
        sources: [{ sourceId: 's1', name: 'mchord', clientId: 'c1' }],
      }),
    )
    expect(msg).toEqual({
      type: 'welcome',
      clientId: 'c2',
      mbus: 1,
      sources: [{ sourceId: 's1', name: 'mchord', clientId: 'c1' }],
    })
  })

  it('drops malformed directory entries but keeps valid ones', () => {
    const msg = parseServerMessage(
      JSON.stringify({
        type: 'mbus/sources',
        sources: [
          { sourceId: 's1', name: 'ok', clientId: 'c1' },
          { sourceId: 42, name: 'bad', clientId: 'c1' },
          'garbage',
          null,
        ],
      }),
    )
    expect(msg).toEqual({
      type: 'sources',
      sources: [{ sourceId: 's1', name: 'ok', clientId: 'c1' }],
    })
  })

  it('parses announced, request, signal, error', () => {
    expect(
      parseServerMessage(JSON.stringify({ type: 'mbus/announced', sourceId: 's3', name: 'x' })),
    ).toEqual({ type: 'announced', sourceId: 's3', name: 'x' })
    expect(
      parseServerMessage(JSON.stringify({ type: 'mbus/request', sourceId: 's3', from: 'c9' })),
    ).toEqual({ type: 'request', sourceId: 's3', from: 'c9' })
    expect(
      parseServerMessage(JSON.stringify({ type: 'mbus/signal', from: 'c9', payload: { a: 1 } })),
    ).toEqual({ type: 'signal', from: 'c9', payload: { a: 1 } })
    expect(
      parseServerMessage(JSON.stringify({ type: 'mbus/error', code: 'no-such-source' })),
    ).toEqual({ type: 'error', code: 'no-such-source', message: '', re: '' })
  })

  it('ignores Link traffic, unknown types, non-JSON, and non-strings', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'link', tempo: 120 }))).toBeNull()
    expect(parseServerMessage(JSON.stringify({ type: 'mbus/v2-thing' }))).toBeNull()
    expect(parseServerMessage('not json')).toBeNull()
    expect(parseServerMessage(new ArrayBuffer(4))).toBeNull()
    expect(parseServerMessage(null)).toBeNull()
  })

  it('rejects messages with missing or mistyped required fields', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'mbus/welcome', clientId: 'c1' }))).toBeNull()
    expect(
      parseServerMessage(JSON.stringify({ type: 'mbus/welcome', clientId: 7, mbus: 1 })),
    ).toBeNull()
    expect(parseServerMessage(JSON.stringify({ type: 'mbus/request', sourceId: 's1' }))).toBeNull()
    expect(parseServerMessage(JSON.stringify({ type: 'mbus/signal', from: 'c1' }))).toBeNull()
  })
})

describe('parseSignalPayload', () => {
  it('parses offer, answer, ice, and end-of-candidates', () => {
    expect(parseSignalPayload({ kind: 'offer', sourceId: 's1', sdp: 'v=0' })).toEqual({
      kind: 'offer',
      sourceId: 's1',
      sdp: 'v=0',
    })
    expect(parseSignalPayload({ kind: 'answer', sourceId: 's1', sdp: 'v=0' })).toEqual({
      kind: 'answer',
      sourceId: 's1',
      sdp: 'v=0',
    })
    expect(
      parseSignalPayload({ kind: 'ice', sourceId: 's1', candidate: { candidate: 'x' } }),
    ).toEqual({ kind: 'ice', sourceId: 's1', candidate: { candidate: 'x' } })
    expect(parseSignalPayload({ kind: 'ice', sourceId: 's1', candidate: null })).toEqual({
      kind: 'ice',
      sourceId: 's1',
      candidate: null,
    })
  })

  it('rejects wrong shapes', () => {
    expect(parseSignalPayload(null)).toBeNull()
    expect(parseSignalPayload({ kind: 'offer', sourceId: 's1' })).toBeNull()
    expect(parseSignalPayload({ kind: 'ice', sourceId: 's1' })).toBeNull()
    expect(parseSignalPayload({ kind: 'ice', sourceId: 's1', candidate: 'str' })).toBeNull()
    expect(parseSignalPayload({ kind: 'nope', sourceId: 's1' })).toBeNull()
  })
})

describe('outbound builders', () => {
  it('serialize to the wire format the bridge expects', () => {
    expect(JSON.parse(outbound.hello())).toEqual({ type: 'mbus/hello', mbus: 1 })
    expect(JSON.parse(outbound.announce('mchord'))).toEqual({
      type: 'mbus/announce',
      name: 'mchord',
    })
    expect(JSON.parse(outbound.unannounce('s1'))).toEqual({
      type: 'mbus/unannounce',
      sourceId: 's1',
    })
    expect(JSON.parse(outbound.request('s1'))).toEqual({ type: 'mbus/request', sourceId: 's1' })
    expect(
      JSON.parse(outbound.signal('c2', { kind: 'offer', sourceId: 's1', sdp: 'v=0' })),
    ).toEqual({
      type: 'mbus/signal',
      to: 'c2',
      payload: { kind: 'offer', sourceId: 's1', sdp: 'v=0' },
    })
  })
})
