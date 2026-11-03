// Plain-language summary of a detailed report: a three-level verdict and issue cards sorted by urgency.
// Pure functions over the same data ReportView already has; nothing here is stored or invented. Anything not
// inspected is reported as "not inspected", never as a pass. Repair costs come later from a maintained price table.

import { LIMITS, labelFor, type Condition, type Measurement, type ReportItem, type Section, type Tyre } from './reportTemplate'

export type Urgency = 'now' | 'soon' | 'watch'
export type VerdictLevel = 'good' | 'negotiate' | 'avoid'

export interface RepairEstimate { key: string; label: string; low: number | null; high: number | null; premium_factor: number }
export interface Cost { low: number; high: number; label: string }

const PREMIUM_MAKES = ['bmw', 'mercedes', 'audi', 'volvo', 'land rover', 'range rover', 'jaguar', 'porsche', 'lexus', 'mini', 'alfa']
export const isPremiumMake = (make?: string | null) => !!make && PREMIUM_MAKES.some(m => make.toLowerCase().includes(m))
const round50 = (n: number) => Math.round(n / 50) * 50

export interface Issue {
  key: string
  urgency: Urgency
  title: string        // plain name, e.g. "Front brake pads"
  state: string        // "In poor condition" / "Showing wear"
  why: string          // why it matters, in plain language
  note?: string        // the inspector's own words, or a measured fact when fact is true
  fact?: boolean
  cost?: Cost          // estimated repair range in rand
  quote?: boolean      // no price on file: a mechanic quote is needed
  costGroup?: string   // issues that are the same repair (e.g. one tyre) are only counted once in the total
}
export interface Summary {
  level: VerdictLevel
  headline: string
  reason: string
  issues: Issue[]
  counts: { now: number; soon: number; watch: number; ok: number }
  notInspectedSafety: number
  total?: { low: number; high: number }  // fix now + fix soon, priced items only
  quotesNeeded: number
}

const SECTION_WHY: Record<string, string> = {
  drive_system: 'This sits under the car and affects how it drives, steers or stops.',
  engine: 'This is part of keeping the engine running and cool.',
  exterior: 'This affects how safe and visible the car is on the road.',
  interior: 'This affects the controls and safety equipment you use every day.',
  test_drive: 'This was noticed while driving the car, so you would feel it too.',
  wheels: 'Wheels and tyres are the only part of the car touching the road.',
}

