// Behaviour of the server-side booking / payment / report flows (migrated schema only).
import { describe, it, expect, beforeAll } from 'vitest'
import { makeDb, addUser, asUser, asService, attempt, uid, type Db } from './harness'

let db: Db
const BUYER = uid(1), BUYER2 = uid(2), INSP = uid(3), INSP2 = uid(4), NEWINSP = uid(5)

const bookingArgs = (inspector: string, vin = 'AAA111GP') =>
  [vin, 'Toyota', 'Corolla', 2019, 'CMH Toyota Midrand', 'check the clutch', inspector]
const callBook = (who: string, args: unknown[]) => asUser(db, who, () =>
  db.query<any>('select * from public.create_booking($1,$2,$3,$4,$5,$6,$7)', args))
const itn = (kind: string, id: string, pf: string | null, status: string, amount: number) =>
  asService(db, () => db.query<{ r: string }>(
    'select public.apply_payfast_itn($1,$2,$3,$4,$5,$6::jsonb) as r', [kind, id, pf, status, amount, '{}'])).then(x => x.rows[0].r)
const bookingRow = async (id: string) => (await db.query<any>('select * from public.bookings where id=$1', [id])).rows[0]

const ITEMS = [{ section: 'engine', component: 'oil', condition: 'good', explanation: null, roadworthy_relevant: false }]
const FINDINGS = [{ area: 'Engine', status: 'pass', note: 'secret note' }]
const submit = (who: string, bookingId: string, score = 85) => asUser(db, who, () => db.query<any>(
  'select * from public.submit_detailed_report($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb)',
  [bookingId, score, 'Good car', 120000, 'pass', '[]', '[]', JSON.stringify(FINDINGS), JSON.stringify(ITEMS), '[]', '[]']))

async function paidBooking(buyer = BUYER, inspector = INSP, vin = 'AAA111GP') {
  const b = (await callBook(buyer, bookingArgs(inspector, vin))).rows[0]
  expect(await itn('booking', b.id, 'pf-' + b.id, 'COMPLETE', b.amount_due)).toBe('applied')
  return b.id as string
}

beforeAll(async () => {
  db = await makeDb({ migrations: true })
  for (const [id, role] of [[BUYER, 'buyer'], [BUYER2, 'buyer'], [INSP, 'inspector'], [INSP2, 'inspector'], [NEWINSP, 'inspector']] as const)
    await addUser(db, id, role, 'User ' + id.slice(-2))
  await db.query(`update public.profiles set approved=true, online=true, price=500 where id in ($1,$2)`, [INSP, INSP2])
})

describe('signup / approval', () => {
  it('new inspectors start unapproved and cannot go online', async () => {
    const p = await db.query<any>('select approved, role from public.profiles where id=$1', [NEWINSP])
    expect(p.rows[0]).toMatchObject({ approved: false, role: 'inspector' })
    expect((await attempt(() => asUser(db, NEWINSP, () => db.query('select public.set_online(true)')))).ok).toBe(false)
  })
  it('a buyer cannot call set_online or accept jobs', async () => {
    expect((await attempt(() => asUser(db, BUYER, () => db.query('select public.set_online(true)')))).ok).toBe(false)
  })
  it('unapproved inspectors are not in the directory; approved ones are, without email/phone', async () => {
    const r = await asUser(db, BUYER, () => db.query<any>('select * from public.inspector_directory'))
    const ids = r.rows.map((x: any) => x.id)
    expect(ids).toContain(INSP); expect(ids).not.toContain(NEWINSP)
    expect(Object.keys(r.rows[0])).not.toContain('email'); expect(Object.keys(r.rows[0])).not.toContain('phone')
  })
  it('a buyer cannot read another user\'s profile (email)', async () => {
    const r = await asUser(db, BUYER, () => db.query<any>('select email from public.profiles where id=$1', [INSP]))
    expect(r.rows.length).toBe(0)
  })
  it('anon cannot call RPCs or read the directory', async () => {
    await db.exec('set role anon')
    const r = await attempt(() => db.query('select * from public.inspector_directory'))
    const r2 = await attempt(() => db.query('select public.accept_booking($1)', [uid(999)]))
    await db.exec('reset role')
    expect(r.ok).toBe(false); expect(r2.ok).toBe(false)
  })
})

