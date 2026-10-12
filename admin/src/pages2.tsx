import { useEffect, useState } from 'react'
import * as api from './api'
import { Empty, ErrorBanner, Pill, PromptModal, money, useLoad, when } from './ui'

interface PageProps { canWrite: boolean }

const Head = ({ title, sub, onReload, loading }: { title: string; sub?: string; onReload: () => void; loading: boolean }) => (
  <div className="head">
    <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
    <button className="btn" onClick={onReload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </div>
)

/* ───────────────────────── Inspector documents ───────────────────────── */
const DOC_LABEL: Record<string, string> = { id: 'ID document', licence: 'Inspector licence / certificate', proof_of_address: 'Proof of address', other: 'Other' }
export function DocumentsModal({ inspector, canWrite, onClose, onChanged }: {
  inspector: api.InspectorRow; canWrite: boolean; onClose: () => void; onChanged: () => void
}) {
  const { data, error, reload } = useLoad(() => api.listDocuments(inspector.id), [inspector.id])
  const [reject, setReject] = useState<api.DocRow | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const open = async (d: api.DocRow) => {
    setErr(null)
    try { window.open(await api.documentUrl(d.storage_path), '_blank', 'noopener,noreferrer') } catch (e) { setErr((e as Error).message) }
  }
  const approve = async (d: api.DocRow) => {
    setErr(null)
    try { await api.reviewDocument(d.id, true); reload(); onChanged() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`Documents for ${inspector.name}`}
         onKeyDown={(e) => { if (e.key === 'Escape' && !reject) onClose() }}>
      <div className="modal wide">
        <h2>Documents: {inspector.name}</h2>
        <p className="muted">Files open in a new tab through a link that expires after two minutes.</p>
        <ErrorBanner message={error ?? err} />
        {data && data.length === 0 && <Empty>This inspector has not uploaded anything yet.</Empty>}
        <div className="list">
          {data?.map((d) => (
            <div key={d.id} className="item">
              <div>
                <strong>{DOC_LABEL[d.kind] ?? d.kind}</strong> <Pill value={d.status} />
                <div className="muted">{d.file_name} · uploaded {when(d.created_at)}</div>
                {d.reject_reason && <div className="muted">Rejected: {d.reject_reason}</div>}
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => void open(d)}>Open</button>
                {canWrite && d.status !== 'approved' && <button className="btn sm primary" onClick={() => void approve(d)}>Approve</button>}
                {canWrite && d.status !== 'rejected' && <button className="btn sm danger" onClick={() => setReject(d)}>Reject</button>}
              </div>
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Close</button></div>
      </div>
      {reject && (
        <PromptModal title={`Reject ${reject.file_name}?`} multiline label="Reason (shown to the inspector)" confirmLabel="Reject" danger
          onConfirm={async (reason) => { await api.reviewDocument(reject.id, false, reason); reload(); onChanged() }}
          onClose={() => setReject(null)} />
      )}
    </div>
  )
}

/* ───────────────────────── Reassign ───────────────────────── */
export function ReassignModal({ booking, onClose, onDone }: { booking: api.BookingRow; onClose: () => void; onDone: () => void }) {
  const { data, error } = useLoad(api.listAssignable, [])
  const [pick, setPick] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async () => {
    if (!pick) { setErr('Choose an inspector.'); return }
    if (!reason.trim()) { setErr('A reason is required.'); return }
    setBusy(true); setErr(null)
    try { await api.reassignBooking(booking.id, pick, reason.trim()); onDone(); onClose() }
    catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  const options = (data ?? []).filter((i) => i.name !== booking.inspector_name)
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Reassign booking"
         onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose() }}>
      <div className="modal">
        <h2>Reassign {booking.vin}</h2>
        <p className="muted">Currently with {booking.inspector_name ?? 'nobody'}. The new inspector must accept the job again, and the buyer and both inspectors are notified. The buyer's price does not change.</p>
        <label>New inspector
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((i) => <option key={i.id} value={i.id}>{i.name}{i.online ? ' (online)' : ''}{i.region ? ` · ${i.region}` : ''}</option>)}
          </select>
        </label>
        <label>Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <ErrorBanner message={error ?? err} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} disabled={busy}>Back</button>
          <button className="btn primary" onClick={() => void go()} disabled={busy}>{busy ? 'Working…' : 'Reassign'}</button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Reports ───────────────────────── */
export function ReportsPage({ canWrite }: PageProps) {
  const [status, setStatus] = useState<'all' | 'live' | 'taken_down'>('all')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const { data, error, loading, reload } = useLoad(() => api.listReports(status, q), [status, q])
  const [down, setDown] = useState<api.ReportRow | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const restore = async (r: api.ReportRow) => {
    setActionError(null)
    try { await api.restoreReport(r.id); reload() } catch (e) { setActionError((e as Error).message) }
  }
  return (
    <>
      <Head title="Reports" onReload={reload} loading={loading}
        sub="Take a report down if it is wrong, abusive or disputed. People who already bought it keep the money they paid but can no longer open it. You can restore it." />
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setQ(search) }}>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">All</option><option value="live">Live</option><option value="taken_down">Taken down</option>
        </select>
        <input type="search" placeholder="Report number, VIN or inspector" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn" type="submit">Search</button>
      </form>
      <ErrorBanner message={error ?? actionError} />
      <div className="tablewrap">
        {data && data.length === 0 ? <Empty>No reports match.</Empty> : (
          <table>
            <thead><tr><th>Created</th><th>Report</th><th>VIN</th><th>Score</th><th>Inspector</th><th>Resale price</th><th>Sold</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.created_at)}</td><td>{r.report_number ?? '—'}</td><td>{r.vin}</td><td>{r.score}</td>
                  <td>{r.inspector_name ?? '—'}</td><td>{money(r.report_price)}</td><td>{Number(r.purchases)}</td>
                  <td>{r.taken_down_at
                    ? <><Pill value="rejected" label="taken down" /><div className="muted wraptext">{r.taken_down_reason}</div></>
                    : <Pill value="approved" label="live" />}</td>
                  <td>{canWrite && (r.taken_down_at
                    ? <button className="btn sm" onClick={() => void restore(r)}>Restore</button>
                    : <button className="btn sm danger" onClick={() => setDown(r)}>Take down</button>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {down && (
        <PromptModal title={`Take down ${down.report_number ?? down.vin}?`} danger multiline label="Reason" confirmLabel="Take down"
          description="Buyers can no longer open or order it, and the inspector and commissioning buyer are told it is under review. Unpaid orders for it are cancelled."
          onConfirm={async (reason) => { await api.takedownReport(down.id, reason); reload() }} onClose={() => setDown(null)} />
      )}
    </>
  )
}

/* ───────────────────────── Payouts ───────────────────────── */
export function PayoutsPage({ canWrite }: PageProps) {
  const [tab, setTab] = useState<'requests' | 'balances'>('requests')
  return (
    <>
      <div className="head">
        <div><h1>Payouts</h1><p className="muted">Pay withdrawals from your bank, then record the bank reference here. Balances come from the earnings ledger.</p></div>
        <div className="row">
          <button className={`btn ${tab === 'requests' ? 'primary' : ''}`} onClick={() => setTab('requests')}>Withdrawals</button>
          <button className={`btn ${tab === 'balances' ? 'primary' : ''}`} onClick={() => setTab('balances')}>Balances</button>
        </div>
      </div>
      {tab === 'requests' ? <Withdrawals canWrite={canWrite} /> : <Balances canWrite={canWrite} />}
    </>
  )
}

function Withdrawals({ canWrite }: PageProps) {
  const [status, setStatus] = useState('requested')
  const { data, error, loading, reload } = useLoad(() => api.listWithdrawals(status), [status])
  const [pay, setPay] = useState<api.WithdrawalRow | null>(null)
  const [reject, setReject] = useState<api.WithdrawalRow | null>(null)
  if (!canWrite) return <div className="banner bad">Withdrawals show bank account numbers, so they are only visible to admins.</div>
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="requested">Waiting to be paid</option><option value="paid">Paid</option>
          <option value="rejected">Rejected</option><option value="cancelled">Cancelled</option><option value="all">All</option>
        </select>
        <button className="btn" onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <ErrorBanner message={error} />
      <div className="tablewrap">
        {data && data.length === 0 ? <Empty>No withdrawals here.</Empty> : (
          <table>
            <thead><tr><th>Requested</th><th>Person</th><th>Amount</th><th>Pay to</th><th>Their balance</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data?.map((w) => (
                <tr key={w.id}>
                  <td>{when(w.requested_at)}</td>
                  <td>{w.name}<br /><span className="muted">{w.email}</span></td>
                  <td><strong>{money(w.amount)}</strong></td>
                  <td>{w.account.account_holder}<br /><span className="muted">{w.account.bank_name} · {w.account.account_type}</span>
                    <br />Acc {w.account.account_number} · Branch {w.account.branch_code}</td>
                  <td>{money(w.balance)}</td>
                  <td><Pill value={w.status === 'requested' ? 'pending' : w.status} label={w.status === 'requested' ? 'waiting' : w.status} />
                    {w.reference && <div className="muted">Ref {w.reference}</div>}
                    {w.reject_reason && <div className="muted wraptext">{w.reject_reason}</div>}</td>
                  <td>{w.status === 'requested' && <div className="row">
                    <button className="btn sm primary" onClick={() => setPay(w)}>Record payment</button>
                    <button className="btn sm danger" onClick={() => setReject(w)}>Reject</button></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pay && (
        <PromptModal title={`Record payment of ${money(pay.amount)} to ${pay.name}`} label="Bank payment reference" confirmLabel="Record payment"
          description="Only do this after the money has left your bank account. It is deducted from their balance and cannot be undone."
          onConfirm={async (ref) => { await api.payWithdrawal(pay.id, ref); reload() }} onClose={() => setPay(null)} />
      )}
      {reject && (
        <PromptModal title={`Reject withdrawal for ${reject.name}?`} danger multiline label="Reason (shown to them)" confirmLabel="Reject"
          onConfirm={async (reason) => { await api.rejectWithdrawal(reject.id, reason); reload() }} onClose={() => setReject(null)} />
      )}
    </>
  )
}

function Balances({ canWrite }: PageProps) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const { data, error, loading, reload } = useLoad(() => api.listBalances(q), [q])
  const [ledgerFor, setLedgerFor] = useState<api.BalanceRow | null>(null)
  const [adjust, setAdjust] = useState<api.BalanceRow | null>(null)
  return (
    <>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setQ(search) }}>
        <input type="search" placeholder="Name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn" type="submit">Search</button>
        <button className="btn" type="button" onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </form>
      <ErrorBanner message={error} />
      <div className="tablewrap">
        {data && data.length === 0 ? <Empty>No earnings recorded yet.</Empty> : (
          <table>
            <thead><tr><th>Person</th><th>Role</th><th>Earned</th><th>Paid out</th><th>Adjustments</th><th>Balance</th><th></th></tr></thead>
            <tbody>
              {data?.map((b) => (
                <tr key={b.user_id}>
                  <td>{b.name}<br /><span className="muted">{b.email}</span></td><td>{b.role}</td>
                  <td>{money(b.earned)}</td><td>{money(b.paid_out)}</td><td>{money(b.adjustments)}</td><td><strong>{money(b.balance)}</strong></td>
                  <td><div className="row">
                    <button className="btn sm" onClick={() => setLedgerFor(b)}>Ledger</button>
                    {canWrite && <button className="btn sm" onClick={() => setAdjust(b)}>Adjust</button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {ledgerFor && <LedgerModal who={ledgerFor} onClose={() => setLedgerFor(null)} />}
      {adjust && <AdjustModal who={adjust} onClose={() => setAdjust(null)} onDone={reload} />}
    </>
  )
}

function LedgerModal({ who, onClose }: { who: api.BalanceRow; onClose: () => void }) {
  const { data, error } = useLoad(() => api.listLedger(who.user_id), [who.user_id])
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`Ledger for ${who.name}`} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <div className="modal wide">
        <h2>Ledger: {who.name}</h2>
        <ErrorBanner message={error} />
        <div className="tablewrap">
          <table>
            <thead><tr><th>When</th><th>Type</th><th>Amount</th><th>Note</th></tr></thead>
            <tbody>
              {data?.map((l) => (
                <tr key={l.id}><td>{when(l.created_at)}</td><td>{l.kind.replace(/_/g, ' ')}</td>
                  <td className={l.amount < 0 ? 'neg' : ''}>{l.amount < 0 ? '−' : ''}{money(Math.abs(l.amount))}</td><td className="wrap">{l.note ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}

function AdjustModal({ who, onClose, onDone }: { who: api.BalanceRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async () => {
    const n = Number(amount)
    if (!Number.isInteger(n) || n === 0) { setErr('Enter a whole-rand amount, positive to credit or negative to deduct.'); return }
    if (!reason.trim()) { setErr('A reason is required.'); return }
    setBusy(true); setErr(null)
    try { await api.addAdjustment(who.user_id, n, reason.trim()); onDone(); onClose() } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Adjust balance" onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose() }}>
      <div className="modal">
        <h2>Adjust balance for {who.name}</h2>
        <p className="muted">Current balance {money(who.balance)}. The person is notified. A deduction cannot take the balance below zero.</p>
        <label>Amount in rand (use a minus sign to deduct)<input type="text" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <ErrorBanner message={err} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} disabled={busy}>Back</button>
          <button className="btn primary" onClick={() => void go()} disabled={busy}>{busy ? 'Working…' : 'Apply'}</button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Support ───────────────────────── */
export function SupportPage() {
  const [status, setStatus] = useState('unresolved')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const { data, error, loading, reload } = useLoad(() => api.listTickets(status, q), [status, q])
  const [open, setOpen] = useState<api.TicketRow | null>(null)
  return (
    <>
      <Head title="Support" onReload={reload} loading={loading} sub="Tickets from buyers and inspectors. Support staff can reply and resolve." />
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setQ(search) }}>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="unresolved">Not resolved</option><option value="open">Waiting on us</option>
          <option value="answered">Waiting on customer</option><option value="resolved">Resolved</option><option value="all">All</option>
        </select>
        <input type="search" placeholder="Subject, email or VIN" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn" type="submit">Search</button>
      </form>
      <ErrorBanner message={error} />
      <div className="tablewrap">
        {data && data.length === 0 ? <Empty>No tickets here.</Empty> : (
          <table>
            <thead><tr><th>Updated</th><th>Subject</th><th>From</th><th>Booking</th><th>Messages</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data?.map((t) => (
                <tr key={t.id}>
                  <td>{when(t.updated_at)}</td><td className="wrap"><strong>{t.subject}</strong></td>
                  <td>{t.name} <span className="muted">({t.role})</span><br /><span className="muted">{t.email}</span></td>
                  <td>{t.vin ?? '—'}</td><td>{Number(t.messages)}</td>
                  <td><Pill value={t.status === 'open' ? 'pending' : t.status === 'resolved' ? 'done' : 'accepted'}
                            label={t.status === 'open' ? 'waiting on us' : t.status === 'answered' ? 'waiting on customer' : 'resolved'} /></td>
                  <td><button className="btn sm" onClick={() => setOpen(t)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && <TicketModal ticket={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  )
}

function TicketModal({ ticket, onClose, onChanged }: { ticket: api.TicketRow; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => api.ticketThread(ticket.id), [ticket.id])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [state, setState] = useState(ticket.status)
  useEffect(() => { setState(ticket.status) }, [ticket.status])
  const send = async (resolve: boolean) => {
    if (!body.trim()) { setErr('Write a reply first.'); return }
    setBusy(true); setErr(null)
    try { await api.replyTicket(ticket.id, body.trim(), resolve); setBody(''); setState(resolve ? 'resolved' : 'answered'); reload(); onChanged() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const resolveOnly = async () => {
    setBusy(true); setErr(null)
    try { await api.setTicketStatus(ticket.id, 'resolved'); setState('resolved'); onChanged() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={ticket.subject} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose() }}>
      <div className="modal wide">
        <h2>{ticket.subject}</h2>
        <p className="muted">{ticket.name} ({ticket.role}) · {ticket.email}{ticket.vin ? ` · booking ${ticket.vin}` : ''} · {state === 'resolved' ? 'resolved' : state === 'open' ? 'waiting on us' : 'waiting on customer'}</p>
        <ErrorBanner message={error ?? err} />
        <div className="thread">
          {data?.map((m) => (
            <div key={m.id} className={`msg ${m.from_staff ? 'staff' : ''}`}>
              <div className="muted">{m.author} · {when(m.created_at)}</div>
              <div className="body">{m.body}</div>
            </div>
          ))}
        </div>
        <label>Reply<textarea value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} disabled={busy}>Close</button>
          {state !== 'resolved' && <button className="btn" onClick={() => void resolveOnly()} disabled={busy}>Mark resolved</button>}
          <button className="btn" onClick={() => void send(true)} disabled={busy}>Reply and resolve</button>
          <button className="btn primary" onClick={() => void send(false)} disabled={busy}>{busy ? 'Sending…' : 'Reply'}</button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Settings ───────────────────────── */
const pct = (bp: number) => (bp / 100).toString()
export function SettingsPage({ canWrite }: PageProps) {
  const { data, error, loading, reload } = useLoad(api.getSettings, [])
  const [f, setF] = useState<Record<string, string>>({})
  const [docs, setDocs] = useState(false)
  const [confirm, setConfirm] = useState<api.Settings | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!data) return
    setF({
      travel_fee: String(data.travel_fee), platform_fee: String(data.platform_fee), resale: pct(data.resale_price_bp),
      payer: pct(data.payer_share_bp), platform: pct(data.platform_share_bp), min_payout: String(data.min_payout),
    })
    setDocs(data.require_documents)
  }, [data])
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { setF({ ...f, [k]: e.target.value }); setSaved(false) }

  const parse = (): api.Settings | null => {
    const int = (k: string) => Number(f[k])
    const bp = (k: string) => Math.round(Number(f[k]) * 100)
    for (const k of ['travel_fee', 'platform_fee', 'min_payout']) if (!Number.isInteger(int(k)) || int(k) < 0) { setFormError('Fees and the minimum payout must be whole rand, 0 or more.'); return null }
    for (const k of ['resale', 'payer', 'platform']) if (!Number.isFinite(Number(f[k])) || Number(f[k]) < 0 || Number(f[k]) > 100) { setFormError('Percentages must be between 0 and 100.'); return null }
    if (bp('payer') + bp('platform') > 10000) { setFormError('The payer and platform shares cannot add up to more than 100%.'); return null }
    setFormError(null)
    return { travel_fee: int('travel_fee'), platform_fee: int('platform_fee'), resale_price_bp: bp('resale'), payer_share_bp: bp('payer'),
             platform_share_bp: bp('platform'), min_payout: int('min_payout'), require_documents: docs }
  }
  const sample = (s: { resale_price_bp: number; payer_share_bp: number; platform_share_bp: number }) => {
    const fee = 500
    const rp = Math.round((fee * s.resale_price_bp) / 10000)
    const pc = Math.round((rp * s.payer_share_bp) / 10000)
    const plc = Math.round((rp * s.platform_share_bp) / 10000)
    return { rp, pc, plc, ic: rp - pc - plc }
  }
  const preview = f.resale !== undefined ? sample({ resale_price_bp: Math.round(Number(f.resale) * 100) || 0, payer_share_bp: Math.round(Number(f.payer) * 100) || 0, platform_share_bp: Math.round(Number(f.platform) * 100) || 0 }) : null
  const field = (k: string, label: string, hint: string, unit: string) => (
    <label className="field">
      <span>{label}</span>
      <span className="row"><input type="text" inputMode="decimal" value={f[k] ?? ''} onChange={set(k)} disabled={!canWrite} aria-describedby={`${k}-h`} /><span className="muted">{unit}</span></span>
      <span id={`${k}-h`} className="muted hint">{hint}</span>
    </label>
  )
  return (
    <>
      <Head title="Settings" onReload={reload} loading={loading}
        sub="Pricing and payout rules. A change applies to new bookings and new reports straight away. Existing bookings and reports keep the amounts they were created with." />
      <ErrorBanner message={error ?? formError} />
      {saved && <div className="banner ok" role="status">Saved.</div>}
      {data && (
        <div className="panel">
          <div className="formgrid">
            {field('travel_fee', 'Travel fee', 'Added to every booking, on top of the inspector\'s price.', 'rand')}
            {field('platform_fee', 'Platform fee', 'Added to every booking.', 'rand')}
            {field('resale', 'Report resale price', 'Share of the inspection price that a later buyer pays for the report.', '% of inspection price')}
            {field('payer', 'Share to the commissioning buyer', 'Of each resale price.', '% of resale price')}
            {field('platform', 'Share to the platform', 'Of each resale price. The inspector gets whatever is left.', '% of resale price')}
            {field('min_payout', 'Minimum withdrawal', 'The smallest amount a person can ask to be paid out.', 'rand')}
          </div>
          <label className="row" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={docs} disabled={!canWrite} onChange={(e) => { setDocs(e.target.checked); setSaved(false) }} />
            Require an approved ID and licence before an inspector can be approved
          </label>
          {preview && (
            <p className="muted" style={{ marginTop: 14 }}>
              Example, R500 inspection: the report resells for <strong>{money(preview.rp)}</strong>.
              Commissioning buyer {money(preview.pc)}, platform {money(preview.plc)}, inspector {money(preview.ic)}.
            </p>
          )}
          {canWrite
            ? <div className="row" style={{ marginTop: 14 }}><button className="btn primary" onClick={() => { const s = parse(); if (s) setConfirm(s) }}>Save changes</button></div>
            : <p className="muted" style={{ marginTop: 14 }}>Only admins can change settings.</p>}
        </div>
      )}
      {confirm && (
        <PromptModal title="Save these settings?" multiline label="Reason for the change" confirmLabel="Save"
          description="This is recorded in the audit log with the old and new values."
          onConfirm={async (reason) => { await api.updateSettings(confirm, reason); setSaved(true); reload() }} onClose={() => setConfirm(null)} />
      )}
    </>
  )
}