// Plain explanations for the items buyers ask about most. Anything else falls back to its section's sentence.
const WHY: Record<string, string> = {
  'drive_system.brake_lines': 'A leaking or damaged brake line can cause the brakes to fail suddenly.',
  'drive_system.brake_calipers': 'Calipers squeeze the pads against the disc. A faulty one gives weaker or uneven braking.',
  'drive_system.handbrake': 'The hand brake holds the car on a hill and is part of the roadworthy test.',
  'drive_system.steering_rack': 'Wear here makes steering loose or vague and is a roadworthy failure.',
  'drive_system.tie_rods': 'Tie rods connect the steering to the wheels. When worn, steering feels loose and tyres wear unevenly.',
  'drive_system.ball_joint': 'Worn ball joints cause clunks and uneven tyre wear, and can fail while driving.',
  'drive_system.wheel_bearings': 'A worn bearing hums or grinds and can eventually let the wheel wobble.',
  'drive_system.shocks': 'Weak shock absorbers make the car bounce, lengthen braking distance and wear tyres.',
  'drive_system.chassis': 'The chassis is the car\'s structure. Damage or rust here is serious and costly.',
  'drive_system.exhaust': 'A leaking exhaust is noisy, can let fumes in and fails roadworthy.',
  'drive_system.smoke_emission': 'Visible smoke points to engine wear or a fault, and can fail roadworthy.',
  'drive_system.fuel_system': 'Fuel leaks are a fire risk and fail roadworthy.',
  'drive_system.gearbox': 'Gearbox problems are among the most expensive repairs on a car.',
  'drive_system.cv_joints': 'A worn CV joint clicks when turning and will eventually fail.',
  'drive_system.engine_mountings': 'Worn mountings cause vibration and can stress other parts.',
  'drive_system.radiator': 'Cooling problems can lead to an overheated, damaged engine.',
  'drive_system.coolant_hoses': 'A split hose can leak coolant and overheat the engine.',
  'drive_system.underbody': 'Rust or damage underneath can hide accident or flood history.',
  'engine.brake_fluid': 'Old or low brake fluid makes the brakes feel soft and less reliable.',
  'engine.belts': 'A snapped belt can stop the car or damage the engine.',
  'engine.battery': 'A weak battery means hard starts and a likely replacement soon.',
  'engine.alternator': 'The alternator charges the battery. If it fails, the car will stop.',
  'engine.oil': 'Low or dirty oil wears the engine faster.',
  'engine.coolant': 'Low coolant can cause overheating.',
  'engine.engine': 'This is how the engine ran during the inspection.',
  'exterior.crumple_zones': 'Repaired or damaged crumple zones suggest a past accident and affect crash safety.',
  'exterior.body_panels': 'Dents, rust or mismatched paint can point to past accident repairs.',
  'exterior.windscreen': 'A cracked windscreen is a safety issue and fails roadworthy.',
  'exterior.wipers': 'Worn wipers reduce visibility in rain and fail roadworthy.',
  'exterior.headlights': 'Faulty headlights make night driving unsafe and fail roadworthy.',
  'exterior.main_beams': 'Main beams are needed for dark roads and are a roadworthy item.',
  'exterior.brake_lights': 'Without working brake lights, drivers behind can\'t see you stopping.',
  'exterior.indicators': 'Faulty indicators are unsafe and a roadworthy failure.',
  'exterior.side_mirrors': 'Missing or cracked mirrors reduce visibility and fail roadworthy.',
  'interior.seatbelts': 'Seatbelts are essential for crash protection and are a roadworthy item.',
  'interior.warning_lights': 'A dashboard warning light means the car has detected a fault.',
  'interior.pedals': 'Worn pedals can slip and affect how you control the car.',
  'interior.aircon': 'Aircon repairs vary from a regas to an expensive compressor.',
  'interior.hooter': 'A working hooter is a legal requirement.',
  'test_drive.braking': 'The car did not stop as well as it should during the test drive.',
  'test_drive.steering': 'Steering problems were felt while driving.',
  'test_drive.noises': 'Unusual noises or vibration while driving usually point to a worn part.',
  'test_drive.gear_selection': 'Hard or notchy gear changes suggest gearbox or clutch wear.',
  'test_drive.performance': 'The car did not pull as strongly as it should.',
  'wheels.fl_tyre': 'Worn or damaged tyres reduce grip and are a roadworthy item.',
  'wheels.fr_tyre': 'Worn or damaged tyres reduce grip and are a roadworthy item.',
  'wheels.rl_tyre': 'Worn or damaged tyres reduce grip and are a roadworthy item.',
  'wheels.rr_tyre': 'Worn or damaged tyres reduce grip and are a roadworthy item.',
  'wheels.wheel_nuts': 'Loose or missing wheel nuts can let a wheel come off.',
}

const STATE: Partial<Record<Condition, string>> = { poor: 'In poor condition', fair: 'Showing wear' }

const urgencyOf = (i: ReportItem): Urgency | null => {
  if (i.condition === 'poor') return i.roadworthy_relevant ? 'now' : 'soon'
  if (i.condition === 'fair') return i.roadworthy_relevant ? 'soon' : 'watch'
  return null
}

export function plainWhy(section: string, component: string): string {
  return WHY[`${section}.${component}`] ?? SECTION_WHY[section] ?? 'This was flagged by the inspector.'
}

const TYRE_ITEM_POS: Record<string, string> = { fl_tyre: 'Front Left', fr_tyre: 'Front Right', rl_tyre: 'Rear Left', rr_tyre: 'Rear Right' }

