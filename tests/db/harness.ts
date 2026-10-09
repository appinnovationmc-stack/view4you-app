// PGlite harness: stub -> live baseline -> forward migrations 20261009*.
// TEST-ONLY. Never points at a real database.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..', 'supabase')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

export type Db = PGlite

export async function makeDb(opts: { migrations: boolean }): Promise<Db> {
  const db = new PGlite()
  await db.exec(read('tests/helpers/supabase_stub.sql'))
  await db.exec(read('baseline/lemoncheck_live_baseline_2026-10-07.sql'))
  if (opts.migrations) {
    const files = readdirSync(join(root, 'migrations'))
      .filter((f) => f.startsWith('20261009') && f.endsWith('.sql'))
      .sort()
    for (const f of files) await db.exec(read(`migrations/${f}`))
  }
  return db
}

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export async function addUser(db: Db, id: string, role: 'buyer' | 'inspector', name = 'Test User') {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)`, [
    id, `${id}@example.test`, JSON.stringify({ role, name }),
  ])
}

/** Run fn as an authenticated user (RLS + grants apply). Always resets afterwards. */
export async function asUser<T>(db: Db, id: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub','${id}',false), set_config('request.jwt.claim.role','authenticated',false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false);`) }
}
export async function asAnon<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role anon;`)
  try { return await fn() } finally { await db.exec(`reset role;`) }
}
export async function asService<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role service_role;`)
  try { return await fn() } finally { await db.exec(`reset role;`) }
}
/** Returns {ok, error} instead of throwing, for exploit assertions. */
export async function attempt(fn: () => Promise<unknown>): Promise<{ ok: boolean; error?: string }> {
  try { await fn(); return { ok: true } } catch (e: any) { return { ok: false, error: String(e?.message ?? e) } }
}