describe('create_booking', () => {
  it('computes the price on the server and ignores any client money', async () => {
    const b = (await callBook(BUYER, bookingArgs(INSP, 'PRICE1GP'))).rows[0]
    expect(b).toMatchObject({ inspection_fee: 500, travel_fee: 100, platform_fee: 75, amount_due: 675, paid: false, payment_status: 'unpaid', status: 'pending' })
  })
  it('rejects inspectors, unapproved/offline inspectors and bad input', async () => {
    expect((await attempt(() => callBook(INSP, bookingArgs(INSP2)))).ok).toBe(false)         // inspector booking
    expect((await attempt(() => callBook(BUYER, bookingArgs(NEWINSP)))).ok).toBe(false)     // unapproved
    expect((await attempt(() => callBook(BUYER, bookingArgs(BUYER2)))).ok).toBe(false)       // not an inspector
    expect((await attempt(() => callBook(BUYER, ['x', 'a', 'b', 2020, 'loc here', null, INSP]))).ok).toBe(false)
    expect((await attempt(() => callBook(BUYER, ['ABC123GP', 'a', 'b', 1800, 'loc here', null, INSP]))).ok).toBe(false)
  })
  it('does not let a client overwrite an existing vehicle or claim it', async () => {
    await callBook(BUYER2, ['PRICE1GP', 'Hacked', 'Hacked', 2000, 'somewhere', null, INSP])
    const v = await db.query<any>(`select make, first_tracked_by from public.vehicles where vin='PRICE1GP'`)
    expect(v.rows[0].make).toBe('Toyota'); expect(v.rows[0].first_tracked_by).toBeNull()
  })
  it('caps unpaid bookings per buyer', async () => {
    let failed = false
    for (let n = 0; n < 8; n++) { if (!(await attempt(() => callBook(OTHERBUYER, bookingArgs(INSP, 'CAP' + String(n).padStart(4, '0') + 'GP')))).ok) failed = true }
    expect(failed).toBe(true)
  })
})
const OTHERBUYER = uid(6)
beforeAll(async () => { await addUser(db, OTHERBUYER, 'buyer') })

describe('payment confirmation (ITN) integrity', () => {
  it('marks paid only on a correct COMPLETE and is idempotent', async () => {
    const b = (await callBook(BUYER, bookingArgs(INSP, 'ITN001GP'))).rows[0]
    expect(await itn('booking', b.id, 'pf1', 'COMPLETE', b.amount_due)).toBe('applied')
    expect(await itn('booking', b.id, 'pf1', 'COMPLETE', b.amount_due)).toBe('duplicate')
    const row = await bookingRow(b.id)
    expect(row).toMatchObject({ paid: true, payment_status: 'paid', payment_reference: 'pf1' })
    const v = await db.query<any>(`select first_tracked_by from public.vehicles where vin='ITN001GP'`)
    expect(v.rows[0].first_tracked_by).toBe(BUYER)
    const n = await db.query<any>(`select count(*)::int c from public.notifications where user_id=$1 and title='New inspection request'`, [INSP])
    expect(n.rows[0].c).toBeGreaterThanOrEqual(1)
  })
  it('rejects a wrong amount and leaves the booking unpaid', async () => {
    const b = (await callBook(BUYER, bookingArgs(INSP, 'ITN002GP'))).rows[0]
    expect(await itn('booking', b.id, 'pf2', 'COMPLETE', 1)).toBe('amount_mismatch')
    expect((await bookingRow(b.id)).paid).toBe(false)
  })
  it('ignores FAILED / CANCELLED / PENDING and never downgrades a paid booking', async () => {
    const b = (await callBook(BUYER, bookingArgs(INSP, 'ITN003GP'))).rows[0]
    expect(await itn('booking', b.id, 'pf3a', 'FAILED', b.amount_due)).toBe('ignored_failed')
    expect((await bookingRow(b.id)).paid).toBe(false)
    expect(await itn('booking', b.id, 'pf3b', 'COMPLETE', b.amount_due)).toBe('applied')
    expect(await itn('booking', b.id, 'pf3c', 'FAILED', b.amount_due)).toBe('ignored_failed')
    expect((await bookingRow(b.id)).paid).toBe(true)
  })
  it('flags a second payment with a different reference instead of double-applying', async () => {
    const b = (await callBook(BUYER, bookingArgs(INSP, 'ITN004GP'))).rows[0]
    await itn('booking', b.id, 'pf4a', 'COMPLETE', b.amount_due)
    expect(await itn('booking', b.id, 'pf4b', 'COMPLETE', b.amount_due)).toBe('already_paid_other_reference')
    expect((await bookingRow(b.id)).payment_reference).toBe('pf4a')
  })
  it('rejects unknown orders / kinds and records every attempt', async () => {
    expect(await itn('booking', uid(777), 'pf5', 'COMPLETE', 100)).toBe('unknown_order')
    expect(await itn('bogus', uid(777), 'pf6', 'COMPLETE', 100)).toBe('rejected_kind')
    const ev = await db.query<any>(`select count(*)::int c from public.payment_events`)
    expect(ev.rows[0].c).toBeGreaterThan(5)
  })
  it('a payment arriving after the buyer cancelled is queued for refund, not for the inspector', async () => {
    const b = (await callBook(BUYER, bookingArgs(INSP, 'ITN007GP'))).rows[0]
    await asUser(db, BUYER, () => db.query('select public.cancel_booking($1)', [b.id]))
    expect(await itn('booking', b.id, 'pf7', 'COMPLETE', b.amount_due)).toBe('applied')
    expect((await bookingRow(b.id)).payment_status).toBe('refund_due')
  })
  it('clients cannot call apply_payfast_itn or the order helpers', async () => {
    for (const [sql, args] of [
      ['select public.apply_payfast_itn($1,$2,$3,$4,$5,$6::jsonb)', ['booking', uid(1), 'x', 'COMPLETE', 1, '{}']],
      ['select * from public.create_report_order_for($1,$2)', [BUYER, uid(1)]],
      ['select * from public.prepare_booking_payment($1,$2)', [BUYER, uid(1)]],
      ['select public.admin_approve_inspector($1)', [NEWINSP]],
    ] as const) expect((await attempt(() => asUser(db, BUYER, () => db.query(sql, args as unknown[])))).ok).toBe(false)
    expect((await attempt(() => asUser(db, BUYER, () => db.query('select * from public.payment_events')))).ok).toBe(false)
  })
})

