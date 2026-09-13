import type { CSSProperties } from 'react'

type StampVariant = 'verified' | 'flagged' | 'pending'

const styles: Record<StampVariant, CSSProperties> = {
  verified: {
    borderColor: 'var(--color-verified)',
    color: 'var(--color-verified)',
    background: 'var(--color-verified-dim)',
  },
  flagged: {
    borderColor: 'var(--color-flagged)',
    color: 'var(--color-flagged)',
    background: 'var(--color-flagged-dim)',
  },
  pending: {
    borderColor: 'var(--color-steel-400)',
    color: 'var(--color-steel-400)',
    background: 'transparent',
  },
}

const labels: Record<StampVariant, string> = {
  verified: 'VERIFIED',
  flagged: 'FLAGGED',
  pending: 'PENDING',
}

export function Stamp({
  variant = 'verified',
  size = 80,
}: {
  variant?: StampVariant
  size?: number
}) {
  return (
    <div
      className="rounded-full border-2 flex items-center justify-center font-mono text-[10px] font-medium tracking-wider rotate-[-12deg] select-none"
      style={{
        width: size,
        height: size,
        ...styles[variant],
      }}
    >
      {labels[variant]}
    </div>
  )
}
