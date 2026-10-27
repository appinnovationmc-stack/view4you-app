// PayFast helpers shared by the Edge Functions. Pure functions (no Deno APIs) so they are unit-tested in Node.
// md5 is injected: Deno's WebCrypto supports MD5, Node's does not.

export type Md5 = (s: string) => Promise<string> | string

export function pfEncode(value: string): string {
  return encodeURIComponent(value.trim())
    .replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+')
}

export const CHECKOUT_ORDER = [
  'merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url',
  'name_first', 'name_last', 'email_address', 'cell_number',
  'm_payment_id', 'amount', 'item_name', 'item_description',
  'custom_int1', 'custom_int2', 'custom_int3', 'custom_int4', 'custom_int5',
  'custom_str1', 'custom_str2', 'custom_str3', 'custom_str4', 'custom_str5',
  'email_confirmation', 'confirmation_address', 'payment_method',
] as const

export function orderCheckoutFields(fields: Record<string, string>): [string, string][] {
  const known = CHECKOUT_ORDER.filter((k) => k in fields).map((k) => [k, fields[k]] as [string, string])
  const rest = Object.entries(fields).filter(([k]) => !(CHECKOUT_ORDER as readonly string[]).includes(k))
  return [...known, ...rest]
}

export async function checkoutSignature(fields: Record<string, string>, passphrase: string, md5: Md5): Promise<string> {
  const pairs = orderCheckoutFields(fields).filter(([, v]) => v.trim() !== '')
  const raw = pairs.map(([k, v]) => `${k}=${pfEncode(v)}`).join('&') + (passphrase ? `&passphrase=${pfEncode(passphrase)}` : '')
  return md5(raw)
}

export async function buildCheckoutFields(fields: Record<string, string>, passphrase: string, md5: Md5): Promise<Record<string, string>> {
  const ordered = orderCheckoutFields(fields).filter(([, v]) => v.trim() !== '')
  const out: Record<string, string> = {}
  for (const [k, v] of ordered) out[k] = v
  out.signature = await checkoutSignature(out, passphrase, md5)
  return out
}

export function parseItnBody(body: string): [string, string][] {
  return Array.from(new URLSearchParams(body).entries())
}

export function itnParamString(pairs: [string, string][]): string {
  return pairs.filter(([k]) => k !== 'signature').map(([k, v]) => `${k}=${pfEncode(v)}`).join('&')
}

export async function itnSignatureValid(pairs: [string, string][], passphrase: string, md5: Md5): Promise<boolean> {
  const sig = pairs.find(([k]) => k === 'signature')?.[1]
  if (!sig) return false
  const raw = itnParamString(pairs) + (passphrase ? `&passphrase=${pfEncode(passphrase)}` : '')
  const expected = String(await md5(raw))
  return timingSafeEqual(expected, sig.toLowerCase())
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export const DEFAULT_PAYFAST_RANGES = ['197.97.145.144/28', '41.74.179.192/27', '102.216.36.0/28', '102.216.36.128/28', '144.126.193.139/32']

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim())
  if (!m) return null
  const o = m.slice(1).map(Number)
  if (o.some((n) => n > 255)) return null
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0
}

export function ipAllowed(ip: string | null | undefined, ranges: string[] = DEFAULT_PAYFAST_RANGES): boolean {
  const addr = ip ? ipv4ToInt(ip) : null
  if (addr === null) return false
  return ranges.some((r) => {
    const [base, bitsStr] = r.trim().split('/')
    const b = ipv4ToInt(base)
    if (b === null) return false
    const bits = bitsStr === undefined ? 32 : Number(bitsStr)
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (addr & mask) >>> 0 === (b & mask) >>> 0
  })
}

export function clientIp(headers: { get(name: string): string | null }): string | null {
  const xff = headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return headers.get('cf-connecting-ip') ?? headers.get('x-real-ip')
}

export function amountMatches(amountGross: string, expectedRand: number): boolean {
  if (!/^\d+(\.\d{1,2})?$/.test(amountGross.trim())) return false
  const cents = Math.round(Number(amountGross) * 100)
  return cents === Math.round(expectedRand * 100)
}

export const randToPayfast = (rand: number) => rand.toFixed(2)

export type OrderRef = { kind: 'booking' | 'report'; id: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const orderRef = (kind: OrderRef['kind'], id: string) => `${kind === 'booking' ? 'b' : 'r'}_${id}`
export function parseOrderRef(ref: string | undefined): OrderRef | null {
  const m = /^([br])_(.+)$/.exec(ref ?? '')
  if (!m || !UUID.test(m[2])) return null
  return { kind: m[1] === 'b' ? 'booking' : 'report', id: m[2].toLowerCase() }
}

export function payfastHosts(sandbox: boolean) {
  const host = sandbox ? 'sandbox.payfast.co.za' : 'www.payfast.co.za'
  return { process: `https://${host}/eng/process`, validate: `https://${host}/eng/query/validate` }
}

export function redactItn(pairs: [string, string][]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of pairs) if (!['signature', 'merchant_key', 'passphrase'].includes(k)) out[k] = v
  return out
}
