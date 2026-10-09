// Starts a PayFast payment for buying an existing LemonCheck report. The price is the report_price stored by the
// server when the inspector submitted the report; the request only names the inspection.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminClient, checkoutResponse, cors, json, requireUser } from '../_shared/edge.ts'
import { orderRef } from '../_shared/payfast.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
  const admin = adminClient()
  const auth = await requireUser(req, admin)
  if (auth.error) return auth.error

  let body: { inspection_id?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (typeof body.inspection_id !== 'string' || !UUID.test(body.inspection_id)) return json({ error: 'inspection_id is required' }, 400)

  const { data, error } = await admin.rpc('create_report_order_for', { p_user: auth.user.id, p_inspection_id: body.inspection_id })
  if (error) return json({ error: error.message }, 400)
  const order = Array.isArray(data) ? data[0] : data
  return checkoutResponse({
    ref: orderRef('report', order.id), amountRand: Number(order.amount),
    itemName: 'LemonCheck vehicle report', itemDescription: 'LemonCheck report', user: auth.user,
  })
})
