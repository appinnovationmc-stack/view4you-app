import { Pill, dateOnly, money, num, when, label } from './ui'
import { optionsOf, type ResourceDef } from './resource'
import * as api from './api'

const CATEGORIES = ['sedan', 'hatchback', 'suv', 'bakkie', 'minibus', 'bus', 'truck', 'tractor', 'motorcycle', 'trailer', 'implement', 'other']
const unitCol = { key: 'unit_id', label: 'Unit', render: (r: api.Row, lk: any) => lk.unit(r.unit_id), csv: (r: api.Row, lk: any) => lk.unit(r.unit_id) }
const vehicleCol = { key: 'vehicle_id', label: 'Vehicle', render: (r: api.Row, lk: any) => <strong>{lk.vehicle(r.vehicle_id)}</strong>, csv: (r: api.Row, lk: any) => lk.vehicle(r.vehicle_id) }
const driverCol = { key: 'driver_id', label: 'Driver', render: (r: api.Row, lk: any) => lk.driver(r.driver_id), csv: (r: api.Row, lk: any) => lk.driver(r.driver_id) }
const isManager = (role: string) => ['tenant_admin', 'fleet_manager', 'site_manager'].includes(role)

export const vehiclesDef: ResourceDef = {
  table: 'fleet_vehicles', singular: 'Vehicle', plural: 'Vehicles', area: 'fleet',
  order: ['reg_number', true], search: ['reg_number', 'fleet_number', 'vin', 'make', 'model'],
  filters: [
    { key: 'category', label: 'Category', options: optionsOf(CATEGORIES) },
    { key: 'status', label: 'Status', options: optionsOf(['active', 'reserved', 'in_workshop', 'out_of_service', 'disposed']) },
    { key: 'ownership', label: 'Ownership', options: optionsOf(['owned', 'rented', 'leased']) },
    { key: 'tracker_installed', label: 'Tracker', options: [['true', 'Installed'], ['false', 'Not installed']] },
  ],
  defaults: { category: 'sedan', ownership: 'owned', status: 'active', odometer_km: 0, tracker_installed: false },
  columns: [
    { key: 'reg_number', label: 'Registration', render: (r) => <strong>{r.reg_number}</strong> },
    { key: 'fleet_number', label: 'Fleet no.' },
    { key: 'make', label: 'Vehicle', render: (r) => [r.make, r.model, r.year].filter(Boolean).join(' ') || '—', csv: (r) => [r.make, r.model, r.year].filter(Boolean).join(' ') },
    { key: 'category', label: 'Category', render: (r) => label(r.category) },
    { key: 'ownership', label: 'Ownership', render: (r) => <Pill value={r.ownership} /> },
    unitCol,
    { key: 'acquisition_date', label: 'Acquired', render: (r) => dateOnly(r.acquisition_date) },
    { key: 'odometer_km', label: 'Odometer', right: true, render: (r) => num(r.odometer_km) + ' km' },
    { key: 'tracker_installed', label: 'Tracker', render: (r) => (r.tracker_installed ? <Pill value="ok" text="Installed" /> : <span className="muted">None</span>), csv: (r) => (r.tracker_installed ? 'Yes' : 'No') },
    { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
  ],
  fields: [
    { key: 'reg_number', label: 'Registration number', type: 'text', required: true },
    { key: 'fleet_number', label: 'Fleet / asset number', type: 'text' },
    { key: 'vin', label: 'VIN', type: 'text' },
    { key: 'make', label: 'Make', type: 'text' },
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'year', label: 'Year', type: 'number', step: '1' },
    { key: 'colour', label: 'Colour', type: 'text' },
    { key: 'category', label: 'Category', type: 'select', options: optionsOf(CATEGORIES), required: true },
    { key: 'unit_id', label: 'Unit / site', type: 'unit', hint: 'Which region, depot or site this vehicle belongs to. Unit managers only see their own.' },
    { key: 'ownership', label: 'Ownership', type: 'select', options: optionsOf(['owned', 'rented', 'leased']), required: true },
    { key: 'rental_supplier', label: 'Rental / lease supplier', type: 'text' },
    { key: 'rental_rate_per_day', label: 'Rental rate per day (R)', type: 'number' },
    { key: 'rental_start', label: 'Rental start', type: 'date' },
    { key: 'rental_end', label: 'Rental end', type: 'date' },
    { key: 'acquisition_date', label: 'Date of acquisition', type: 'date' },
    { key: 'acquisition_cost', label: 'Acquisition cost (R)', type: 'number' },
    { key: 'odometer_km', label: 'Odometer (km)', type: 'number', step: '1', required: true },
    { key: 'engine_hours', label: 'Engine hours', type: 'number', hint: 'Tractors and plant.' },
    { key: 'fuel_type', label: 'Fuel type', type: 'select', options: optionsOf(['petrol', 'diesel', 'hybrid', 'electric', 'lpg']) },
    { key: 'tank_capacity_l', label: 'Tank capacity (litres)', type: 'number' },
    { key: 'seats', label: 'Seats', type: 'number', step: '1' },
    { key: 'status', label: 'Status', type: 'select', options: optionsOf(['active', 'reserved', 'in_workshop', 'out_of_service', 'disposed']), required: true },
    { key: 'tracker_installed', label: 'Tracking device installed', type: 'bool' },
    { key: 'tracker_provider', label: 'Tracker provider', type: 'text' },
    { key: 'tracker_device_id', label: 'Tracker device ID', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
}

export const driversDef: ResourceDef = {
  table: 'fleet_drivers', singular: 'Driver', plural: 'Drivers', area: 'fleet',
  order: ['full_name', true], search: ['full_name', 'employee_no', 'licence_number', 'phone'],
  filters: [{ key: 'status', label: 'Status', options: optionsOf(['active', 'suspended', 'inactive']) }],
  defaults: { status: 'active' },
  columns: [
    { key: 'full_name', label: 'Name', render: (r) => <strong>{r.full_name}</strong> },
    { key: 'employee_no', label: 'Employee no.' },
    { key: 'phone', label: 'Phone' },
    unitCol,
    { key: 'licence_code', label: 'Licence code' },
    { key: 'licence_expiry', label: 'Licence expires', render: (r) => dateOnly(r.licence_expiry) },
    { key: 'prdp_expiry', label: 'PrDP expires', render: (r) => dateOnly(r.prdp_expiry) },
    { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
  ],
  fields: [
    { key: 'full_name', label: 'Full name', type: 'text', required: true },
    { key: 'employee_no', label: 'Employee number', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'unit_id', label: 'Unit / site', type: 'unit' },
    { key: 'licence_number', label: 'Driver licence number', type: 'text' },
    { key: 'licence_code', label: 'Licence code', type: 'text', hint: 'e.g. B, C1, EC' },
    { key: 'licence_expiry', label: 'Licence expiry', type: 'date' },
    { key: 'prdp_expiry', label: 'PrDP expiry', type: 'date' },
    { key: 'status', label: 'Status', type: 'select', options: optionsOf(['active', 'suspended', 'inactive']), required: true },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
}

const ALLOC_STATUS = ['requested', 'approved', 'active', 'completed', 'rejected', 'cancelled']
export const allocationsDef: ResourceDef = {
  table: 'fleet_allocations', singular: 'Trip / booking', plural: 'Trips and bookings', area: 'fleet',
  order: ['start_at', false], search: ['purpose', 'destination'],
  filters: [{ key: 'status', label: 'Status', options: optionsOf(ALLOC_STATUS) }],
  defaults: { status: 'approved' },
  canCreate: () => true,                         // drivers may request; the database only accepts status "requested" from them
  canEdit: (role) => isManager(role),
  columns: [
    { key: 'start_at', label: 'From', render: (r) => when(r.start_at) },
    { key: 'end_at', label: 'To', render: (r) => when(r.end_at) },
    vehicleCol, driverCol,
    { key: 'purpose', label: 'Purpose', render: (r) => <span className="wraptext">{r.purpose}</span> },
    { key: 'destination', label: 'Destination' },
    { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
    { key: 'km', label: 'Km', right: true, render: (r) => (r.end_odometer != null && r.start_odometer != null ? num(r.end_odometer - r.start_odometer) : '—'), csv: (r) => (r.end_odometer != null && r.start_odometer != null ? r.end_odometer - r.start_odometer : '') },
  ],
  fields: [
    { key: 'vehicle_id', label: 'Vehicle', type: 'vehicle', required: true, createOnly: true },
    { key: 'driver_id', label: 'Driver', type: 'driver' },
    { key: 'purpose', label: 'Purpose of trip', type: 'text', required: true },
    { key: 'destination', label: 'Destination', type: 'text' },
    { key: 'passengers', label: 'Passengers', type: 'number', step: '1' },
    { key: 'start_at', label: 'Start', type: 'datetime', required: true },
    { key: 'end_at', label: 'End', type: 'datetime', required: true },
    { key: 'status', label: 'Status', type: 'select', options: optionsOf(ALLOC_STATUS), required: true },
    { key: 'decision_note', label: 'Decision note', type: 'text' },
    { key: 'start_odometer', label: 'Odometer at start', type: 'number', step: '1' },
    { key: 'end_odometer', label: 'Odometer at return', type: 'number', step: '1' },
  ],
  beforeSave: (v, ctx, mode) => {
    if (mode === 'create') v.requested_by = ctx.memberId
    if (ctx.role === 'driver') { v.status = 'requested'; delete v.driver_id; delete v.decision_note; delete v.start_odometer; delete v.end_odometer }
    return v
  },
}

export const maintenanceDef: ResourceDef = {
  table: 'fleet_maintenance', singular: 'Work order', plural: 'Maintenance work orders', area: 'fleet',
  order: ['scheduled_date', false], search: ['description', 'supplier', 'invoice_no'],
  filters: [
    { key: 'status', label: 'Status', options: optionsOf(['scheduled', 'in_progress', 'completed', 'cancelled']) },
    { key: 'kind', label: 'Type', options: optionsOf(['service', 'repair', 'tyres', 'inspection', 'accident_repair', 'other']) },
  ],
  defaults: { kind: 'service', status: 'scheduled', cost: 0 },
  columns: [
    { key: 'scheduled_date', label: 'Scheduled', render: (r) => dateOnly(r.scheduled_date) },
    vehicleCol,
    { key: 'kind', label: 'Type', render: (r) => label(r.kind) },
    { key: 'description', label: 'Work', render: (r) => <span className="wraptext">{r.description}</span> },
    { key: 'supplier', label: 'Supplier' },
    { key: 'completed_date', label: 'Completed', render: (r) => dateOnly(r.completed_date) },
    { key: 'cost', label: 'Cost', right: true, render: (r) => money(r.cost) },
    { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
  ],
  fields: [
    { key: 'vehicle_id', label: 'Vehicle', type: 'vehicle', required: true, createOnly: true },
    { key: 'kind', label: 'Type', type: 'select', options: optionsOf(['service', 'repair', 'tyres', 'inspection', 'accident_repair', 'other']), required: true },
    { key: 'status', label: 'Status', type: 'select', options: optionsOf(['scheduled', 'in_progress', 'completed', 'cancelled']), required: true },
    { key: 'description', label: 'Work description', type: 'text', required: true },
    { key: 'supplier', label: 'Workshop / supplier', type: 'text' },
    { key: 'scheduled_date', label: 'Scheduled date', type: 'date' },
    { key: 'completed_date', label: 'Completed date', type: 'date' },
    { key: 'odometer_km', label: 'Odometer at service (km)', type: 'number', step: '1' },
    { key: 'cost', label: 'Cost (R)', type: 'number', required: true },
    { key: 'invoice_no', label: 'Invoice number', type: 'text' },
  ],
}

export const plansDef: ResourceDef = {
  table: 'fleet_maintenance_plans', view: 'fleet_v_maintenance_due', idKey: 'plan_id', singular: 'Maintenance plan', plural: 'Maintenance plans', area: 'fleet',
  order: ['state', true], search: ['task', 'reg_number'],
  filters: [{ key: 'state', label: 'State', options: [['overdue', 'Overdue'], ['due_soon', 'Due soon'], ['ok', 'OK'], ['no_history', 'No history']] }],
  defaults: { interval_km: 15000, interval_days: 365 },
  columns: [
    { key: 'reg_number', label: 'Vehicle', render: (r) => <strong>{r.reg_number}</strong> },
    { key: 'task', label: 'Task' },
    { key: 'interval', label: 'Every', render: (r) => [r.interval_km ? `${num(r.interval_km)} km` : '', r.interval_days ? `${r.interval_days} days` : ''].filter(Boolean).join(' / '), csv: (r) => [r.interval_km ? `${r.interval_km} km` : '', r.interval_days ? `${r.interval_days} days` : ''].filter(Boolean).join(' / ') },
    { key: 'last_done_date', label: 'Last done', render: (r) => (r.last_done_date ? `${dateOnly(r.last_done_date)}${r.last_done_km != null ? ' @ ' + num(r.last_done_km) + ' km' : ''}` : '—'), csv: (r) => r.last_done_date },
    { key: 'next_due_date', label: 'Next due', render: (r) => [r.next_due_date ? dateOnly(r.next_due_date) : '', r.next_due_km != null ? num(r.next_due_km) + ' km' : ''].filter(Boolean).join(' / ') || '—', csv: (r) => r.next_due_date },
    { key: 'km_left', label: 'Remaining', right: true, render: (r) => [r.days_left != null ? `${r.days_left} d` : '', r.km_left != null ? `${num(r.km_left)} km` : ''].filter(Boolean).join(' · ') || '—', csv: (r) => r.km_left },
    { key: 'state', label: 'State', render: (r) => <Pill value={r.state} /> },
  ],
  fields: [
    { key: 'vehicle_id', label: 'Vehicle', type: 'vehicle', required: true, createOnly: true },
    { key: 'task', label: 'Task', type: 'text', required: true, hint: 'e.g. Service, Tyre rotation, Brake inspection' },
    { key: 'interval_km', label: 'Repeat every (km)', type: 'number', step: '1' },
    { key: 'interval_days', label: 'Repeat every (days)', type: 'number', step: '1' },
    { key: 'last_done_date', label: 'Last done on', type: 'date' },
    { key: 'last_done_km', label: 'Odometer when last done', type: 'number', step: '1' },
  ],
}

export const fuelDef: ResourceDef = {
  table: 'fleet_fuel_logs', view: 'fleet_v_fuel', singular: 'Fuel fill', plural: 'Fuel log', area: 'fleet',
  order: ['filled_at', false], search: ['station', 'fuel_card', 'reg_number'],
  defaults: {},
  canCreate: () => true, canEdit: (role) => isManager(role),
  columns: [
    { key: 'filled_at', label: 'Date', render: (r) => when(r.filled_at) },
    { key: 'reg_number', label: 'Vehicle', render: (r) => <strong>{r.reg_number}</strong> },
    { key: 'litres', label: 'Litres', right: true, render: (r) => num(r.litres, 1) },
    { key: 'cost', label: 'Cost', right: true, render: (r) => money(r.cost) },
    { key: 'price_per_litre', label: 'R / litre', right: true, render: (r) => money(r.price_per_litre) },
    { key: 'odometer_km', label: 'Odometer', right: true, render: (r) => (r.odometer_km != null ? num(r.odometer_km) : '—') },
    { key: 'km_per_litre', label: 'km / litre', right: true, render: (r) => (r.km_per_litre != null ? num(r.km_per_litre, 1) : '—') },
    { key: 'station', label: 'Station' },
    { key: 'fuel_card', label: 'Fuel card' },
  ],
  fields: [
    { key: 'vehicle_id', label: 'Vehicle', type: 'vehicle', required: true, createOnly: true },
    { key: 'filled_at', label: 'Date and time', type: 'datetime', required: true },
    { key: 'litres', label: 'Litres', type: 'number', required: true },
    { key: 'cost', label: 'Total cost (R)', type: 'number', required: true },
    { key: 'odometer_km', label: 'Odometer (km)', type: 'number', step: '1', hint: 'Needed to work out km per litre.' },
    { key: 'station', label: 'Fuel station', type: 'text' },
    { key: 'fuel_card', label: 'Fuel card number', type: 'text' },
    { key: 'driver_id', label: 'Driver', type: 'driver' },
  ],
  beforeSave: (v, ctx) => { if (ctx.role === 'driver') delete v.driver_id; return v },
}

export const incidentsDef: ResourceDef = {
  table: 'fleet_incidents', singular: 'Incident', plural: 'Incidents', area: 'fleet',
  order: ['occurred_at', false], search: ['description', 'location', 'police_case_no', 'insurance_claim'],
  filters: [
    { key: 'status', label: 'Status', options: optionsOf(['reported', 'investigating', 'claim_lodged', 'resolved', 'closed']) },
    { key: 'severity', label: 'Severity', options: optionsOf(['minor', 'moderate', 'major', 'critical']) },
    { key: 'kind', label: 'Type', options: optionsOf(['accident', 'damage', 'breakdown', 'theft', 'hijacking', 'traffic_fine', 'misuse', 'other']) },
  ],
  defaults: { kind: 'accident', severity: 'minor', status: 'reported', injuries: false },
  canCreate: () => true, canEdit: (role) => isManager(role),
  columns: [
    { key: 'occurred_at', label: 'When', render: (r) => when(r.occurred_at) },
    vehicleCol, driverCol,
    { key: 'kind', label: 'Type', render: (r) => label(r.kind) },
    { key: 'severity', label: 'Severity', render: (r) => <Pill value={r.severity} /> },
    { key: 'description', label: 'What happened', render: (r) => <span className="wraptext">{r.description}</span> },
    { key: 'police_case_no', label: 'Police case' },
    { key: 'estimated_cost', label: 'Est. cost', right: true, render: (r) => money(r.estimated_cost) },
    { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
  ],
  fields: [
    { key: 'vehicle_id', label: 'Vehicle', type: 'vehicle', required: true, createOnly: true },
    { key: 'driver_id', label: 'Driver', type: 'driver' },
    { key: 'occurred_at', label: 'Date and time', type: 'datetime', required: true },
    { key: 'kind', label: 'Type', type: 'select', options: optionsOf(['accident', 'damage', 'breakdown', 'theft', 'hijacking', 'traffic_fine', 'misuse', 'other']), required: true },
    { key: 'severity', label: 'Severity', type: 'select', options: optionsOf(['minor', 'moderate', 'major', 'critical']), required: true },
    { key: 'location', label: 'Where', type: 'text' },
    { key: 'description', label: 'What happened', type: 'textarea', required: true },
    { key: 'injuries', label: 'Anyone injured', type: 'bool' },
    { key: 'police_case_no', label: 'Police case number', type: 'text' },
    { key: 'third_party', label: 'Third party details', type: 'text' },
    { key: 'estimated_cost', label: 'Estimated cost (R)', type: 'number' },
    { key: 'insurance_claim', label: 'Insurance claim number', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: optionsOf(['reported', 'investigating', 'claim_lodged', 'resolved', 'closed']), required: true },
    { key: 'resolution', label: 'Resolution', type: 'textarea' },
  ],
  beforeSave: (v, ctx) => { if (ctx.role === 'driver') { v.status = 'reported'; delete v.driver_id; delete v.resolution; delete v.insurance_claim } return v },
}

const EXP_CATS = ['insurance', 'licence_fees', 'tolls', 'fines', 'parking', 'cleaning', 'tracking', 'rental', 'utilities', 'rates_taxes', 'security', 'other']
export const expensesDef: ResourceDef = {
  table: 'fleet_expenses', singular: 'Expense', plural: 'Expenses', area: 'finance',
  order: ['incurred_on', false], search: ['supplier', 'invoice_no', 'cost_centre', 'description'],
  filters: [
    { key: 'category', label: 'Category', options: optionsOf(EXP_CATS) },
    { key: 'status', label: 'Status', options: optionsOf(['captured', 'approved', 'paid', 'disputed']) },
  ],
  defaults: { category: 'insurance', status: 'captured', incurred_on: new Date().toISOString().slice(0, 10) },
  empty: 'No expenses yet. Fuel and workshop spend are captured in their own screens and are included in cost recovery automatically.',
  columns: [
    { key: 'incurred_on', label: 'Date', render: (r) => dateOnly(r.incurred_on) },
    { key: 'category', label: 'Category', render: (r) => label(r.category) },
    { key: 'vehicle_id', label: 'Asset', render: (r, lk) => (r.vehicle_id ? lk.vehicle(r.vehicle_id) : r.property_id ? lk.property(r.property_id) : '—'), csv: (r, lk) => (r.vehicle_id ? lk.vehicle(r.vehicle_id) : r.property_id ? lk.property(r.property_id) : '') },
    { key: 'supplier', label: 'Supplier' },
    { key: 'invoice_no', label: 'Invoice' },
    { key: 'cost_centre', label: 'Cost centre' },
    { key: 'amount', label: 'Amount', right: true, render: (r) => money(r.amount) },
    { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
  ],
  fields: [
    { key: 'category', label: 'Category', type: 'select', options: optionsOf(EXP_CATS), required: true },
    { key: 'amount', label: 'Amount (R)', type: 'number', required: true },
    { key: 'incurred_on', label: 'Date', type: 'date', required: true },
    { key: 'vehicle_id', label: 'Vehicle', type: 'vehicle', createOnly: true, hint: 'Leave empty for a property or general expense.' },
    { key: 'property_id', label: 'Property', type: 'property', createOnly: true },
    { key: 'unit_id', label: 'Unit (general expenses)', type: 'unit', createOnly: true },
    { key: 'supplier', label: 'Supplier', type: 'text' },
    { key: 'invoice_no', label: 'Invoice number', type: 'text' },
    { key: 'cost_centre', label: 'Cost centre', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: optionsOf(['captured', 'approved', 'paid', 'disputed']), required: true },
  ],
}

const COMP_KINDS = ['licence_disc', 'roadworthy', 'insurance', 'operator_card', 'tracker_subscription', 'driver_licence', 'prdp', 'medical', 'other']
export const complianceDef: ResourceDef = {
  table: 'fleet_compliance', view: 'fleet_v_compliance', singular: 'Compliance item', plural: 'Statutory compliance', area: 'fleet',
  order: ['expires_on', true], search: ['subject', 'reference', 'kind'],
  filters: [
    { key: 'state', label: 'State', options: [['expired', 'Expired'], ['due_soon', 'Due soon'], ['valid', 'Valid']] },
    { key: 'kind', label: 'Type', options: optionsOf(COMP_KINDS) },
    { key: 'subject_type', label: 'Applies to', options: [['vehicle', 'Vehicles'], ['driver', 'Drivers']] },
  ],
  defaults: { kind: 'licence_disc', reminder_days: 30 },
  columns: [
    { key: 'subject', label: 'Vehicle / driver', render: (r) => <strong>{r.subject}</strong> },
    { key: 'kind', label: 'Type', render: (r) => label(r.kind) },
    { key: 'reference', label: 'Reference' },
    { key: 'expires_on', label: 'Expires', render: (r) => dateOnly(r.expires_on) },
    { key: 'days_left', label: 'Days left', right: true, render: (r) => <span className={r.days_left < 0 ? 'neg' : ''}>{r.days_left}</span> },
    { key: 'state', label: 'State', render: (r) => <Pill value={r.state} /> },
    { key: 'document_path', label: 'Document', render: (r) => (r.document_path ? <button className="btn sm" onClick={() => void api.openDocument(r.document_path)}>Open</button> : '—'), csv: (r) => (r.document_path ? 'attached' : '') },
  ],
  fields: [
    { key: 'vehicle_id', label: 'Vehicle', type: 'vehicle', createOnly: true, hint: 'Choose a vehicle OR a driver.' },
    { key: 'driver_id', label: 'Driver', type: 'driver', createOnly: true },
    { key: 'kind', label: 'Type', type: 'select', options: optionsOf(COMP_KINDS), required: true },
    { key: 'reference', label: 'Reference / certificate number', type: 'text' },
    { key: 'issued_on', label: 'Issued on', type: 'date' },
    { key: 'expires_on', label: 'Expires on', type: 'date', required: true },
    { key: 'reminder_days', label: 'Warn this many days before', type: 'number', step: '1', required: true },
    { key: 'document_path', label: 'Scanned document', type: 'doc', docScope: 'compliance' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
}

const PROP_KINDS = ['land', 'building', 'land_and_buildings', 'infrastructure']
const PROP_COND = ['excellent', 'good', 'fair', 'poor', 'critical']
export const propertiesDef: ResourceDef = {
  table: 'fleet_properties', view: 'fleet_v_property_value', idKey: 'property_id', singular: 'Property', plural: 'Land and buildings', area: 'property',
  order: ['name', true], search: ['name', 'asset_number', 'title_deed_number', 'municipality', 'province'],
  filters: [
    { key: 'kind', label: 'Type', options: optionsOf(PROP_KINDS) },
    { key: 'condition_rating', label: 'Condition', options: optionsOf(PROP_COND) },
    { key: 'ownership', label: 'Ownership', options: optionsOf(['owned', 'leased', 'state_custody']) },
  ],
  defaults: { kind: 'building', ownership: 'owned', extent_unit: 'm2', status: 'active' },
  columns: [
    { key: 'name', label: 'Property', render: (r) => <strong>{r.name}</strong> },
    { key: 'asset_number', label: 'Asset no.' },
    { key: 'kind', label: 'Type', render: (r) => label(r.kind) },
    { key: 'title_deed_number', label: 'Title deed' },
    { key: 'extent_value', label: 'Extent', right: true, render: (r) => (r.extent_value != null ? `${num(r.extent_value, 2)} ${r.extent_unit === 'ha' ? 'ha' : 'm²'}` : '—'), csv: (r) => (r.extent_value != null ? `${r.extent_value} ${r.extent_unit}` : '') },
    { key: 'condition_rating', label: 'Condition', render: (r) => <Pill value={r.condition_rating} /> },
    { key: 'market_value', label: 'Market value', right: true, render: (r) => money(r.market_value) },
    { key: 'current_value', label: 'Current value', right: true, render: (r) => money(r.current_value) },
    { key: 'open_backlog_cost', label: 'Open backlog', right: true, render: (r) => money(r.open_backlog_cost) },
  ],
  fields: [
    { key: 'name', label: 'Property name', type: 'text', required: true },
    { key: 'asset_number', label: 'Asset register number', type: 'text' },
    { key: 'kind', label: 'Type', type: 'select', options: optionsOf(PROP_KINDS), required: true },
    { key: 'usage', label: 'Use', type: 'text', hint: 'Offices, research station, housing, farm …' },
    { key: 'ownership', label: 'Ownership', type: 'select', options: optionsOf(['owned', 'leased', 'state_custody']), required: true },
    { key: 'unit_id', label: 'Unit / site', type: 'unit' },
    { key: 'address', label: 'Physical address', type: 'text' },
    { key: 'municipality', label: 'Municipality', type: 'text' },
    { key: 'province', label: 'Province', type: 'text' },
    { key: 'lat', label: 'Latitude', type: 'number', hint: 'e.g. -25.7479' },
    { key: 'lng', label: 'Longitude', type: 'number', hint: 'e.g. 28.2293' },
    { key: 'extent_value', label: 'Extent (size)', type: 'number' },
    { key: 'extent_unit', label: 'Extent unit', type: 'select', options: [['m2', 'm²'], ['ha', 'hectares']], required: true },
    { key: 'title_deed_number', label: 'Title deed number', type: 'text' },
    { key: 'deed_document_path', label: 'Title deed (scan)', type: 'doc', docScope: 'property-deed' },
    { key: 'layout_plan_path', label: 'Building layout plan', type: 'doc', docScope: 'property-plan' },
    { key: 'year_built', label: 'Year built', type: 'number', step: '1' },
    { key: 'condition_rating', label: 'Physical condition', type: 'select', options: optionsOf(PROP_COND) },
    { key: 'status', label: 'Status', type: 'select', options: optionsOf(['active', 'vacant', 'under_construction', 'for_disposal', 'disposed']), required: true },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
}

export const valuationsDef: ResourceDef = {
  table: 'fleet_property_valuations', singular: 'Valuation', plural: 'Valuations', area: 'property',
  order: ['valued_on', false], search: ['valuer', 'method'],
  defaults: { valued_on: new Date().toISOString().slice(0, 10) },
  columns: [
    { key: 'valued_on', label: 'Valued on', render: (r) => dateOnly(r.valued_on) },
    { key: 'market_value', label: 'Market value', right: true, render: (r) => money(r.market_value) },
    { key: 'current_value', label: 'Current value', right: true, render: (r) => money(r.current_value) },
    { key: 'discount', label: 'Condition discount', right: true, render: (r) => <span className="neg">{money(Number(r.market_value) - Number(r.current_value))}</span>, csv: (r) => Number(r.market_value) - Number(r.current_value) },
    { key: 'maintenance_backlog', label: 'Backlog at valuation', right: true, render: (r) => money(r.maintenance_backlog) },
    { key: 'method', label: 'Method' },
    { key: 'valuer', label: 'Valuer' },
  ],
  fields: [
    { key: 'valued_on', label: 'Valuation date', type: 'date', required: true },
    { key: 'market_value', label: 'Market value (R)', type: 'number', required: true, hint: 'What it would fetch in good condition.' },
    { key: 'current_value', label: 'Current value (R)', type: 'number', required: true, hint: 'After the discount for its physical condition / maintenance backlog.' },
    { key: 'maintenance_backlog', label: 'Maintenance backlog (R)', type: 'number' },
    { key: 'method', label: 'Method', type: 'text', hint: 'e.g. comparable sales, depreciated replacement cost' },
    { key: 'valuer', label: 'Valuer', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
}

export const propMaintDef: ResourceDef = {
  table: 'fleet_property_maintenance', singular: 'Backlog item', plural: 'Maintenance backlog', area: 'property',
  order: ['due_date', true], search: ['title', 'contractor'],
  filters: [
    { key: 'status', label: 'Status', options: optionsOf(['backlog', 'planned', 'in_progress', 'completed', 'cancelled']) },
    { key: 'priority', label: 'Priority', options: optionsOf(['low', 'medium', 'high', 'critical']) },
  ],
  defaults: { priority: 'medium', status: 'backlog', estimated_cost: 0 },
  columns: [
    { key: 'title', label: 'Work', render: (r) => <strong>{r.title}</strong> },
    { key: 'priority', label: 'Priority', render: (r) => <Pill value={r.priority} /> },
    { key: 'due_date', label: 'Due', render: (r) => dateOnly(r.due_date) },
    { key: 'contractor', label: 'Contractor' },
    { key: 'estimated_cost', label: 'Estimate', right: true, render: (r) => money(r.estimated_cost) },
    { key: 'actual_cost', label: 'Actual', right: true, render: (r) => money(r.actual_cost) },
    { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
  ],
  fields: [
    { key: 'title', label: 'Work required', type: 'text', required: true },
    { key: 'description', label: 'Details', type: 'textarea' },
    { key: 'priority', label: 'Priority', type: 'select', options: optionsOf(['low', 'medium', 'high', 'critical']), required: true },
    { key: 'status', label: 'Status', type: 'select', options: optionsOf(['backlog', 'planned', 'in_progress', 'completed', 'cancelled']), required: true },
    { key: 'estimated_cost', label: 'Estimated cost (R)', type: 'number', required: true },
    { key: 'actual_cost', label: 'Actual cost (R)', type: 'number' },
    { key: 'due_date', label: 'Due date', type: 'date' },
    { key: 'completed_date', label: 'Completed on', type: 'date' },
    { key: 'contractor', label: 'Contractor', type: 'text' },
  ],
}

// All property work across the portfolio (not only one property): used by the portfolio-level backlog report.
export const propMaintAllDef: ResourceDef = {
  ...propMaintDef,
  columns: [{ key: 'property_id', label: 'Property', render: (r, lk) => <strong>{lk.property(r.property_id)}</strong>, csv: (r, lk) => lk.property(r.property_id) }, ...propMaintDef.columns],
  fields: [{ key: 'property_id', label: 'Property', type: 'property', required: true, createOnly: true }, ...propMaintDef.fields],
}
