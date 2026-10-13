import { useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useCtx } from '../context'
import { Bars, Empty, ErrorBanner, Head, Pill, Tile, dateOnly, money, num, useLoad } from '../ui'

export default function Dashboard() {
  const ctx = useCtx()
  const nav = useNavigate()
  const { data: d, error, loading, reload } = useLoad(() => api.dashboard(ctx.tenantId), [ctx.tenantId])
  const compliance = useLoad(() => api.list('fleet_v_compliance', { eq: { tenant_id: ctx.tenantId }, order: ['expires_on', true], limit: 400 }), [ctx.tenantId])
  const due = useLoad(() => api.list('fleet_v_maintenance_due', { eq: { tenant_id: ctx.tenantId }, order: ['days_left', true], limit: 400 }), [ctx.tenantId])
  const showFleet = ctx.canRead('fleet'), showProp = ctx.canRead('property'), showFin = ctx.canRead('finance')
  const alerts = (compliance.data ?? []).filter((c) => c.state !== 'valid').slice(0, 8)
  const dueList = (due.data ?? []).filter((m) => m.state === 'overdue' || m.state === 'due_soon').slice(0, 8)
  const tracked = d ? d.vehicles_tracked : 0
  return (
    <>
      <Head title="Dashboard" sub={`${ctx.tenantName}${ctx.unitId ? ' — ' + ctx.lk.unit(ctx.unitId) : ''}`}>
        <button className="btn" onClick={() => { reload(); compliance.reload(); due.reload() }} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </Head>
      <ErrorBanner message={error} />
      {d && showFleet && (
        <>
          <h2>Fleet</h2>
          <div className="cards">
            <Tile label="Total fleet" value={num(d.vehicles_total)} sub={`${d.in_workshop} in workshop`} onClick={() => nav('/vehicles')} />
            <Tile label="With tracking installed" value={`${num(tracked)} / ${num(d.vehicles_total)}`} sub={d.vehicles_total ? `${Math.round((tracked / d.vehicles_total) * 100)}% coverage` : undefined} tone={d.vehicles_untracked > 0 ? 'warn' : 'ok'} onClick={() => nav('/tracking')} />
            <Tile label="Average age" value={d.avg_age_years != null ? `${d.avg_age_years} yrs` : '—'} sub={d.avg_odometer_km ? `avg ${num(d.avg_odometer_km)} km` : undefined} />
            <Tile label="Licences / documents expired" value={d.compliance_expired} tone={d.compliance_expired > 0 ? 'bad' : 'ok'} sub={`${d.compliance_due_soon} due soon`} onClick={() => nav('/compliance')} />
            <Tile label="Maintenance overdue" value={d.maintenance_overdue} tone={d.maintenance_overdue > 0 ? 'bad' : 'ok'} sub={`${d.maintenance_due_soon} due soon`} onClick={() => nav('/maintenance')} />
            <Tile label="Open incidents" value={d.open_incidents} tone={d.open_incidents > 0 ? 'warn' : 'ok'} onClick={() => nav('/incidents')} />
            <Tile label="Vehicle requests to approve" value={d.requests_pending} tone={d.requests_pending > 0 ? 'warn' : undefined} sub={`${d.trips_active} on the road · ${d.trips_next_7_days} in next 7 days`} onClick={() => nav('/scheduling')} />
            {showFin && <Tile label="Fuel this month" value={money(d.fuel_cost_month)} sub={`${num(d.fuel_litres_month, 0)} litres`} onClick={() => nav('/fuel')} />}
            {showFin && <Tile label="Workshop spend this month" value={money(d.maintenance_cost_month)} onClick={() => nav('/maintenance')} />}
          </div>
          <div className="charts">
            <div className="panel"><h2>By category</h2><Bars data={d.by_category} /></div>
            <div className="panel"><h2>Ownership</h2><Bars data={d.by_ownership} /><h2 style={{ marginTop: 16 }}>Status</h2><Bars data={d.by_status} /></div>
          </div>
          <div className="charts">
            <div className="panel">
              <h2>Compliance needing attention</h2>
              {alerts.length === 0 ? <p className="muted">Nothing expired or due soon.</p> : (
                <div className="list">{alerts.map((c) => (
                  <div className="item" key={c.id}><span><strong>{c.subject}</strong> · {c.kind.replace(/_/g, ' ')}<br /><span className="muted">{dateOnly(c.expires_on)}</span></span><Pill value={c.state} text={c.state === 'expired' ? `Expired ${Math.abs(c.days_left)} d ago` : `${c.days_left} days left`} /></div>
                ))}</div>
              )}
            </div>
            <div className="panel">
              <h2>Maintenance due</h2>
              {dueList.length === 0 ? <p className="muted">Nothing overdue or due soon.</p> : (
                <div className="list">{dueList.map((m) => (
                  <div className="item" key={m.plan_id}><span><strong>{m.reg_number}</strong> · {m.task}<br /><span className="muted">{[m.days_left != null ? `${m.days_left} days` : '', m.km_left != null ? `${num(m.km_left)} km` : ''].filter(Boolean).join(' / ')}</span></span><Pill value={m.state} /></div>
                ))}</div>
              )}
            </div>
          </div>
        </>
      )}
      {d && showProp && (
        <>
          <h2>Land and buildings</h2>
          <div className="cards">
            <Tile label="Properties" value={num(d.properties_total)} sub={`${num(d.properties_extent_m2 / 10000, 1)} ha in total`} onClick={() => nav('/properties')} />
            <Tile label="Market value" value={money(d.property_market_value)} />
            <Tile label="Current value (after condition)" value={money(d.property_current_value)} sub={d.property_market_value > 0 ? `${money(d.property_market_value - d.property_current_value)} below market` : undefined} />
            <Tile label="Open maintenance backlog" value={money(d.property_open_backlog)} tone={d.property_open_backlog > 0 ? 'warn' : 'ok'} onClick={() => nav('/properties')} />
            <Tile label="Poor or critical condition" value={d.property_poor_or_critical} tone={d.property_poor_or_critical > 0 ? 'bad' : 'ok'} />
          </div>
        </>
      )}
      {!d && !error && !loading && <Empty>No data yet.</Empty>}
    </>
  )
}
