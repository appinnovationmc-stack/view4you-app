type StampVariant = 'verified' | 'pending' | 'flagged'

const VARIANT_STYLE: Record<StampVariant, { ring: string; text: string; glow: string; label: string }> = {
  verified: {
    ring: 'border-[var(--color-verified)]',
    text: 'text-[var(--color-verified)]',
    glow: 'shadow-[0_0_0_3px_var(--color-verified-dim)]',
    label: 'INSPECTED',
  },
  pending: {
    ring: 'border-[var(--color-flagged)]',
    text: 'text-[var(--color-flagged)]',
    glow: 'shadow-[0_0_0_3px_var(--color-flagged-dim)]',
    label: 'IN PROGRESS',
  },
  flagged: {
    ring: 'border-[var(--color-danger)]',
    text: 'text-[var(--color-danger)]',
    glow: 'shadow-[0_0_0_3px_rgba(224,82,107,0.13)]',
    label: 'FLAGGED',
  },
}

export function Stamp({
  variant = 'verified',
  size = 72,
  dateLabel,
}: {
  variant?: StampVariant
  size?: number
  dateLabel?: string
}) {
  const s = VARIANT_STYLE[variant]
  return (
    <div
      className={`relative flex items-center justify-center rounded-full border-2 ${s.ring} ${s.glow} shrink-0`}
      style={{ width: size, height: size, transform: 'rotate(-8deg)' }}
    >
      <div className={`absolute inset-1 rounded-full border border-dashed ${s.ring} opacity-50`} />
      <div className="flex flex-col items-center leading-none">
        <span className={`font-display font-bold ${s.text}`} style={{ fontSize: size * 0.15, letterSpacing: '0.04em' }}>
          {s.label}
        </span>
        {dateLabel && (
          <span className="font-mono text-[var(--color-steel-400)] mt-0.5" style={{ fontSize: size * 0.11 }}>
            {dateLabel}
          </span>
        )}
      </div>
    </div>
  )
}
