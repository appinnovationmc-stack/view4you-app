import { useMemo, useState, type ReactNode } from 'react'
import * as api from './api'
import { can, type Area, type Role } from './access'
import { useCtx, type Ctx, type Lookups } from './context'
import { ConfirmModal, Empty, ErrorBanner, Modal, label, useLoad } from './ui'

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'bool' | 'vehicle' | 'driver' | 'unit' | 'property' | 'doc'
export interface FieldDef {
  key: string; label: string; type: FieldType; options?: [string, string][]; required?: boolean; hint?: string
  step?: string; docScope?: string; wide?: boolean; createOnly?: boolean
}
export interface ColumnDef { key: string; label: string; render?: (row: api.Row, lk: Lookups) => ReactNode; right?: boolean; csv?: (row: api.Row, lk: Lookups) => unknown }
export interface ResourceDef {
  table: string; view?: string; idKey?: string; singular: string; plural: string; area: Area
  columns: ColumnDef[]; fields: FieldDef[]; order: [string, boolean]; search: string[]
  filters?: { key: string; label: string; options: [string, string][] }[]
  defaults?: api.Row
  canCreate?: (role: Role) => boolean; canEdit?: (role: Role) => boolean; canDelete?: (role: Role) => boolean
  beforeSave?: (values: api.Row, ctx: Ctx, mode: 'create' | 'edit') => api.Row
  rowActions?: (row: api.Row, ctx: Ctx, reload: () => void) => ReactNode
  empty?: string
}

const toLocalInput = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
const fromLocalInput = (s: string) => (s ? new Date(s).toISOString() : null)

function optionsFor(f: FieldDef, lk: Lookups): [string, string][] {
  switch (f.type) {
    case 'vehicle': return lk.vehicles.map((v) => [v.id, `${v.reg_number}${v.make ? ' — ' + v.make + ' ' + (v.model ?? '') : ''}`.trim()])
    case 'driver': return lk.drivers.map((d) => [d.id, d.full_name])
    case 'unit': return lk.units.map((u) => [u.id, u.name])
    case 'property': return lk.properties.map((p) => [p.id, p.name])
    default: return f.options ?? []
  }
}

function DocLink({ path }: { path: string }) {
  const [err, setErr] = useState<string | null>(null)
  return <><button type="button" className="btn sm" onClick={() => api.openDocument(path).catch((e: Error) => setErr(e.message))}>Open</button>{err && <span className="neg"> {err}</span>}</>
}

