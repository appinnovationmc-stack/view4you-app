// Admin console backend: access control, audit trail and the operator actions.
import { describe, it, expect, beforeAll } from 'vitest'
import { makeDb, addUser, asUser, asAnon, attempt, uid, type Db } from './harness'

let db: Db
const BUYER = uid(1), INSP = uid(3), NEWINSP = uid(5), ADMIN = uid(90), SUPPORT = uid(91)
const VIN = 'ADM111GP'
let bookingId = ''

const call = (who: string, sql: string, args: unknown[] = []) => asUser(db, who, () => db.query<any>(sql, args))
const audit = async () => (await db.query<any>('select action, target_id, detail from public.admin_audit_log order by id')).rows

beforeAll(async () => {
  db = await makeDb({ migrations: true })
  for (const [id, role] of [[BUYER, 'buyer'], [INSP, 'inspector'], [NEWINSP, 'inspector'], [ADMIN, 'buyer'], [SUPPORT, 'buyer']] as const)
    await addUser(db, id, role, 'User ' + id.slice(-2))
  await db.query(`update public.profiles set approved=true, online=true, price=500 where id=$1`, [INSP])
  // operators are added by SQL (service role), never through the app
  await db.query(`insert into public.admin_users (user_id, role) values ($1,'admin'), ($2,'support')`, [ADMIN, SUPPORT])
  await db.query(`insert into public.vehicles (vin, make, model, year) values ($1,'Toyota','Corolla',2019)`, [VIN])
  bookingId = (await db.query<any>(
    `insert into public.bookings (buyer_id, inspector_id, vin, location, status, inspection_fee, amount_due, paid, payment_status)
     values ($1,$2,$3,'Midrand','pending',500,675,true,'paid') returning id`, [BUYER, INSP, VIN])).rows[0].id
})

const ADMIN_CALLS: [string, string, unknown[]][] = [
  ['overview', 'select public.admin_overview()', []],
  ['inspectors', 'select * from public.admin_list_inspectors()', []],
  ['bookings', 'select * from public.admin_list_bookings()', []],
  ['payments', 'select * from public.admin_list_payment_events()', []],
  ['audit', 'select * from public.admin_list_audit()', []],
  ['approve', 'select public.admin_set_inspector_approval($1, true, null)', [NEWINSP]],
  ['refund', 'select public.admin_mark_refunded($1, $2)', [uid(500), 'ref']],
  ['cancel', 'select public.admin_cancel_booking($1, $2)', [uid(500), 'why']],
]

describe('who can use the admin functions', () => {
  it.each(ADMIN_CALLS)('a buyer and an inspector are refused: %s', async (_n, sql, args) => {
    for (const who of [BUYER, INSP]) {
      const r = await attempt(() => call(who, sql, args))
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/Admin access required|permission denied/i)
    }
  })
  it.each(ADMIN_CALLS)('anonymous callers are refused: %s', async (_n, sql, args) => {
    expect((await attempt(() => asAnon(db, () => db.query(sql, args)))).ok).toBe(false)
  })
  it('admin_whoami reports the role, or null for everyone else, without raising', async () => {
    expect((await call(ADMIN, 'select public.admin_whoami() as r')).rows[0].r).toBe('admin')
    expect((await call(SUPPORT, 'select public.admin_whoami() as r')).rows[0].r).toBe('support')
    expect((await call(BUYER, 'select public.admin_whoami() as r')).rows[0].r).toBeNull()
  })
  it('a user cannot make themselves an admin or read the admin tables', async () => {
    for (const sql of [
      `insert into public.admin_users (user_id, role) values ('${BUYER}', 'admin')`,
      `update public.admin_users set role = 'admin' where user_id = '${SUPPORT}'`,
      `select * from public.admin_users`,
      `select * from public.admin_audit_log`,
      `delete from public.admin_audit_log`,
      `update public.admin_audit_log set action = 'x'`,
    ]) {
      expect((await attempt(() => call(BUYER, sql))).ok, sql).toBe(false)
      expect((await attempt(() => call(ADMIN, sql))).ok, 'even an admin: ' + sql).toBe(false)
    }
    expect((await db.query<any>('select role from public.admin_users where user_id=$1', [BUYER])).rows.length).toBe(0)
  })
  it('the internal helpers cannot be called directly', async () => {
    for (const sql of [`select public.lc_audit('x','y','z','{}')`, `select public.lc_require_admin(false)`, `select public.lc_admin_role()`])
      expect((await attempt(() => call(ADMIN, sql))).ok, sql).toBe(false)
  })
})

