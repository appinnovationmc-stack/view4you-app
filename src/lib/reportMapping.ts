// Bridges the detailed checklist (~150 components) to the 12 summary areas the rest of the
// app already understands (inspection_findings, the score ring, the buyer's report cards).

import { CHECKLIST, LIMITS, labelFor, type Measurement, type ReportItem, type Tyre } from './reportTemplate'
import type { FindingStatus } from '../types'

export const AREAS = [
  'Engine', 'Transmission', 'Brakes', 'Tyres', 'Suspension', 'Electricals',
  'Body & Paint', 'Interior', 'Lights', 'Exhaust', 'Battery', 'Charging System',
] as const
export type Area = (typeof AREAS)[number]

// section.component -> area. Every checklist row must appear exactly once (see assertMappingComplete).
const AREA_COMPONENTS: Record<Area, string[]> = {
  Engine: [
    'engine.belts', 'engine.idle', 'engine.coolant', 'engine.oil', 'engine.cables', 'engine.pipes_wiring',
    'engine.oil_cap', 'engine.expansion_bottle', 'engine.fan', 'engine.firewall', 'engine.induction_pipe', 'engine.engine',
    'drive_system.engine_mountings', 'drive_system.fuel_system', 'drive_system.radiator',
    'drive_system.radiator_cradle', 'drive_system.coolant_hoses',
    'test_drive.starting', 'test_drive.idle_speed', 'test_drive.performance', 'test_drive.noises',
  ],
  Transmission: [
    'drive_system.gearbox', 'drive_system.bell_housing', 'drive_system.axles', 'drive_system.cv_joints',
    'drive_system.drive_shaft', 'drive_system.link_rod_covers', 'test_drive.gear_selection',
  ],
  Brakes: [
    'drive_system.brake_lines', 'drive_system.handbrake', 'drive_system.brake_calipers',
    'engine.brake_fluid', 'test_drive.braking', 'interior.pedals',
  ],
  Tyres: [
    'wheels.wheel_nuts', 'wheels.fl_rim', 'wheels.fr_rim', 'wheels.rl_rim', 'wheels.rr_rim',
    'wheels.fl_tyre', 'wheels.fr_tyre', 'wheels.rl_tyre', 'wheels.rr_tyre',
  ],
  Suspension: [
    'drive_system.ball_joint', 'drive_system.subframe', 'drive_system.control_arm', 'drive_system.chassis',
    'drive_system.shock_mounting', 'drive_system.stabilizer', 'drive_system.bushings', 'drive_system.links',
    'drive_system.tie_rods', 'drive_system.wheel_bearings', 'drive_system.shocks', 'drive_system.steering_rack',
    'test_drive.suspension', 'test_drive.steering', 'test_drive.stability', 'test_drive.handling',
  ],
  Electricals: [
    'interior.main_key', 'interior.spare_key', 'interior.locking', 'interior.steering_lock', 'interior.interior_lights',
    'interior.hooter', 'interior.fuel_gauge', 'interior.wiper_stalk', 'interior.washer', 'interior.headlight_controls',
    'interior.mirror_adjust', 'interior.instrument_cluster', 'interior.warning_lights', 'interior.audio_nav',
    'interior.power_windows', 'exterior.wipers', 'test_drive.instrument_panel',
  ],
  'Body & Paint': [
    'exterior.body_panels', 'exterior.crumple_zones', 'exterior.bumpers', 'exterior.door_hinges', 'exterior.door_handles',
    'exterior.lid_hinges', 'exterior.side_windows', 'exterior.windscreen', 'exterior.back_window',
    'exterior.window_rubbers', 'exterior.side_mirrors', 'exterior.tailgate',
    'drive_system.bonnet_cable', 'drive_system.bonnet_stay', 'drive_system.bonnet_hinges', 'drive_system.underbody',
  ],
  Interior: [
    'interior.interior_mirror', 'interior.aircon', 'interior.seats', 'interior.roof_lining',
    'interior.seatbelts', 'interior.sun_visors', 'test_drive.heating',
  ],
  Lights: [
    'exterior.headlights', 'exterior.main_beams', 'exterior.dim_lights', 'exterior.park_lights', 'exterior.fog_lights',
    'exterior.indicators', 'exterior.side_repeaters', 'exterior.tail_lights', 'exterior.reflectors',
    'exterior.brake_lights', 'exterior.reverse_lights', 'exterior.plate_lights',
  ],
  Exhaust: ['drive_system.exhaust', 'drive_system.smoke_emission'],
  Battery: ['engine.battery'],
  'Charging System': ['engine.alternator'],
}

const AREA_OF: Map<string, Area> = new Map(
  (Object.entries(AREA_COMPONENTS) as [Area, string[]][]).flatMap(([area, keys]) => keys.map(k => [k, area] as const)),
)