export function buildSummary(items: ReportItem[], tests: Measurement[], tyres: Tyre[], checklist: Section[], est?: { rows: RepairEstimate[]; make?: string | null }): Summary {
  const issues: Issue[] = []
  let ok = 0

  for (const i of items) {
    const u = urgencyOf(i)
    if (!u) { if (i.condition === 'good' || i.condition === 'as_expected') ok++; continue }
    issues.push({
      key: `${i.section}.${i.component}`, urgency: u, title: labelFor(i.section, i.component),
      state: STATE[i.condition] ?? 'Needs a look', why: plainWhy(i.section, i.component), note: i.explanation?.trim() || undefined,
    })
  }

  for (const t of tests) {
    const d = t.diff_pct ?? 0
    if (t.test === 'brake' && d > LIMITS.brakeImbalancePct) {
      const park = t.position === 'Parking Brake'
      issues.push({ key: `brake.${t.position}`, urgency: park ? 'soon' : 'now', title: `${t.position} brakes`,
        state: 'Braking is uneven side to side', why: 'When one side brakes harder than the other, the car can pull to one side when stopping.',
        note: `Left and right differ by ${d}% on the brake test.`, fact: true })
    } else if (t.test === 'shock' && d > LIMITS.shockImbalancePct) {
      issues.push({ key: `shock.${t.position}`, urgency: 'soon', title: `${t.position} shock absorbers`,
        state: 'Weaker on one side', why: 'Uneven shock absorbers make the car bounce, lengthen braking distance and wear tyres.',
        note: `Left and right differ by ${d}% on the shock test.`, fact: true })
    } else if (t.test === 'slip' && Math.abs(t.right_value ?? 0) > LIMITS.slipMaxMPerKm) {
      issues.push({ key: `slip.${t.position}`, urgency: 'soon', title: `${t.position} wheel alignment`,
        state: 'Out of line', why: 'Poor alignment wears tyres quickly and can make the car pull to one side.' })
    } else if (t.result) ok++
  }

  for (const ty of tyres) {
    if (ty.tread_mm == null || ty.position === 'Spare') continue
    if (ty.tread_mm < LIMITS.treadMinMm) {
      issues.push({ key: `tyre.${ty.position}`, urgency: 'now', title: `${ty.position} tyre`, state: 'Below the legal tread depth',
        why: 'Tyres this worn grip poorly, especially in the wet, and fail roadworthy.', note: `${ty.tread_mm} mm tread left.`, fact: true })
    } else if (ty.tread_mm < LIMITS.treadWarnMm) {
      issues.push({ key: `tyre.${ty.position}`, urgency: 'soon', title: `${ty.position} tyre`, state: 'Tread is getting low',
        why: 'The tyre will need replacing soon.', note: `${ty.tread_mm} mm tread left.`, fact: true })
    }
  }

  const rows = new Map((est?.rows ?? []).map(r => [r.key, r] as const))
  const premium = isPremiumMake(est?.make)
  const price = (i: Issue, key: string, group?: string) => {
    const r = rows.get(key)
    if (!r) { i.quote = true; return }
    if (r.low == null || r.high == null) { i.quote = true; return }
    const f = premium ? r.premium_factor : 1
    i.cost = { low: round50(r.low * f), high: round50(r.high * f), label: r.label }
    if (group) i.costGroup = group
  }
  for (const i of issues) {
    if (i.key.startsWith('tyre.')) price(i, 'tyre.replace', i.key)
    else if (i.key.startsWith('brake.')) price(i, 'test.brake', i.key)
    else if (i.key.startsWith('shock.')) price(i, 'test.shock', i.key)
    else if (i.key.startsWith('slip.')) price(i, 'test.slip', i.key)
    else if (i.key.startsWith('wheels.') && TYRE_ITEM_POS[i.key.slice(7)]) price(i, 'tyre.replace', `tyre.${TYRE_ITEM_POS[i.key.slice(7)]}`)
    else price(i, i.key)
  }

  const rank: Record<Urgency, number> = { now: 0, soon: 1, watch: 2 }
  issues.sort((a, b) => rank[a.urgency] - rank[b.urgency])
  const counts = { now: 0, soon: 0, watch: 0, ok }
  issues.forEach(i => counts[i.urgency]++)

  const seen = new Set(items.map(i => `${i.section}.${i.component}`))
  const notInspectedSafety = checklist.reduce((n, s) => n + s.rows.filter(([k, , rw]) => {
    if (!rw) return false
    const it = items.find(i => `${i.section}.${i.component}` === `${s.key}.${k}`)
    return !seen.has(`${s.key}.${k}`) || it?.condition === 'na'
  }).length, 0)

  let level: VerdictLevel, headline: string, reason: string
  if (counts.now >= 3) {
    level = 'avoid'; headline = 'Not recommended as it stands'
    reason = `${counts.now} safety-related problems were found. Only consider it if the price reflects the repairs.`
  } else if (counts.now + counts.soon > 0) {
    level = 'negotiate'; headline = 'Decent car, but negotiate the price'
    const n = counts.now + counts.soon
    reason = `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention. Use them to ask for a lower price or repairs before you buy.`
  } else {
    level = 'good'; headline = 'Good buy'
    reason = counts.watch ? `No safety problems found. ${counts.watch} small thing${counts.watch === 1 ? '' : 's'} to keep an eye on.` : 'No problems were found in what was inspected.'
  }
  const seenGroup = new Set<string>()
  let lo = 0, hi = 0, priced = 0, quotesNeeded = 0
  for (const i of issues) {
    if (i.urgency === 'watch') continue
    if (i.quote) { quotesNeeded++; continue }
    if (!i.cost) continue
    if (i.costGroup) { if (seenGroup.has(i.costGroup)) continue; seenGroup.add(i.costGroup) }
    lo += i.cost.low; hi += i.cost.high; priced++
  }
  return { level, headline, reason, issues, counts, notInspectedSafety, quotesNeeded, total: priced ? { low: lo, high: hi } : undefined }
}
