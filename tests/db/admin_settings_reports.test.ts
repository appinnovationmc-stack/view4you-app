// Admin: editable pricing, report takedown, booking reassignment.
import { describe, it, expect, beforeAll } from 'vitest'
import { makeDb, addUser, asUser, asAnon, attempt, uid, type Db } from './harness'

let db: Db
const BUYER = uid(1), BUYER2 = uid(2), INSP = uid(3), INSP2 = uid(4), PENDING_INSP = uid(5), ADMIN = uid(90), SUPPORT = uid(91)
const VIN = 'SET111GP'
let bookingId = '', doneBookingId = '', inspectionId = ''

const call = (who: string, sql: string, args: unknown[] = []) => asUser(db, who, () => db.query<any>(sql, args))
const settingsArgs = (o: Partial<Record<string, unknown>> = {}) => {
  const s: any = { travel: 100, platform: 75, price: 1800, payer: 5150, plat: 0, min: 100, docs: false, reason: 'test', ...o }
  return [s.travel, s.platform, s.price, s.payer, s.plat, s.min, s.docs, s.reason]
}
const UPDATE = 'select public.admin_update_settings($1,$2,$3,$4,$5,$6,$7,$8)'

beforeAll(async () => {
  db = await makeDb({ migrations: true })
  for (const [id, role] of [[BUYER, 'buyer'], [BUYER2, 'buyer'], [INSP, 'inspector'], [INSP2, 'inspector'], [PENDING_INSP, 'inspector'], [ADMIN, 'buyer'], [SUPPORT, 'buyer']] as const)
    await addUser(db, id, role, 'User ' + id.slice(-2))
  await db.query(`update public.profiles set approved=true, online=true, price=500 where id in ($1,$2)`, [INSP, INSP2])
  await db.query(`insert into public.admin_users (user_id, role) values ($1,'admin'), ($2,'support')`, [ADMIN, SUPPORT])
  await db.query(`insert into public.vehicles (vin, make, model, year) values ($1,'Toyota','Corolla',2019)`, [VIN])
  bookingId = (await db.query<any>(
    `insert into public.bookings (buyer_id, inspector_id, vin, location, status, inspection_fee, amount_due, paid, payment_status)
     values ($1,$2,$3,'Midrand','accepted',500,675,true,'paid') returning id`, [BUYER, INSP, VIN])).rows[0].id
  doneBookingId = (await db.query<any>(
    `insert into public.bookings (buyer_id, inspector_id, vin, location, status, inspection_fee, amount_due, paid, payment_status)
     values ($1,$2,$3,'Sandton','done',500,675,true,'paid') returning id`, [BUYER, INSP, VIN])).rows[0].id
  inspectionId = (await db.query<any>(
    `insert into public.inspections (booking_id, vin, inspector_id, score, verdict, full_price, report_price, payer_cut, inspector_cut, report_number)
     values ($1,$2,$3,80,'ok',500,90,46,44,'LC-TEST-000001') returning id`, [doneBookingId, VIN, INSP])).rows[0].id
})

const NEW_CALLS: [string, string, unknown[]][] = [
  ['get settings', 'select public.admin_get_settings()', []],
  ['update settings', UPDATE, settingsArgs()],
  ['list reports', 'select * from public.admin_list_reports()', []],
  ['takedown', 'select public.admin_takedown_report($1,$2)', [uid(500), 'why']],
  ['restore', 'select public.admin_restore_report($1)', [uid(500)]],
  ['assignable', 'select * from public.admin_list_assignable_inspectors()', []],
  ['reassign', 'select public.admin_reassign_booking($1,$2,$3)', [uid(500), INSP2, 'why']],
]

describe('access', () => {
  it.each(NEW_CALLS)('buyers and inspectors are refused: %s', async (_n, sql, args) => {
    for (const who of [BUYER, INSP]) {
      const r = await attempt(() => call(who, sql, args))
      expect(r.ok).toBe(false); expect(r.error).toMatch(/Admin access required|permission denied/i)
    }
  })
  it.each(NEW_CALLS)('anonymous callers are refused: %s', async (_n, sql, args) => {
    expect((await attempt(() => asAnon(db, () => db.query(sql, args)))).ok).toBe(false)
  })
  it('support can read but not write', async () => {
    expect((await call(SUPPORT, 'select public.admin_get_settings() as s')).rows[0].s.travel_fee).toBe(100)
    expect((await call(SUPPORT, 'select * from public.admin_list_reports()')).rows.length).toBe(1)
    for (const [sql, args] of [
      [UPDATE, settingsArgs()],
      ['select public.admin_takedown_report($1,$2)', [inspectionId, 'x']],
      ['select public.admin_restore_report($1)', [inspectionId]],
      ['select public.admin_reassign_booking($1,$2,$3)', [bookingId, INSP2, 'x']],
    ] as [string, unknown[]][]) {
      const r = await attempt(() => call(SUPPORT, sql, args))
      expect(r.ok, sql).toBe(false); expect(r.error).toMatch(/admin role/i)
    }
  })
  it('the settings table is invisible to clients, even an admin', async () => {
    for (const who of [BUYER, ADMIN]) {
      expect((await attempt(() => call(who, 'select * from public.lc_settings'))).ok).toBe(false)
      expect((await attempt(() => call(who, 'update public.lc_settings set travel_fee = 0'))).ok).toBe(false)
    }
  })
})

