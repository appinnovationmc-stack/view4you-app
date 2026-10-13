import { useState } from 'react'
import * as api from '../api'
import { useCtx } from '../context'
import { ROLES, ROLE_LABEL, type Role } from '../access'
import { Resource, optionsOf, type ResourceDef } from '../resource'
import { Empty, ErrorBanner, Head, Pill, Tabs, useLoad } from '../ui'

const unitsDef: ResourceDef = {
  table: 'fleet_units', singular: 'Unit', plural: 'Units', area: 'people', order: ['name', true], search: ['name'],
  defaults: { kind: 'site' },
  columns: [{ key: 'name', label: 'Name', render: (r) => <strong>{r.name}</strong> }, { key: 'kind', label: 'Level', render: (r) => r.kind.replace('_', ' ') },
    { key: 'parent_id', label: 'Reports to', render: (_r, lk) => lk.unit(_r.parent_id), csv: (r, lk) => lk.unit(r.parent_id) }],
  fields: [{ key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'kind', label: 'Level', type: 'select', required: true, options: optionsOf(['head_office', 'province', 'region', 'district', 'department', 'depot', 'site']) },
    { key: 'parent_id', label: 'Reports to', type: 'unit', hint: 'Managers scoped to a unit see that unit and everything below it.' }],
}

function Members() {
  const ctx = useCtx()
  const isAdmin = ctx.role === 'tenant_admin'
  const members = useLoad(() => api.list('fleet_members', { eq: { tenant_id: ctx.tenantId }, order: ['full_name', true] }), [ctx.tenantId])
  const invites = useLoad(() => api.list('fleet_invites', { eq: { tenant_id: ctx.tenantId, accepted_at: null } }), [ctx.tenantId])
  const [f, setF] = useState({ email: '', name: '', role: 'fleet_manager' as Role, unit: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); members.reload(); invites.reload() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const setMember = (m: api.Row, patch: Partial<{ role: string; unit: string | null; status: string }>) =>
    run(() => api.rpc('fleet_set_member', { p_member: m.id, p_role: patch.role ?? m.role, p_unit: patch.unit === undefined ? m.unit_id : patch.unit, p_status: patch.status ?? m.status }))
  return (
    <>
      <ErrorBanner message={err ?? members.error} />
      {isAdmin && (
        <form className="panel formgrid" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.rpc('fleet_invite_member', { p_tenant: ctx.tenantId, p_email: f.email, p_role: f.role, p_unit: f.unit || null, p_name: f.name || null }); setF({ ...f, email: '', name: '' }) }) }}>
          <h2 className="wide">Invite a person</h2>
          <label className="field"><span>Email *</span><input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field"><span>Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field"><span>Role</span><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          <label className="field"><span>Limit to unit</span><select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="">Whole organisation</option>{ctx.lk.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <div className="row end wide"><button className="btn primary" disabled={busy}>Send invitation</button></div>
          <p className="muted wide">They sign in with this email address (create the account on the sign-in page) and access is granted automatically.</p>
        </form>
      )}
      <div className="tablewrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Unit</th><th>Status</th></tr></thead>
          <tbody>
            {(members.data ?? []).map((m) => (
              <tr key={m.id}>
                <td><strong>{m.full_name ?? '—'}</strong></td><td>{m.email}</td>
                <td>{isAdmin ? <select value={m.role} disabled={busy} onChange={(e) => void setMember(m, { role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select> : ROLE_LABEL[m.role as Role]}</td>
                <td>{isAdmin ? <select value={m.unit_id ?? ''} disabled={busy} onChange={(e) => void setMember(m, { unit: e.target.value || null })}><option value="">Whole organisation</option>{ctx.lk.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select> : ctx.lk.unit(m.unit_id)}</td>
                <td>{isAdmin ? <button className="btn sm" disabled={busy} onClick={() => void setMember(m, { status: m.status === 'active' ? 'suspended' : 'active' })}>{m.status === 'active' ? 'Suspend' : 'Reactivate'}</button> : <Pill value={m.status} />}{isAdmin && <> <Pill value={m.status} /></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(members.data ?? []).length === 0 && <Empty>No members visible.</Empty>}
      </div>
      {(invites.data ?? []).length > 0 && (
        <div className="panel"><h2>Pending invitations</h2>
          {(invites.data ?? []).map((i) => <div key={i.id} className="row"><span>{i.email} — {ROLE_LABEL[i.role as Role]}</span>{isAdmin && <button className="btn sm" disabled={busy} onClick={() => void run(() => api.rpc('fleet_revoke_invite', { p_invite: i.id }))}>Revoke</button>}</div>)}
        </div>
      )}
    </>
  )
}

export default function People() {
  const [tab, setTab] = useState<'members' | 'units'>('members')
  return (
    <>
      <Head title="People and units" sub="Roles decide what each person can see and change. Unit limits narrow it to part of the organisation." />
      <Tabs tabs={[{ id: 'members', label: 'People' }, { id: 'units', label: 'Organisation structure' }]} value={tab} onChange={setTab} />
      {tab === 'members' ? <Members /> : <Resource def={unitsDef} title="Organisation structure" sub="Head office → province / region → district → depot or site." />}
    </>
  )
}
