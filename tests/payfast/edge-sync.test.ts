import { describe, it, expect } from 'vitest'
// @ts-expect-error plain .mjs helper without type declarations
import { staleCopies } from '../../scripts/sync-edge-helpers.mjs'
import { clientIp } from '../../supabase/functions/_shared/payfast'

describe('edge function helper copies', () => {
  it('are identical to supabase/functions/_shared (run `node scripts/sync-edge-helpers.mjs` to fix)', () => {
    expect(staleCopies()).toEqual([])
  })
})

describe('clientIp source preference', () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null })
  it('prefers the Cloudflare-set header over a caller-suppliable X-Forwarded-For', () => {
    expect(clientIp(h({ 'cf-connecting-ip': '41.74.179.200', 'x-forwarded-for': '1.2.3.4' }))).toBe('41.74.179.200')
  })
  it('falls back to the first X-Forwarded-For entry, then x-real-ip', () => {
    expect(clientIp(h({ 'x-forwarded-for': '41.74.179.200, 10.0.0.1' }))).toBe('41.74.179.200')
    expect(clientIp(h({ 'x-real-ip': '41.74.179.201' }))).toBe('41.74.179.201')
  })
})
