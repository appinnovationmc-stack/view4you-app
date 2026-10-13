import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as api from './api'
import type { Membership, Role } from './access'
import { can, type Area } from './access'

export interface Lookups {
  vehicles: api.Row[]; drivers: api.Row[]; units: api.Row[]; properties: api.Row[]
  vehicle: (id: string | null | undefined) => string
  driver: (id: string | null | undefined) => string
  unit: (id: string | null | undefined) => string
  property: (id: string | null | undefined) => string
}
export interface Ctx {
  tenantId: string; tenantName: string; tenantKind: 'government' | 'company'
  role: Role; memberId: string; unitId: string | null
  lk: Lookups; refreshLookups: () => void
  canWrite: (area: Area) => boolean; canRead: (area: Area) => boolean
}
const C = createContext<Ctx | null>(null)
export const useCtx = () => { const c = useContext(C); if (!c) throw new Error('No organisation context'); return c }

export function TenantProvider({ membership, children }: { membership: Membership; children: ReactNode }) {
  const [state, setState] = useState<{ vehicles: api.Row[]; drivers: api.Row[]; units: api.Row[]; properties: api.Row[] }>({ vehicles: [], drivers: [], units: [], properties: [] })
  const [ready, setReady] = useState(false)
  const { tenant_id: tenantId, role } = membership
  const load = useCallback(async () => {
    const eq = { tenant_id: tenantId }
    const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])      // a role without access to a list just gets an empty one
    const [vehicles, drivers, units, properties] = await Promise.all([
      safe(api.list(role === 'driver' ? 'fleet_v_driver_vehicles' : 'fleet_vehicles', { eq, order: ['reg_number', true] })),
      safe(api.list('fleet_drivers', { eq, order: ['full_name', true] })),
      safe(api.list('fleet_units', { eq, order: ['name', true] })),
      safe(api.list('fleet_properties', { eq, order: ['name', true] })),
    ])
    setState({ vehicles, drivers, units, properties }); setReady(true)
  }, [tenantId, role])
  useEffect(() => { setReady(false); void load() }, [load])

  const value = useMemo<Ctx>(() => {
    const byId = (rows: api.Row[], f: (r: api.Row) => string) => { const m = new Map(rows.map((r) => [r.id as string, f(r)])); return (id: string | null | undefined) => (id ? m.get(id) ?? '—' : '—') }
    return {
      tenantId, tenantName: membership.tenant_name, tenantKind: membership.tenant_kind, role, memberId: membership.member_id, unitId: membership.unit_id,
      lk: {
        ...state,
        vehicle: byId(state.vehicles, (v) => v.reg_number),
        driver: byId(state.drivers, (d) => d.full_name),
        unit: byId(state.units, (u) => u.name),
        property: byId(state.properties, (p) => p.name),
      },
      refreshLookups: () => void load(),
      canWrite: (a) => can(role, a, true), canRead: (a) => can(role, a, false),
    }
  }, [state, tenantId, role, membership, load])
  if (!ready) return <div className="empty">Loading {membership.tenant_name}…</div>
  return <C.Provider value={value}>{children}</C.Provider>
}
