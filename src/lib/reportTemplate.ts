// RealName detailed report: checklist template + evaluation logic.
// Thresholds below are DEFAULTS. Verify against the standard you want to certify to.

export type Condition = 'good' | 'as_expected' | 'fair' | 'poor' | 'na'

export const CONDITION_LABEL: Record<Condition, string> = {
  good: 'Good', as_expected: 'As expected', fair: 'Fair', poor: 'Poor', na: 'N/A',
}

export const LIMITS = {
  brakeImbalancePct: 30,   // left/right difference above this = fail
  shockImbalancePct: 30,
  slipMaxMPerKm: 5,        // |alignment| above this = fail
  treadMinMm: 1.0,         // below = fail
  treadWarnMm: 3.0,        // below = warn
}

type Row = [key: string, label: string, roadworthy?: boolean]
export interface Section { key: string; title: string; rows: Row[] }

export const CHECKLIST: Section[] = [
  { key: 'drive_system', title: 'Drive system & underbody', rows: [
    ['ball_joint', 'Ball joints'], ['bell_housing', 'Bell housing / dust cover'],
    ['bonnet_cable', 'Bonnet cable'], ['bonnet_stay', 'Bonnet shocks / stay'], ['bonnet_hinges', 'Bonnet hinges'],
    ['underbody', 'Underbody'], ['subframe', 'Subframe'], ['control_arm', 'Control arms'],
    ['exhaust', 'Exhaust system', true], ['smoke_emission', 'Smoke emission', true], ['chassis', 'Chassis', true],
    ['shock_mounting', 'Shock mountings'], ['stabilizer', 'Stabilizer bars'], ['bushings', 'Bushings'], ['links', 'Links'],
    ['tie_rods', 'Tie rods', true], ['wheel_bearings', 'Wheel bearings', true], ['axles', 'Axles'],
    ['shocks', 'Shock absorbers', true], ['gearbox', 'Transmission / gearbox'], ['steering_rack', 'Steering rack', true],
    ['engine_mountings', 'Engine / gearbox mountings'], ['fuel_system', 'Fuel system', true],
    ['radiator', 'Radiator / fans / coolers'], ['radiator_cradle', 'Radiator cradle'], ['coolant_hoses', 'Coolant hoses & connections'],
    ['brake_lines', 'Brake lines & hoses', true], ['handbrake', 'Hand brake', true], ['brake_calipers', 'Brake calipers', true],
    ['cv_joints', 'CV joints'], ['drive_shaft', 'Drive shaft'], ['link_rod_covers', 'Link rod dust covers'],
  ]},
  { key: 'engine', title: 'Engine compartment', rows: [
    ['belts', 'Belts'], ['idle', 'Engine idle'], ['alternator', 'Alternator / generator'], ['battery', 'Battery, terminals, clamps'],
    ['coolant', 'Coolant level'], ['oil', 'Oil level'], ['cables', 'Cables'], ['pipes_wiring', 'Pipes & wiring'],
    ['brake_fluid', 'Brake fluid', true], ['oil_cap', 'Oil cap & dipstick'], ['expansion_bottle', 'Expansion bottle'],
    ['fan', 'Cooling fan'], ['firewall', 'Firewall'], ['induction_pipe', 'Induction pipe'], ['engine', 'Engine running'],
  ]},
  { key: 'exterior', title: 'Vehicle exterior', rows: [
    ['body_panels', 'Body panels'], ['crumple_zones', 'Crumple zones', true], ['bumpers', 'Bumpers & fittings'],
    ['door_hinges', 'Door hinges & operation'], ['door_handles', 'Door handles'], ['lid_hinges', 'Lid hinges'],
    ['wipers', 'Wipers', true], ['side_windows', 'Side windows'], ['windscreen', 'Windscreen', true], ['back_window', 'Back window'],
    ['window_rubbers', 'Window rubbers & rails'], ['headlights', 'Headlights', true], ['main_beams', 'Main beams', true],
    ['dim_lights', 'Dim lights', true], ['park_lights', 'Park lights', true], ['fog_lights', 'Fog lights'],
    ['indicators', 'Indicators', true], ['side_repeaters', 'Side repeaters'], ['side_mirrors', 'Side mirrors', true],
    ['tail_lights', 'Rear tail light cluster', true], ['reflectors', 'Reflectors', true], ['brake_lights', 'Brake lights', true],
    ['reverse_lights', 'Reverse lights'], ['plate_lights', 'Number plate lights', true], ['tailgate', 'Tailgate / boot operation'],
  ]},
  { key: 'interior', title: 'Vehicle interior', rows: [
    ['main_key', 'Main key'], ['spare_key', 'Spare key'], ['locking', 'Locking system'], ['steering_lock', 'Steering lock', true],
    ['interior_lights', 'Interior lights'], ['hooter', 'Hooter', true], ['fuel_gauge', 'Fuel gauge'], ['wiper_stalk', 'Wiper stalk'],
    ['washer', 'Windscreen washer'], ['headlight_controls', 'Headlight controls'], ['interior_mirror', 'Interior mirror'],
    ['mirror_adjust', 'Mirror adjustment'], ['instrument_cluster', 'Instrument cluster'],
    ['warning_lights', 'Warning lights / sounds', true], ['audio_nav', 'Audio & navigation'], ['aircon', 'Air conditioning'],
    ['seats', 'Seats'], ['power_windows', 'Power windows'], ['roof_lining', 'Roof / lining'],
    ['seatbelts', 'Seatbelts', true], ['sun_visors', 'Sun visors'], ['pedals', 'Pedal rubbers & function', true],
  ]},
  { key: 'test_drive', title: 'Test drive', rows: [
    ['starting', 'Starting behaviour'], ['idle_speed', 'Idle speed behaviour'], ['braking', 'Braking effect', true],
    ['suspension', 'Suspension'], ['steering', 'Steering', true], ['stability', 'Directional stability'],
    ['handling', 'Road behaviour & handling'], ['performance', 'Vehicle performance'], ['heating', 'Heating & ventilation'],
    ['gear_selection', 'Gear selection'], ['instrument_panel', 'Instrument panel'], ['noises', 'Noises / vibration'],
  ]},
  { key: 'wheels', title: 'Wheels', rows: [
    ['wheel_nuts', 'Wheel nuts', true],
    ['fl_rim', 'Front left rim'], ['fr_rim', 'Front right rim'], ['rl_rim', 'Rear left rim'], ['rr_rim', 'Rear right rim'],
    ['fl_tyre', 'Front left tyre', true], ['fr_tyre', 'Front right tyre', true],
    ['rl_tyre', 'Rear left tyre', true], ['rr_tyre', 'Rear right tyre', true],
  ]},
]

