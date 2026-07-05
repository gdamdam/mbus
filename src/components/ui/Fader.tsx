/*
 * Fader — a dB gain slider built on a native range input (keyboard + a11y for
 * free). The numeric readout is monospace, instrument-grade. Value is dB; the
 * hook converts to linear gain.
 */

import { DB_MAX, DB_MIN, formatDb } from '../../patchbay/level'

interface FaderProps {
  db: number
  onChange(db: number): void
  label: string
  disabled?: boolean
}

export function Fader({ db, onChange, label, disabled }: FaderProps) {
  return (
    <label className="fader" data-disabled={disabled}>
      <span className="sr-only">{label}</span>
      <input
        type="range"
        className="fader__input"
        min={DB_MIN}
        max={DB_MAX}
        step={0.5}
        value={db}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="fader__value mono" aria-hidden="true">
        {formatDb(db)}
        <span className="fader__unit"> dB</span>
      </span>
    </label>
  )
}
