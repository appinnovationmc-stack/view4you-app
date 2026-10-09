// Typed Supabase data-access layer for LemonCheck.
// Every screen calls into this module instead of touching `supabase` directly,
// so the query shape lives in one place and matches supabase/schema.sql.

import { supabase } from './supabase'
import type {
  Profile, Vehicle, VehicleHistory, VehicleAccident, OdometerReading,
  Booking, Inspection, InspectionFinding, ReportPurchase, AppNotification,
  UserRole, FindingStatus,
} from '../types'
import { evaluate, type Measurement, type ReportItem, type ReportPhoto, type Tyre } from './reportTemplate'
import { deriveFindings, scoreFromFindings, buildVerdictText } from './reportMapping'
import type { ReportViewProps } from '../ReportView'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function signUp(params: {
  email: string; password: string; role: UserRole; name: string
}) {
  const { email, password, role, name } = params
  const first_name = name.trim().split(/\s+/)[0] || name
  const init = name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'U'

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { role, name, first_name, init } },
  })
  if (error) throw error
  const user = data.user
  if (!user) throw new Error('Sign up did not return a user.')

  // The database trigger creates the profile even when email confirmation is enabled
  // and Supabase returns no session. If a session exists, upsert keeps the profile
  // synchronized without relying on client-side INSERT permission.
  if (data.session) {
    const { error: profileErr } = await supabase.from('profiles').upsert({
      id: user.id, role, name, first_name, init, email,
    }, { onConflict: 'id' })
    if (profileErr) throw profileErr
    return fetchProfile(user.id)
  }

  throw new Error('Account created. Check your email to confirm the account, then sign in.')
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (!data.user) throw new Error('Sign in failed')
  return fetchProfile(data.user.id)
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return fetchProfile(user.id)
}

export async function fetchProfile(id: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single()
  if (error) throw error
  return data as Profile
}