export const TYRE_POSITIONS = ['Front Left', 'Front Right', 'Rear Left', 'Rear Right', 'Spare']

// Measured tests: which positions exist, and the result strings ReportView colours by.
export const TEST_POSITIONS: Record<'brake' | 'shock' | 'slip', string[]> = {
  brake: ['Front Axle', 'Rear Axle', 'Parking Brake'],
  shock: ['Front Axle', 'Rear Axle'],
  slip: ['Front Axle', 'Rear Axle'],
}

export function testResult(test: 'brake' | 'shock' | 'slip', right: number, left: number): { diff_pct: number | null; result: string } {
  if (test === 'slip') return { diff_pct: null, result: Math.abs(right) > LIMITS.slipMaxMPerKm ? 'Out of range' : 'Ok' }
  const d = diffPct(right, left)
  if (test === 'brake') return { diff_pct: d, result: d > LIMITS.brakeImbalancePct ? 'Failed' : 'Passed' }
  return { diff_pct: d, result: d > LIMITS.shockImbalancePct ? 'Imbalance' : 'Normal' }
}

// ---- data shapes (match supabase/report_schema.sql) ----
export interface ReportItem { section: string; component: string; condition: Condition; explanation?: string | null; roadworthy_relevant?: boolean }
export interface Measurement { test: 'brake' | 'shock' | 'slip'; position: string; right_value: number | null; left_value: number | null; diff_pct: number | null; result: string | null }
export interface Tyre { position: string; size?: string; load_speed?: string; make?: string; model?: string; tyre_type?: string; tread_mm?: number | null }
export interface ReportPhoto { section: string; url: string; caption?: string }

