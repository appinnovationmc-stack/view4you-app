import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  pfEncode, buildCheckoutFields, checkoutSignature, itnSignatureValid, itnParamString, parseItnBody,
  ipAllowed, amountMatches, parseOrderRef, orderRef, clientIp, redactItn, orderCheckoutFields, timingSafeEqual,
} from '../../supabase/functions/_shared/payfast'

const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const ID = '123e4567-e89b-42d3-a456-426614174000'

describe('encoding matches PHP urlencode', () => {
  it('uses + for spaces, uppercase hex and encodes !\'()*~', () => {
    expect(pfEncode('LemonCheck vehicle report')).toBe('LemonCheck+vehicle+report')
    expect(pfEncode("a!b'c(d)e*f~g")).toBe('a%21b%27c%28d%29e%2Af%7Eg')
    expect(pfEncode('john@doe.co.za')).toBe('john%40doe.co.za')
    expect(pfEncode('  trim me  ')).toBe('trim+me')
    expect(pfEncode('https://x.co/y?a=1&b=2')).toBe('https%3A%2F%2Fx.co%2Fy%3Fa%3D1%26b%3D2')
  })
})

describe('checkout signature', () => {
  const base = {
    amount: '675.00', merchant_id: '10000100', merchant_key: 'abc', m_payment_id: orderRef('booking', ID),
    item_name: 'LemonCheck vehicle inspection', notify_url: 'https://n.example/itn', return_url: 'https://r.example',
    cancel_url: 'https://c.example', email_address: '', name_first: 'Sam',
  }
  it('orders fields as PayFast documents, drops blanks, signs with the passphrase', async () => {
    expect(orderCheckoutFields(base).map(([k]) => k)).toEqual(
      ['merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url', 'name_first', 'email_address', 'm_payment_id', 'amount', 'item_name'])
    const f = await buildCheckoutFields(base, 'secret pass', md5)
    expect(Object.keys(f)).not.toContain('email_address')
    expect(Object.keys(f).at(-1)).toBe('signature')
    const manual = md5(
      `merchant_id=10000100&merchant_key=abc&return_url=https%3A%2F%2Fr.example&cancel_url=https%3A%2F%2Fc.example` +
      `&notify_url=https%3A%2F%2Fn.example%2Fitn&name_first=Sam&m_payment_id=b_${ID}&amount=675.00` +
      `&item_name=LemonCheck+vehicle+inspection&passphrase=secret+pass`)
    expect(f.signature).toBe(manual)
  })
  it('signature depends on amount and passphrase (tamper evident)', async () => {
    const a = await checkoutSignature(base, 'p', md5)
    expect(await checkoutSignature({ ...base, amount: '1.00' }, 'p', md5)).not.toBe(a)
    expect(await checkoutSignature(base, 'q', md5)).not.toBe(a)
    expect(await checkoutSignature(base, '', md5)).not.toBe(a)
  })
})

