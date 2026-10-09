// Starts a PayFast payment for a booking. The amount comes from the database (bookings.amount_due, set by
// create_booking from the inspector's price), never from the request. Only the booking's buyer can start it.
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

  let body: { booking_id?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (typeof body.booking_id !== 'string' || !UUID.test(body.booking_id)) return json({ error: 'booking_id is required' }, 400)

  const { data, error } = await admin.rpc('prepare_booking_payment', { p_user: auth.user.id, p_booking_id: body.booking_id })
  if (error) return json({ error: error.message }, 400)
  const row = Array.isArray(data) ? data[0] : data
  return checkoutResponse({
    ref: orderRef('booking', row.booking_id), amountRand: Number(row.amount_due),
    itemName: 'LemonCheck vehicle inspection', itemDescription: `Inspection booking for ${row.vin}`, user: auth.user,
  })
})
