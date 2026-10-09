// Regression suite for the live exploits found in the 2026-10-07 audit.
// Each test asserts the SECURE behaviour. Run with LC_MIGRATIONS=0 to prove the exploits
// reproduce against the live baseline; default (migrated) must be fully green.
import { describe, it, expect, beforeAll } from 'vitest'
import { makeDb, addUser, asUser, asAnon, attempt, uid, type Db } from './harness'

const MIG = process.env.LC_MIGRATIONS !== '0'
let db: Db
const BUYER = uid(1), OTHER = uid(2), INSP = uid(3), INSP2 = uid(4)
const VIN = 'TESTVIN0000000001'

beforeAll(async () => {
  db = await makeDb({ migrations: MIG })
  await addUser(db, BUYER, 'buyer'); await addUser(db, OTHER, 'buyer')
  await addUser(db, INSP, 'inspector'); await addUser(db, INSP2, 'inspector')
  // fixtures written as the table owner (stands in for service role / trusted server code)
  await db.query(`insert into vehicles (vin, make, model, year, first_tracked_by) values ($1,'VW','Polo',2019,$2)`, [VIN, BUYER])
  await db.query(`insert into bookings (id, buyer_id, inspector_id, vin, location, status, inspection_fee, paid)
    values ($1,$2,$3,$4,'Sandton','in_progress',500,true)`, [uid(100), BUYER, INSP, VIN])
  await db.query(`insert into inspections (id, booking_id, vin, inspector_id, score, verdict, full_price, report_price, payer_cut, inspector_cut)
    values ($1,$2,$3,$4,80,'ok',500,90,46,44)`, [uid(200), uid(100), VIN, INSP])
  await db.query(`insert into report_items (inspection_id, section, component, condition) values ($1,'engine','oil','good')`, [uid(200)])
})

describe('privilege escalation', () => {
  it('a buyer cannot make themselves an inspector', async () => {
    await attempt(() => asUser(db, OTHER, () => db.query(`update public.profiles set role='inspector' where id=$1`, [OTHER])))
    const r = await db.query<{ role: string }>(`select role from public.profiles where id=$1`, [OTHER])
    expect(r.rows[0].role).toBe('buyer')
  })
  it('an inspector cannot edit rating / jobs_completed / price / top_rated', async () => {
    await attempt(() => asUser(db, INSP, () => db.query(`update public.profiles set rating=5, jobs_completed=999, top_rated=true, price=1 where id=$1`, [INSP])))
    const r = await db.query<any>(`select rating, jobs_completed, top_rated from public.profiles where id=$1`, [INSP])
    expect(r.rows[0].jobs_completed).not.toBe(999)
    expect(r.rows[0].top_rated).not.toBe(true)
  })
})

describe('booking / payment manipulation', () => {
  it('a buyer cannot insert a booking already marked paid', async () => {
    const r = await attempt(() => asUser(db, OTHER, () => db.query(
      `insert into public.bookings (buyer_id, vin, location, inspection_fee, paid) values ($1,$2,'x',1,true)`, [OTHER, VIN])))
    expect(r.ok).toBe(false)
  })
  it('a buyer cannot insert a booking with a self-chosen fee', async () => {
    const r = await attempt(() => asUser(db, OTHER, () => db.query(
      `insert into public.bookings (buyer_id, vin, location, inspection_fee) values ($1,$2,'x',1)`, [OTHER, VIN])))
    expect(r.ok).toBe(false)
  })
  it('a buyer cannot flip paid / status / inspector on their own booking', async () => {
    await db.query(`insert into bookings (id, buyer_id, vin, location, inspection_fee, paid) values ($1,$2,$3,'x',500,false)`, [uid(101), OTHER, VIN])
    await attempt(() => asUser(db, OTHER, () => db.query(`update public.bookings set paid=true, status='done', inspector_id=$2 where id=$1`, [uid(101), OTHER])))
    const r = await db.query<any>(`select paid, status, inspector_id from public.bookings where id=$1`, [uid(101)])
    expect(r.rows[0].paid).toBe(false); expect(r.rows[0].status).toBe('pending'); expect(r.rows[0].inspector_id).toBeNull()
  })
  it('an inspector cannot rewrite the fee or paid flag of an assigned booking', async () => {
    await attempt(() => asUser(db, INSP, () => db.query(`update public.bookings set inspection_fee=99999, paid=false where id=$1`, [uid(100)])))
    const r = await db.query<any>(`select inspection_fee, paid from public.bookings where id=$1`, [uid(100)])
    expect(r.rows[0].inspection_fee).toBe(500); expect(r.rows[0].paid).toBe(true)
  })
})

