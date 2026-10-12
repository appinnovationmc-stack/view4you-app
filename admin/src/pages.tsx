import { useState } from 'react'
import * as api from './api'
import { Empty, ErrorBanner, Pill, PromptModal, money, useLoad, when } from './ui'
import { DailyChart, Funnel } from './charts'
import { DocumentsModal, ReassignModal } from './pages2'

export type Page = 'overview' | 'inspectors' | 'bookings' | 'reports' | 'payments' | 'payouts' | 'support' | 'settings' | 'audit'
interface PageProps { canWrite: boolean; go: (p: Page, filter?: string) => void; initialFilter?: string }

const Head = ({ title, sub, onReload, loading }: { title: string; sub?: string; onReload: () => void; loading: boolean }) => (
  <div className="head">
    <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
    <button className="btn" onClick={onReload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </div>
)

/* ───────────────────────── Overview ───────────────────────── */
export function OverviewPage({ go }: PageProps) {
  const { data: o, error, loading, reload } = useLoad(api.overview, [])
  const stat = (label: string, value: string | number, opts?: { alert?: boolean; to?: Page; filter?: string }) => {
    const inner = <><div className="label">{label}</div><div className="value">{value}</div></>
    return (
      <div className={`card ${opts?.alert ? 'alert' : ''}`} key={label}>
        {opts?.to ? <button onClick={() => go(opts.to!, opts.filter)}>{inner}</button> : inner}
      </div>
    )
  }
  return (
    <>
      <Head title="Overview" sub="Live counts from the database." onReload={reload} loading={loading} />
      <ErrorBanner message={error} />
      {o && (
        <>
          <div className="cards">
            {stat('Inspectors awaiting approval', o.inspectors_pending_approval, { alert: o.inspectors_pending_approval > 0, to: 'inspectors', filter: 'pending' })}
            {stat('Refunds due', o.refunds_due, { alert: o.refunds_due > 0, to: 'payments' })}
            {stat('Refund amount owed', money(o.refunds_due_amount), { alert: o.refunds_due > 0, to: 'payments' })}
            {stat('Payment problems (7 days)', o.payment_problems_7d, { alert: o.payment_problems_7d > 0, to: 'payments' })}
            {stat('Bookings awaiting payment', o.bookings_awaiting_payment, { to: 'bookings', filter: 'unpaid' })}
            {stat('Withdrawals to pay', o.withdrawals_requested, { alert: o.withdrawals_requested > 0, to: 'payouts' })}
            {stat('Amount to pay out', money(o.withdrawals_requested_amount), { alert: o.withdrawals_requested > 0, to: 'payouts' })}
            {stat('Documents to review', o.documents_pending, { alert: o.documents_pending > 0, to: 'inspectors' })}
            {stat('Tickets waiting on us', o.tickets_open, { alert: o.tickets_open > 0, to: 'support' })}
          </div>
          <div className="cards">
            {stat('Approved inspectors', o.inspectors_approved)}
            {stat('Inspectors online', o.inspectors_online)}
            {stat('Buyers', o.buyers)}
            {stat('Reports', o.reports)}
            {stat('Reports taken down', o.reports_taken_down, { to: 'reports' })}
            {stat('Paid bookings (total)', money(o.paid_bookings_amount))}
          </div>
          <div className="panel">
            <h2>Bookings by status</h2>
            {Object.keys(o.bookings_by_status).length === 0
              ? <p className="muted">No bookings yet.</p>
              : <div className="row">{Object.entries(o.bookings_by_status).map(([s, n]) =>
                  <span key={s}><Pill value={s} /> <strong>{n}</strong></span>)}</div>}
          </div>
        </>
      )}
      <AnalyticsSection />
    </>
  )
}

function AnalyticsSection() {
  const [days, setDays] = useState(30)
  const { data: a, error, loading } = useLoad(() => api.analytics(days), [days])
  const day = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
  const count = (n: number) => Math.round(n).toLocaleString('en-ZA')
  return (
    <>
      <div className="head" style={{ marginTop: 8 }}>
        <div><h2 style={{ marginBottom: 2 }}>Trends</h2><p className="muted">Revenue is what buyers paid, not company profit.</p></div>
        <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
      </div>
      <ErrorBanner message={error} />
      {loading && !a && <p className="muted">Loading…</p>}
      {a && (
        <>
          <div className="charts">
            <div className="panel"><DailyChart title="Bookings per day" kind="bar" format={count} points={a.series.map((d) => ({ label: day(d.day), value: d.bookings }))} /></div>
            <div className="panel"><DailyChart title="Booking revenue per day" kind="line" format={money} points={a.series.map((d) => ({ label: day(d.day), value: d.booking_revenue }))} /></div>
            <div className="panel"><DailyChart title="Reports sold per day" kind="bar" series={2} format={count} points={a.series.map((d) => ({ label: day(d.day), value: d.report_sales }))} /></div>
            <div className="panel"><DailyChart title="Report revenue per day" kind="line" series={2} format={money} points={a.series.map((d) => ({ label: day(d.day), value: d.report_revenue }))} /></div>
          </div>
          <div className="charts">
            <div className="panel">
              <h2>Booking funnel</h2>
              <Funnel steps={[{ label: 'Created', value: a.funnel.created }, { label: 'Paid', value: a.funnel.paid },
                              { label: 'Accepted', value: a.funnel.accepted }, { label: 'Completed', value: a.funnel.completed }]} />
              <p className="muted" style={{ marginTop: 8 }}>{a.funnel.cancelled} cancelled in this period.</p>
            </div>
            <div className="panel">
              <h2>Inspectors and buyers</h2>
              <p>{a.inspectors.worked_in_period} of {a.inspectors.approved} approved inspectors finished a job; {a.inspectors.online_now} online now.</p>
              <p style={{ marginTop: 6 }}>{a.repeat_buyers.repeat} of {a.repeat_buyers.buyers} buyers who have paid have booked more than once (all time).</p>
              <h2 style={{ marginTop: 14 }}>Top inspectors</h2>
              {a.top_inspectors.length === 0 ? <p className="muted">No finished jobs in this period.</p>
                : <ol className="plain">{a.top_inspectors.map((t) => <li key={t.name}><strong>{t.name}</strong> · {t.jobs} {t.jobs === 1 ? 'job' : 'jobs'} · rating {Number(t.rating).toFixed(2)}</li>)}</ol>}
            </div>
          </div>
        </>
      )}
    </>
  )
}

/* ───────────────────────── Inspectors ───────────────────────── */
export function InspectorsPage({ canWrite, initialFilter }: PageProps) {
  const [status, setStatus] = useState<'all' | 'pending' | 'approved'>(initialFilter === 'pending' ? 'pending' : 'all')
  const { data, error, loading, reload } = useLoad(() => api.listInspectors(status), [status])
  const [suspend, setSuspend] = useState<api.InspectorRow | null>(null)
  const [docsFor, setDocsFor] = useState<api.InspectorRow | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const approve = async (r: api.InspectorRow) => {
    setActionError(null)
    try { await api.setInspectorApproval(r.id, true); reload() } catch (e) { setActionError((e as Error).message) }
  }
  return (
    <>
      <Head title="Inspectors" sub="New inspectors cannot go online or receive jobs until approved. Check their documents before approving." onReload={reload} loading={loading} />
      <div className="row" style={{ marginBottom: 12 }}>
        <label className="row">Show <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">All</option><option value="pending">Awaiting approval</option><option value="approved">Approved</option>
        </select></label>
      </div>
      <ErrorBanner message={error ?? actionError} />
      <div className="tablewrap">
        {data && data.length === 0 ? <Empty>No inspectors match.</Empty> : (
          <table>
            <thead><tr><th>Name</th><th>Contact</th><th>Certification</th><th>Region</th><th>Jobs</th><th>Rating</th><th>Price</th><th>Status</th><th>Documents</th><th>Joined</th><th></th></tr></thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td>{r.email}<br /><span className="muted">{r.phone ?? 'no phone'}</span></td>
                  <td>{r.cert ?? '—'}<br /><span className="muted">{r.licence ?? 'no licence no.'}</span></td>
                  <td>{r.region ?? '—'}</td>
                  <td>{r.jobs_completed}</td>
                  <td>{Number(r.rating).toFixed(2)}</td>
                  <td>{money(r.price)}</td>
                  <td>{r.approved ? <Pill value="approved" /> : <Pill value="pending" label="awaiting approval" />}{r.online && <> <Pill value="applied" label="online" /></>}</td>
                  <td>
                    <button className="btn sm" onClick={() => setDocsFor(r)}>View</button>
                    <div className="muted">{Number(r.docs_approved)} approved · {Number(r.docs_pending)} to review{Number(r.docs_rejected) > 0 ? ` · ${Number(r.docs_rejected)} rejected` : ''}</div>
                  </td>
                  <td>{when(r.created_at)}</td>
                  <td>
                    {canWrite && (r.approved
                      ? <button className="btn sm danger" onClick={() => setSuspend(r)}>Suspend</button>
                      : <button className="btn sm primary" onClick={() => void approve(r)}>Approve</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {docsFor && <DocumentsModal inspector={docsFor} canWrite={canWrite} onClose={() => setDocsFor(null)} onChanged={reload} />}
      {suspend && (
        <PromptModal title={`Suspend ${suspend.name}?`} danger multiline label="Reason" confirmLabel="Suspend"
          description="They go offline immediately and cannot receive new jobs. Jobs already accepted are not cancelled."
          onConfirm={async (reason) => { await api.setInspectorApproval(suspend.id, false, reason); reload() }}
          onClose={() => setSuspend(null)} />
      )}
    </>
  )
}

/* ───────────────────────── Bookings ───────────────────────── */
const STATUSES = ['pending', 'accepted', 'en_route', 'in_progress', 'done', 'cancelled']
const PAYMENTS = ['unpaid', 'paid', 'legacy_unverified', 'refund_due', 'refunded']
export function BookingsPage({ canWrite, initialFilter }: PageProps) {
  const [status, setStatus] = useState('')
  const [payment, setPayment] = useState(initialFilter && PAYMENTS.includes(initialFilter) ? initialFilter : '')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const { data, error, loading, reload } = useLoad(() => api.listBookings({ status, payment, search: q }), [status, payment, q])
  const [cancel, setCancel] = useState<api.BookingRow | null>(null)
  const [reassign, setReassign] = useState<api.BookingRow | null>(null)
  return (
    <>
      <Head title="Bookings" onReload={reload} loading={loading} sub="Newest first. Showing up to 200." />
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setQ(search) }}>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select aria-label="Payment" value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="">Any payment</option>{PAYMENTS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <input type="search" placeholder="VIN, buyer email or inspector" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn" type="submit">Search</button>
      </form>
      <ErrorBanner message={error} />
      <div className="tablewrap">
        {data && data.length === 0 ? <Empty>No bookings match.</Empty> : (
          <table>
            <thead><tr><th>Created</th><th>Vehicle (VIN)</th><th>Buyer</th><th>Inspector</th><th>Location</th><th>Amount</th><th>Status</th><th>Payment</th><th></th></tr></thead>
            <tbody>
              {data?.map((b) => (
                <tr key={b.id}>
                  <td>{when(b.created_at)}</td>
                  <td>{b.vin}</td>
                  <td>{b.buyer_name ?? '—'}<br /><span className="muted">{b.buyer_email}</span></td>
                  <td>{b.inspector_name ?? '—'}</td>
                  <td className="wrap">{b.location}</td>
                  <td>{money(b.amount_due)}</td>
                  <td><Pill value={b.status} /></td>
                  <td><Pill value={b.payment_status} /></td>
                  <td>{canWrite && b.status !== 'done' && b.status !== 'cancelled' && <div className="row">
                    {(b.payment_status === 'paid' || b.payment_status === 'legacy_unverified') &&
                      <button className="btn sm" onClick={() => setReassign(b)}>Reassign</button>}
                    <button className="btn sm danger" onClick={() => setCancel(b)}>Cancel</button></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {reassign && <ReassignModal booking={reassign} onClose={() => setReassign(null)} onDone={reload} />}
      {cancel && (
        <PromptModal title={`Cancel booking for ${cancel.vin}?`} danger multiline label="Reason" confirmLabel="Cancel booking"
          description={cancel.payment_status === 'paid' || cancel.payment_status === 'legacy_unverified'
            ? 'The buyer has paid. The booking moves to the refund queue and the buyer is notified. You still have to refund them in PayFast.'
            : 'The buyer is notified.'}
          onConfirm={async (reason) => { await api.cancelBooking(cancel.id, reason); reload() }}
          onClose={() => setCancel(null)} />
      )}
    </>
  )
}

/* ───────────────────────── Refunds & payments ───────────────────────── */
export function PaymentsPage({ canWrite }: PageProps) {
  const refunds = useLoad(() => api.listBookings({ payment: 'refund_due' }), [])
  const [onlyProblems, setOnlyProblems] = useState(true)
  const events = useLoad(() => api.listPaymentEvents(onlyProblems), [onlyProblems])
  const [refund, setRefund] = useState<api.BookingRow | null>(null)
  const reload = () => { refunds.reload(); events.reload() }
  return (
    <>
      <Head title="Refunds & payments" onReload={reload} loading={refunds.loading || events.loading}
        sub="Refunds are paid from your PayFast dashboard. Record each one here with the PayFast reference so the queue stays accurate." />
      <h2>Refunds due</h2>
      <ErrorBanner message={refunds.error} />
      <div className="tablewrap" style={{ marginBottom: 24 }}>
        {refunds.data && refunds.data.length === 0 ? <Empty>Nothing to refund.</Empty> : (
          <table>
            <thead><tr><th>Booked</th><th>Buyer</th><th>VIN</th><th>Amount</th><th>Booking</th><th></th></tr></thead>
            <tbody>
              {refunds.data?.map((b) => (
                <tr key={b.id}>
                  <td>{when(b.created_at)}</td>
                  <td>{b.buyer_name ?? '—'}<br /><span className="muted">{b.buyer_email}</span></td>
                  <td>{b.vin}</td>
                  <td><strong>{money(b.amount_due)}</strong></td>
                  <td><Pill value={b.status} /></td>
                  <td>{canWrite && <button className="btn sm primary" onClick={() => setRefund(b)}>Record refund</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>PayFast notifications</h2>
        <label className="row"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Problems only</label>
      </div>
      <ErrorBanner message={events.error} />
      <div className="tablewrap">
        {events.data && events.data.length === 0 ? <Empty>{onlyProblems ? 'No problems recorded.' : 'No notifications yet.'}</Empty> : (
          <table>
            <thead><tr><th>Received</th><th>Type</th><th>Order</th><th>PayFast payment</th><th>Status</th><th>Amount</th><th>Outcome</th></tr></thead>
            <tbody>
              {events.data?.map((e) => (
                <tr key={e.id}>
                  <td>{when(e.created_at)}</td><td>{e.kind}</td>
                  <td>{e.order_id ? e.order_id.slice(0, 8) : '—'}</td><td>{e.pf_payment_id ?? '—'}</td>
                  <td>{e.payment_status ?? '—'}</td><td>{money(e.amount_gross)}</td><td><Pill value={e.outcome} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {refund && (
        <PromptModal title={`Record refund of ${money(refund.amount_due)}`} label="PayFast refund reference" confirmLabel="Record refund"
          description="Only do this after the refund has been made in PayFast. This cannot be undone."
          onConfirm={async (ref) => { await api.markRefunded(refund.id, ref); reload() }} onClose={() => setRefund(null)} />
      )}
    </>
  )
}

/* ───────────────────────── Audit log ───────────────────────── */
export function AuditPage() {
  const { data, error, loading, reload } = useLoad(api.listAudit, [])
  return (
    <>
      <Head title="Audit log" sub="Every change made from this console. It cannot be edited." onReload={reload} loading={loading} />
      <ErrorBanner message={error} />
      <div className="tablewrap">
        {data && data.length === 0 ? <Empty>No admin actions yet.</Empty> : (
          <table>
            <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
            <tbody>
              {data?.map((a) => (
                <tr key={a.id}>
                  <td>{when(a.created_at)}</td><td>{a.admin_email ?? '—'}</td>
                  <td>{a.action.replace(/_/g, ' ')}</td>
                  <td>{a.target_type}<br /><span className="muted">{a.target_id?.slice(0, 8)}</span></td>
                  <td className="wrap">{Object.entries(a.detail).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