describe('accept / decline / state machine', () => {
  it('unpaid bookings are invisible to the inspector and cannot be accepted', async () => {
    const b = (await callBook(BUYER, bookingArgs(INSP, 'SM0001GP'))).rows[0]
    const seen = await asUser(db, INSP, () => db.query<any>('select id from public.bookings where id=$1', [b.id]))
    expect(seen.rows.length).toBe(0)
    expect((await attempt(() => asUser(db, INSP, () => db.query('select public.accept_booking($1)', [b.id])))).ok).toBe(false)
  })
  it('only the assigned inspector can accept, and only once (race-safe)', async () => {
    const id = await paidBooking(BUYER, INSP, 'SM0002GP')
    expect((await attempt(() => asUser(db, INSP2, () => db.query('select public.accept_booking($1)', [id])))).ok).toBe(false)
    const first = await attempt(() => asUser(db, INSP, () => db.query('select public.accept_booking($1)', [id])))
    const second = await attempt(() => asUser(db, INSP, () => db.query('select public.accept_booking($1)', [id])))
    expect(first.ok).toBe(true); expect(second.ok).toBe(false)
    expect((await bookingRow(id)).status).toBe('accepted')
  })
  it('enforces the status order and refuses jumps / invalid targets', async () => {
    const id = await paidBooking(BUYER, INSP, 'SM0003GP')
    const adv = (s: string, who = INSP) => attempt(() => asUser(db, who, () => db.query('select public.advance_booking($1,$2)', [id, s])))
    expect((await adv('en_route')).ok).toBe(false)           // not accepted yet
    await asUser(db, INSP, () => db.query('select public.accept_booking($1)', [id]))
    expect((await adv('done')).ok).toBe(false)               // cannot self-complete
    expect((await adv('en_route', INSP2)).ok).toBe(false)    // not the assigned inspector
    expect((await adv('en_route')).ok).toBe(true)
    expect((await adv('in_progress')).ok).toBe(true)
    expect((await adv('en_route')).ok).toBe(false)           // no going backwards
  })
  it('decline of a paid booking cancels it and queues a refund; the buyer sees it', async () => {
    const id = await paidBooking(BUYER, INSP, 'SM0004GP')
    await asUser(db, INSP, () => db.query('select public.decline_booking($1)', [id]))
    expect(await bookingRow(id)).toMatchObject({ status: 'cancelled', payment_status: 'refund_due', cancel_reason: 'declined_by_inspector' })
    const n = await asUser(db, BUYER, () => db.query<any>(`select title from public.notifications where title='Inspector unavailable'`))
    expect(n.rows.length).toBeGreaterThan(0)
  })
  it('a buyer can cancel only before acceptance', async () => {
    const id = await paidBooking(BUYER, INSP, 'SM0005GP')
    await asUser(db, INSP, () => db.query('select public.accept_booking($1)', [id]))
    expect((await attempt(() => asUser(db, BUYER, () => db.query('select public.cancel_booking($1)', [id])))).ok).toBe(false)
    expect((await attempt(() => asUser(db, BUYER2, () => db.query('select public.cancel_booking($1)', [id])))).ok).toBe(false)
  })
  it('inspector job view shows the buyer first name only for the inspector\'s own paid jobs', async () => {
    const rows = await asUser(db, INSP, () => db.query<any>('select * from public.inspector_jobs'))
    expect(rows.rows.length).toBeGreaterThan(0)
    expect(rows.rows.every((r: any) => r.inspector_id === INSP && r.paid)).toBe(true)
    expect(Object.keys(rows.rows[0])).not.toContain('buyer_id')
    const other = await asUser(db, INSP2, () => db.query<any>('select * from public.inspector_jobs'))
    expect(other.rows.length).toBe(0)
  })
})

