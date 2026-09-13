import type { ReactNode } from 'react'
import type { BookingStatus } from '../types'

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  full,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'outline'
  disabled?: boolean
  type?: 'button' | 'submit'
  full?: boolean
}) {
  const base = 'font-display font-semibold text-[15px] rounded-2xl px-5 py-3.5 transition-all active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100'
  const styles = {
    primary: 'bg-gradient-to-r from-[var(--color-blue-600)] to-[var(--color-blue-500)] text-white shadow-lg shadow-[var(--color-blue-glow)]',
    ghost: 'bg-[var(--color-navy-raised)] text-white border border-[var(--color-navy-line)]',
    outline: 'bg-transparent text-[var(--color-blue-400)] border border-[var(--color-blue-600)]',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles[variant]} ${full ? 'w-full' : ''}`}
    >
      {children}
    </button>
  )
}

export function Card({ children, onClick, className = '' }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <div
      onClick={onClick}
      className={`bg-[var(--color-navy-raised)] border border-[var(--color-navy-line)] rounded-2xl p-4 ${onClick ? 'active:scale-[0.98] transition-transform cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  required?: boolean
}) {
  return (
    <label className="block mb-4">
      <span className="block font-body text-[13px] text-[var(--color-steel-400)] mb-1.5">
        {label}
        {required && <span className="text-[var(--color-danger)]"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[var(--color-navy)] border border-[var(--color-navy-line)] rounded-xl px-4 py-3 text-white text-[15px] placeholder:text-[var(--color-steel-600)] focus:outline-none focus:border-[var(--color-blue-500)] focus:ring-2 focus:ring-[var(--color-blue-glow)]"
      />
    </label>
  )
}

const STATUS_TONE: Record<BookingStatus, string> = {
  pending: 'text-[var(--color-flagged)] bg-[var(--color-flagged-dim)]',
  confirmed: 'text-[var(--color-blue-400)] bg-[var(--color-blue-glow)]',
  assigned: 'text-[var(--color-blue-400)] bg-[var(--color-blue-glow)]',
  in_progress: 'text-[var(--color-flagged)] bg-[var(--color-flagged-dim)]',
  report_ready: 'text-[var(--color-verified)] bg-[var(--color-verified-dim)]',
  completed: 'text-[var(--color-verified)] bg-[var(--color-verified-dim)]',
  cancelled: 'text-[var(--color-danger)] bg-[rgba(224,82,107,0.13)]',
}

export function StatusPill({ status, label }: { status: BookingStatus; label: string }) {
  return (
    <span className={`inline-block font-mono text-[11px] uppercase tracking-wide px-2.5 py-1 rounded-full ${STATUS_TONE[status]}`}>
      {label}
    </span>
  )
}

export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="font-display font-bold text-2xl text-white">{title}</h1>
      {subtitle && <p className="text-[var(--color-steel-400)] text-[14px] mt-1">{subtitle}</p>}
    </div>
  )
}
