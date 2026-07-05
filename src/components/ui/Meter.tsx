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

export function Meter({ analyser, label }: MeterProps) {
  const fillRef = useRef<HTMLDivElement>(null)
  const peakRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fill = fillRef.current
    const peak = peakRef.current
    if (!analyser || !fill || !peak) {
      if (fill) fill.style.clipPath = 'inset(0 100% 0 0)'
      if (peak) peak.style.left = '0%'
      return
    }
    const buf = new Float32Array(analyser.fftSize)
    let peakLevel = 0
    let raf = 0
    const tick = () => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += v * v
      const level = rmsToMeter(Math.sqrt(sum / buf.length))
      // Reveal the fixed green→amber→red ramp from the left up to `level`, so the
      // colour at each position is stable (scaling would compress the gradient).
      fill.style.clipPath = `inset(0 ${((1 - level) * 100).toFixed(1)}% 0 0)`
      peakLevel = Math.max(level, peakLevel - PEAK_DECAY_PER_FRAME)
      peak.style.left = `${(peakLevel * 100).toFixed(1)}%`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [analyser])

  return (
    <div className="meter" role="meter" aria-label={label}>
      <div className="meter__fill" ref={fillRef} />
      <div className="meter__peak" ref={peakRef} />
    </div>
  )
}
