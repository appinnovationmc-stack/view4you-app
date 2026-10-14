// Auction / dealership bookings, inspector credential badges, testing stations and roadworthy certificates.
import { describe, it, expect, beforeAll } from 'vitest'
import { makeDb, addUser, asUser, asService, asAnon, attempt, uid, type Db } from './harness'
import { CHECKLIST } from '../../src/lib/reportTemplate'
import { AREAS } from '../../src/lib/reportMapping'

let db: Db
const BUYER = uid(1), BUYER2 = uid(2), INSP = uid(3), INSP2 = uid(4), ADMIN = uid(90), SUPPORT = uid(91)
let STATION = '', DORMANT = ''

const call = (who: string, sql: string, args: unknown[] = []) => asUser(db, who, () => db.query<any>(sql, args))
const addFile = (bucket: string, path: string) => db.query(`insert into storage.objects (bucket_id, name) values ($1,$2)`, [bucket, path])
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()
const dateIn = (d: number) => inDays(d).slice(0, 10)

const BOOK = `select * from public.create_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`
// The app caps a buyer at 5 unpaid bookings a day; these tests create many, so clear that bucket first.
const book = async (who: string, o: Partial<{ vin: string; inspector: string; kind: string; venue: string | null; auctionAt: string | null; lot: string | null; needed: string | null; station: string | null }> = {}) => {
  await db.query(`delete from public.bookings where buyer_id=$1 and payment_status='unpaid' and status='pending'`, [who])
  return call(who, BOOK, [o.vin ?? 'AUC111GP', 'VW', 'Polo', 2018, '12 Auction Rd, Johannesburg', null, o.inspector ?? INSP2,
    o.kind ?? 'private', o.venue ?? null, o.auctionAt ?? null, o.lot ?? null, o.needed ?? null, o.station ?? null])
}
const itn = (id: string, amount: number) => asService(db, () => db.query<{ r: string }>(
  'select public.apply_payfast_itn($1,$2,$3,$4,$5,$6::jsonb) as r', ['booking', id, 'pf-' + id, 'COMPLETE', amount, '{}'])).then((x) => x.rows[0].r)

beforeAll(async () => {
  db = await makeDb({ migrations: true })
  for (const [id, role] of [[BUYER, 'buyer'], [BUYER2, 'buyer'], [INSP, 'inspector'], [INSP2, 'inspector'], [ADMIN, 'buyer'], [SUPPORT, 'buyer']] as const)
    await addUser(db, id, role, 'User ' + id.slice(-2))
  await db.query(`update public.profiles set approved=true, online=true, price=500 where id in ($1,$2)`, [INSP, INSP2])
  await db.query(`insert into public.admin_users (user_id, role) values ($1,'admin'), ($2,'support')`, [ADMIN, SUPPORT])
  const save = (name: string) => call(ADMIN, `select public.admin_save_station(null,$1,'1 Test Rd','Midrand','Gauteng','011 000 0000','B','VTS-0042','Mon-Fri 8-16',250,'Light vehicles',-25.99,28.13) as id`, [name])
  STATION = (await save('Midrand Testing Station')).rows[0].id
  DORMANT = (await save('Dormant Station')).rows[0].id
  await call(ADMIN, `select public.admin_set_station_active($1,true,'registration checked')`, [STATION])
})