export function FieldInput({ f, value, onChange, lk, ctx, recordId }: { f: FieldDef; value: any; onChange: (v: any) => void; lk: Lookups; ctx: Ctx; recordId: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const common = { id: 'f-' + f.key, required: f.required }
  switch (f.type) {
    case 'textarea': return <textarea {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'number': return <input {...common} type="number" step={f.step ?? 'any'} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    case 'date': return <input {...common} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
    case 'datetime': return <input {...common} type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} />
    case 'bool': return <input id={'f-' + f.key} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
    case 'doc': return (
      <div className="row">
        {value ? <><DocLink path={value} /><button type="button" className="btn sm" onClick={() => onChange(null)}>Remove</button></> : <span className="muted">No file</span>}
        <label className="btn sm filebtn">{busy ? 'Uploading…' : value ? 'Replace' : 'Upload PDF / photo'}
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => {
            const file = e.target.files?.[0]; if (!file) return
            setBusy(true); setErr(null)
            api.uploadDocument(ctx.tenantId, f.docScope ?? 'misc', recordId, file).then(onChange).catch((x: Error) => setErr(x.message)).finally(() => setBusy(false))
            e.target.value = ''
          }} />
        </label>
        {err && <span className="neg">{err}</span>}
      </div>
    )
    default: {
      if (f.type === 'text') return <input {...common} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      const opts = optionsFor(f, lk)
      return (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
          <option value="">{f.required ? 'Choose…' : '— none —'}</option>
          {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )
    }
  }
}

function FormModal({ def, ctx, row, fixed, onClose, onSaved }: { def: ResourceDef; ctx: Ctx; row: api.Row | null; fixed: api.Row; onClose: () => void; onSaved: () => void }) {
  const mode = row ? 'edit' : 'create'
  const recordId = useMemo(() => (row?.id as string) ?? crypto.randomUUID(), [row])
  const [values, setValues] = useState<api.Row>(() => ({ ...def.defaults, ...row, ...fixed }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fields = def.fields.filter((f) => !(mode === 'edit' && f.createOnly) && !(f.key in fixed))
  const save = async () => {
    setBusy(true); setError(null)
    try {
      const out: api.Row = {}
      for (const f of fields) { const v = values[f.key]; out[f.key] = v === '' || v === undefined ? null : v }
      let payload = { ...out }
      if (mode === 'create') payload = { id: recordId, tenant_id: ctx.tenantId, ...fixed, ...payload }
      if (def.beforeSave) payload = def.beforeSave(payload, ctx, mode)
      if (mode === 'create') await api.insert(def.table, payload); else await api.update(def.table, row!.id, payload)
      ctx.refreshLookups(); onSaved(); onClose()
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title={`${mode === 'create' ? 'Add' : 'Edit'} ${def.singular}`} onClose={() => !busy && onClose()} wide>
      <form onSubmit={(e) => { e.preventDefault(); void save() }} className="formgrid">
        {fields.map((f) => (
          <label key={f.key} className={`field ${f.wide || f.type === 'textarea' ? 'wide' : ''}`} htmlFor={'f-' + f.key}>
            <span>{f.label}{f.required ? ' *' : ''}</span>
            <FieldInput f={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} lk={ctx.lk} ctx={ctx} recordId={recordId} />
            {f.hint && <span className="hint muted">{f.hint}</span>}
          </label>
        ))}
        <div className="wide"><ErrorBanner message={error} /></div>
        <div className="row end wide">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}

/** A complete list + add / edit / delete screen for one table, driven by a ResourceDef. */
export function Resource({ def, fixed = {}, title, sub, actions }: { def: ResourceDef; fixed?: api.Row; title?: string; sub?: ReactNode; actions?: ReactNode }) {
  const ctx = useCtx()
  const { lk } = ctx
  const [editing, setEditing] = useState<api.Row | 'new' | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [openErr, setOpenErr] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<api.Row | null>(null)
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<[string, boolean]>(def.order)
  const idKey = def.idKey ?? 'id'
  const eq = { tenant_id: ctx.tenantId, ...fixed }
  const { data, error, loading, reload } = useLoad(() => api.list(def.view ?? def.table, { eq, order: def.order }), [def.table, def.view, ctx.tenantId, JSON.stringify(fixed)])

  const writeOk = can(ctx.role, def.area, true)
  const mayCreate = def.canCreate ? def.canCreate(ctx.role) : writeOk
  const mayEdit = def.canEdit ? def.canEdit(ctx.role) : writeOk
  const mayDelete = def.canDelete ? def.canDelete(ctx.role) : ctx.role === 'tenant_admin' || (writeOk && !['fleet_vehicles', 'fleet_drivers', 'fleet_properties'].includes(def.table))

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = data ?? []
    if (needle) out = out.filter((r) => def.search.some((k) => String(r[k] ?? '').toLowerCase().includes(needle) || String(lk.vehicle(r.vehicle_id)).toLowerCase().includes(needle)))
    for (const [k, v] of Object.entries(filters)) if (v) out = out.filter((r) => String(r[k]) === v)
    const [key, asc] = sort
    return [...out].sort((a, b) => {
      const x = a[key], y = b[key]
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1)
    })
  }, [data, q, filters, sort, def.search, lk])

  // A list backed by a reporting view does not carry every column of the record; edit the full row, never the view row.
  const openEdit = async (r: api.Row) => {
    if (!def.view) { setEditing(r); return }
    setOpening(r[idKey]); setOpenErr(null)
    try {
      const full = await api.list(def.table, { eq: { id: r[idKey] }, limit: 1 })
      if (full.length === 0) throw new Error('That record is no longer available.')
      setEditing(full[0])
    } catch (e) { setOpenErr((e as Error).message) } finally { setOpening(null) }
  }

  const csv = () => api.downloadCsv(`${def.plural.toLowerCase().replace(/\s+/g, '-')}.csv`, def.columns.map((c) => ({ key: c.key, label: c.label })),
    rows.map((r) => Object.fromEntries(def.columns.map((c) => [c.key, c.csv ? c.csv(r, lk) : r[c.key]]))))

  return (
    <>
      <div className="head">
        <div><h1>{title ?? def.plural}</h1>{sub && <p className="muted">{sub}</p>}</div>
        <div className="row">
          {actions}
          <button className="btn" onClick={csv} disabled={rows.length === 0}>Export CSV</button>
          <button className="btn" onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          {mayCreate && <button className="btn primary" onClick={() => setEditing('new')}>Add {def.singular.toLowerCase()}</button>}
        </div>
      </div>
      <div className="row filters">
        <input type="search" placeholder={`Search ${def.plural.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {def.filters?.map((f) => (
          <select key={f.key} value={filters[f.key] ?? ''} onChange={(e) => setFilters((s) => ({ ...s, [f.key]: e.target.value }))} aria-label={f.label}>
            <option value="">{f.label}: all</option>
            {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ))}
        <span className="muted">{rows.length} of {data?.length ?? 0}</span>
      </div>
      <ErrorBanner message={error ?? openErr} />
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {def.columns.map((c) => (
                <th key={c.key} className={c.right ? 'r' : ''}>
                  <button className="sortbtn" onClick={() => setSort(([k, a]) => [c.key, k === c.key ? !a : true])}>{c.label}{sort[0] === c.key ? (sort[1] ? ' ▲' : ' ▼') : ''}</button>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[idKey]}>
                {def.columns.map((c) => <td key={c.key} className={c.right ? 'r' : ''}>{c.render ? c.render(r, lk) : (r[c.key] ?? '—')}</td>)}
                <td className="r">
                  <div className="row end">
                    {def.rowActions?.(r, ctx, reload)}
                    {mayEdit && def.fields.length > 0 && <button className="btn sm" onClick={() => void openEdit(r)} disabled={opening === r[idKey]}>{opening === r[idKey] ? 'Opening…' : 'Edit'}</button>}
                    {mayDelete && <button className="btn sm danger" onClick={() => setDeleting(r)}>Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !loading && <Empty>{data?.length ? 'Nothing matches your search.' : def.empty ?? `No ${def.plural.toLowerCase()} yet.`}</Empty>}
      </div>
      {editing && <FormModal def={def} ctx={ctx} row={editing === 'new' ? null : editing} fixed={fixed} onClose={() => setEditing(null)} onSaved={reload} />}
      {deleting && (
        <ConfirmModal title={`Delete ${def.singular.toLowerCase()}`} danger confirmLabel="Delete"
          body={<>This permanently removes the record{deleting.reg_number ? ` ${deleting.reg_number}` : ''}. The change is kept in the audit log. {def.table === 'fleet_vehicles' ? 'To retire a vehicle and keep its history, set its status to Disposed instead.' : ''}</>}
          onConfirm={async () => { await api.remove(def.table, deleting[idKey]); ctx.refreshLookups(); reload() }} onClose={() => setDeleting(null)} />
      )}
    </>
  )
}

export const optionsOf = (values: string[]): [string, string][] => values.map((v) => [v, label(v)])
