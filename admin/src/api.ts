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
}
export interface InspectorRow {
  id: string; name: string; email: string; phone: string | null; cert: string | null; licence: string | null
  region: string | null; approved: boolean; online: boolean; jobs_completed: number; rating: number | string
  price: number | null; created_at: string
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
