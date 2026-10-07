// Typed Supabase data-access layer for LemonCheck.
// Every screen calls into this module instead of touching `supabase` directly,
// so the query shape lives in one place and matches supabase/schema.sql.

import { supabase } from './supabase'
import type {
  Profile, Vehicle, VehicleHistory, VehicleAccident, OdometerReading,
  Booking, Inspection, InspectionFinding, ReportPurchase, AppNotification,
  UserRole, FindingStatus,
} from '../types'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function signUp(params: {
  email: string; password: string; role: UserRole; name: string
}) {
  const { email, password, role, name } = params
  const first_name = name.trim().split(/\s+/)[0] || name
  const init = name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'U'

  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  const user = data.user
  if (!user) throw new Error('Sign up did not return a user — check your email to confirm, then sign in.')

  const { error: profileErr } = await supabase.from('profiles').insert({
    id: user.id, role, name, first_name, init, email,
  })
  if (profileErr) throw profileErr

  return fetchProfile(user.id)
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
    inspector_id: inspectorId, status: 'accepted',
    inspection_fee: inspectionFee, accepted_at: new Date().toISOString(),
  }).select().single()
  if (error) throw error
  return data as Booking
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

export async function purchaseReport(inspectionId: string, buyerId: string): Promise<ReportPurchase> {
  const { data: inspection, error: insErr } = await supabase
    .from('inspections').select('*').eq('id', inspectionId).single()
  if (insErr) throw insErr

  const { data, error } = await supabase.from('report_purchases').insert({
    inspection_id: inspectionId, buyer_id: buyerId,
    amount_paid: inspection.report_price,
    payer_earning: inspection.payer_cut,
    inspector_earning: inspection.inspector_cut,
  }).select().single()
  if (error) throw error
  return data as ReportPurchase
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
