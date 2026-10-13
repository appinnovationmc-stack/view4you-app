import { supabase } from './supabase'
import type { Who } from './access'

export type Row = Record<string, any>

function fail(e: { message: string } | null): never { throw new Error(e?.message ?? 'Request failed') }

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) fail(error)
}
export const signOut = () => supabase.auth.signOut()

export async function whoami(): Promise<Who> {
  const claim = await supabase.rpc('fleet_claim_invites')       // turns invitations for this confirmed email into access
  if (claim.error) fail(claim.error)
  const { data, error } = await supabase.rpc('fleet_whoami')
  if (error) fail(error)
  return data as Who
}

export interface ListOpts {
  eq?: Record<string, string | number | boolean | null>
  order?: [string, boolean]
  limit?: number
}
export async function list<T = Row>(source: string, opts: ListOpts = {}): Promise<T[]> {
  let q = supabase.from(source).select('*')
  for (const [k, v] of Object.entries(opts.eq ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v)
  if (opts.order) q = q.order(opts.order[0], { ascending: opts.order[1] })
  const { data, error } = await q.limit(opts.limit ?? 2000)
  if (error) fail(error)
  return (data ?? []) as T[]
}
export async function insert(table: string, values: Row): Promise<void> {
  const { error } = await supabase.from(table).insert(values)
  if (error) fail(error)
}
export async function update(table: string, id: string | number, values: Row): Promise<void> {
  const { data, error } = await supabase.from(table).update(values).eq('id', id).select('id')
  if (error) fail(error)
  if (!data || data.length === 0) throw new Error('Nothing was changed — you may not have permission to edit this record.')
}
export async function remove(table: string, id: string | number): Promise<void> {
  const { data, error } = await supabase.from(table).delete().eq('id', id).select('id')
  if (error) fail(error)
  if (!data || data.length === 0) throw new Error('Nothing was deleted — only an organisation administrator can delete this record.')
}
export async function rpc<T = unknown>(name: string, args: Row = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) fail(error)
  return data as T
}

// ── Documents (title deeds, layout plans, licence discs) ──────────────────────────────────────
export async function uploadDocument(tenantId: string, scope: string, recordId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
  const path = `${tenantId}/${scope}/${recordId}/${Date.now()}-${safe}`
  const { error } = await supabase.storage.from('fleet-documents').upload(path, file, { contentType: file.type, upsert: false })
  if (error) fail(error)
  return path
}
export async function openDocument(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from('fleet-documents').createSignedUrl(path, 120)
  if (error || !data) fail(error)
  window.open(data.signedUrl, '_blank', 'noopener')
}

// ── Reporting ────────────────────────────────────────────────────────────────────────────────
export const dashboard = (tenantId: string) => rpc<Row>('fleet_dashboard', { p_tenant: tenantId })
export const vehicleCosts = (tenantId: string, from: string, to: string) =>
  rpc<Row[]>('fleet_vehicle_costs', { p_tenant: tenantId, p_from: from, p_to: to })

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────
export function downloadCsv(filename: string, columns: { key: string; label: string }[], rows: Row[]) {
  const esc = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    // neutralise spreadsheet formula injection
    const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const body = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
