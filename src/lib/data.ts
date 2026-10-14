// Typed Supabase data-access layer for CheckVertical.
// Every screen calls into this module instead of touching `supabase` directly,
// so the query shape lives in one place and matches supabase/schema.sql.

import { supabase } from './supabase'
import type {
  Profile, Vehicle, VehicleHistory, VehicleAccident, OdometerReading,
  Booking, Inspection, InspectionFinding, ReportPurchase, AppNotification,
  UserRole, FindingStatus, VenueKind, BookingOptions, TestingStation, ReportExtras, RoadworthyCertificate,
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

  // The database trigger (handle_new_user) creates the profile, so the client never writes `profiles` itself.
  // New inspector accounts start unapproved: an operator approves them (docs/RELEASE_CHECKLIST.md).
  if (data.session) return fetchProfile(user.id)

  throw new Error('Account created. Check your email to confirm the account, then sign in.')
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (!data.user) throw new Error('Sign in failed')
  return fetchProfile(data.user.id)
}

export async function signOut() {
  // Local-only sign-out: do not revoke the user's other active sessions/devices.
  await supabase.auth.signOut({ scope: 'local' })
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

/** Goes online/offline. Only approved inspectors can; the database enforces it. */
export async function setOnlineStatus(online: boolean) {
  const { error } = await supabase.rpc('set_online', { p_online: online })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Vehicles + history (Search screen)
// ---------------------------------------------------------------------------

export type ReportPreview = Inspection & {
  findings: InspectionFinding[]
  inspector_name: string
  owned: boolean
}

/**
 * Vehicle row plus the latest report PREVIEW. What a non-purchaser may see (score, price, area pass/warn/fail)
 * is decided by the database (report_preview); notes and the verdict text only come back once the caller owns the report.
 */
export async function fetchVehicleWithLatestInspection(vin: string): Promise<{
  vehicle: Vehicle
  inspection: ReportPreview | null
} | null> {
  const { data: vehicle, error } = await supabase.from('vehicles').select('*').eq('vin', vin).maybeSingle()
  if (error) throw error
  if (!vehicle) return null

  const { data: pv, error: pvErr } = await supabase.rpc('report_preview', { p_vin: vin })
  if (pvErr) throw pvErr
  const p = pv as null | {
    inspection_id: string; report_number: string | null; score: number; full_price: number; report_price: number; payer_cut: number
    inspected_at: string; roadworthy_status: 'pass' | 'fail' | null; inspector_name: string | null
    owned: boolean; verdict: string | null
    areas: { area: string; status: FindingStatus; note: string | null }[]
  }
  if (!p) return { vehicle: vehicle as Vehicle, inspection: null }

  return {
    vehicle: vehicle as Vehicle,
    inspection: {
      id: p.inspection_id, booking_id: '', vin, inspector_id: '', score: p.score, verdict: p.verdict,
      full_price: p.full_price, report_price: p.report_price, payer_cut: p.payer_cut, inspector_cut: 0,
      created_at: p.inspected_at, report_number: p.report_number, roadworthy_status: p.roadworthy_status,
      findings: p.areas.map((a, i) => ({ id: String(i), inspection_id: p.inspection_id, area: a.area, status: a.status, note: a.note })),
      inspector_name: p.inspector_name ?? 'Inspector',
      owned: p.owned,
    },
  }
}

export async function fetchVehicleHistory(vin: string): Promise<{
  history: VehicleHistory | null
  accidents: VehicleAccident[]
  odometer: OdometerReading[]
}> {
  const [historyResult, accidentResult, odometerResult] = await Promise.all([
    supabase.from('vehicle_history').select('*').eq('vin', vin).maybeSingle(),
    supabase.from('vehicle_accidents').select('*').eq('vin', vin).order('date'),
    supabase.from('vehicle_odometer_readings').select('*').eq('vin', vin).order('date', { ascending: false }),
  ])
  // A query/RLS/schema failure must not be presented as a clean history.
  const queryError = historyResult.error ?? accidentResult.error ?? odometerResult.error
  if (queryError) throw new Error(`Vehicle history could not be verified: ${queryError.message}`)
  return {
    history: (historyResult.data as VehicleHistory) ?? null,
    accidents: (accidentResult.data as VehicleAccident[]) ?? [],
    odometer: (odometerResult.data as OdometerReading[]) ?? [],
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

// ---------------------------------------------------------------------------
// Inspectors + booking (Book screen)
// ---------------------------------------------------------------------------

// Public inspector info comes from the inspector_directory view (approved inspectors only; no email/phone).
export async function fetchOnlineInspectors(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('inspector_directory').select('*').eq('online', true)
    .order('eta_minutes', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as Profile[]
}

export async function fetchOfflineInspectors(): Promise<Profile[]> {
  const { data, error } = await supabase.from('inspector_directory').select('*').eq('online', false)
  if (error) throw error
  return (data ?? []) as unknown as Profile[]
}

/**
 * Creates an UNPAID booking. The price is computed by the database from the inspector's profile;
 * the client sends no money values. The booking only reaches the inspector once payment is confirmed by PayFast.
 */
export interface InspectionTier {
  id: string; name: string; buyer_price: number; resale_price: number; sort: number
}

export interface EarnBackProgress { cap: number; earned: number; pending: number; percent: number }
export async function fetchEarnBackProgress(bookingId: string): Promise<EarnBackProgress> {
  const { data, error } = await supabase.rpc('get_earn_back_progress', { p_booking_id: bookingId })
  if (error) throw error
  return data as EarnBackProgress
}

export async function fetchInspectionTiers(): Promise<InspectionTier[]> {
  const { data, error } = await supabase.rpc('list_active_inspection_tiers')
  if (error) throw error
  return (data || []) as InspectionTier[]
}

export async function createBooking(params: {
  vin: string; make: string; model: string; year: number
  location: string; notes: string; inspectorId: string
  venueKind?: VenueKind; venueName?: string; auctionAt?: string | null; lotNumber?: string
  neededBy?: string | null; stationId?: string | null; tierId?: string | null
}): Promise<Booking> {
  const { vin, make, model, year, location, notes, inspectorId } = params
  const args: Record<string, unknown> = {
    p_vin: vin, p_make: make, p_model: model, p_year: year,
    p_location: location, p_notes: notes || null, p_inspector_id: inspectorId,
    p_venue_kind: params.venueKind ?? 'private', p_venue_name: params.venueName || null,
    p_auction_at: params.auctionAt || null, p_lot_number: params.lotNumber || null,
    p_needed_by: params.neededBy || null, p_station_id: params.stationId || null,
  }
  // Only tier-mode requests include the 14th argument; legacy callers retain the old RPC signature.
  if (params.tierId) args.p_tier_id = params.tierId
  const { data, error } = await supabase.rpc('create_booking', args)
  if (error) throw error
  return data as Booking
}

// Fees the server will charge (so the confirm screen never guesses) and the testing-station directory.
export const fetchBookingOptions = () => rpc<BookingOptions>('booking_options')
export const fetchTestingStations = () => rpc<TestingStation[]>('list_testing_stations')

// Report extras: venue, inspector badges and the station certificate (no document, no path).
export const fetchReportExtras = (inspectionId: string) => rpc<ReportExtras>('report_extras', { p_inspection: inspectionId })

// The booking's own certificate (buyer / inspector). Files live in the private roadworthy-certs bucket under <booking id>/.
export const fetchBookingCertificate = async (bookingId: string) =>
  (await rpc<RoadworthyCertificate[]>('booking_certificate', { p_booking: bookingId }))[0] ?? null
export async function submitRoadworthyCertificate(bookingId: string, file: File, f: {
  number: string; result: 'pass' | 'fail'; issuedOn: string; expiresOn: string | null
}): Promise<string> {
  const ext = DOC_TYPES[file.type]
  if (!ext) throw new Error('Upload a PDF, JPG, PNG or WebP file')
  if (file.size > DOC_MAX_BYTES) throw new Error('That file is over 10 MB')
  const path = `${bookingId}/certificate-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('roadworthy-certs').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  return rpc<string>('submit_roadworthy_certificate', {
    p_booking: bookingId, p_path: path, p_number: f.number, p_result: f.result, p_issued_on: f.issuedOn, p_expires_on: f.expiresOn || null,
  })
}
export async function openCertificate(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from('roadworthy-certs').createSignedUrl(path, 120)
  if (error || !data) throw new Error(error?.message ?? 'Could not open the file')
  window.open(data.signedUrl, '_blank', 'noopener')
}

export interface PayfastCheckout { order_ref: string; amount: number; action: string; fields: Record<string, string> }

async function invokePayment(fn: string, body: Record<string, string>): Promise<PayfastCheckout> {
  const { data: session } = await supabase.auth.getSession()
  if (!session.session?.access_token) throw new Error('Please sign in again.')

  let { data, error } = await supabase.functions.invoke(fn, { body })
  // Refresh and retry exactly once for an expired access token. Never create a new booking here;
  // the caller supplies the existing booking/report order id on retry.
  const firstContext = error ? (error as { context?: Response }).context : undefined
  if (error && firstContext?.status === 401) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError || !refreshed.session?.access_token) throw new Error('Your session expired. Please sign in again.')
    ;({ data, error } = await supabase.functions.invoke(fn, { body }))
  }
  if (error) {
    // Edge Function errors carry the JSON body on error.context; surface the server's message when present.
    const ctx = (error as { context?: Response }).context
    const msg = ctx && typeof ctx.json === 'function' ? (await ctx.json().catch(() => null))?.error : null
    throw new Error(msg || error.message || 'Payment could not be started')
  }
  if (!data?.action || !data?.fields) throw new Error(data?.error ?? 'Payment could not be started')
  return data as PayfastCheckout
}

/** Asks the server for a signed PayFast checkout for this booking (amount comes from the database). */
export const startBookingPayment = (bookingId: string) => invokePayment('create-booking-payment', { booking_id: bookingId })

export async function fetchBooking(bookingId: string): Promise<Booking | null> {
  const { data, error } = await supabase.from('bookings').select('*').eq('id', bookingId).maybeSingle()
  if (error) throw error
  return (data as Booking) ?? null
}

export async function cancelBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_booking', { p_booking_id: bookingId })
  if (error) throw error
}

export async function acceptBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_booking', { p_booking_id: bookingId })
  if (error) throw error
}

export async function declineBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_booking', { p_booking_id: bookingId })
  if (error) throw error
}

/** Inspector progress: accepted -> en_route -> in_progress. The database enforces the order. */
export async function advanceBooking(bookingId: string, status: 'en_route' | 'in_progress'): Promise<void> {
  const { error } = await supabase.rpc('advance_booking', { p_booking_id: bookingId, p_status: status })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Inspector jobs
// ---------------------------------------------------------------------------

export interface JobRow extends Omit<Booking, 'buyer_id'> {
  vehicle: Pick<Vehicle, 'make' | 'model' | 'year' | 'colour'>
  buyer_name: string
}

/** The signed-in inspector's own PAID jobs (view inspector_jobs; unpaid bookings are never shown to inspectors). */
export async function fetchInspectorJobs(_inspectorId?: string): Promise<JobRow[]> {
  const { data, error } = await supabase.from('inspector_jobs').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => {
    const { make, model, year, colour, buyer_first_name, ...b } = r as Record<string, any>
    return { ...b, vehicle: { make, model, year, colour }, buyer_name: buyer_first_name ?? 'Customer' } as JobRow
  })
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

// ---------------------------------------------------------------------------
// Report purchases (resale / passive income)
// ---------------------------------------------------------------------------

/** Asks the server for a signed PayFast checkout for this report (price comes from the database). */
export const purchaseReport = (inspectionId: string) => invokePayment('create-report-payment', { inspection_id: inspectionId })

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

// ---------------------------------------------------------------------------
// Earnings ledger, bank details and withdrawals (db: 20261012000200)
// ---------------------------------------------------------------------------

export interface LedgerEntry { id: number; kind: string; amount: number; note: string | null; created_at: string }
export interface MyEarnings { balance: number; pending_withdrawal: number; available: number; min_payout: number; entries: LedgerEntry[] }
export interface PayoutAccount { account_holder: string; bank_name: string; branch_code: string; account_type: string; account_last4: string }
export interface MyWithdrawal {
  id: string; amount: number; status: 'requested' | 'paid' | 'rejected' | 'cancelled'
  requested_at: string; processed_at: string | null; reference: string | null; reject_reason: string | null
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const fetchMyEarnings = () => rpc<MyEarnings>('my_earnings')
export const fetchMyPayoutAccount = () => rpc<PayoutAccount | null>('my_payout_account')
export const fetchMyWithdrawals = () => rpc<MyWithdrawal[]>('my_withdrawals')
export const requestWithdrawal = (amount: number) => rpc<string>('request_withdrawal', { p_amount: amount })
export const cancelMyWithdrawal = (id: string) => rpc<void>('cancel_my_withdrawal', { p_id: id })
export const savePayoutAccount = (a: { holder: string; bank: string; number: string; branch: string; type: string }) =>
  rpc<void>('set_my_payout_account', { p_holder: a.holder, p_bank: a.bank, p_number: a.number, p_branch: a.branch, p_type: a.type })

// ---------------------------------------------------------------------------
// Support tickets (db: 20261012000400)
// ---------------------------------------------------------------------------

export interface MyTicket { id: string; subject: string; status: 'open' | 'answered' | 'resolved'; booking_id: string | null; created_at: string; updated_at: string; messages: number }
export interface TicketMessage { id: number; from_staff: boolean; body: string; created_at: string }

export const fetchMyTickets = () => rpc<MyTicket[]>('my_tickets')
export const fetchMyTicketThread = (ticketId: string) => rpc<TicketMessage[]>('my_ticket_thread', { p_ticket: ticketId })
export const openTicket = (subject: string, body: string, bookingId?: string | null) =>
  rpc<string>('open_ticket', { p_subject: subject, p_body: body, p_booking_id: bookingId ?? null })
export const replyMyTicket = (ticketId: string, body: string) => rpc<void>('reply_my_ticket', { p_ticket: ticketId, p_body: body })

// ---------------------------------------------------------------------------
// Inspector documents (db: 20261012000300). Files live in the private inspector-docs bucket under <user id>/.
// ---------------------------------------------------------------------------

export type DocKind = 'id' | 'licence' | 'proof_of_address' | 'other'
export type CredentialKind = 'eov' | 'trade_certificate'
export interface MyDocument { id: string; kind: DocKind; file_name: string; status: 'pending' | 'approved' | 'rejected'; reject_reason: string | null; created_at: string }
export interface MyCredential {
  id: string; kind: CredentialKind; file_name: string; status: 'pending' | 'approved' | 'rejected'; reject_reason: string | null
  credential_number: string | null; credential_grade: 'A' | 'B' | 'C' | null; expires_on: string | null; created_at: string
}

export const DOC_MAX_BYTES = 10 * 1024 * 1024
const DOC_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export const fetchMyDocuments = () => rpc<MyDocument[]>('my_documents')
export const fetchMyCredentials = () => rpc<MyCredential[]>('my_credentials')

/** Uploads an Examiner of Vehicles / trade certificate and registers it for operator review. */
export async function uploadMyCredential(userId: string, kind: CredentialKind, file: File, f: { number: string; grade: string | null; expiresOn: string | null }): Promise<string> {
  const ext = DOC_TYPES[file.type]
  if (!ext) throw new Error('Upload a PDF, JPG, PNG or WebP file')
  if (file.size > DOC_MAX_BYTES) throw new Error('That file is over 10 MB')
  const path = `${userId}/${kind}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('inspector-docs').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  return rpc<string>('register_my_credential', { p_kind: kind, p_path: path, p_file_name: file.name, p_number: f.number, p_grade: f.grade, p_expires_on: f.expiresOn || null })
}

export async function uploadMyDocument(userId: string, kind: DocKind, file: File): Promise<string> {
  const ext = DOC_TYPES[file.type]
  if (!ext) throw new Error('Upload a PDF, JPG, PNG or WebP file')
  if (file.size > DOC_MAX_BYTES) throw new Error('That file is over 10 MB')
  const path = `${userId}/${kind}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('inspector-docs').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  return rpc<string>('register_my_document', { p_kind: kind, p_path: path, p_file_name: file.name })
}

/** Inspector edits their own self-reported details. Verification is separate (documents + admin approval). */
export async function updateMyProfile(p: { licence?: string; cert?: string; experience?: string; region?: string }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const patch = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))
  if (!Object.keys(patch).length) return
  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
  if (error) throw error
}