describe('bookings at dealerships and auctions', () => {
  it('the old 7-argument call still works and is a private booking with the unchanged price', async () => {
    const r = await call(BUYER, 'select * from public.create_booking($1,$2,$3,$4,$5,$6,$7)', ['OLD111GP', 'Toyota', 'Corolla', 2019, 'Midrand', null, INSP2])
    expect(r.rows[0]).toMatchObject({ venue_kind: 'private', venue_name: null, roadworthy_requested: false, addon_fee: 0 })
    expect(r.rows[0].amount_due).toBe(500 + 100 + 75)
  })

  it('an auction booking stores venue, lot, auction time and defaults the deadline to the auction start', async () => {
    const at = inDays(3)
    const r = await book(BUYER, { kind: 'auction', venue: 'Smith Auctioneers', auctionAt: at, lot: '42' })
    expect(r.rows[0]).toMatchObject({ venue_kind: 'auction', venue_name: 'Smith Auctioneers', lot_number: '42' })
    expect(new Date(r.rows[0].needed_by).getTime()).toBe(new Date(r.rows[0].auction_at).getTime())
  })

  it('rejects an auction without a name or a future start, and a deadline after the auction', async () => {
    const f = async (o: any) => (await attempt(() => book(BUYER, o)))
    expect((await f({ kind: 'auction', venue: null, auctionAt: inDays(3) })).ok).toBe(false)
    expect((await f({ kind: 'auction', venue: 'Smith Auctioneers', auctionAt: null })).ok).toBe(false)
    expect((await f({ kind: 'auction', venue: 'Smith Auctioneers', auctionAt: inDays(-1) })).ok).toBe(false)
    expect((await f({ kind: 'auction', venue: 'Smith Auctioneers', auctionAt: inDays(3), needed: inDays(4) })).ok).toBe(false)
    expect((await f({ kind: 'auction', venue: 'Smith Auctioneers', auctionAt: inDays(3), needed: inDays(2) })).ok).toBe(true)
    expect((await f({ kind: 'carboot', venue: 'x' })).ok).toBe(false)
  })

  it('a dealership booking needs the dealership name; a private one drops stray venue data', async () => {
    expect((await attempt(() => book(BUYER, { kind: 'dealership', venue: null }))).ok).toBe(false)
    const d = await book(BUYER, { kind: 'dealership', venue: 'CMH Toyota Midrand' })
    expect(d.rows[0]).toMatchObject({ venue_kind: 'dealership', venue_name: 'CMH Toyota Midrand', auction_at: null })
    const p = await book(BUYER, { kind: 'private', venue: 'ignored', lot: '9', auctionAt: inDays(3) })
    expect(p.rows[0]).toMatchObject({ venue_kind: 'private', venue_name: null, lot_number: null, auction_at: null })
  })

  it('the assigned inspector sees venue, lot and deadline on a paid job; other inspectors do not see it', async () => {
    const b = (await book(BUYER, { vin: 'JOB111GP', kind: 'auction', venue: 'Smith Auctioneers', auctionAt: inDays(2), lot: '7' })).rows[0]
    expect(await itn(b.id, b.amount_due)).toBe('applied')
    const mine = await call(INSP2, 'select venue_kind, venue_name, lot_number, needed_by from public.inspector_jobs where id=$1', [b.id])
    expect(mine.rows[0]).toMatchObject({ venue_kind: 'auction', venue_name: 'Smith Auctioneers', lot_number: '7' })
    expect(mine.rows[0].needed_by).toBeTruthy()
    expect((await call(INSP, 'select 1 from public.inspector_jobs where id=$1', [b.id])).rows.length).toBe(0)
  })
})

