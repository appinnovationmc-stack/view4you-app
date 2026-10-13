import { useState, type ReactNode } from 'react'
import * as api from '../api'
import { useCtx } from '../context'
import { Empty, ErrorBanner, Head, Pill, Tabs, dateOnly, label, money, num, useLoad } from '../ui'

interface Col { key: string; label: string; render?: (r: api.Row) => ReactNode; right?: boolean; csv?: (r: api.Row) => unknown }
interface Def { id: string; title: string; source: string; order: [string, boolean]; cols: Col[]; filter?: (r: api.Row) => boolean; sub: string }

const DEFS: Def[] = [
  { id: 'compliance', title: 'Compliance', source: 'fleet_v_compliance', order: ['expires_on', true], sub: 'Every licence and certificate, soonest expiry first.',
    cols: [{ key: 'subject', label: 'Vehicle / driver' }, { key: 'kind', label: 'Document', render: (r) => label(r.kind) }, { key: 'reference', label: 'Reference' },
      { key: 'expires_on', label: 'Expires', render: (r) => dateOnly(r.expires_on) }, { key: 'days_left', label: 'Days left', right: true },
      { key: 'state', label: 'State', render: (r) => <Pill value={r.state} /> }] },
  { id: 'maintenance', title: 'Maintenance due', source: 'fleet_v_maintenance_due', order: ['days_left', true], sub: 'Service plans by date and kilometres.', filter: (r) => r.state !== 'ok',
    cols: [{ key: 'reg_number', label: 'Vehicle' }, { key: 'task', label: 'Task' }, { key: 'next_due_date', label: 'Next due', render: (r) => dateOnly(r.next_due_date) },
      { key: 'days_left', label: 'Days left', right: true }, { key: 'km_left', label: 'Km left', right: true, render: (r) => num(r.km_left) },
      { key: 'state', label: 'State', render: (r) => <Pill value={r.state} /> }] },
  { id: 'fuel', title: 'Fuel consumption', source: 'fleet_v_fuel', order: ['filled_at', false], sub: 'Km per litre is worked out between consecutive fills.',
    cols: [{ key: 'filled_at', label: 'Date', render: (r) => dateOnly(r.filled_at) }, { key: 'reg_number', label: 'Vehicle' }, { key: 'litres', label: 'Litres', right: true, render: (r) => num(r.litres, 1) },
      { key: 'cost', label: 'Cost', right: true, render: (r) => money(r.cost) }, { key: 'price_per_litre', label: 'R / litre', right: true, render: (r) => money(r.price_per_litre) },
      { key: 'km_per_litre', label: 'Km / litre', right: true, render: (r) => num(r.km_per_litre, 1) }] },
  { id: 'property', title: 'Property portfolio', source: 'fleet_v_property_value', order: ['name', true], sub: 'Market value against current value after condition and backlog.',
    cols: [{ key: 'name', label: 'Property' }, { key: 'kind', label: 'Type', render: (r) => label(r.kind) }, { key: 'province', label: 'Province' },
      { key: 'extent_m2', label: 'Extent m²', right: true, render: (r) => num(r.extent_m2) }, { key: 'condition_rating', label: 'Condition', render: (r) => <Pill value={r.condition_rating} /> },
      { key: 'market_value', label: 'Market', right: true, render: (r) => money(r.market_value) }, { key: 'current_value', label: 'Current', right: true, render: (r) => money(r.current_value) },
      { key: 'condition_discount', label: 'Discount', right: true, render: (r) => money(r.condition_discount) }, { key: 'open_backlog_cost', label: 'Backlog', right: true, render: (r) => money(r.open_backlog_cost) }] },
]

export default function Reports() {
  const ctx = useCtx()
  const defs = DEFS.filter((d) => ctx.canRead(d.id === 'property' ? 'property' : d.id === 'fuel' ? 'finance' : 'fleet'))
  const [tab, setTab] = useState(defs[0]?.id ?? 'compliance')
  const def = defs.find((d) => d.id === tab) ?? defs[0]
  const { data, error, loading } = useLoad(() => (def ? api.list(def.source, { eq: { tenant_id: ctx.tenantId }, order: def.order, limit: 5000 }) : Promise.resolve([])), [def?.id, ctx.tenantId])
  if (!def) return <Empty>Your role has no reports.</Empty>
  const rows = (data ?? []).filter(def.filter ?? (() => true))
  return (
    <>
      <Head title="Reports" sub={def.sub}>
        <button className="btn" disabled={rows.length === 0} onClick={() => api.downloadCsv(`${def.id}-report.csv`, def.cols, rows.map((r) => Object.fromEntries(def.cols.map((c) => [c.key, c.csv ? c.csv(r) : r[c.key]]))))}>Export CSV</button>
        <button className="btn" onClick={() => window.print()}>Print</button>
      </Head>
      <Tabs tabs={defs.map((d) => ({ id: d.id, label: d.title }))} value={def.id} onChange={setTab} />
      <ErrorBanner message={error} />
      <div className="tablewrap">
        <table>
          <thead><tr>{def.cols.map((c) => <th key={c.key} className={c.right ? 'r' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.id ?? r.plan_id ?? r.property_id ?? i}>{def.cols.map((c) => <td key={c.key} className={c.right ? 'r' : ''}>{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>)}</tr>)}</tbody>
        </table>
        {rows.length === 0 && !loading && <Empty>Nothing to report.</Empty>}
      </div>
    </>
  )
}