describe('ITN verification', () => {
  const pass = 'pass phrase'
  // Fields in PayFast's sending order, including blank ones (PayFast signs what it sends).
  const fields: [string, string][] = [
    ['m_payment_id', `b_${ID}`], ['pf_payment_id', '1089250'], ['payment_status', 'COMPLETE'],
    ['item_name', 'LemonCheck vehicle inspection'], ['item_description', ''], ['amount_gross', '675.00'],
    ['amount_fee', '-15.54'], ['amount_net', '659.46'], ['custom_str1', ''], ['name_first', 'Sam'],
    ['email_address', 'sam@example.co.za'], ['merchant_id', '10000100'],
  ]
  const signed = (pairs = fields, p = pass) => {
    const raw = itnParamString(pairs) + (p ? `&passphrase=${pfEncodeP(p)}` : '')
    return new URLSearchParams([...pairs, ['signature', md5(raw)]]).toString()
  }
  const pfEncodeP = pfEncode

  it('accepts a correctly signed ITN, including blank fields', async () => {
    expect(await itnSignatureValid(parseItnBody(signed()), pass, md5)).toBe(true)
  })
  it('keeps blank fields in the signed string (blank-stripping would break real ITNs)', () => {
    expect(itnParamString(fields)).toContain('item_description=&')
  })
  it('rejects a changed amount, status, reference, passphrase, missing signature or wrong case-insensitive match', async () => {
    const body = signed()
    for (const [k, v] of [['amount_gross', '1.00'], ['payment_status', 'FAILED'], ['m_payment_id', `b_${ID.replace('1', '2')}`]]) {
      const forged = parseItnBody(body).map(([a, b]) => (a === k ? [a, v] : [a, b])) as [string, string][]
      expect(await itnSignatureValid(forged, pass, md5)).toBe(false)
    }
    expect(await itnSignatureValid(parseItnBody(body), 'wrong', md5)).toBe(false)
    expect(await itnSignatureValid(parseItnBody(body).filter(([k]) => k !== 'signature'), pass, md5)).toBe(false)
    expect(await itnSignatureValid(parseItnBody(body.replace(/signature=[0-9a-f]+/, 'signature=')), pass, md5)).toBe(false)
  })
  it('accepts an uppercase hex signature', async () => {
    const body = signed().replace(/signature=([0-9a-f]+)/, (_m, h) => 'signature=' + h.toUpperCase())
    expect(await itnSignatureValid(parseItnBody(body), pass, md5)).toBe(true)
  })
  it('works without a passphrase when none is configured', async () => {
    expect(await itnSignatureValid(parseItnBody(signed(fields, '')), '', md5)).toBe(true)
  })
  it('redacts secrets before storing', () => {
    expect(redactItn([['signature', 'x'], ['merchant_key', 'k'], ['amount_gross', '1.00']])).toEqual({ amount_gross: '1.00' })
  })
  it('timingSafeEqual', () => { expect(timingSafeEqual('abc', 'abc')).toBe(true); expect(timingSafeEqual('abc', 'abd')).toBe(false); expect(timingSafeEqual('a', 'ab')).toBe(false) })
})

describe('source IP', () => {
  it('allows addresses inside PayFast ranges and rejects others', () => {
    expect(ipAllowed('197.97.145.150')).toBe(true)
    expect(ipAllowed('197.97.145.160')).toBe(false)   // outside the /28
    expect(ipAllowed('41.74.179.200')).toBe(true)
    expect(ipAllowed('144.126.193.139')).toBe(true)
    expect(ipAllowed('8.8.8.8')).toBe(false)
    expect(ipAllowed(null)).toBe(false)
    expect(ipAllowed('not-an-ip')).toBe(false)
    expect(ipAllowed('999.1.1.1')).toBe(false)
  })
  it('supports an override list', () => {
    expect(ipAllowed('10.0.0.5', ['10.0.0.0/24'])).toBe(true)
    expect(ipAllowed('10.0.1.5', ['10.0.0.0/24'])).toBe(false)
    expect(ipAllowed('1.2.3.4', ['1.2.3.4'])).toBe(true)
  })
  it('reads the first X-Forwarded-For entry', () => {
    const h = (m: Record<string, string>) => ({ get: (k: string) => m[k.toLowerCase()] ?? null })
    expect(clientIp(h({ 'x-forwarded-for': '41.74.179.200, 10.0.0.1' }))).toBe('41.74.179.200')
    expect(clientIp(h({}))).toBeNull()
  })
})

describe('amounts and references', () => {
  it('compares decimal strings to integer Rand exactly', () => {
    expect(amountMatches('675.00', 675)).toBe(true)
    expect(amountMatches('675', 675)).toBe(true)
    expect(amountMatches('674.99', 675)).toBe(false)
    expect(amountMatches('0675.00', 675)).toBe(true)
    expect(amountMatches('-675.00', 675)).toBe(false)
    expect(amountMatches('1e3', 1000)).toBe(false)
    expect(amountMatches('', 0)).toBe(false)
  })
  it('round-trips order references and rejects junk', () => {
    expect(parseOrderRef(orderRef('booking', ID))).toEqual({ kind: 'booking', id: ID })
    expect(parseOrderRef(orderRef('report', ID))).toEqual({ kind: 'report', id: ID })
    for (const bad of [undefined, '', 'x_' + ID, 'b_not-a-uuid', ID, "b_' or 1=1 --"]) expect(parseOrderRef(bad)).toBeNull()
  })
})
