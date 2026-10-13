import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import * as api from '../api'
import { useCtx } from '../context'
import { Resource } from '../resource'
import { propertiesDef, propMaintDef, valuationsDef } from '../configs'
import { Empty, ErrorBanner, Head, Tabs, Tile, label, money, num, useLoad } from '../ui'
import { MapView } from './Tracking'

function Open({ id }: { id: string }) { const nav = useNavigate(); return <button className="btn sm" onClick={() => nav(`/properties/${id}`)}>Open</button> }

export function Properties() {
  const ctx = useCtx()
  const { data } = useLoad(() => api.list('fleet_v_property_value', { eq: { tenant_id: ctx.tenantId } }), [ctx.tenantId])
  const rows = data ?? []
  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)
  const m2 = rows.reduce((s, r) => s + Number(r.extent_m2 ?? 0), 0)
  return (
    <>
      <div className="cards">
        <Tile label="Properties" value={num(rows.length)} sub={`${num(m2 / 10000, 1)} ha in total`} />
        <Tile label="Market value" value={money(sum('market_value'))} sub="Latest valuations, in good condition" />
        <Tile label="Current value" value={money(sum('current_value'))} sub={`${money(sum('condition_discount'))} lost to condition`} tone={sum('condition_discount') > 0 ? 'warn' : undefined} />
        <Tile label="Maintenance backlog" value={money(sum('open_backlog_cost'))} sub={`${num(sum('open_backlog_items'))} open items`} tone={sum('open_backlog_cost') > 0 ? 'bad' : 'ok'} />
      </div>
      <Resource def={{ ...propertiesDef, rowActions: (r) => <Open id={r.property_id} /> }} title="Land and buildings" sub="Asset repository: extent, title deeds, location, layout plans and valuation." />
    </>
  )
}

export function PropertyDetail() {
  const { id = '' } = useParams()
  const ctx = useCtx()
  const [tab, setTab] = useState<'valuations' | 'backlog' | 'documents'>('valuations')
  const { data, error } = useLoad(() => api.list('fleet_properties', { eq: { id }, limit: 1 }), [id])
  const p = data?.[0]
  if (error) return <ErrorBanner message={error} />
  if (!data) return <Empty>Loading…</Empty>
  if (!p) return <Empty>Property not found. <Link to="/properties">Back to the register</Link></Empty>
  return (
    <>
      <Head title={p.name} sub={[label(p.kind), p.address, p.municipality, p.province].filter(Boolean).join(' · ')}>
        <Link className="btn" to="/properties">All properties</Link>
      </Head>
      <div className="cards">
        <Tile label="Title deed" value={p.title_deed_number ?? '—'} sub={p.asset_number ? `Asset ${p.asset_number}` : undefined} />
        <Tile label="Extent" value={p.extent_value != null ? `${num(p.extent_value, 2)} ${p.extent_unit === 'ha' ? 'ha' : 'm²'}` : '—'} />
        <Tile label="Condition" value={label(p.condition_rating)} sub={p.year_built ? `Built ${p.year_built}` : undefined} />
        <Tile label="Ownership" value={label(p.ownership)} sub={label(p.status)} />
      </div>
      {p.lat != null && p.lng != null && <div className="panel"><MapView height={260} points={[{ id: p.id, lat: Number(p.lat), lng: Number(p.lng), title: p.name, sub: p.address }]} /></div>}
      <Tabs tabs={[{ id: 'valuations', label: 'Valuation history' }, { id: 'backlog', label: 'Maintenance backlog' }, { id: 'documents', label: 'Documents' }]} value={tab} onChange={setTab} />
      {tab === 'valuations' && <Resource def={valuationsDef} fixed={{ property_id: id }} title="Market value vs current value" sub="Current value is the market value reduced for physical condition and maintenance backlog." />}
      {tab === 'backlog' && <Resource def={propMaintDef} fixed={{ property_id: id }} />}
      {tab === 'documents' && (
        <div className="panel">
          <h2>Documents</h2>
          <div className="row">
            {p.deed_document_path ? <DocBtn path={p.deed_document_path} text="Title deed" /> : <span className="muted">No title deed uploaded.</span>}
            {p.layout_plan_path ? <DocBtn path={p.layout_plan_path} text="Building layout plan" /> : <span className="muted">No layout plan uploaded.</span>}
          </div>
          <p className="muted" style={{ marginTop: 12 }}>{ctx.canWrite('property') ? 'Upload or replace documents by editing the property in the register.' : 'Read only.'}</p>
        </div>
      )}
    </>
  )
}
function DocBtn({ path, text }: { path: string; text: string }) {
  const [err, setErr] = useState<string | null>(null)
  return <><button className="btn" onClick={() => api.openDocument(path).catch((e: Error) => setErr(e.message))}>Open {text}</button>{err && <span className="neg">{err}</span>}</>
}
