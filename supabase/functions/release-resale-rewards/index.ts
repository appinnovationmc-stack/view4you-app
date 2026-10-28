// Scheduled worker fallback for projects where pg_cron is unavailable.
// Configure the scheduler to POST to this function every 15 minutes with
// Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>. Never expose that key to a client.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminClient, cors, json } from '../_shared/edge.ts'
import { timingSafeEqual } from '../_shared/payfast.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${serviceKey}`)) {
    return json({ error: 'Unauthorized' }, 401)
  }
  const { data, error } = await adminClient().rpc('lc_release_resale_rewards')
  if (error) return json({ error: 'Reward release failed' }, 500)
  return json({ released: Number(data || 0) })
})