describe('testing stations and the roadworthy add-on', () => {
  it('only operators manage stations; support is read-only; buyers see active stations only', async () => {
    expect((await attempt(() => call(BUYER, `select public.admin_save_station(null,'x','1 Rd',null,null,null,'A','R1',null,0,null,null,null)`))).ok).toBe(false)
    expect((await attempt(() => call(SUPPORT, `select public.admin_save_station(null,'xx','1 Rd',null,null,null,'A','R1',null,0,null,null,null)`))).ok).toBe(false)
    expect((await call(SUPPORT, 'select * from public.admin_list_stations()')).rows.length).toBe(2)
    const seen = (await call(BUYER, 'select id from public.list_testing_stations()')).rows.map((r: any) => r.id)
    expect(seen).toContain(STATION); expect(seen).not.toContain(DORMANT)
    expect((await attempt(() => call(BUYER, 'select * from public.testing_stations'))).ok).toBe(false)
    expect((await attempt(() => asAnon(db, () => db.query('select * from public.list_testing_stations()')))).ok).toBe(false)
  })

  it('validates station details', async () => {
    const bad = (grade: string, reg: string, fee: number) => attempt(() => call(ADMIN, `select public.admin_save_station(null,'Valid Name','1 Rd',null,null,null,$1,$2,null,$3,null,null,null)`, [grade, reg, fee]))
    expect((await bad('D', 'R1', 100)).ok).toBe(false)
    expect((await bad('A', ' ', 100)).ok).toBe(false)
    expect((await bad('A', 'R1', 99999)).ok).toBe(false)
  })

  it('a booking cannot use an inactive station; an active one adds the operator fee to the price and keeps the station fee quote', async () => {
    expect((await attempt(() => book(BUYER, { vin: 'RW0001GP', station: DORMANT }))).ok).toBe(false)
    const free = (await book(BUYER, { vin: 'RW0002GP', station: STATION })).rows[0]
    expect(free).toMatchObject({ roadworthy_requested: true, addon_fee: 0, station_fee_quote: 250 })
    expect(free.amount_due).toBe(675)
    await call(ADMIN, 'select public.admin_set_roadworthy_fee(150, $1)', ['coordination'])
    const paid = (await book(BUYER, { vin: 'RW0003GP', station: STATION })).rows[0]
    expect(paid).toMatchObject({ addon_fee: 150, amount_due: 825 })
    expect((await call(BUYER, 'select public.booking_options() as o')).rows[0].o).toEqual({ roadworthy_addon_fee: 150, travel_fee: 100, platform_fee: 75 })
    expect(await itn(paid.id, 825)).toBe('applied')                 // payment accepts exactly the new total
    const wrong = (await book(BUYER, { vin: 'RW0004GP', station: STATION })).rows[0]
    expect(await itn(wrong.id, 675)).not.toBe('applied')            // the old total is refused
  })

  it('only an admin can change the add-on fee, within limits', async () => {
    expect((await attempt(() => call(SUPPORT, 'select public.admin_set_roadworthy_fee(10, null)'))).ok).toBe(false)
    expect((await attempt(() => call(BUYER, 'select public.admin_set_roadworthy_fee(10, null)'))).ok).toBe(false)
    expect((await attempt(() => call(ADMIN, 'select public.admin_set_roadworthy_fee(-1, null)'))).ok).toBe(false)
    expect((await attempt(() => call(ADMIN, 'select public.admin_set_roadworthy_fee(5001, null)'))).ok).toBe(false)
  })
})

describe('inspector credential badges', () => {
  const reg = (who: string, kind: string, path: string, num: string | null, grade: string | null, exp: string | null) =>
    call(who, 'select public.register_my_credential($1,$2,$3,$4,$5,$6) as id', [kind, path, 'cert.pdf', num, grade, exp])

  it('an EOV credential needs a number and a grade, a real upload in the inspector\'s own folder, and is not a badge until approved', async () => {
    await addFile('inspector-docs', `${INSP2}/eov.pdf`)
    expect((await attempt(() => reg(INSP2, 'eov', `${INSP2}/eov.pdf`, 'EOV-1', null, null))).ok).toBe(false)
    expect((await attempt(() => reg(INSP2, 'eov', `${INSP2}/eov.pdf`, null, 'A', null))).ok).toBe(false)
    expect((await attempt(() => reg(INSP2, 'eov', `${INSP2}/missing.pdf`, 'EOV-1', 'A', null))).ok).toBe(false)
    expect((await attempt(() => reg(INSP, 'eov', `${INSP2}/eov.pdf`, 'EOV-1', 'A', null))).ok).toBe(false)
    expect((await attempt(() => reg(BUYER, 'eov', `${BUYER}/eov.pdf`, 'EOV-1', 'A', null))).ok).toBe(false)
    expect((await attempt(() => reg(INSP2, 'eov', `${INSP2}/eov.pdf`, 'EOV-1', 'A', dateIn(-2)))).ok).toBe(false)
    const id = (await reg(INSP2, 'eov', `${INSP2}/eov.pdf`, 'EOV-1', 'B', dateIn(300))).rows[0].id
    const before = await call(BUYER, 'select badges from public.inspector_directory where id=$1', [INSP2])
    expect(before.rows[0].badges).toEqual([])
    await call(ADMIN, 'select public.admin_review_document($1,true,null)', [id])
    const after = await call(BUYER, 'select badges from public.inspector_directory where id=$1', [INSP2])
    expect(after.rows[0].badges).toEqual([{ kind: 'eov', grade: 'B' }])
    expect(JSON.stringify(after.rows[0].badges)).not.toContain('EOV-1')   // the number is never public
  })

  it('an expired or rejected credential stops being a badge; an approved ID adds identity verified', async () => {
    await addFile('inspector-docs', `${INSP2}/id.jpg`)
    const idDoc = (await call(INSP2, `select public.register_my_document('id',$1,'id.jpg') as id`, [`${INSP2}/id.jpg`])).rows[0].id
    await call(ADMIN, 'select public.admin_review_document($1,true,null)', [idDoc])
    let b = (await call(BUYER, 'select badges from public.inspector_directory where id=$1', [INSP2])).rows[0].badges
    expect(b.map((x: any) => x.kind)).toEqual(['identity_verified', 'eov'])
    await db.query(`update public.inspector_documents set expires_on = current_date - 1 where user_id=$1 and kind='eov'`, [INSP2])
    b = (await call(BUYER, 'select badges from public.inspector_directory where id=$1', [INSP2])).rows[0].badges
    expect(b.map((x: any) => x.kind)).toEqual(['identity_verified'])
  })

  it('operators see the number; the inspector sees only their own credentials; a support agent cannot approve', async () => {
    const admin = await call(ADMIN, 'select kind, credential_number, credential_grade from public.admin_list_documents($1) where kind=$2', [INSP2, 'eov'])
    expect(admin.rows[0]).toMatchObject({ credential_number: 'EOV-1', credential_grade: 'B' })
    expect((await call(INSP2, 'select * from public.my_credentials()')).rows.length).toBe(1)
    expect((await call(INSP, 'select * from public.my_credentials()')).rows.length).toBe(0)
    const id = (await call(INSP2, 'select id from public.my_credentials()')).rows[0].id
    expect((await attempt(() => call(SUPPORT, 'select public.admin_review_document($1,true,null)', [id]))).ok).toBe(false)
  })
})

