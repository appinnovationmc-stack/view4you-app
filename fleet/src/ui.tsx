import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export const money = (n: number | string | null | undefined) =>
  n == null || n === '' ? '—' : 'R' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
export const num = (n: number | string | null | undefined, digits = 0) =>
  n == null || n === '' ? '—' : Number(n).toLocaleString('en-ZA', { maximumFractionDigits: digits })
export const dateOnly = (v: string | null | undefined) =>
  v ? new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
export const label = (s: string | null | undefined) => (s ?? '—').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
export const todayIso = () => new Date().toISOString().slice(0, 10)

const GOOD = new Set(['active', 'approved', 'completed', 'valid', 'ok', 'paid', 'resolved', 'closed', 'excellent', 'good', 'owned'])
const WARN = new Set(['requested', 'scheduled', 'due_soon', 'reported', 'investigating', 'in_progress', 'planned', 'fair', 'reserved', 'captured', 'backlog', 'medium', 'no_history', 'vacant', 'rented', 'leased', 'moderate', 'minor', 'claim_lodged', 'in_workshop'])
const BAD = new Set(['expired', 'overdue', 'rejected', 'cancelled', 'suspended', 'poor', 'critical', 'disputed', 'out_of_service', 'major', 'high', 'for_disposal'])
export function Pill({ value, text }: { value: string | null | undefined; text?: string }) {
  if (!value) return <span className="muted">—</span>
  const cls = BAD.has(value) ? 'bad' : GOOD.has(value) ? 'ok' : WARN.has(value) ? 'warn' : ''
  return <span className={`pill ${cls}`}>{text ?? label(value)}</span>
}

/** Async loader with loading / error state; reload() keeps the old data on screen. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    const id = ++seq.current
    setLoading(true)
    fn().then((d) => { if (id === seq.current) { setData(d); setError(null) } })
      .catch((e: Error) => { if (id === seq.current) setError(e.message) })
      .finally(() => { if (id === seq.current) setLoading(false) })
  }, deps)
  useEffect(() => { run() }, [run])
  return { data, error, loading, reload: run }
}

export const ErrorBanner = ({ message }: { message: string | null }) =>
  message ? <div className="banner bad" role="alert">{message}</div> : null
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>

export function Head({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="head">
      <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      <div className="row">{children}</div>
    </div>
  )
}

export function Tile({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' | 'warn' | 'ok'; onClick?: () => void }) {
  const inner = <><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="muted tilesub">{sub}</div>}</>
  return <div className={`card ${tone ? 'tone-' + tone : ''}`}>{onClick ? <button onClick={onClick}>{inner}</button> : inner}</div>
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className="tab" onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function ConfirmModal(props: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true); setError(null)
    try { await props.onConfirm(); props.onClose() } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title={props.title} onClose={() => !busy && props.onClose()}>
      <div className="muted">{props.body}</div>
      <ErrorBanner message={error} />
      <div className="row end">
        <button className="btn" onClick={props.onClose} disabled={busy}>Back</button>
        <button className={`btn ${props.danger ? 'danger' : 'primary'}`} onClick={() => void go()} disabled={busy}>{busy ? 'Working…' : props.confirmLabel}</button>
      </div>
    </Modal>
  )
}

/** Horizontal bars for a {label: count} breakdown. */
export function Bars({ data, total }: { data: Record<string, number>; total?: number }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1])
  const max = total ?? Math.max(1, ...entries.map(([, n]) => n))
  if (entries.length === 0) return <p className="muted">Nothing recorded yet.</p>
  return (
    <div className="funnel">
      {entries.map(([k, n]) => (
        <div className="frow" key={k}>
          <span>{label(k)}</span>
          <div className="fbar"><span style={{ width: `${Math.max(2, (n / max) * 100)}%` }} /></div>
          <span className="fval"><strong>{n}</strong></span>
        </div>
      ))}
    </div>
  )
}
