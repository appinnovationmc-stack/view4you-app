// PayFast Instant Transaction Notification (ITN) receiver for BOTH bookings (m_payment_id b_<uuid>) and report
// purchases (r_<uuid>). Verifies, in order: merchant id, signature, source IP, PayFast server confirmation.
// Only then is the database asked to apply it; the database re-checks the order, the amount and idempotency
// (apply_payfast_itn). This function marks nothing paid itself.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminClient, md5, payfastConfig } from '../_shared/edge.ts'
import {
  clientIp, DEFAULT_PAYFAST_RANGES, ipAllowed, itnParamString, itnSignatureValid,
  parseItnBody, parseOrderRef, payfastHosts, redactItn,
} from '../_shared/payfast.ts'

const text = (body: string, status = 200) => new Response(body, { status })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('OK')
  const admin = adminClient()
  const cfg = payfastConfig()
  const pairs = parseItnBody(await req.text())
  const d = Object.fromEntries(pairs)
  const raw = redactItn(pairs)

  const reject = async (reason: string, status = 400) => {
    await admin.from('payment_events').insert({
      kind: 'unknown', order_id: null, pf_payment_id: d.pf_payment_id ?? null, payment_status: d.payment_status ?? null,
      outcome: 'rejected_' + reason, raw,
    })
    console.warn('ITN rejected:', reason, 'm_payment_id=', d.m_payment_id)
    return text('rejected', status)
  }

  if (!cfg.merchantId || d.merchant_id !== cfg.merchantId) return reject('merchant')
  if (!(await itnSignatureValid(pairs, cfg.passphrase, md5))) return reject('signature')

  // Source IP. Enforced unless explicitly disabled (never disable in production).
  if (Deno.env.get('PAYFAST_ENFORCE_IP') !== 'false') {
    const override = (Deno.env.get('PAYFAST_ALLOWED_IPS') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (!ipAllowed(clientIp(req.headers), override.length ? override : DEFAULT_PAYFAST_RANGES)) return reject('source_ip')
  }

  // Server-to-server confirmation: PayFast must confirm it sent exactly these values.
  let valid = false
  try {
    const res = await fetch(payfastHosts(cfg.sandbox).validate, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: itnParamString(pairs), signal: AbortSignal.timeout(10_000),
    })
    valid = (await res.text()).trim() === 'VALID'
  } catch (e) {
    console.error('ITN validate call failed', e)
    return text('validation unavailable', 503) // PayFast retries later
  }
  if (!valid) return reject('server_confirmation')

  const ref = parseOrderRef(d.m_payment_id)
  if (!ref) return reject('reference')
  if (!/^\d+(\.\d{1,2})?$/.test(d.amount_gross ?? '')) return reject('amount_format')

  const { data, error } = await admin.rpc('apply_payfast_itn', {
    p_kind: ref.kind, p_order_id: ref.id, p_pf_payment_id: d.pf_payment_id ?? null,
    p_payment_status: d.payment_status ?? '', p_amount_gross: Number(d.amount_gross), p_raw: raw,
  })
  if (error) { console.error('apply_payfast_itn failed', error.message); return text('error', 500) }

  const outcome = String(data)
  console.log('ITN', outcome, ref.kind, ref.id)
  // Anything that is not a clean apply / duplicate / harmless status is an anomaly: tell PayFast we did not accept it.
  const ok = outcome === 'applied' || outcome === 'duplicate' || outcome.startsWith('ignored_')
  return ok ? text('OK') : text(outcome, 400)
})