export const diffPct = (r: number, l: number) => {
  const hi = Math.max(r, l)
  return hi === 0 ? 0 : Math.round((Math.abs(r - l) / hi) * 1000) / 10
}

export const rowDefaults = (): ReportItem[] =>
  CHECKLIST.flatMap(s => s.rows.map(([key, , rw]) => ({
    section: s.key, component: key, condition: 'good' as Condition, explanation: '', roadworthy_relevant: !!rw,
  })))

export const labelFor = (section: string, component: string) =>
  CHECKLIST.find(s => s.key === section)?.rows.find(r => r[0] === component)?.[1] ?? component

// ---- evaluation ----
export interface Verdict { roadworthy: 'pass' | 'fail'; faults: string[]; warnings: string[] }

export function evaluate(items: ReportItem[], tests: Measurement[], tyres: Tyre[]): Verdict {
  const faults: string[] = [], warnings: string[] = []
  for (const i of items) {
    const name = labelFor(i.section, i.component)
    if (i.condition === 'poor') (i.roadworthy_relevant ? faults : warnings).push(`${name}: ${i.explanation || 'poor condition'}`)
    else if (i.condition === 'fair' && i.roadworthy_relevant) warnings.push(`${name}: ${i.explanation || 'fair condition'}`)
  }
  for (const t of tests) {
    const d = t.diff_pct ?? 0
    if (t.test === 'brake' && t.position !== 'Parking Brake' && d > LIMITS.brakeImbalancePct) faults.push(`Brake imbalance on ${t.position} (${d}%)`)
    if (t.test === 'brake' && t.position === 'Parking Brake' && d > LIMITS.brakeImbalancePct) warnings.push(`Parking brake imbalance (${d}%)`)
    if (t.test === 'shock' && d > LIMITS.shockImbalancePct) warnings.push(`Shock damping imbalance on ${t.position} (${d}%)`)
    if (t.test === 'slip' && Math.abs(t.right_value ?? 0) > LIMITS.slipMaxMPerKm) warnings.push(`Wheel alignment out of range on ${t.position}`)
  }
  for (const ty of tyres) {
    if (ty.tread_mm == null || ty.position === 'Spare') continue
    if (ty.tread_mm < LIMITS.treadMinMm) faults.push(`${ty.position} tyre below legal tread (${ty.tread_mm} mm)`)
    else if (ty.tread_mm < LIMITS.treadWarnMm) warnings.push(`${ty.position} tyre tread low (${ty.tread_mm} mm)`)
  }
  return { roadworthy: faults.length ? 'fail' : 'pass', faults, warnings }
}

export function summariseSection(sectionKey: string, items: ReportItem[]): string {
  const rows = items.filter(i => i.section === sectionKey && i.condition !== 'na')
  if (!rows.length) return 'No items were checked in this section.'
  const count = (c: Condition) => rows.filter(r => r.condition === c).length
  const bad = rows.filter(r => r.condition === 'fair' || r.condition === 'poor')
  let s = `${rows.length} items checked: ${count('good')} good, ${count('as_expected')} as expected`
  if (count('fair')) s += `, ${count('fair')} fair`
  if (count('poor')) s += `, ${count('poor')} poor`
  s += '.'
  s += bad.length
    ? ' Attention: ' + bad.map(b => `${labelFor(b.section, b.component)}${b.explanation ? ` (${b.explanation})` : ''}`).join('; ') + '.'
    : ' No faults found.'
  return s
}