describe('support role is read-only', () => {
  it('can read but not write', async () => {
    expect((await call(SUPPORT, 'select * from public.admin_list_bookings()')).rows.length).toBeGreaterThan(0)
    for (const [sql, args] of [
      ['select public.admin_set_inspector_approval($1, true, null)', [NEWINSP]],
      ['select public.admin_cancel_booking($1, $2)', [bookingId, 'why']],
      ['select public.admin_mark_refunded($1, $2)', [bookingId, 'ref']],
    ] as [string, unknown[]][]) {
      const r = await attempt(() => call(SUPPORT, sql, args))
      expect(r.ok).toBe(false); expect(r.error).toMatch(/admin role/i)
    }
    expect((await db.query<any>('select approved from public.profiles where id=$1', [NEWINSP])).rows[0].approved).toBe(false)
  })
})

describe('reads', () => {
  it('overview counts the data', async () => {
    const o = (await call(ADMIN, 'select public.admin_overview() as o')).rows[0].o
    expect(o).toMatchObject({ inspectors_pending_approval: 1, inspectors_approved: 1, buyers: 3, paid_bookings_amount: 675, refunds_due: 0 })
    expect(o.bookings_by_status.pending).toBe(1)
  })
  it('lists and filters inspectors', async () => {
    expect((await call(ADMIN, `select * from public.admin_list_inspectors('pending')`)).rows.map((r: any) => r.id)).toEqual([NEWINSP])
    expect((await call(ADMIN, `select * from public.admin_list_inspectors('approved')`)).rows.map((r: any) => r.id)).toEqual([INSP])
    expect((await attempt(() => call(ADMIN, `select * from public.admin_list_inspectors('nonsense')`))).ok).toBe(false)
  })
  it('lists bookings with names, filters and a wildcard-safe search', async () => {
    const all = (await call(ADMIN, 'select * from public.admin_list_bookings()')).rows
    expect(all[0]).toMatchObject({ vin: VIN, payment_status: 'paid', amount_due: 675 })
    expect(all[0].buyer_email).toContain('@')
    expect((await call(ADMIN, `select * from public.admin_list_bookings(null,'unpaid')`)).rows.length).toBe(0)
    expect((await call(ADMIN, `select * from public.admin_list_bookings(null,null,'adm111')`)).rows.length).toBe(1)
    expect((await call(ADMIN, `select * from public.admin_list_bookings(null,null,'%')`)).rows.length).toBe(0)
  })
  it('payment events hide the raw payload and the problems filter works', async () => {
    await db.query(`insert into public.payment_events (kind, order_id, outcome, raw) values
      ('booking', $1, 'applied', '{"email_address":"x@y.z"}'), ('booking', $1, 'amount_mismatch', '{"email_address":"x@y.z"}')`, [bookingId])
    const probs = (await call(ADMIN, 'select * from public.admin_list_payment_events(true)')).rows
    expect(probs.map((r: any) => r.outcome)).toEqual(['amount_mismatch'])
    expect(Object.keys(probs[0])).not.toContain('raw')
    expect((await call(ADMIN, 'select * from public.admin_list_payment_events(false)')).rows.length).toBe(2)
    expect((await call(ADMIN, 'select public.admin_overview() as o')).rows[0].o.payment_problems_7d).toBe(1)
  })
})

