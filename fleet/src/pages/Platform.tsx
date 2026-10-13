import { useState } from 'react'
import * as api from '../api'
import type { PlatformRole } from '../access'
import { ConfirmModal, Empty, ErrorBanner, Head, Modal, Pill, Tile, dateOnly, label, num, useLoad } from '../ui'

export default function Platform({ role }: { role: PlatformRole }) {
  const { data, error, reload, loading } = useLoad(() => api.rpc<{ tenants: api.Row[] }>('fleet_platform_overview'), [])
  const canManage = role === 'platform_admin'
  const [creating, setCreating] = useState(false)
  const [toggle, setToggle] = useState<api.Row | null>(null)
  const [invite, setInvite] = useState<api.Row | null>(null)
  const t = data?.tenants ?? []
  return (
    <>
      <Head title="Client organisations" sub={`CheckVertical ${role === 'platform_admin' ? 'platform administrator' : 'support (read only)'}. Counts only: client vehicles, properties and documents are never shown here.`}>
        <button className="btn" onClick={reload} disabled={loading}>Refresh</button>
        {canManage && <button className="btn primary" onClick={() => setCreating(true)}>Add organisation</button>}
      </Head>
      <ErrorBanner message={error} />
      <div className="cards">
        <Tile label="Organisations" value={num(t.length)} sub={`${t.filter((x) => x.kind === 'government').length} government · ${t.filter((x) => x.kind === 'company').length} company`} />
        <Tile label="Vehicles managed" value={num(t.reduce((s, x) => s + Number(x.vehicles), 0))} />
        <Tile label="Properties managed" value={num(t.reduce((s, x) => s + Number(x.properties), 0))} />
        <Tile label="Suspended" value={t.filter((x) => x.status === 'suspended').length} tone={t.some((x) => x.status === 'suspended') ? 'warn' : 'ok'} />
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Organisation</th><th>Type</th><th className="r">People</th><th className="r">Invites</th><th className="r">Units</th><th className="r">Vehicles</th><th className="r">Properties</th><th>Since</th><th>Status</th><th /></tr></thead>
          <tbody>
            {t.map((x) => (
              <tr key={x.id}>
                <td><strong>{x.name}</strong><div className="muted">{x.contact_email}</div></td><td>{label(x.kind)}</td>
                <td className="r">{x.members}</td><td className="r">{x.pending_invites}</td><td className="r">{x.units}</td><td className="r">{x.vehicles}</td><td className="r">{x.properties}</td>
                <td>{dateOnly(x.created_at)}</td><td><Pill value={x.status} /></td>
                <td className="r">{canManage && <div className="row end"><button className="btn sm" onClick={() => setInvite(x)}>Invite administrator</button><button className="btn sm" onClick={() => setToggle(x)}>{x.status === 'active' ? 'Suspend' : 'Reactivate'}</button></div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {t.length === 0 && !loading && <Empty>No organisations yet.</Empty>}
      </div>
      {creating && <OrgForm onClose={() => setCreating(false)} onDone={reload} />}
      {invite && <OrgForm tenant={invite} onClose={() => setInvite(null)} onDone={reload} />}
      {toggle && (
        <ConfirmModal title={`${toggle.status === 'active' ? 'Suspend' : 'Reactivate'} ${toggle.name}`} danger={toggle.status === 'active'} confirmLabel={toggle.status === 'active' ? 'Suspend' : 'Reactivate'}
          body={toggle.status === 'active' ? 'Nobody in this organisation will be able to open the portal until it is reactivated. No data is deleted.' : 'The organisation can sign in again.'}
          onConfirm={async () => { await api.rpc('fleet_platform_set_tenant_status', { p_tenant: toggle.id, p_status: toggle.status === 'active' ? 'suspended' : 'active' }); reload() }} onClose={() => setToggle(null)} />
      )}
    </>
  )
}

function OrgForm({ tenant, onClose, onDone }: { tenant?: api.Row; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', kind: 'government', email: '', admin: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      if (tenant) await api.rpc('fleet_invite_member', { p_tenant: tenant.id, p_email: f.email, p_role: 'tenant_admin', p_unit: null, p_name: f.admin || null })
      else await api.rpc('fleet_platform_create_tenant', { p_name: f.name, p_kind: f.kind, p_admin_email: f.email, p_admin_name: f.admin || null })
      onDone(); onClose()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title={tenant ? `Invite administrator for ${tenant.name}` : 'Add organisation'} onClose={() => !busy && onClose()}>
      <form className="formgrid" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        {!tenant && <label className="field wide"><span>Organisation name *</span><input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>}
        {!tenant && <label className="field wide"><span>Type *</span><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="government">Government / public entity</option><option value="company">Company</option></select></label>}
        <label className="field wide"><span>Administrator email *</span><input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field wide"><span>Administrator name</span><input value={f.admin} onChange={(e) => setF({ ...f, admin: e.target.value })} /></label>
        <div className="wide"><ErrorBanner message={err} /></div>
        <div className="row end wide"><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  )
}
