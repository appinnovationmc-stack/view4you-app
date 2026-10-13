import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as api from '../api'
import { useCtx } from '../context'
import { Empty, ErrorBanner, Head, Modal, Pill, Tile, when, num, useLoad } from '../ui'

export function MapView({ points, height = 420 }: { points: { id: string; lat: number; lng: number; title: string; sub?: string; tone?: 'ok' | 'bad' | 'warn' }[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  useEffect(() => {
    if (!el.current || map.current) return
    map.current = L.map(el.current, { scrollWheelZoom: false }).setView([-28.5, 25], 5)   // South Africa
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => { map.current?.remove(); map.current = null }
  }, [])
  useEffect(() => {
    if (!map.current || !layer.current) return
    layer.current.clearLayers()
    const color = { ok: '#12A66B', warn: '#d99a00', bad: '#c62828' }
    points.forEach((p) => {
      const m = L.circleMarker([p.lat, p.lng], { radius: 8, weight: 2, color: '#0A0A0B', fillColor: color[p.tone ?? 'ok'], fillOpacity: 0.9 })
      const box = document.createElement('div')
      const b = document.createElement('strong'); b.textContent = p.title; box.appendChild(b)
      if (p.sub) { box.appendChild(document.createElement('br')); box.appendChild(document.createTextNode(p.sub)) }
      m.bindPopup(box).addTo(layer.current!)
    })
    if (points.length > 0) map.current.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])).pad(0.3), { maxZoom: 14 })
  }, [points])
  return <div ref={el} style={{ height }} className="map" role="region" aria-label="Map" />
}

export function PositionModal({ vehicleId, onClose, onSaved }: { vehicleId?: string; onClose: () => void; onSaved: () => void }) {
  const ctx = useCtx()
  const [vehicle, setVehicle] = useState(vehicleId ?? '')
  const [lat, setLat] = useState(''), [lng, setLng] = useState(''), [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const driver = ctx.role === 'driver'
  const locate = () => {
    if (!navigator.geolocation) { setError('This device cannot share its location.'); return }
    navigator.geolocation.getCurrentPosition((p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)) }, (e) => setError(e.message), { enableHighAccuracy: true, timeout: 15000 })
  }
  const save = async () => {
    setBusy(true); setError(null)
    try {
      const la = Number(lat), lo = Number(lng)
      if (!vehicle) throw new Error('Choose a vehicle.')
      if (!(la >= -90 && la <= 90 && lo >= -180 && lo <= 180) || lat === '' || lng === '') throw new Error('Enter a valid latitude and longitude.')
      await api.insert('fleet_locations', { tenant_id: ctx.tenantId, vehicle_id: vehicle, lat: la, lng: lo, source: driver ? 'driver' : 'manual', note: note || null })
      ctx.refreshLookups(); onSaved(); onClose()
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title="Record vehicle position" onClose={() => !busy && onClose()}>
      <label className="field"><span>Vehicle</span>
        <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} disabled={!!vehicleId}>
          <option value="">Choose…</option>{ctx.lk.vehicles.map((v) => <option key={v.id} value={v.id}>{v.reg_number}</option>)}
        </select></label>
      <div className="row"><label className="field"><span>Latitude</span><input type="text" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-25.7479" /></label>
        <label className="field"><span>Longitude</span><input type="text" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="28.2293" /></label></div>
      <button type="button" className="btn sm" onClick={locate}>Use this device's location</button>
      <label className="field"><span>Note</span><input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <ErrorBanner message={error} />
      <div className="row end"><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save position'}</button></div>
    </Modal>
  )
}

export default function Tracking() {
  const ctx = useCtx()
  const { data, error, loading, reload } = useLoad(() => api.list('fleet_vehicles', { eq: { tenant_id: ctx.tenantId }, order: ['reg_number', true] }), [ctx.tenantId])
  const [adding, setAdding] = useState(false)
  const vehicles = (data ?? []).filter((v) => v.status !== 'disposed')
  const located = vehicles.filter((v) => v.last_lat != null && v.last_lng != null)
  const tracked = vehicles.filter((v) => v.tracker_installed)
  const stale = (v: api.Row) => !v.last_seen_at || Date.now() - new Date(v.last_seen_at).getTime() > 24 * 3600 * 1000
  const points = located.map((v) => ({ id: v.id, lat: v.last_lat, lng: v.last_lng, title: v.reg_number, sub: `${[v.make, v.model].filter(Boolean).join(' ')} · seen ${when(v.last_seen_at)}`, tone: (stale(v) ? 'warn' : 'ok') as 'warn' | 'ok' }))
  const write = ctx.canWrite('fleet')
  return (
    <>
      <Head title="Vehicle location" sub="Last known position of every vehicle. Positions come from installed trackers or are recorded by staff and drivers.">
        <button className="btn" onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        {write && <button className="btn primary" onClick={() => setAdding(true)}>Record position</button>}
      </Head>
      <ErrorBanner message={error} />
      <div className="cards">
        <Tile label="Total fleet" value={num(vehicles.length)} />
        <Tile label="Tracking installed" value={`${num(tracked.length)} / ${num(vehicles.length)}`} tone={tracked.length < vehicles.length ? 'warn' : 'ok'} sub={vehicles.length ? `${Math.round((tracked.length / vehicles.length) * 100)}% of fleet` : undefined} />
        <Tile label="Positions known" value={num(located.length)} />
        <Tile label="No position in 24 h" value={num(vehicles.filter(stale).length)} tone="warn" />
      </div>
      {points.length > 0 ? <MapView points={points} /> : <div className="panel"><Empty>No vehicle has reported a position yet.</Empty></div>}
      <h2 style={{ marginTop: 18 }}>Fleet without a tracker ({vehicles.length - tracked.length})</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Vehicle</th><th>Category</th><th>Unit</th><th>Last position</th><th>Tracker</th></tr></thead>
          <tbody>{vehicles.filter((v) => !v.tracker_installed).map((v) => (
            <tr key={v.id}><td><strong>{v.reg_number}</strong></td><td>{v.category}</td><td>{ctx.lk.unit(v.unit_id)}</td><td>{v.last_seen_at ? when(v.last_seen_at) : '—'}</td><td><Pill value="no_history" text="Not installed" /></td></tr>
          ))}</tbody>
        </table>
        {vehicles.every((v) => v.tracker_installed) && <Empty>Every vehicle has a tracker.</Empty>}
      </div>
      {adding && <PositionModal onClose={() => setAdding(false)} onSaved={reload} />}
    </>
  )
}
