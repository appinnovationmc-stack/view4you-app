// Deno-only glue shared by the payment Edge Functions (not imported by tests).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCheckoutFields, payfastHosts, randToPayfast } from './payfast.ts'

export const cors = {
  'Access-Control-Allow-Origin': '*', // bearer-token auth, no cookies: wildcard origin is not a CSRF risk
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

export async function md5(s: string): Promise<string> {
  const d = await crypto.subtle.digest('MD5', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const adminClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

/** Authenticates the caller from the Authorization header. Returns the user or a ready 401 response. */
export async function requireUser(req: Request, admin: ReturnType<typeof adminClient>) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return { error: json({ error: 'Authentication required' }, 401) }
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return { error: json({ error: 'Invalid authentication' }, 401) }
  return { user: data.user }
}

export function payfastConfig() {
  const c = {
    merchantId: Deno.env.get('PAYFAST_MERCHANT_ID') ?? '',
    merchantKey: Deno.env.get('PAYFAST_MERCHANT_KEY') ?? '',
    passphrase: Deno.env.get('PAYFAST_PASSPHRASE') ?? '',
    returnUrl: Deno.env.get('PAYFAST_RETURN_URL') ?? '',
    cancelUrl: Deno.env.get('PAYFAST_CANCEL_URL') ?? '',
    notifyUrl: Deno.env.get('PAYFAST_NOTIFY_URL') ?? '',
    sandbox: Deno.env.get('PAYFAST_SANDBOX') === 'true',
  }
  const ok = !!(c.merchantId && c.merchantKey && c.returnUrl && c.cancelUrl && c.notifyUrl)
  return { ...c, ok }
}

export async function checkoutResponse(opts: {
  ref: string; amountRand: number; itemName: string; itemDescription: string
  user: { email?: string | null; user_metadata?: Record<string, unknown> }
}) {
  const cfg = payfastConfig()
  if (!cfg.ok) return json({ error: 'Payments are not configured yet' }, 503)
  const fields = await buildCheckoutFields({
    merchant_id: cfg.merchantId, merchant_key: cfg.merchantKey,
    return_url: cfg.returnUrl, cancel_url: cfg.cancelUrl, notify_url: cfg.notifyUrl,
    name_first: String(opts.user.user_metadata?.first_name ?? ''),
    email_address: opts.user.email ?? '',
    m_payment_id: opts.ref, amount: randToPayfast(opts.amountRand),
    item_name: opts.itemName, item_description: opts.itemDescription,
  }, cfg.passphrase, md5)
  return json({ order_ref: opts.ref, amount: opts.amountRand, action: payfastHosts(cfg.sandbox).process, fields })
}
