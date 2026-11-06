import { useEffect, useState } from 'react'
import * as api from './api'
import { Empty, ErrorBanner, Pill, PromptModal, Tabs, money, useLoad, when } from './ui'

interface PageProps { canWrite: boolean }

const Head = ({ title, sub, onReload, loading }: { title: string; sub?: string; onReload: () => void; loading: boolean }) => (
  <div className="head">
    <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
    <button className="btn" onClick={onReload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </div>
)

/* ───────────────────────── Testing stations ───────────────────────── */
const blank: api.StationInput = {
  id: null, name: '', address: '', city: '', province: '', phone: '', grade: 'A', registration: '', hours: '', fee: 0, classes: '', lat: null, lng: null,
}

function StationModal({ initial, onClose, onSaved }: { initial: api.StationInput; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>({
    name: initial.name, address: initial.address, city: initial.city, province: initial.province, phone: initial.phone, grade: initial.grade,
    registration: initial.registration, hours: initial.hours, fee: String(initial.fee), classes: initial.classes,
    lat: initial.lat == null ? '' : String(initial.lat), lng: initial.lng == null ? '' : String(initial.lng),
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const save = async () => {
    const fee = Number(f.fee)
    if (!Number.isInteger(fee) || fee < 0 || fee > 5000) { setErr('Test fee must be whole rand between 0 and 5000.'); return }
    const lat = num(f.lat), lng = num(f.lng)
    if ((lat != null && !Number.isFinite(lat)) || (lng != null && !Number.isFinite(lng))) { setErr('Latitude and longitude must be numbers.'); return }
    setBusy(true); setErr(null)
    try {
      await api.saveStation({ id: initial.id, name: f.name, address: f.address, city: f.city, province: f.province, phone: f.phone, grade: f.grade,
        registration: f.registration, hours: f.hours, fee, classes: f.classes, lat, lng })
      onSaved(); onClose()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  const text = (k: string, label: string, hint?: string) => (
    <label className="field"><span>{label}</span><input type="text" value={f[k]} onChange={set(k)} />{hint && <span className="muted hint">{hint}</span>}</label>
  )
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Testing station" onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose() }}>
      <div className="modal wide">
        <h2>{initial.id ? 'Edit testing station' : 'Add testing station'}</h2>
        <p className="muted">Only list stations that are registered with their provincial licensing authority. Check the registration number before you add one.</p>
        <div className="formgrid">
          {text('name', 'Name')}
          {text('registration', 'Registration number')}
          <label className="field"><span>Grade</span>
            <select value={f.grade} onChange={set('grade')}><option value="A">Grade A</option><option value="B">Grade B</option><option value="C">Grade C</option></select>
          </label>
          {text('address', 'Address')}
          {text('city', 'City')}
          {text('province', 'Province')}
          {text('phone', 'Phone')}
          {text('hours', 'Opening hours')}
          {text('classes', 'Vehicle classes', 'e.g. light vehicles, heavy vehicles, motorcycles')}
          {text('fee', 'Test fee (rand)', 'What the station charges. Paid at the station.')}
          {text('lat', 'Latitude (optional)')}
          {text('lng', 'Longitude (optional)')}
        </div>
        <ErrorBanner message={err} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save station'}</button>
        </div>
      </div>
    </div>
  )
}

function AddonFee({ canWrite }: PageProps) {
  const { data, error, reload } = useLoad(api.getAddonSettings, [])
  const [fee, setFee] = useState('')
  const [confirm, setConfirm] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { if (data) setFee(String(data.roadworthy_addon_fee)) }, [data])
  const go = () => {
    const n = Number(fee)
    if (!Number.isInteger(n) || n < 0 || n > 5000) { setMsg('Enter whole rand between 0 and 5000.'); return }
    setMsg(null); setConfirm(n)
  }
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h2>CheckVertical add-on fee</h2>
      <p className="muted">Charged once on a booking when the buyer adds the official roadworthy test. 0 means free. It is separate from the station's own test fee, which the buyer pays at the station.</p>
      <ErrorBanner message={error ?? msg} />
      <div className="row">
        <input type="text" inputMode="numeric" value={fee} disabled={!canWrite} onChange={(e) => setFee(e.target.value)} aria-label="Add-on fee in rand" style={{ maxWidth: 140 }} />
        <span className="muted">rand</span>
        {canWrite && <button className="btn primary" onClick={go}>Save fee</button>}
      </div>
      {confirm != null && (
        <PromptModal title={`Set the add-on fee to ${money(confirm)}?`} multiline label="Reason for the change" confirmLabel="Save"
          description="Applies to new bookings only. Recorded in the audit log."
          onConfirm={async (reason) => { await api.setRoadworthyFee(confirm, reason); reload() }} onClose={() => setConfirm(null)} />
      )}
    </div>
  )
}

export function StationsPage({ canWrite }: PageProps) {
  const { data, error, loading, reload } = useLoad(api.listStations, [])
  const [edit, setEdit] = useState<api.StationInput | null>(null)
  const [toggle, setToggle] = useState<api.StationRow | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const activate = async (s: api.StationRow) => {
    setErr(null)
    try { await api.setStationActive(s.id, true); reload() } catch (e) { setErr((e as Error).message) }
  }
  const toInput = (s: api.StationRow): api.StationInput => ({
    id: s.id, name: s.name, address: s.address, city: s.city ?? '', province: s.province ?? '', phone: s.phone ?? '', grade: s.grade,
    registration: s.registration_number, hours: s.hours ?? '', fee: s.test_fee, classes: s.vehicle_classes ?? '',
    lat: s.lat == null ? null : Number(s.lat), lng: s.lng == null ? null : Number(s.lng),
  })
  return (
    <>
      <Head title="Testing stations" onReload={reload} loading={loading}
        sub="Registered roadworthy testing stations buyers can pick when they add an official test. The station issues the certificate, not CheckVertical." />
      <ErrorBanner message={error ?? err} />
      <AddonFee canWrite={canWrite} />
      {canWrite && <div className="row" style={{ marginBottom: 12 }}><button className="btn primary" onClick={() => setEdit(blank)}>Add station</button></div>}
      {data && data.length === 0 && <Empty>No testing stations yet. Add the first one so buyers can choose it.</Empty>}
      {data && data.length > 0 && (
        <div className="panel"><table>
          <thead><tr><th>Station</th><th>Registration</th><th>Grade</th><th>Location</th><th>Test fee</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong><div className="muted">{s.address}{s.phone ? ` · ${s.phone}` : ''}</div></td>
                <td>{s.registration_number}</td>
                <td>{s.grade}</td>
                <td>{[s.city, s.province].filter(Boolean).join(', ') || '—'}</td>
                <td>{money(s.test_fee)}</td>
                <td><Pill value={s.active ? 'approved' : 'suspended'} label={s.active ? 'listed' : 'hidden'} /></td>
                <td><div className="row">
                  {canWrite && <button className="btn sm" onClick={() => setEdit(toInput(s))}>Edit</button>}
                  {canWrite && (s.active
                    ? <button className="btn sm danger" onClick={() => setToggle(s)}>Hide</button>
                    : <button className="btn sm primary" onClick={() => void activate(s)}>List</button>)}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {edit && <StationModal initial={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      {toggle && (
        <PromptModal title={`Hide ${toggle.name}?`} multiline label="Reason" confirmLabel="Hide" danger
          description="Buyers will no longer see this station. Existing bookings keep it."
          onConfirm={async (reason) => { await api.setStationActive(toggle.id, false, reason); reload() }} onClose={() => setToggle(null)} />
      )}
    </>
  )
}

/* ───────────────────────── Certificates ───────────────────────── */
export function CertificatesPage({ canWrite }: PageProps) {
  const [status, setStatus] = useState('submitted')
  const { data, error, loading, reload } = useLoad(() => api.listCertificates(status), [status])
  const [reject, setReject] = useState<api.CertRow | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const open = async (c: api.CertRow) => {
    setErr(null)
    try { window.open(await api.certificateUrl(c.storage_path), '_blank', 'noopener,noreferrer') } catch (e) { setErr((e as Error).message) }
  }
  const verify = async (c: api.CertRow) => {
    setErr(null)
    try { await api.reviewCertificate(c.id, true); reload() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <>
      <Head title="Certificates" onReload={reload} loading={loading}
        sub="Official roadworthy certificates uploaded by buyers and inspectors. Open the file, check the number, station, vehicle and dates, then verify or reject. Only verified certificates show as checked on the report." />
      <div className="row" style={{ marginBottom: 12 }}>
        <Tabs label="Status filter" value={status} onChange={setStatus} options={[{ value: 'submitted', label: 'To review' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }]} />
      </div>
      <ErrorBanner message={error ?? err} />
      {data && data.length === 0 && <Empty>Nothing here.</Empty>}
      {data && data.length > 0 && (
        <div className="panel"><table>
          <thead><tr><th>Vehicle</th><th>Station</th><th>Certificate</th><th>Result</th><th>Dates</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <td>{c.vin}<div className="muted">uploaded {when(c.created_at)}</div></td>
                <td>{c.station_name ?? '—'}</td>
                <td>{c.certificate_number}</td>
                <td>{c.result}</td>
                <td>Issued {c.issued_on}{c.expires_on ? <div className="muted">valid to {c.expires_on}</div> : null}</td>
                <td><Pill value={c.status === 'submitted' ? 'pending' : c.status === 'verified' ? 'approved' : 'rejected'} label={c.status} /></td>
                <td><div className="row">
                  <button className="btn sm" onClick={() => void open(c)}>Open file</button>
                  {canWrite && c.status !== 'verified' && <button className="btn sm primary" onClick={() => void verify(c)}>Verify</button>}
                  {canWrite && c.status !== 'rejected' && <button className="btn sm danger" onClick={() => setReject(c)}>Reject</button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {reject && (
        <PromptModal title={`Reject certificate ${reject.certificate_number}?`} multiline label="Reason (shown to the uploader)" confirmLabel="Reject" danger
          onConfirm={async (reason) => { await api.reviewCertificate(reject.id, false, reason); reload() }} onClose={() => setReject(null)} />
      )}
    </>
  )
}

/* ───────────────────────── Workshops ───────────────────────── */
export function WorkshopsPage({ canWrite }: PageProps) {
  const [status, setStatus] = useState<'all' | 'pending' | 'approved'>('all')
  const { data, error, loading, reload } = useLoad(() => api.listWorkshops(status), [status])
  const [suspend, setSuspend] = useState<api.WorkshopRow | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const approve = async (r: api.WorkshopRow) => {
    setActionError(null)
    try { await api.setWorkshopApproval(r.id, true); reload() } catch (e) { setActionError((e as Error).message) }
  }
  return (
    <>
      <Head title="Workshops" sub="Partner workshops quote on repairs found in reports. Only approved workshops see requests. Check their business before approving." onReload={reload} loading={loading} />
      <div className="row" style={{ marginBottom: 12 }}>
        <Tabs label="Show" value={status} onChange={(v) => setStatus(v as typeof status)} options={[{ value: 'all', label: 'All' }, { value: 'pending', label: 'Awaiting approval' }, { value: 'approved', label: 'Approved' }]} />
      </div>
      <ErrorBanner message={error ?? actionError} />
      <div className="tablewrap">
        {data && data.length === 0 ? <Empty>No workshops match.</Empty> : (
          <table>
            <thead><tr><th>Business</th><th>Contact</th><th>Area</th><th>Services</th><th>Quotes</th><th>Status</th><th>Joined</th><th></th></tr></thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.business_name ?? r.name}</strong><br /><span className="muted">{r.address ?? 'no address yet'}</span></td>
                  <td>{r.email}<br /><span className="muted">{r.phone ?? 'no phone'}</span></td>
                  <td>{r.area ?? '—'}</td>
                  <td>{r.services ?? '—'}<br /><span className="muted">{r.brands ?? ''}</span></td>
                  <td>{Number(r.quotes_sent)} sent · {Number(r.quotes_accepted)} accepted</td>
                  <td>{r.approved ? <Pill value="approved" /> : <Pill value="pending" label="awaiting approval" />}</td>
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
      {suspend && (
        <PromptModal title={`Suspend ${suspend.business_name ?? suspend.name}?`} danger multiline label="Reason" confirmLabel="Suspend"
          description="They can no longer see requests or send quotes. Quotes already accepted are not cancelled."
          onConfirm={async (reason) => { await api.setWorkshopApproval(suspend.id, false, reason); reload() }}
          onClose={() => setSuspend(null)} />
      )}
    </>
  )
}

/* ───────────────────── Repair payouts to workshops ───────────────────── */
export function RepairPayoutsPage({ canWrite }: PageProps) {
  const [status, setStatus] = useState<'due' | 'sent' | 'all'>('due')
  const { data, error, loading, reload } = useLoad(() => api.listRepairPayouts(status), [status])
  const [pay, setPay] = useState<api.RepairPayoutRow | null>(null)
  const owed = (data ?? []).filter((r) => !r.payout_sent_at).reduce((a, r) => a + Number(r.workshop_payout ?? 0), 0)
  return (
    <>
      <Head title="Repair payouts" sub="Buyers pay CheckVertical for accepted repair quotes. Pay the workshop its share (total minus our referral fee) by EFT, then record the reference here." onReload={reload} loading={loading} />
      <div className="row" style={{ marginBottom: 12 }}>
        <Tabs label="Show" value={status} onChange={(v) => setStatus(v as typeof status)} options={[{ value: 'due', label: 'To pay out' }, { value: 'sent', label: 'Paid out' }, { value: 'all', label: 'All' }]} />
        {status !== 'sent' && <span className="muted">Owed to workshops: <strong>{money(owed)}</strong></span>}
      </div>
      <ErrorBanner message={error} />
      <div className="tablewrap">
        {data && data.length === 0 ? <Empty>Nothing here.</Empty> : (
          <table>
            <thead><tr><th>Vehicle</th><th>Workshop</th><th>Buyer paid</th><th>Our fee</th><th>Pay workshop</th><th>Paid on</th><th>Payout</th></tr></thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.quote_id}>
                  <td>{r.vehicle_label}</td>
                  <td>{r.workshop_name}<br /><span className="muted">{r.workshop_email}</span></td>
                  <td>{money(r.total)}</td>
                  <td>{money(r.referral_fee)}</td>
                  <td><strong>{money(r.workshop_payout)}</strong></td>
                  <td>{when(r.paid_at)}</td>
                  <td>{r.payout_sent_at
                    ? <span className="muted">Sent {when(r.payout_sent_at)}<br />{r.payout_ref}</span>
                    : canWrite ? <button className="btn sm primary" onClick={() => setPay(r)}>Mark paid out</button> : <Pill value="pending" label="to pay" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pay && (
        <PromptModal title={`Record payout to ${pay.workshop_name}`} label="Payment reference" confirmLabel="Mark as paid out"
          description={`You have paid ${money(pay.workshop_payout)}. The workshop is notified.`}
          onConfirm={async (ref) => { await api.markRepairPayoutSent(pay.quote_id, ref); reload() }}
          onClose={() => setPay(null)} />
      )}
    </>
  )
}
