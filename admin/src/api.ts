import { supabase } from './supabase'

export type AdminRole = 'admin' | 'support'

export interface Overview {
  inspectors_pending_approval: number
  inspectors_approved: number
  inspectors_online: number
  buyers: number
  bookings_by_status: Record<string, number>
  bookings_awaiting_payment: number
  refunds_due: number
  refunds_due_amount: number
  paid_bookings_amount: number
  reports: number
  payment_problems_7d: number
  withdrawals_requested: number
  withdrawals_requested_amount: number
  documents_pending: number
  tickets_open: number
  reports_taken_down: number
}
export interface InspectorRow {
  id: string; name: string; email: string; phone: string | null; cert: string | null; licence: string | null
  region: string | null; approved: boolean; online: boolean; jobs_completed: number; rating: number | string
  price: number | null; created_at: string
  docs_pending: number | string; docs_approved: number | string; docs_rejected: number | string
}
export interface BookingRow {
  id: string; vin: string; status: string; payment_status: string; amount_due: number | null; location: string
  buyer_name: string | null; buyer_email: string | null; inspector_name: string | null
  created_at: string; accepted_at: string | null; completed_at: string | null
}
export interface PaymentEventRow {
  id: number; kind: string; order_id: string | null; pf_payment_id: string | null; payment_status: string | null
  amount_gross: number | string | null; outcome: string; created_at: string
}
export interface AuditRow {
  id: number; admin_email: string | null; action: string; target_type: string | null; target_id: string | null
  detail: Record<string, unknown>; created_at: string
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const signIn = async (email: string, password: string) => {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}
export const signOut = () => supabase.auth.signOut()

export const whoami = () => rpc<AdminRole | null>('admin_whoami')
export const overview = () => rpc<Overview>('admin_overview')
export const listInspectors = (status: 'all' | 'pending' | 'approved') => rpc<InspectorRow[]>('admin_list_inspectors', { p_status: status })
export const listBookings = (f: { status?: string; payment?: string; search?: string }) =>
  rpc<BookingRow[]>('admin_list_bookings', { p_status: f.status || null, p_payment: f.payment || null, p_search: f.search || null, p_limit: 200 })
export const listPaymentEvents = (onlyProblems: boolean) => rpc<PaymentEventRow[]>('admin_list_payment_events', { p_only_problems: onlyProblems, p_limit: 200 })
export const listAudit = () => rpc<AuditRow[]>('admin_list_audit', { p_limit: 200 })

export const setInspectorApproval = (id: string, approved: boolean, reason?: string) =>
  rpc<void>('admin_set_inspector_approval', { p_inspector_id: id, p_approved: approved, p_reason: reason ?? null })
export const cancelBooking = (id: string, reason: string) => rpc<void>('admin_cancel_booking', { p_booking_id: id, p_reason: reason })
export const markRefunded = (id: string, reference: string) => rpc<void>('admin_mark_refunded', { p_booking_id: id, p_reference: reference })

/* ───────── settings ───────── */
export interface Settings {
  travel_fee: number; platform_fee: number; resale_price_bp: number; payer_share_bp: number
  platform_share_bp: number; min_payout: number; require_documents: boolean
}
export const getSettings = () => rpc<Settings>('admin_get_settings')
export const updateSettings = (s: Settings, reason: string) => rpc<void>('admin_update_settings', {
  p_travel_fee: s.travel_fee, p_platform_fee: s.platform_fee, p_resale_price_bp: s.resale_price_bp,
  p_payer_share_bp: s.payer_share_bp, p_platform_share_bp: s.platform_share_bp, p_min_payout: s.min_payout,
  p_require_documents: s.require_documents, p_reason: reason,
})

/* ───────── reports ───────── */
export interface ReportRow {
  id: string; report_number: string | null; vin: string; score: number; report_price: number; inspector_name: string | null
  buyer_email: string | null; purchases: number | string; created_at: string; taken_down_at: string | null; taken_down_reason: string | null
}
export const listReports = (status: 'all' | 'live' | 'taken_down', search: string) =>
  rpc<ReportRow[]>('admin_list_reports', { p_status: status, p_search: search || null, p_limit: 200 })
export const takedownReport = (id: string, reason: string) => rpc<void>('admin_takedown_report', { p_inspection_id: id, p_reason: reason })
export const restoreReport = (id: string) => rpc<void>('admin_restore_report', { p_inspection_id: id })

/* ───────── reassign ───────── */
export interface AssignableInspector { id: string; name: string; region: string | null; online: boolean; rating: number | string; price: number | null }
export const listAssignable = () => rpc<AssignableInspector[]>('admin_list_assignable_inspectors')
export const reassignBooking = (bookingId: string, inspectorId: string, reason: string) =>
  rpc<void>('admin_reassign_booking', { p_booking_id: bookingId, p_inspector_id: inspectorId, p_reason: reason })

/* ───────── earnings and withdrawals ───────── */
export interface BalanceRow { user_id: string; name: string; email: string; role: string; earned: number | string; paid_out: number | string; adjustments: number | string; balance: number | string }
export interface LedgerRow { id: number; kind: string; amount: number; note: string | null; ref_type: string | null; ref_id: string | null; created_at: string }
export interface WithdrawalRow {
  id: string; user_id: string; name: string; email: string; amount: number; status: string
  account: { account_holder: string; bank_name: string; account_number: string; branch_code: string; account_type: string }
  balance: number | string; requested_at: string; processed_at: string | null; reference: string | null; reject_reason: string | null
}
export const listBalances = (search: string) => rpc<BalanceRow[]>('admin_list_balances', { p_search: search || null })
export const listLedger = (user: string) => rpc<LedgerRow[]>('admin_list_ledger', { p_user: user, p_limit: 200 })
export const listWithdrawals = (status: string) => rpc<WithdrawalRow[]>('admin_list_withdrawals', { p_status: status })
export const payWithdrawal = (id: string, reference: string) => rpc<void>('admin_pay_withdrawal', { p_id: id, p_reference: reference })
export const rejectWithdrawal = (id: string, reason: string) => rpc<void>('admin_reject_withdrawal', { p_id: id, p_reason: reason })
export const addAdjustment = (user: string, amount: number, reason: string) =>
  rpc<void>('admin_add_adjustment', { p_user: user, p_amount: amount, p_reason: reason })

/* ───────── inspector documents ───────── */
export interface DocRow { id: string; kind: string; file_name: string; storage_path: string; status: string; reject_reason: string | null; reviewed_at: string | null; created_at: string }
export const listDocuments = (user: string) => rpc<DocRow[]>('admin_list_documents', { p_user: user })
export const reviewDocument = (id: string, approve: boolean, reason?: string) =>
  rpc<void>('admin_review_document', { p_id: id, p_approve: approve, p_reason: reason ?? null })
export async function documentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('inspector-docs').createSignedUrl(path, 120)
  if (error || !data) throw new Error(error?.message ?? 'Could not open the file')
  return data.signedUrl
}

