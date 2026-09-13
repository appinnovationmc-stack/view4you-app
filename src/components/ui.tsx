import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react'

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  children: ReactNode
}) {
  const base = 'inline-flex items-center justify-center rounded-xl font-medium text-[14px] h-11 px-5 transition-colors disabled:opacity-50'
  const variants = {
    primary: 'bg-[var(--color-blue-500)] text-white hover:bg-[var(--color-blue-600)]',
    secondary: 'bg-[var(--color-navy-raised)] text-white border border-[var(--color-navy-line)]',
    ghost: 'bg-transparent text-[var(--color-blue-400)]',
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-[var(--color-navy-raised)] border border-[var(--color-navy-line)] rounded-2xl ${className}`}
    >
      {children}
    </div>
  )
}

export function Field({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="text-[12px] text-[var(--color-steel-400)] mb-1.5 block">{label}</span>
      <input
        className="w-full h-11 px-3.5 rounded-xl bg-[var(--color-navy)] border border-[var(--color-navy-line)] text-white text-[14px] placeholder:text-[var(--color-steel-600)] focus:outline-none focus:border-[var(--color-blue-400)]"
        {...props}
      />
    </label>
  )
}

export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      {onBack && (
        <button onClick={onBack} className="w-9 h-9 rounded-full bg-[var(--color-navy-raised)] flex items-center justify-center">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}
      <h1 className="font-display font-bold text-[20px]">{title}</h1>
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-[var(--color-flagged-dim)] text-[var(--color-flagged)]',
    confirmed: 'bg-[var(--color-blue-glow)] text-[var(--color-blue-400)]',
    in_progress: 'bg-[var(--color-blue-glow)] text-[var(--color-blue-400)]',
    completed: 'bg-[var(--color-verified-dim)] text-[var(--color-verified)]',
    cancelled: 'bg-red-500/20 text-[var(--color-danger)]',
  }
  return (
    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${colors[status] || colors.pending}`}>
      {status.replace('_', ' ')}
    </span>
  )
}