describe('roadworthy certificates on the report', () => {
  let bookingId = '', inspectionId = ''
  const path = (f: string) => `${bookingId}/${f}`
  const submit = (who: string, p: string, num = 'RWC-001', result = 'pass', issued = dateIn(-1), exp: string | null = dateIn(59)) =>
    call(who, 'select public.submit_roadworthy_certificate($1,$2,$3,$4,$5,$6) as id', [bookingId, p, num, result, issued, exp])

  beforeAll(async () => {
    await call(ADMIN, 'select public.admin_set_roadworthy_fee(0, null)')
    const b = (await book(BUYER, { vin: 'CERT11GP', inspector: INSP2, station: STATION })).rows[0]
    bookingId = b.id
    expect(await itn(b.id, b.amount_due)).toBe('applied')
    await call(INSP2, 'select public.accept_booking($1)', [b.id])
    await call(INSP2, `select public.advance_booking($1,'en_route')`, [b.id])
    await call(INSP2, `select public.advance_booking($1,'in_progress')`, [b.id])
    await call(INSP2, 'select * from public.submit_detailed_report($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb)',
      [b.id, 100, 'Good', 100000, 'pass', '[]', '[]', JSON.stringify(AREAS.map(area => ({ area, status: 'pass', note: 'ok' }))),
        JSON.stringify(CHECKLIST.flatMap(sec => sec.rows.map(([component, , rw]) => ({ section: sec.key, component, condition: 'good', explanation: null, roadworthy_relevant: !!rw })))),
        '[]', JSON.stringify(['Front Left', 'Front Right', 'Rear Left', 'Rear Right'].map(position => ({ position, tread_mm: 5.5 })))])
    inspectionId = (await db.query<any>('select id from public.inspections where booking_id=$1', [bookingId])).rows[0].id
  })

  it('shows nothing before a certificate exists; only the booking\'s buyer or inspector can attach one', async () => {
    expect((await call(BUYER, 'select public.report_extras($1) as r', [inspectionId])).rows[0].r.roadworthy_certificate).toBeNull()
    await addFile('roadworthy-certs', path('rwc.pdf'))
    expect((await attempt(() => submit(BUYER2, path('rwc.pdf')))).ok).toBe(false)
    expect((await attempt(() => submit(INSP, path('rwc.pdf')))).ok).toBe(false)
    expect((await attempt(() => submit(BUYER, path('missing.pdf')))).ok).toBe(false)
    expect((await attempt(() => submit(BUYER, `${uid(777)}/rwc.pdf`))).ok).toBe(false)
    expect((await attempt(() => submit(BUYER, path('rwc.pdf'), 'RWC-001', 'maybe'))).ok).toBe(false)
    expect((await attempt(() => submit(BUYER, path('rwc.pdf'), 'RWC-001', 'pass', dateIn(5)))).ok).toBe(false)
  })

  it('a submitted certificate shows on the report as unverified, then verified, without the document or its path', async () => {
    await submit(BUYER, path('rwc.pdf'))
    let r = (await call(BUYER, 'select public.report_extras($1) as r', [inspectionId])).rows[0].r
    expect(r.roadworthy_certificate).toMatchObject({ certificate_number: 'RWC-001', result: 'pass', verified: false, station_name: 'Midrand Testing Station', station_grade: 'B' })
    expect(JSON.stringify(r)).not.toContain('rwc.pdf')
    const cid = (await call(ADMIN, `select id from public.admin_list_certificates('submitted')`)).rows[0].id
    expect((await attempt(() => call(SUPPORT, 'select public.admin_review_certificate($1,true,null)', [cid]))).ok).toBe(false)
    expect((await attempt(() => call(ADMIN, 'select public.admin_review_certificate($1,false,null)', [cid]))).ok).toBe(false)   // reason needed
    await call(ADMIN, 'select public.admin_review_certificate($1,true,null)', [cid])
    r = (await call(BUYER, 'select public.report_extras($1) as r', [inspectionId])).rows[0].r
    expect(r.roadworthy_certificate.verified).toBe(true)
    expect(r.venue.kind).toBe('private')
    expect(r.inspector_badges.map((x: any) => x.kind)).toEqual(['identity_verified'])
  })

  it('a verified certificate cannot be replaced; a rejected one disappears from the report', async () => {
    expect((await attempt(() => submit(BUYER, path('rwc.pdf'), 'RWC-002'))).ok).toBe(false)
    const cid = (await call(ADMIN, `select id from public.admin_list_certificates('verified')`)).rows[0].id
    await db.query(`update public.roadworthy_certificates set status='submitted' where id=$1`, [cid])
    await call(ADMIN, `select public.admin_review_certificate($1,false,'number does not match the station')`, [cid])
    expect((await call(BUYER, 'select public.report_extras($1) as r', [inspectionId])).rows[0].r.roadworthy_certificate).toBeNull()
    const note = await call(BUYER, `select body from public.notifications where title='Roadworthy certificate needs attention'`)
    expect(note.rows.length).toBe(1)
    await submit(BUYER, path('rwc.pdf'), 'RWC-003')                           // the buyer can upload a corrected one
    expect((await call(BUYER, 'select * from public.booking_certificate($1)', [bookingId])).rows[0].certificate_number).toBe('RWC-003')
  })

  it('certificate details are private to the booking parties and operators', async () => {
    expect((await attempt(() => call(BUYER2, 'select * from public.booking_certificate($1)', [bookingId]))).ok).toBe(false)
    expect((await call(ADMIN, 'select * from public.booking_certificate($1)', [bookingId])).rows.length).toBe(1)
    expect((await attempt(() => call(BUYER, 'select * from public.roadworthy_certificates'))).ok).toBe(false)
    expect((await attempt(() => call(BUYER2, 'select public.report_extras($1)', [inspectionId]))).ok).toBe(false)
    const files = async (who: string) => (await call(who, `select name from storage.objects where bucket_id='roadworthy-certs'`)).rows.length
    expect(await files(BUYER)).toBe(1); expect(await files(INSP2)).toBe(1); expect(await files(BUYER2)).toBe(0); expect(await files(ADMIN)).toBe(1)
  })

  it('a booking without the add-on cannot take a certificate', async () => {
    const b = (await book(BUYER, { vin: 'NOCERT1GP' })).rows[0]
    await itn(b.id, b.amount_due)
    await addFile('roadworthy-certs', `${b.id}/x.pdf`)
    expect((await attempt(() => call(BUYER, 'select public.submit_roadworthy_certificate($1,$2,$3,$4,$5,$6)', [b.id, `${b.id}/x.pdf`, 'RWC-9', 'pass', dateIn(-1), null]))).ok).toBe(false)
  })
})
