/*
 * Meter — an analyser-driven level bar.
 *
 * Runs its own requestAnimationFrame loop and writes level straight to the DOM
 * (bar width + a decaying peak tick) so metering never triggers a React render.
 * The RMS→display mapping is the pure `rmsToMeter` (dB-scaled) so the bar reads
 * like a real meter. Green→amber→red ramp comes from the CSS gradient; the mask
 * just reveals it up to the current level.
 */

import { useEffect, useRef } from 'react'
import { rmsToMeter } from '../../patchbay/level'

interface MeterProps {
  analyser: AnalyserNode | null
  /** Accessible label, e.g. "mchord level". */
  label: string
}

const PEAK_DECAY_PER_FRAME = 0.015
/** A sample at/over this amplitude counts as a clip (digital full scale). */
const CLIP_LEVEL = 0.99
/** How long the clip LED stays lit after the last clipping frame. */
const CLIP_HOLD_MS = 1500

export function Meter({ analyser, label }: MeterProps) {
  const fillRef = useRef<HTMLDivElement>(null)
  const peakRef = useRef<HTMLDivElement>(null)
  const clipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fill = fillRef.current
    const peak = peakRef.current
    const clip = clipRef.current
    if (!analyser || !fill || !peak) {
      if (fill) fill.style.clipPath = 'inset(0 100% 0 0)'
      if (peak) peak.style.left = '0%'
      if (clip) clip.dataset.clip = 'false'
      return
    }
    const buf = new Float32Array(analyser.fftSize)
    let peakLevel = 0
    let clipUntil = 0
    let raf = 0
    const tick = () => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      let peakSample = 0
      for (const v of buf) {
        sum += v * v
        const a = v < 0 ? -v : v
        if (a > peakSample) peakSample = a
      }
      const level = rmsToMeter(Math.sqrt(sum / buf.length))
      // Reveal the fixed green→amber→red ramp from the left up to `level`, so the
      // colour at each position is stable (scaling would compress the gradient).
      fill.style.clipPath = `inset(0 ${((1 - level) * 100).toFixed(1)}% 0 0)`
      peakLevel = Math.max(level, peakLevel - PEAK_DECAY_PER_FRAME)
      peak.style.left = `${(peakLevel * 100).toFixed(1)}%`
      if (clip) {
        // Latch the clip LED: any full-scale sample lights it for CLIP_HOLD_MS,
        // re-armed while the signal keeps clipping.
        const now = performance.now()
        if (peakSample >= CLIP_LEVEL) clipUntil = now + CLIP_HOLD_MS
        clip.dataset.clip = String(now < clipUntil)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [analyser])

  return (
    <div className="meter" role="meter" aria-label={label}>
      <div className="meter__fill" ref={fillRef} />
      <div className="meter__peak" ref={peakRef} />
      <div className="meter__clip" ref={clipRef} data-clip="false" title="clip" />
    </div>
  )
}