/** Throws if a checklist row has no area, or an area key points at no checklist row. Run in tests/dev. */
export function assertMappingComplete(): void {
  const all = CHECKLIST.flatMap(s => s.rows.map(r => `${s.key}.${r[0]}`))
  const missing = all.filter(k => !AREA_OF.has(k))
  const mapped = (Object.values(AREA_COMPONENTS) as string[][]).flat()
  const dupes = mapped.filter((k, i) => mapped.indexOf(k) !== i)
  const unknown = mapped.filter(k => !all.includes(k))
  if (missing.length || dupes.length || unknown.length) {
    throw new Error(`Area mapping broken. missing=${missing} dupes=${dupes} unknown=${unknown}`)
  }
}

export const areaOf = (section: string, component: string): Area | undefined => AREA_OF.get(`${section}.${component}`)

export interface AreaFinding { area: Area; status: FindingStatus; note: string }

const rank: Record<FindingStatus, number> = { pass: 0, warn: 1, fail: 2 }

/** Roll the detailed items and measured tests up into the 12 area findings. */
export function deriveFindings(items: ReportItem[], tests: Measurement[], tyres: Tyre[]): AreaFinding[] {
  const status = new Map<Area, FindingStatus>(AREAS.map(a => [a, 'pass']))
  const notes = new Map<Area, string[]>(AREAS.map(a => [a, []]))
  const raise = (area: Area, s: FindingStatus, note?: string) => {
    if (rank[s] > rank[status.get(area)!]) status.set(area, s)
    if (note && s !== 'pass') notes.get(area)!.push(note)
  }

  for (const i of items) {
    const area = areaOf(i.section, i.component)
    if (!area) continue
    const name = labelFor(i.section, i.component)
    const why = i.explanation ? `${name}: ${i.explanation}` : name
    if (i.condition === 'poor') raise(area, i.roadworthy_relevant ? 'fail' : 'warn', why)
    else if (i.condition === 'fair' && i.roadworthy_relevant) raise(area, 'warn', why)
  }
  for (const t of tests) {
    const d = t.diff_pct ?? 0
    if (t.test === 'brake') {
      if (t.position === 'Parking Brake') { if (d > LIMITS.brakeImbalancePct) raise('Brakes', 'warn', `Parking brake imbalance (${d}%)`) }
      else if (d > LIMITS.brakeImbalancePct) raise('Brakes', 'fail', `Brake imbalance on ${t.position} (${d}%)`)
    }
    if (t.test === 'shock' && d > LIMITS.shockImbalancePct) raise('Suspension', 'warn', `Shock damping imbalance on ${t.position} (${d}%)`)
    if (t.test === 'slip' && Math.abs(t.right_value ?? 0) > LIMITS.slipMaxMPerKm) raise('Suspension', 'warn', `Wheel alignment out of range on ${t.position}`)
  }
  for (const ty of tyres) {
    if (ty.tread_mm == null || ty.position === 'Spare') continue
    if (ty.tread_mm < LIMITS.treadMinMm) raise('Tyres', 'fail', `${ty.position} tyre below legal tread (${ty.tread_mm} mm)`)
    else if (ty.tread_mm < LIMITS.treadWarnMm) raise('Tyres', 'warn', `${ty.position} tyre tread low (${ty.tread_mm} mm)`)
  }

  return AREAS.map(area => ({ area, status: status.get(area)!, note: notes.get(area)!.join('; ') }))
}

/** Same formula the old 12-area screen used: pass=10, warn=5, fail=0, scaled to 0-100. */
export function scoreFromFindings(findings: AreaFinding[]): number {
  const pts = findings.reduce((a, f) => a + (f.status === 'pass' ? 10 : f.status === 'warn' ? 5 : 0), 0)
  return Math.round((pts / findings.length) * 10)
}

/** Plain-language verdict stored on the inspection; same wording rules as the legacy buildVerdict. */
export function buildVerdictText(score: number, findings: AreaFinding[], roadworthy: 'pass' | 'fail'): string {
  const warns = findings.filter(f => f.status === 'warn').map(f => f.area)
  const fails = findings.filter(f => f.status === 'fail').map(f => f.area)
  const rw = roadworthy === 'pass' ? '' : ' Roadworthy issues found.'
  if (fails.length) return `Below-average condition. Fail on ${fails.join(', ')} — recommend further diagnosis before purchase.${rw}`
  if (warns.length) return `${score >= 80 ? 'Above-average' : 'Fair'} condition for its age and mileage. Advisory on ${warns.join(', ')} should be actioned soon. Recommend purchase with negotiation.${rw}`
  return 'Above-average condition. No material issues found. Recommend purchase.'
}