describe('writes are applied and audited', () => {
  it('approve / suspend inspector (reason required, suspended goes offline)', async () => {
    await call(ADMIN, 'select public.admin_set_inspector_approval($1, true, null)', [NEWINSP])
    await db.query('update public.profiles set online=true where id=$1', [NEWINSP])
    expect((await attempt(() => call(ADMIN, 'select public.admin_set_inspector_approval($1, false, $2)', [NEWINSP, '  ']))).ok).toBe(false)
    await call(ADMIN, 'select public.admin_set_inspector_approval($1, false, $2)', [NEWINSP, 'licence expired'])
    expect((await db.query<any>('select approved, online from public.profiles where id=$1', [NEWINSP])).rows[0]).toEqual({ approved: false, online: false })
    expect((await attempt(() => call(ADMIN, 'select public.admin_set_inspector_approval($1, true, null)', [BUYER]))).ok).toBe(false) // not an inspector
    const a = await audit()
    expect(a.map((x: any) => x.action)).toEqual(['inspector_approved', 'inspector_suspended'])
    expect(a[1].detail.reason).toBe('licence expired')
  })
  it('cancelling a paid booking queues a refund, notifies the buyer and cannot repeat', async () => {
    expect((await attempt(() => call(ADMIN, 'select public.admin_cancel_booking($1, $2)', [bookingId, '']))).ok).toBe(false)
    await call(ADMIN, 'select public.admin_cancel_booking($1, $2)', [bookingId, 'inspector unreachable'])
    expect((await db.query<any>('select status, payment_status from public.bookings where id=$1', [bookingId])).rows[0])
      .toEqual({ status: 'cancelled', payment_status: 'refund_due' })
    expect((await db.query<any>(`select body from public.notifications where user_id=$1 and title like 'Your booking was cancelled'`, [BUYER])).rows[0].body).toContain('refund')
    expect((await attempt(() => call(ADMIN, 'select public.admin_cancel_booking($1, $2)', [bookingId, 'again']))).ok).toBe(false)
    expect((await call(ADMIN, 'select public.admin_overview() as o')).rows[0].o).toMatchObject({ refunds_due: 1, refunds_due_amount: 675 })
  })
  it('a finished booking cannot be cancelled by an admin', async () => {
    const id = (await db.query<any>(`insert into public.bookings (buyer_id, inspector_id, vin, location, status, inspection_fee, amount_due, paid, payment_status)
      values ($1,$2,$3,'x','done',500,675,true,'paid') returning id`, [BUYER, INSP, VIN])).rows[0].id
    const r = await attempt(() => call(ADMIN, 'select public.admin_cancel_booking($1, $2)', [id, 'oops']))
    expect(r.ok).toBe(false); expect(r.error).toMatch(/cannot be cancelled/)
  })
  it('recording a refund needs a reference, only works on refund_due, and is idempotent-safe', async () => {
    expect((await attempt(() => call(ADMIN, 'select public.admin_mark_refunded($1, $2)', [bookingId, '']))).ok).toBe(false)
    await call(ADMIN, 'select public.admin_mark_refunded($1, $2)', [bookingId, 'PF-REFUND-123'])
    expect((await db.query<any>('select payment_status from public.bookings where id=$1', [bookingId])).rows[0].payment_status).toBe('refunded')
    expect((await attempt(() => call(ADMIN, 'select public.admin_mark_refunded($1, $2)', [bookingId, 'PF-REFUND-123']))).ok).toBe(false)
    expect((await db.query<any>(`select count(*)::int n from public.payment_events where outcome='refunded_by_operator'`)).rows[0].n).toBe(1)
  })
  it('every write is in the audit log with the acting admin, readable through admin_list_audit', async () => {
    const rows = (await call(SUPPORT, 'select * from public.admin_list_audit()')).rows
    expect(rows.map((r: any) => r.action)).toEqual(
      ['booking_refund_recorded', 'booking_cancelled', 'inspector_suspended', 'inspector_approved'])
    expect(rows.every((r: any) => r.admin_email?.includes(ADMIN))).toBe(true)
  })
})

describe('admin_update_inspector_profile', () => {
  const args = [INSP, 'Cert A', 'LIC-1', 'Midrand', '8 years', 450, 30]
  const sql = 'select public.admin_update_inspector_profile($1,$2,$3,$4,$5,$6,$7)'
  it('buyers, inspectors, support and anon cannot write it', async () => {
    for (const who of [BUYER, INSP, SUPPORT]) expect((await attempt(() => call(who, sql, args))).ok).toBe(false)
    expect((await attempt(() => asAnon(db, () => db.query(sql, args)))).ok).toBe(false)
  })
  it('admin sets the fields, makes the inspector bookable, and it is audited', async () => {
    await call(ADMIN, sql, args)
    const p = (await db.query<any>(`select cert, licence, region, experience, price, eta_minutes from public.profiles where id=$1`, [INSP])).rows[0]
    expect(p).toMatchObject({ cert: 'Cert A', licence: 'LIC-1', region: 'Midrand', experience: '8 years', price: 450, eta_minutes: 30 })
    const a = await db.query<any>(`select 1 from public.admin_audit_log where action='inspector_profile_updated' and target_id=$1`, [INSP])
    expect(a.rows.length).toBe(1)
  })
  it('rejects bad price/ETA and non-inspectors', async () => {
    expect((await attempt(() => call(ADMIN, sql, [INSP, '', '', '', '', 0, 30]))).ok).toBe(false)
    expect((await attempt(() => call(ADMIN, sql, [INSP, '', '', '', '', 450, 9999]))).ok).toBe(false)
    expect((await attempt(() => call(ADMIN, sql, [BUYER, '', '', '', '', 450, 30]))).ok).toBe(false)
  })
})
