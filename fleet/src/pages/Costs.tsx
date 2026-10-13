import { useMemo, useState } from 'react'
import * as api from '../api'
import { useCtx } from '../context'
import { Empty, ErrorBanner, Head, Tile, label, money, num, todayIso, useLoad } from '../ui'

const iso = (d: Date) => d.toISOString().slice(0, 10)
function presets() {
  const now = new Date()
  const y = now.getFullYear()
  const fyStart = new Date(Date.UTC(now.getMonth() >= 3 ? y : y - 1, 3, 1))         // South African government financial year: 1 April
  const monthStart = new Date(Date.UTC(y, now.getMonth(), 1))
  const lastMonthStart = new Date(Date.UTC(y, now.getMonth() - 1, 1)), lastMonthEnd = new Date(Date.UTC(y, now.getMonth(), 0))
  const yearAgo = new Date(now.getTime() - 365 * 86400000)
  return [
    { id: 'fy', label: 'Financial year to date', from: iso(fyStart), to: todayIso() },
    { id: 'month', label: 'This month', from: iso(monthStart), to: todayIso() },
    { id: 'last', label: 'Last month', from: iso(lastMonthStart), to: iso(lastMonthEnd) },
    { id: 'year', label: 'Last 12 months', from: iso(yearAgo), to: todayIso() },
  ]
}

export default function Costs() {
  const ctx = useCtx()
  const P = useMemo(presets, [])
  const [from, setFrom] = useState(P[0].from)
  const [to, setTo] = useState(P[0].to)
  const { data, error, loading, reload } = useLoad(() => api.vehicleCosts(ctx.tenantId, from, to), [ctx.tenantId, from, to])
  const rows = data ?? []
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0)
  const total = sum('total_cost'), hours = sum('hours_used'), km = sum('km_driven')
  const byCat = useMemo(() => {
    const m = new Map<string, { cat: string; n: number; cost: number; hours: number; km: number; fuel: number; maint: number; other: number; rental: number }>()
    for (const r of rows) {
      const c = m.get(r.category) ?? { cat: r.category, n: 0, cost: 0, hours: 0, km: 0, fuel: 0, maint: 0, other: 0, rental: 0 }
      c.n++; c.cost += Number(r.total_cost); c.hours += Number(r.hours_used); c.km += Number(r.km_driven)
      c.fuel += Number(r.fuel_cost); c.maint += Number(r.maintenance_cost); c.other += Number(r.other_cost); c.rental += Number(r.rental_cost)
      m.set(r.category, c)
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost)
  }, [rows])
  const cols = [
    { key: 'reg_number', label: 'Registration' }, { key: 'make', label: 'Make' }, { key: 'model', label: 'Model' }, { key: 'category', label: 'Category' }, { key: 'ownership', label: 'Ownership' },
    { key: 'litres', label: 'Litres' }, { key: 'fuel_cost', label: 'Fuel (R)' }, { key: 'maintenance_cost', label: 'Maintenance (R)' }, { key: 'other_cost', label: 'Other expenses (R)' },
    { key: 'rental_cost', label: 'Rental (R)' }, { key: 'total_cost', label: 'Total cost (R)' }, { key: 'hours_used', label: 'Hours used' }, { key: 'km_driven', label: 'Km driven' },
    { key: 'cost_per_hour', label: 'Cost per hour (R)' }, { key: 'cost_per_km', label: 'Cost per km (R)' },
  ]
  return (
    <>
      <Head title="Cost recovery" sub="Total cost of running each vehicle and what it costs per hour and per km. Fuel, completed workshop work, approved expenses and rental are all included.">
        <button className="btn" onClick={() => api.downloadCsv(`cost-recovery-${from}-to-${to}.csv`, cols, rows)} disabled={rows.length === 0}>Export CSV</button>
        <button className="btn" onClick={reload} disabled={loading}>{loading ? 'Calculating…' : 'Refresh'}</button>
      </Head>
      <div className="panel row">
        {P.map((p) => <button key={p.id} className="btn sm" onClick={() => { setFrom(p.from); setTo(p.to) }} aria-pressed={from === p.from && to === p.to}>{p.label}</button>)}
        <label className="row">From <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="row">To <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
      </div>
      <ErrorBanner message={error} />
      <div className="cards">
        <Tile label="Total fleet cost" value={money(total)} />
        <Tile label="Hours on the road" value={num(hours, 1)} sub="from completed and active bookings" />
        <Tile label="Average cost per hour" value={hours > 0 ? money(total / hours) : '—'} />
        <Tile label="Average cost per km" value={km > 0 ? money(total / km) : '—'} sub={`${num(km)} km recorded`} />
      </div>
      <h2>By category</h2>
      <div className="tablewrap" style={{ marginBottom: 18 }}>
        <table>
          <thead><tr><th>Category</th><th className="r">Vehicles</th><th className="r">Fuel</th><th className="r">Maintenance</th><th className="r">Other</th><th className="r">Rental</th><th className="r">Total</th><th className="r">Hours</th><th className="r">Per hour</th></tr></thead>
          <tbody>{byCat.map((c) => (
            <tr key={c.cat}><td>{label(c.cat)}</td><td className="r">{c.n}</td><td className="r">{money(c.fuel)}</td><td className="r">{money(c.maint)}</td><td className="r">{money(c.other)}</td><td className="r">{money(c.rental)}</td><td className="r"><strong>{money(c.cost)}</strong></td><td className="r">{num(c.hours, 1)}</td><td className="r">{c.hours > 0 ? money(c.cost / c.hours) : '—'}</td></tr>
          ))}</tbody>
        </table>
        {byCat.length === 0 && !loading && <Empty>No vehicles.</Empty>}
      </div>
      <h2>By vehicle</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Vehicle</th><th>Category</th><th className="r">Fuel</th><th className="r">Maintenance</th><th className="r">Other</th><th className="r">Rental</th><th className="r">Total</th><th className="r">Hours</th><th className="r">Km</th><th className="r">R / hour</th><th className="r">R / km</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.vehicle_id}>
              <td><strong>{r.reg_number}</strong><br /><span className="muted">{[r.make, r.model].filter(Boolean).join(' ')}</span></td><td>{label(r.category)}</td>
              <td className="r">{money(r.fuel_cost)}</td><td className="r">{money(r.maintenance_cost)}</td><td className="r">{money(r.other_cost)}</td><td className="r">{money(r.rental_cost)}</td>
              <td className="r"><strong>{money(r.total_cost)}</strong></td><td className="r">{num(r.hours_used, 1)}</td><td className="r">{num(r.km_driven)}</td>
              <td className="r">{r.cost_per_hour != null ? money(r.cost_per_hour) : '—'}</td><td className="r">{r.cost_per_km != null ? money(r.cost_per_km) : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>Hours come from trips and bookings marked active or completed. A vehicle with no recorded trips shows no hourly rate, because dividing by zero hours would be misleading.</p>
    </>
  )
}