describe('report submit, access, preview and resale purchase', () => {
  let bookingId: string, inspectionId: string
  beforeAll(async () => {
    bookingId = await paidBooking(BUYER, INSP, 'RPT001GP')
    await asUser(db, INSP, () => db.query('select public.accept_booking($1)', [bookingId]))
  })
  it('only the assigned inspector can submit; prices are computed on the server', async () => {
    expect((await attempt(() => submit(INSP2, bookingId))).ok).toBe(false)
    expect((await attempt(() => submit(BUYER, bookingId))).ok).toBe(false)
    const r = await submit(INSP, bookingId)
    inspectionId = r.rows[0].inspection_id
    const i = (await db.query<any>('select full_price, report_price, payer_cut, inspector_cut from public.inspections where id=$1', [inspectionId])).rows[0]
    expect(i).toEqual({ full_price: 500, report_price: 90, payer_cut: 46, inspector_cut: 44 })
    expect((await bookingRow(bookingId)).status).toBe('done')
    const p = await db.query<any>('select jobs_completed from public.profiles where id=$1', [INSP])
    expect(p.rows[0].jobs_completed).toBe(1)
  })
  it('submitting twice is idempotent: same report, no duplicate rows or counters', async () => {
    const again = await submit(INSP, bookingId)
    expect(again.rows[0].inspection_id).toBe(inspectionId)
    const c = await db.query<any>('select count(*)::int c from public.inspections where booking_id=$1', [bookingId])
    expect(c.rows[0].c).toBe(1)
    expect((await db.query<any>('select jobs_completed from public.profiles where id=$1', [INSP])).rows[0].jobs_completed).toBe(1)
  })
  it('cannot submit for an unpaid booking', async () => {
    const b = (await callBook(BUYER, bookingArgs(INSP, 'RPT002GP'))).rows[0]
    expect((await attempt(() => submit(INSP, b.id))).ok).toBe(false)
  })
  it('rejects out-of-range scores', async () => {
    const id = await paidBooking(BUYER, INSP, 'RPT003GP')
    await asUser(db, INSP, () => db.query('select public.accept_booking($1)', [id]))
    expect((await attempt(() => submit(INSP, id, 150))).ok).toBe(false)
  })
  it('a non-purchaser sees only the preview (no notes, no verdict, no checklist)', async () => {
    const pv = (await asUser(db, BUYER2, () => db.query<any>('select public.report_preview($1) as p', ['RPT001GP']))).rows[0].p
    expect(pv).toMatchObject({ score: 85, report_price: 90, payer_cut: 46, owned: false, verdict: null })
    expect(pv.areas[0].note).toBeNull()
    expect((await asUser(db, BUYER2, () => db.query('select id from public.report_items'))).rows.length).toBe(0)
    expect((await asUser(db, BUYER2, () => db.query('select id from public.inspection_findings'))).rows.length).toBe(0)
  })
  it('purchase: server-created order, forged amount rejected, correct COMPLETE unlocks and credits earnings', async () => {
    const order = (await asService(db, () => db.query<any>('select * from public.create_report_order_for($1,$2)', [BUYER2, inspectionId]))).rows[0]
    expect(order.amount).toBe(90)
    expect(await itn('report', order.id, 'rp1', 'COMPLETE', 1)).toBe('amount_mismatch')
    expect((await asUser(db, BUYER2, () => db.query('select id from public.report_items'))).rows.length).toBe(0)
    expect(await itn('report', order.id, 'rp2', 'COMPLETE', 90)).toBe('applied')
    expect(await itn('report', order.id, 'rp2', 'COMPLETE', 90)).toBe('duplicate')
    expect((await asUser(db, BUYER2, () => db.query('select id from public.report_items'))).rows.length).toBe(1)
    const pv = (await asUser(db, BUYER2, () => db.query<any>('select public.report_preview($1) as p', ['RPT001GP']))).rows[0].p
    expect(pv.owned).toBe(true); expect(pv.verdict).toBe('Good car')
    const rp = (await db.query<any>('select amount_paid, payer_earning, inspector_earning from public.report_purchases where inspection_id=$1', [inspectionId])).rows
    expect(rp).toEqual([{ amount_paid: 90, payer_earning: 46, inspector_earning: 44 }])
    const earn = await asUser(db, INSP, () => db.query<any>('select inspector_earning from public.report_purchases'))
    expect(earn.rows.length).toBe(1)
    const nt = await db.query<any>(`select user_id from public.notifications where type='earn'`)
    expect(nt.rows.map((x: any) => x.user_id).sort()).toEqual([BUYER, INSP].sort())
  })
  it('the commissioning buyer and the inspector cannot buy their own report', async () => {
    for (const u of [BUYER, INSP])
      expect((await attempt(() => asService(db, () => db.query('select * from public.create_report_order_for($1,$2)', [u, inspectionId])))).ok).toBe(false)
  })
  it('an already-purchased report cannot be ordered twice', async () => {
    expect((await attempt(() => asService(db, () => db.query('select * from public.create_report_order_for($1,$2)', [BUYER2, inspectionId])))).ok).toBe(false)
  })
  it('photos: only the owning inspector can register photos, and only under their inspection folder', async () => {
    const ins = (path: string, who: string) => attempt(() => asUser(db, who, () => db.query(
      `insert into public.report_photos (inspection_id, section, storage_path) values ($1,'overview',$2)`, [inspectionId, path])))
    expect((await ins(inspectionId + '/a.jpg', INSP)).ok).toBe(true)
    expect((await ins('other/a.jpg', INSP)).ok).toBe(false)
    expect((await ins(inspectionId + '/b.jpg', BUYER2)).ok).toBe(false)
    expect((await ins(inspectionId + '/c.jpg', INSP2)).ok).toBe(false)
  })
})

