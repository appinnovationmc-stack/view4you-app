import { useState } from 'react'
import { Tabs } from '../ui'
import { Resource } from '../resource'
import { allocationsDef, complianceDef, driversDef, expensesDef, fuelDef, incidentsDef, maintenanceDef, plansDef, propMaintAllDef, vehiclesDef } from '../configs'
import { useCtx } from '../context'

export const Vehicles = () => <Resource def={vehiclesDef} sub="Every vehicle, owned, rented or leased: category, age, odometer and tracking." />
export const Drivers = () => <Resource def={driversDef} />
export const Scheduling = () => <Resource def={allocationsDef} title="Scheduling and allocation" sub="Book rented and owned vehicles. A clash with an existing trip or a vehicle in the workshop is refused." />
export const Fuel = () => <Resource def={fuelDef} title="Fuel management" />
export const Incidents = () => <Resource def={incidentsDef} title="Incident management" />
export const Expenses = () => <Resource def={expensesDef} title="Expense management" />
export const Compliance = () => <Resource def={complianceDef} title="Statutory compliance" sub="Licences, roadworthy certificates, operator cards, driver licences and PrDPs." />
export const Backlog = () => <Resource def={propMaintAllDef} title="Property maintenance backlog" sub="Across the whole property portfolio." />

export function Maintenance() {
  const [tab, setTab] = useState<'work' | 'plans'>('work')
  return (
    <>
      <Tabs tabs={[{ id: 'work', label: 'Work orders' }, { id: 'plans', label: 'Service plans' }]} value={tab} onChange={setTab} />
      {tab === 'work' ? <Resource def={maintenanceDef} title="Fleet maintenance" /> : <Resource def={plansDef} title="Service plans" sub="Recurring services by date and / or kilometres." />}
    </>
  )
}

export function Audit() {
  const ctx = useCtx()
  return <Resource def={{
    table: 'fleet_audit_log', singular: 'Entry', plural: 'Audit log', area: 'people', order: ['created_at', false], search: ['table_name', 'action'], fields: [],
    canCreate: () => false, canEdit: () => false, canDelete: () => false,
    columns: [
      { key: 'created_at', label: 'When', render: (r) => new Date(r.created_at).toLocaleString('en-ZA') },
      { key: 'table_name', label: 'Record type' }, { key: 'action', label: 'Action' },
      { key: 'actor', label: 'By', render: (r) => (r.actor === ctx.memberId ? 'You' : String(r.actor ?? '').slice(0, 8)) },
      { key: 'changes', label: 'Change', render: (r) => <span className="wraptext muted">{JSON.stringify(r.changes).slice(0, 160)}</span>, csv: (r) => JSON.stringify(r.changes) },
    ],
  }} title="Audit log" sub="Who changed what. Read only." />
}