describe('pricing settings', () => {
  it('defaults match the old hard-coded values', async () => {
    expect((await db.query<any>('select public.lc_travel_fee() t, public.lc_platform_fee() p')).rows[0]).toEqual({ t: 100, p: 75 })
    expect((await db.query<any>('select * from public.lc_report_split(500)')).rows[0]).toEqual({ report_price: 90, payer_cut: 46, inspector_cut: 44 })
  })
  it('validates every input and needs a reason', async () => {
    for (const bad of [
      { reason: '  ' }, { travel: -1 }, { platform: 5001 }, { price: 10001 }, { payer: 6000, plat: 5000 }, { min: -5 }, { travel: null },
    ])
      expect((await attempt(() => call(ADMIN, UPDATE, settingsArgs(bad)))).ok, JSON.stringify(bad)).toBe(false)
    expect((await db.query<any>('select public.lc_travel_fee() t')).rows[0].t).toBe(100)
  })
  it('a change takes effect on the next booking quote and report split, is audited with before and after', async () => {
    await call(ADMIN, UPDATE, settingsArgs({ travel: 150, platform: 100, price: 2000, payer: 5000, plat: 1000, min: 200, docs: true, reason: 'Q4 pricing' }))
    expect((await db.query<any>('select public.lc_travel_fee() t, public.lc_platform_fee() p')).rows[0]).toEqual({ t: 150, p: 100 })
    // 500 * 20% = 100; payer 50% = 50; platform 10% = 10; inspector the rest = 40
    expect((await db.query<any>('select * from public.lc_report_split(500)')).rows[0]).toEqual({ report_price: 100, payer_cut: 50, inspector_cut: 40 })
    const s = (await call(ADMIN, 'select public.admin_get_settings() as s')).rows[0].s
    expect(s).toMatchObject({ travel_fee: 150, min_payout: 200, require_documents: true })
    const a = (await db.query<any>(`select detail from public.admin_audit_log where action='settings_updated'`)).rows
    expect(a.length).toBe(1)
    expect(a[0].detail.reason).toBe('Q4 pricing')
    expect(a[0].detail.before.travel_fee).toBe(100)
    expect(a[0].detail.after.travel_fee).toBe(150)
  })
  it('existing bookings and reports keep their stored amounts', async () => {
    expect((await db.query<any>('select amount_due from public.bookings where id=$1', [bookingId])).rows[0].amount_due).toBe(675)
    expect((await db.query<any>('select report_price from public.inspections where id=$1', [inspectionId])).rows[0].report_price).toBe(90)
  })
  it('restores the defaults for the tests below', async () => {
    await call(ADMIN, UPDATE, settingsArgs({ reason: 'revert' }))
    expect((await db.query<any>('select * from public.lc_report_split(500)')).rows[0]).toEqual({ report_price: 90, payer_cut: 46, inspector_cut: 44 })
  })
})

