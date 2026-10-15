import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export const money = (n: number | string | null | undefined) =>
  n == null ? '—' : 'R' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

const GOOD = new Set(['done', 'paid', 'applied', 'refunded', 'approved', 'accepted', 'in_progress', 'en_route'])
const BAD = new Set(['cancelled', 'rejected', 'refund_due', 'amount_mismatch', 'rejected_kind', 'already_paid_other_reference', 'suspended'])
export function Pill({ value, label }: { value: string; label?: string }) {
  const cls = GOOD.has(value) ? 'ok' : BAD.has(value) ? 'bad' : value === 'pending' || value === 'unpaid' ? 'warn' : ''
  return <span className={`pill ${cls}`}>{(label ?? value).replace(/_/g, ' ')}</span>
}

/** Loads data from an async function, with loading/error state and a reload() that keeps the old data on screen. */
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

export function ErrorBanner({ message }: { message: string | null }) {
  return message ? <div className="banner bad" role="alert">{message}</div> : null
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div> }

/** Asks for a typed reason / reference, then runs the action. Errors stay in the dialog. */
export function PromptModal(props: {
  title: string; description?: ReactNode; label: string; confirmLabel: string; danger?: boolean; multiline?: boolean
  onConfirm: (value: string) => Promise<void>; onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!value.trim()) { setError(`${props.label} is required.`); return }
    setBusy(true); setError(null)
    try { await props.onConfirm(value.trim()); props.onClose() }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={props.title}
         onKeyDown={(e) => { if (e.key === 'Escape' && !busy) props.onClose() }}>
      <div className="modal">
        <h2>{props.title}</h2>
        {props.description && <p className="muted">{props.description}</p>}
        <label>
          {props.label}
          {props.multiline
            ? <textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
            : <input type="text" autoFocus value={value} onChange={(e) => setValue(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />}
        </label>
        <ErrorBanner message={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={props.onClose} disabled={busy}>Back</button>
          <button className={`btn ${props.danger ? 'danger' : 'primary'}`} onClick={() => void submit()} disabled={busy}>
            {busy ? 'Working…' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Pill tabs for short filter lists (replaces a dropdown). */
export function Tabs<T extends string | number>({ options, value, onChange, label }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string
}) {
  return (
    <div className="tabs" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={`tab${o.value === value ? ' on' : ''}`} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
