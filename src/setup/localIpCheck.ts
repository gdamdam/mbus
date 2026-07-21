/*
 * localIpCheck — a startup probe for the one browser setting mbus depends on.
 *
 * mbus audio is peer-to-peer WebRTC with host candidates only. By default
 * browsers mask the local IP behind a random `*.local` mDNS name; that name
 * resolves within one origin but NOT across the suite's different subdomains,
 * so cross-origin channels get stuck on "connecting" forever. The fix is the
 * WebRtcLocalIpsAllowedUrls policy (see docs/webrtc-local-ip-setup.md), which
 * makes the browser emit a real host IP for m-suite origins instead.
 *
 * This probe opens a throwaway peer connection and inspects its own host
 * candidate: a real IP means the policy is in place ('ok'); a `*.local` name
 * means it is not ('obfuscated' — routing will fail); no host candidate at all
 * means we can't tell ('unknown' — e.g. no network, or WebRTC unavailable).
 */

export type LocalIpStatus = 'ok' | 'obfuscated' | 'unknown'

// candidate:<foundation> <component> <transport> <priority> <address> <port> typ host …
const HOST_CANDIDATE = /^candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ host\b/

/**
 * Classify gathered ICE candidate lines. Pure, so it carries the test coverage
 * for the decision the async probe can't unit-test in Node.
 */
export function classifyLocalIp(candidates: readonly string[]): LocalIpStatus {
  let sawHost = false
  for (const line of candidates) {
    const match = HOST_CANDIDATE.exec(line)
    if (!match) continue
    sawHost = true
    // A real IP (v4 or v6) means local IPs are exposed for this origin.
    if (!match[1].toLowerCase().endsWith('.local')) return 'ok'
  }
  return sawHost ? 'obfuscated' : 'unknown'
}

/**
 * Gather host candidates from a short-lived peer connection and classify them.
 * Never throws; resolves 'unknown' if WebRTC is unavailable or nothing gathers
 * before the timeout.
 */
export async function probeLocalIp(timeoutMs = 2500): Promise<LocalIpStatus> {
  if (typeof RTCPeerConnection === 'undefined') return 'unknown'
  const pc = new RTCPeerConnection({ iceServers: [] })
  const candidates: string[] = []
  try {
    pc.onicecandidate = (e) => {
      if (e.candidate) candidates.push(e.candidate.candidate)
    }
    pc.createDataChannel('mbus-localip-probe')
    await pc.setLocalDescription(await pc.createOffer())
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve()
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') resolve()
      })
      setTimeout(resolve, timeoutMs)
    })
  } catch {
    return 'unknown'
  } finally {
    pc.close()
  }
  return classifyLocalIp(candidates)
}