export async function setOnlineStatus(inspectorId: string, online: boolean) {
  const { error } = await supabase.from('profiles').update({ online }).eq('id', inspectorId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Vehicles + history (Search screen)
// ---------------------------------------------------------------------------

export async function fetchVehicleWithLatestInspection(vin: string): Promise<{
  vehicle: Vehicle
  inspection: (Inspection & { findings: InspectionFinding[]; inspector_name: string }) | null
} | null> {
  const { data: vehicle, error } = await supabase.from('vehicles').select('*').eq('vin', vin).maybeSingle()
  if (error) throw error
  if (!vehicle) return null

  const { data: inspections, error: insErr } = await supabase
    .from('inspections')
    .select('*, inspection_findings(*), profiles!inspections_inspector_id_fkey(name)')
    .eq('vin', vin)
    .order('created_at', { ascending: false })
    .limit(1)
  if (insErr) throw insErr

  const row = inspections?.[0] as (Inspection & {
    inspection_findings: InspectionFinding[]
    profiles: { name: string } | null
  }) | undefined

  return {
    vehicle: vehicle as Vehicle,
    inspection: row
      ? { ...row, findings: row.inspection_findings, inspector_name: row.profiles?.name ?? 'Inspector' }
      : null,
  }
}

export async function fetchVehicleHistory(vin: string): Promise<{
  history: VehicleHistory | null
  accidents: VehicleAccident[]
  odometer: OdometerReading[]
}> {
  const [{ data: history }, { data: accidents }, { data: odometer }] = await Promise.all([
    supabase.from('vehicle_history').select('*').eq('vin', vin).maybeSingle(),
    supabase.from('vehicle_accidents').select('*').eq('vin', vin).order('date'),
    supabase.from('vehicle_odometer_readings').select('*').eq('vin', vin).order('date', { ascending: false }),
  ])
  return {
    history: (history as VehicleHistory) ?? null,
    accidents: (accidents as VehicleAccident[]) ?? [],
    odometer: (odometer as OdometerReading[]) ?? [],
  }
}

export async function fetchMyVehicles(buyerId: string): Promise<
  (Vehicle & { latestScore: number | null })[]
> {
  const { data: vehicles, error } = await supabase
    .from('vehicles').select('*').eq('first_tracked_by', buyerId)
  if (error) throw error
  const withScores = await Promise.all((vehicles ?? []).map(async (v) => {
    const { data: insp } = await supabase
      .from('inspections').select('score').eq('vin', v.vin)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    return { ...v, latestScore: insp?.score ?? null } as Vehicle & { latestScore: number | null }
  }))
  return withScores
}

export async function ensureVehicleTracked(vin: string, buyerId: string) {
  await supabase.from('vehicles')
    .update({ first_tracked_by: buyerId })
    .eq('vin', vin)
    .is('first_tracked_by', null)
}

// ---------------------------------------------------------------------------
// Inspectors + booking (Book screen)
// ---------------------------------------------------------------------------

export async function fetchOnlineInspectors(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles').select('*').eq('role', 'inspector').eq('online', true)
    .order('eta_minutes', { ascending: true })
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function fetchOfflineInspectors(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles').select('*').eq('role', 'inspector').eq('online', false)
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function createBooking(params: {
  buyerId: string; vin: string; make: string; model: string; year: number
  location: string; notes: string; inspectorId: string; inspectionFee: number
}): Promise<Booking> {
  const { buyerId, vin, make, model, year, location, notes, inspectorId, inspectionFee } = params

  await supabase.from('vehicles').upsert(
    { vin, make, model, year, first_tracked_by: buyerId },
    { onConflict: 'vin', ignoreDuplicates: false },
  )
  await ensureVehicleTracked(vin, buyerId)

  const { data, error } = await supabase.from('bookings').insert({
    buyer_id: buyerId, vin, location, notes,
    inspector_id: inspectorId, status: 'pending',
    inspection_fee: inspectionFee,
  }).select().single()
  if (error) throw error
  return data as Booking
}

export async function acceptBooking(bookingId: string, inspectorId: string): Promise<void> {
  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', bookingId)
    .eq('inspector_id', inspectorId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('This inspection request is no longer available.')
}

export async function declineBooking(bookingId: string, inspectorId: string): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ status: 'declined' })
    .eq('id', bookingId)
    .eq('inspector_id', inspectorId)
    .eq('status', 'pending')
  if (error) throw error
}

export async function markBookingPaid(bookingId: string) {
  const { error } = await supabase.from('bookings').update({ paid: true }).eq('id', bookingId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Inspector jobs
// ---------------------------------------------------------------------------

export interface JobRow extends Booking {
  vehicle: Vehicle
  buyer_name: string
}

export async function fetchInspectorJobs(inspectorId: string): Promise<JobRow[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*, vehicles(*), profiles!bookings_buyer_id_fkey(name)')
    .eq('inspector_id', inspectorId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: unknown) => {
    const r = row as Booking & { vehicles: Vehicle; profiles: { name: string } | null }
    return { ...r, vehicle: r.vehicles, buyer_name: r.profiles?.name ?? 'Customer' } as JobRow
  })
}

export async function submitInspection(params: {
  bookingId: string; vin: string; inspectorId: string
  findings: Record<string, FindingStatus>
  notes: Record<string, string>
  score: number
  fullPrice: number
}): Promise<Inspection> {
  const { bookingId, vin, inspectorId, findings, notes, score, fullPrice } = params
  const reportPrice = Math.round(fullPrice * 0.18)   // resale price, matches R349-on-R1950 ratio from the design
  const payerCut = Math.round(reportPrice * 0.515)   // ~R180 on a R349 resale, per the approved copy
  const inspectorCut = reportPrice - payerCut

  const { data: inspection, error } = await supabase.from('inspections').insert({
    booking_id: bookingId, vin, inspector_id: inspectorId, score,
    verdict: buildVerdict(score, findings),
    full_price: fullPrice, report_price: reportPrice,
    payer_cut: payerCut, inspector_cut: inspectorCut,
  }).select().single()
  if (error) throw error

  const findingRows = Object.entries(findings).map(([area, status]) => ({
    inspection_id: inspection.id, area, status, note: notes[area] || null,
  }))
  const { error: findErr } = await supabase.from('inspection_findings').insert(findingRows)
  if (findErr) throw findErr

  await supabase.from('bookings').update({
    status: 'done', completed_at: new Date().toISOString(),
  }).eq('id', bookingId)

  // Best-effort: bump the inspector's completed-jobs counter.
  await supabase.rpc('increment_jobs_completed', { p_inspector_id: inspectorId })

  return inspection as Inspection
}

// ---------------------------------------------------------------------------
// Detailed report (checklist, measured tests, tyres, photos)
// ---------------------------------------------------------------------------

export interface DetailedSubmission {
  bookingId: string
  odometerKm: number
  items: ReportItem[]
  measurements: Measurement[]
  tyres: Tyre[]
}

export interface SubmittedReport {
  inspectionId: string
  reportNumber: string
  score: number
  roadworthy: 'pass' | 'fail'
}

/**
 * Saves the whole report in one database transaction (submit_detailed_report).
 * Score, area findings, verdict and roadworthy pass/fail are all derived here from the
 * raw data, so the stored summary can never disagree with the stored checklist.
 */
export async function submitDetailedReport(p: DetailedSubmission): Promise<SubmittedReport> {
  const verdict = evaluate(p.items, p.measurements, p.tyres)
  const findings = deriveFindings(p.items, p.measurements, p.tyres)
  const score = scoreFromFindings(findings)

  const { data, error } = await supabase.rpc('submit_detailed_report', {
    p_booking_id: p.bookingId,
    p_score: score,
    p_verdict: buildVerdictText(score, findings, verdict.roadworthy),
    p_odometer_km: Math.round(p.odometerKm),
    p_roadworthy: verdict.roadworthy,
    p_faults: verdict.faults,
    p_warnings: verdict.warnings,
    p_findings: findings,
    p_items: p.items.map(i => ({
      section: i.section, component: i.component, condition: i.condition,
      explanation: i.explanation?.trim() || null, roadworthy_relevant: !!i.roadworthy_relevant,
    })),
    p_measurements: p.measurements,
    p_tyres: p.tyres,
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as { inspection_id: string; report_number: string } | undefined
  if (!row) throw new Error('Report was not saved (no row returned)')
  return { inspectionId: row.inspection_id, reportNumber: row.report_number, score, roadworthy: verdict.roadworthy }
}

export interface PhotoUpload { section: string; blob: Blob; caption?: string }

/**
 * Uploads photos to the private report-photos bucket (<inspection_id>/<file>) and records them.
 * Runs after the report is saved; a failure here never loses the report. Returns what failed
 * so the caller can offer a retry.
 */
export async function uploadReportPhotos(inspectionId: string, photos: PhotoUpload[]): Promise<{ uploaded: number; failed: PhotoUpload[] }> {
  const failed: PhotoUpload[] = []
  const stored: { photo: PhotoUpload; path: string }[] = []
  const stamp = Date.now()

  let next = 0
  const worker = async () => {
    while (next < photos.length) {
      const idx = next++
      const ph = photos[idx]
      const path = `${inspectionId}/${ph.section}-${stamp}-${idx}.jpg`
      const { error } = await supabase.storage.from('report-photos').upload(path, ph.blob, { contentType: 'image/jpeg', upsert: false })
      if (error) failed.push(ph)
      else stored.push({ photo: ph, path })
    }
  }
  await Promise.all([worker(), worker(), worker()])

  if (!stored.length) return { uploaded: 0, failed }

  // Keep the on-screen order within each section.
  const order = (s: { photo: PhotoUpload }) => photos.indexOf(s.photo)
  stored.sort((a, b) => order(a) - order(b))
  const perSection = new Map<string, number>()
  const rows = stored.map(s => {
    const sort = perSection.get(s.photo.section) ?? 0
    perSection.set(s.photo.section, sort + 1)
    return { inspection_id: inspectionId, section: s.photo.section, storage_path: s.path, caption: s.photo.caption ?? null, sort }
  })
  const { error } = await supabase.from('report_photos').insert(rows)
  if (error) {
    // Files are in storage but not recorded against the report. Hand them all back as failed so a retry
    // re-uploads and records them (the orphaned files are small and sit in the private bucket).
    return { uploaded: 0, failed: [...failed, ...stored.map(s => s.photo)] }
  }
  return { uploaded: rows.length, failed }
}

/** Loads a full detailed report for ReportView. Photos come back as short-lived signed URLs. */
export async function fetchDetailedReport(inspectionId: string): Promise<ReportViewProps | null> {
  const { data: insp, error } = await supabase
    .from('inspections')
    .select('*, profiles!inspections_inspector_id_fkey(name), vehicles(*)')
    .eq('id', inspectionId).maybeSingle()
  if (error) throw error
  if (!insp) return null

  const [items, meas, tyres, photos] = await Promise.all([
    supabase.from('report_items').select('*').eq('inspection_id', inspectionId),
    supabase.from('report_measurements').select('*').eq('inspection_id', inspectionId),
    supabase.from('report_tyres').select('*').eq('inspection_id', inspectionId),
    supabase.from('report_photos').select('*').eq('inspection_id', inspectionId).order('sort'),
  ])
  for (const r of [items, meas, tyres, photos]) if (r.error) throw r.error

  const photoRows = (photos.data ?? []) as { section: string; storage_path: string; caption: string | null }[]
  const signed = photoRows.length
    ? await supabase.storage.from('report-photos').createSignedUrls(photoRows.map(p => p.storage_path), 3600)
    : { data: [], error: null }
  const urlFor = new Map((signed.data ?? []).map(s => [s.path, s.signedUrl] as const))
  const reportPhotos: ReportPhoto[] = photoRows
    .filter(p => urlFor.get(p.storage_path))
    .map(p => ({ section: p.section, url: urlFor.get(p.storage_path)!, caption: p.caption ?? undefined }))

  const v = (insp as { vehicles: Vehicle | null }).vehicles
  const inspector = (insp as { profiles: { name: string } | null }).profiles
  return {
    reportNumber: insp.report_number ?? insp.id.slice(0, 8).toUpperCase(),
    vehicle: {
      make: v?.make, model: v?.model, year: v?.year, vin: insp.vin,
      odometer_km: insp.odometer_km ?? undefined,
      colour: v?.colour ?? undefined, transmission: v?.transmission ?? undefined,
    },
    items: (items.data ?? []) as ReportItem[],
    measurements: (meas.data ?? []) as Measurement[],
    tyres: (tyres.data ?? []) as Tyre[],
    photos: reportPhotos,
    inspectorName: inspector?.name,
    inspectedAt: new Date(insp.submitted_at ?? insp.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }),
  }
}

function buildVerdict(score: number, findings: Record<string, FindingStatus>): string {
  const warns = Object.entries(findings).filter(([, s]) => s === 'warn').map(([a]) => a)
  const fails = Object.entries(findings).filter(([, s]) => s === 'fail').map(([a]) => a)
  if (fails.length) return `Below-average condition. Fail on ${fails.join(', ')} — recommend further diagnosis before purchase.`
  if (warns.length) return `${score >= 80 ? 'Above-average' : 'Fair'} condition for its age and mileage. Advisory on ${warns.join(', ')} should be actioned soon. Recommend purchase with negotiation.`
  return 'Above-average condition. No material issues found. Recommend purchase.'
}

// ---------------------------------------------------------------------------
// Report purchases (resale / passive income)
// ---------------------------------------------------------------------------

export async function purchaseReport(inspectionId: string, _buyerId?: string): Promise<{ order_id: string; amount: number; action: string; fields: Record<string,string> }> {
  const { data: session } = await supabase.auth.getSession()
  if (!session.session?.access_token) throw new Error('Please sign in again.')

  const { data, error } = await supabase.functions.invoke('create-report-payment', {
    body: { inspection_id: inspectionId },
  })
  if (error) throw error
  if (!data?.order_id || !data?.action || !data?.fields) throw new Error(data?.error ?? 'Payment could not be started')
  return data
}

export async function fetchBuyerEarnings(buyerId: string) {
  const { data, error } = await supabase
    .from('report_purchases')
    .select('*, inspections!inner(vin, vehicles!inner(make, model, first_tracked_by))')
    .eq('inspections.vehicles.first_tracked_by', buyerId)
    .order('purchased_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Array<ReportPurchase & {
    inspections: { vin: string; vehicles: { make: string; model: string } }
  }>
}

export async function fetchInspectorEarnings(inspectorId: string) {
  const { data, error } = await supabase
    .from('report_purchases')
    .select('*, inspections!inner(inspector_id)')
    .eq('inspections.inspector_id', inspectorId)
    .order('purchased_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Array<ReportPurchase & { inspections: { inspector_id: string } }>
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function fetchNotifications(userId: string): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as AppNotification[]
}

export async function markAllNotificationsRead(userId: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
  if (error) throw error
}