describe('direct table writes are closed', () => {
  it('no authenticated user can write privileged tables directly', async () => {
    const stmts = [
      `insert into public.bookings (buyer_id, vin, location, inspection_fee) values ('${BUYER}','AAA111GP','x',1)`,
      `update public.bookings set paid=true`, `delete from public.bookings`,
      `insert into public.vehicles (vin, make, model, year) values ('ZZZ999','a','b',2000)`,
      `update public.vehicles set make='x'`,
      `insert into public.report_purchases (inspection_id, buyer_id, amount_paid, payer_earning, inspector_earning) values ('${uid(1)}','${BUYER}',0,0,0)`,
      `insert into public.notifications (user_id, type, title, body) values ('${BUYER}','sys','x','y')`,
      `update public.notifications set title='x'`,
      `update public.profiles set online=true, approved=true`, `update public.profiles set email='a@b.c'`,
      `insert into public.report_items (inspection_id, section, component, condition) values ('${uid(1)}','a','b','good')`,
      `update public.inspections set score=100`, `delete from public.inspections`,
      `insert into public.report_orders (inspection_id, buyer_id, amount) values ('${uid(1)}','${BUYER}',0)`,
      `update public.report_orders set status='paid'`,
    ]
    for (const s of stmts) {
      for (const who of [BUYER, INSP]) {
        const r = await attempt(() => asUser(db, who, async () => { await db.exec(s) }))
        expect(r.ok, `${who === BUYER ? 'buyer' : 'inspector'} must not run: ${s}`).toBe(false)
        expect(r.error, `denied for the right reason: ${s}`).toMatch(/permission denied|row-level security/)
      }
    }
  })
  it('a user can still mark their own notifications read', async () => {
    const r = await asUser(db, BUYER, () => db.query(`update public.notifications set read=true where user_id=$1`, [BUYER]))
    expect(r.affectedRows).toBeGreaterThan(0)
    const other = await asUser(db, BUYER2, () => db.query(`update public.notifications set read=true where user_id=$1`, [BUYER]))
    expect(other.affectedRows).toBe(0)
  })
  it('a user can still edit their own presentation fields', async () => {
    const r = await asUser(db, BUYER, () => db.query(`update public.profiles set phone='0821234567' where id=$1`, [BUYER]))
    expect(r.affectedRows).toBe(1)
  })
})
