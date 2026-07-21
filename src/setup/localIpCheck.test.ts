import { describe, expect, it } from 'vitest'
import { classifyLocalIp } from './localIpCheck'

// A real-IP host candidate means WebRtcLocalIpsAllowedUrls is exposing local
// IPs for this origin — routing can connect.
const REAL_IP = 'candidate:1 1 udp 2113937151 192.168.1.42 51090 typ host generation 0'
// An mDNS-masked host candidate — the default; cross-origin routing will stall.
const MDNS = 'candidate:2 1 udp 2113937151 0d5015dc-7178-4b44-8fbd-02491a826d13.local 55625 typ host'
// Non-host candidates carry no signal about local-IP masking.
const SRFLX = 'candidate:3 1 udp 1677729535 203.0.113.7 51000 typ srflx raddr 0.0.0.0 rport 0'

describe('classifyLocalIp', () => {
  it('reports ok when a host candidate exposes a real IPv4', () => {
    expect(classifyLocalIp([REAL_IP])).toBe('ok')
  })

  it('reports ok for a real IPv6 host candidate', () => {
    expect(classifyLocalIp(['candidate:4 1 udp 2113937151 fe80::1 51091 typ host'])).toBe('ok')
  })

  it('reports obfuscated when the only host candidate is mDNS', () => {
    expect(classifyLocalIp([MDNS])).toBe('obfuscated')
  })

  it('prefers ok when both a real IP and an mDNS host candidate are present', () => {
    expect(classifyLocalIp([MDNS, REAL_IP])).toBe('ok')
  })

  it('reports unknown when there are no host candidates', () => {
    expect(classifyLocalIp([SRFLX])).toBe('unknown')
  })

  it('reports unknown for an empty candidate list', () => {
    expect(classifyLocalIp([])).toBe('unknown')
  })
})