describe('report takedown', () => {
  it('lists reports with purchase counts and filters', async () => {
    const r = (await call(ADMIN, 'select * from public.admin_list_reports()')).rows
    expect(r[0]).toMatchObject({ report_number: 'LC-TEST-000001', vin: VIN })
    expect(Number(r[0].purchases)).toBe(0)
    expect((await call(ADMIN, `select * from public.admin_list_reports('taken_down')`)).rows.length).toBe(0)
    expect((await call(ADMIN, `select * from public.admin_list_reports('live', '%')`)).rows.length).toBe(0)
    expect((await attempt(() => call(ADMIN, `select * from public.admin_list_reports('bogus')`))).ok).toBe(false)
  })
  it('the buyer can read it before takedown, nobody can after, and the preview skips it', async () => {
    expect((await call(BUYER, 'select id from public.inspections')).rows.length).toBe(1)
    expect((await call(BUYER2, 'select public.report_preview($1) as p', [VIN])).rows[0].p.inspection_id).toBe(inspectionId)
    expect((await attempt(() => call(ADMIN, 'select public.admin_takedown_report($1,$2)', [inspectionId, ' ']))).ok).toBe(false)
    await db.query(`insert into public.report_orders (inspection_id, buyer_id, amount) values ($1,$2,90)`, [inspectionId, BUYER2])
    await call(ADMIN, 'select public.admin_takedown_report($1,$2)', [inspectionId, 'photos did not match the car'])
    expect((await call(BUYER, 'select id from public.inspections')).rows.length).toBe(0)
    expect((await call(INSP, 'select id from public.inspections')).rows.length).toBe(0)
    expect((await call(BUYER2, 'select public.report_preview($1) as p', [VIN])).rows[0].p).toBeNull()
    expect((await db.query<any>('select status from public.report_orders where inspection_id=$1', [inspectionId])).rows[0].status).toBe('cancelled')
  })
  it('a taken-down report cannot be ordered and cannot be taken down twice', async () => {
    const r = await attempt(() => db.query(`insert into public.report_orders (inspection_id, buyer_id, amount) values ($1,$2,90)
                                             on conflict (inspection_id, buyer_id) do nothing`, [inspectionId, SUPPORT]))
    expect(r.ok).toBe(false); expect(r.error).toMatch(/not available/)
    expect((await attempt(() => call(ADMIN, 'select public.admin_takedown_report($1,$2)', [inspectionId, 'again']))).ok).toBe(false)
  })
  it('the inspector and the buyer are told, and the takedown is audited with the reason', async () => {
    for (const who of [INSP, BUYER])
      expect((await db.query<any>(`select count(*)::int n from public.notifications where user_id=$1 and title='A report was taken down'`, [who])).rows[0].n).toBe(1)
    const a = (await db.query<any>(`select detail from public.admin_audit_log where action='report_taken_down'`)).rows
    expect(a[0].detail.reason).toBe('photos did not match the car')
    expect((await call(ADMIN, `select * from public.admin_list_reports('taken_down')`)).rows[0].taken_down_reason).toBe('photos did not match the car')
  })
  it('restoring brings it back', async () => {
    await call(ADMIN, 'select public.admin_restore_report($1)', [inspectionId])
    expect((await call(BUYER, 'select id from public.inspections')).rows.length).toBe(1)
    expect((await call(BUYER2, 'select public.report_preview($1) as p', [VIN])).rows[0].p.inspection_id).toBe(inspectionId)
    expect((await attempt(() => call(ADMIN, 'select public.admin_restore_report($1)', [inspectionId]))).ok).toBe(false)
  })
})

describe('reassign a booking', () => {
  it('lists only approved inspectors', async () => {
    const ids = (await call(ADMIN, 'select * from public.admin_list_assignable_inspectors()')).rows.map((r: any) => r.id).sort()
    expect(ids).toEqual([INSP, INSP2].sort())
  })
  it('rejects a missing reason, an unapproved inspector, the same inspector, a non-inspector and a finished booking', async () => {
    const fail = async (b: string, i: string, why: string, re: RegExp) => {
      const r = await attempt(() => call(ADMIN, 'select public.admin_reassign_booking($1,$2,$3)', [b, i, why]))
      expect(r.ok).toBe(false); expect(r.error).toMatch(re)
    }
    await fail(bookingId, INSP2, ' ', /reason/i)
    await fail(bookingId, PENDING_INSP, 'x', /not approved/)
    await fail(bookingId, INSP, 'x', /already has/)
    await fail(bookingId, BUYER, 'x', /not approved/)
    await fail(doneBookingId, INSP2, 'x', /cannot be reassigned/)
  })
  it('moves a paid booking to the new inspector, resets it to pending, notifies everyone and audits it', async () => {
    await call(ADMIN, 'select public.admin_reassign_booking($1,$2,$3)', [bookingId, INSP2, 'inspector no-show'])
    expect((await db.query<any>('select inspector_id, status, accepted_at from public.bookings where id=$1', [bookingId])).rows[0])
      .toEqual({ inspector_id: INSP2, status: 'pending', accepted_at: null })
    for (const [who, title] of [[INSP2, 'New job assigned'], [BUYER, 'Your inspector changed'], [INSP, 'Job reassigned']])
      expect((await db.query<any>(`select count(*)::int n from public.notifications where user_id=$1 and title=$2`, [who, title])).rows[0].n, title).toBe(1)
    const a = (await db.query<any>(`select detail from public.admin_audit_log where action='booking_reassigned'`)).rows[0].detail
    expect(a).toMatchObject({ reason: 'inspector no-show', from: INSP, to: INSP2, was_status: 'accepted' })
    // the new inspector sees it; the old one no longer does
    expect((await call(INSP2, 'select id from public.bookings')).rows.map((r: any) => r.id)).toContain(bookingId)
    expect((await call(INSP, 'select id from public.bookings where id=$1', [bookingId])).rows.length).toBe(0)
  })
  it('an unpaid booking cannot be reassigned', async () => {
    const id = (await db.query<any>(`insert into public.bookings (buyer_id, inspector_id, vin, location, status, inspection_fee, amount_due, paid, payment_status)
      values ($1,$2,$3,'x','pending',500,675,false,'unpaid') returning id`, [BUYER, INSP, VIN])).rows[0].id
    const r = await attempt(() => call(ADMIN, 'select public.admin_reassign_booking($1,$2,$3)', [id, INSP2, 'x']))
    expect(r.ok).toBe(false); expect(r.error).toMatch(/Only paid/)
  })
})
