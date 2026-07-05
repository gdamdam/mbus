/*
 * Toggle — a patch enable switch (ARIA switch). Used to patch/unpatch a source
 * into the monitor. Colour follows state via the `data-on` attribute in CSS.
 */

interface ToggleProps {
  on: boolean
  onChange(on: boolean): void
  label: string
  disabled?: boolean
}

export function Toggle({ on, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="toggle"
      data-on={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
    </button>
  )
}