/* ───────── support tickets ───────── */
export interface TicketRow {
  id: string; subject: string; status: string; user_id: string; name: string; email: string; role: string
  booking_id: string | null; vin: string | null; created_at: string; updated_at: string; messages: number | string
}
export interface TicketMessage { id: number; from_staff: boolean; author: string; body: string; created_at: string }
export const listTickets = (status: string, search: string) => rpc<TicketRow[]>('admin_list_tickets', { p_status: status, p_search: search || null })
export const ticketThread = (id: string) => rpc<TicketMessage[]>('admin_ticket_thread', { p_ticket: id })
export const replyTicket = (id: string, body: string, resolve: boolean) => rpc<void>('admin_reply_ticket', { p_ticket: id, p_body: body, p_resolve: resolve })
export const setTicketStatus = (id: string, status: string) => rpc<void>('admin_set_ticket_status', { p_ticket: id, p_status: status })

/* ───────── analytics ───────── */
export interface Analytics {
  days: number
  series: { day: string; bookings: number; paid_bookings: number; booking_revenue: number; report_sales: number; report_revenue: number }[]
  funnel: { created: number; paid: number; accepted: number; completed: number; cancelled: number }
  repeat_buyers: { buyers: number; repeat: number }
  inspectors: { approved: number; online_now: number; worked_in_period: number }
  top_inspectors: { name: string; jobs: number; rating: number | string }[]
  totals: { booking_revenue: number; report_revenue: number; report_sales: number }
}
export const analytics = (days: number) => rpc<Analytics>('admin_analytics', { p_days: days })
