// Starts a PayFast payment for an ACCEPTED repair quote. The amount is the quote total stored by the server; the request
// only names the quote. The buyer pays CheckVertical, which later pays the workshop its share.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminClient, checkoutResponse, cors, json, requireUser } from './edge.ts'
import { orderRef } from './payfast.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
  const admin = adminClient()
  const auth = await requireUser(req, admin)
  if (auth.error) return auth.error

  let body: { quote_id?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (typeof body.quote_id !== 'string' || !UUID.test(body.quote_id)) return json({ error: 'quote_id is required' }, 400)

  const notifyBase = Deno.env.get('PAYFAST_NOTIFY_URL') ?? ''
  const notifyUrl = notifyBase.replace(/payfast(-report)?-itn(?=\/?$)/, 'payfast-repair-itn')
  if (notifyUrl === notifyBase) return json({ error: 'Repair payments are not configured yet' }, 503)

  const { data, error } = await admin.rpc('prepare_repair_payment', { p_user: auth.user.id, p_quote_id: body.quote_id })
  if (error) return json({ error: error.message }, 400)
  const q = Array.isArray(data) ? data[0] : data
  return checkoutResponse({
    ref: orderRef('repair', q.id), amountRand: Number(q.amount),
    notifyUrl,
    itemName: 'Vehicle repair', itemDescription: String(q.label ?? 'Repair'), user: auth.user,
  })
})