describe('fabricated reports and earnings', () => {
  it('an inspector cannot insert an inspection with self-chosen prices', async () => {
    await db.query(`insert into bookings (id, buyer_id, inspector_id, vin, location, status, inspection_fee, paid) values ($1,$2,$3,$4,'x','in_progress',500,true)`, [uid(102), OTHER, INSP, VIN])
    const r = await attempt(() => asUser(db, INSP, () => db.query(
      `insert into public.inspections (booking_id, vin, inspector_id, score, full_price, report_price, payer_cut, inspector_cut)
       values ($1,$2,$3,90,500,100000,0,100000)`, [uid(102), VIN, INSP])))
    expect(r.ok).toBe(false)
  })
  it('a buyer cannot insert a report_purchases row for themselves', async () => {
    const r = await attempt(() => asUser(db, OTHER, () => db.query(
      `insert into public.report_purchases (inspection_id, buyer_id, amount_paid, payer_earning, inspector_earning) values ($1,$2,0,0,0)`, [uid(200), OTHER])))
    expect(r.ok).toBe(false)
  })
})

describe('cross-user data access', () => {
  it('an unrelated buyer cannot read someone else\'s inspection or checklist', async () => {
    const insp = await asUser(db, OTHER, () => db.query(`select id from public.inspections where id=$1`, [uid(200)]))
    expect(insp.rows.length).toBe(0)
    const items = await attempt(async () => (await asUser(db, OTHER, () => db.query(`select id from public.report_items where inspection_id=$1`, [uid(200)]))).rows.length)
    // either an error or zero rows is secure; returning rows is not
    if (items.ok) {
      const n = (await asUser(db, OTHER, () => db.query(`select id from public.report_items where inspection_id=$1`, [uid(200)]))).rows.length
      expect(n).toBe(0)
    }
  })
  it('the commissioning buyer and the inspector CAN read the full report', async () => {
    const b = await asUser(db, BUYER, () => db.query(`select id from public.report_items where inspection_id=$1`, [uid(200)]))
    const i = await asUser(db, INSP, () => db.query(`select id from public.report_items where inspection_id=$1`, [uid(200)]))
    expect(b.rows.length).toBe(1); expect(i.rows.length).toBe(1)
  })
  it('another buyer cannot read someone else\'s booking', async () => {
    const r = await asUser(db, OTHER, () => db.query(`select id from public.bookings where id=$1`, [uid(100)]))
    expect(r.rows.length).toBe(0)
  })
  it('anonymous callers read nothing', async () => {
    const r = await attempt(async () => (await asAnon(db, () => db.query(`select vin from public.vehicles`))).rows.length)
    if (r.ok) expect((await asAnon(db, () => db.query(`select vin from public.vehicles`))).rows.length).toBe(0)
  })
})

describe('vehicle ownership', () => {
  it('another user cannot steal first_tracked_by', async () => {
    await attempt(() => asUser(db, OTHER, () => db.query(`update public.vehicles set first_tracked_by=$2 where vin=$1`, [VIN, OTHER])))
    const r = await db.query<any>(`select first_tracked_by from public.vehicles where vin=$1`, [VIN])
    expect(r.rows[0].first_tracked_by).toBe(BUYER)
  })
})
