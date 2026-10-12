// Inspector documents, support tickets, analytics and the widened overview.
import { describe, it, expect, beforeAll } from 'vitest'
import { makeDb, addUser, asUser, asAnon, attempt, uid, type Db } from './harness'

let db: Db
const BUYER = uid(1), BUYER2 = uid(2), INSP = uid(3), INSP2 = uid(4), ADMIN = uid(90), SUPPORT = uid(91)
const VIN = 'DOC111GP'
let bookingId = ''

const call = (who: string, sql: string, args: unknown[] = []) => asUser(db, who, () => db.query<any>(sql, args))
const addFile = (path: string, bucket = 'inspector-docs') =>
  db.query(`insert into storage.objects (bucket_id, name) values ($1,$2)`, [bucket, path])
const REG = 'select public.register_my_document($1,$2,$3) as id'

beforeAll(async () => {
  db = await makeDb({ migrations: true })
  for (const [id, role] of [[BUYER, 'buyer'], [BUYER2, 'buyer'], [INSP, 'inspector'], [INSP2, 'inspector'], [ADMIN, 'buyer'], [SUPPORT, 'buyer']] as const)
    await addUser(db, id, role, 'User ' + id.slice(-2))
  await db.query(`update public.profiles set approved=true, online=true, price=500 where id=$1`, [INSP2])
  await db.query(`insert into public.admin_users (user_id, role) values ($1,'admin'), ($2,'support')`, [ADMIN, SUPPORT])
  await db.query(`insert into public.vehicles (vin, make, model, year) values ($1,'Toyota','Corolla',2019)`, [VIN])
  bookingId = (await db.query<any>(
    `insert into public.bookings (buyer_id, inspector_id, vin, location, status, inspection_fee, amount_due, paid, payment_status, accepted_at, completed_at)
     values ($1,$2,$3,'Midrand','done',500,675,true,'paid', now(), now()) returning id`, [BUYER, INSP2, VIN])).rows[0].id
})

describe('inspector documents', () => {
  it('only inspectors can register a file, only in their own folder, and only if it was uploaded', async () => {
    await addFile(`${INSP}/id-front.jpg`)
    await addFile(`${INSP2}/other.jpg`)
    const fail = async (who: string, args: unknown[], re: RegExp) => {
      const r = await attempt(() => call(who, REG, args)); expect(r.ok, args.join('|')).toBe(false); expect(r.error).toMatch(re)
    }
    await fail(BUYER, ['id', `${BUYER}/x.jpg`, 'x.jpg'], /Only inspectors/)
    await fail(INSP, ['passport', `${INSP}/id-front.jpg`, 'id.jpg'], /Unknown document type/)
    await fail(INSP, ['id', `${INSP2}/other.jpg`, 'other.jpg'], /Bad file path/)
    await fail(INSP, ['id', `${INSP}/../${INSP2}/other.jpg`, 'x.jpg'], /Bad file path/)
    await fail(INSP, ['id', `${INSP}/missing.jpg`, 'missing.jpg'], /not uploaded/)
    await fail(INSP, ['id', `${INSP}/id-front.jpg`, '  '], /File name/)
    expect((await asAnon(db, () => attempt(() => db.query(REG, ['id', 'x/y', 'y'])))).ok).toBe(false)
    const id = (await call(INSP, REG, ['id', `${INSP}/id-front.jpg`, 'id-front.jpg'])).rows[0].id
    expect(id).toBeTruthy()
    expect((await attempt(() => call(INSP, REG, ['id', `${INSP}/id-front.jpg`, 'again.jpg']))).ok).toBe(false) // same path twice
  })
  it('an inspector sees their own documents and nobody else does', async () => {
    expect((await call(INSP, 'select * from public.my_documents()')).rows.map((r: any) => r.status)).toEqual(['pending'])
    expect((await call(INSP2, 'select * from public.my_documents()')).rows.length).toBe(0)
    for (const who of [INSP, ADMIN]) {
      expect((await attempt(() => call(who, 'select * from public.inspector_documents'))).ok).toBe(false)
      expect((await attempt(() => call(who, `update public.inspector_documents set status='approved'`))).ok).toBe(false)
    }
  })
  it('storage rules: own folder only, operators can read everything, others cannot', async () => {
    const put = (who: string, path: string) => attempt(() => call(who, `insert into storage.objects (bucket_id, name) values ('inspector-docs', $1)`, [path]))
    expect((await put(INSP, `${INSP}/licence.pdf`)).ok).toBe(true)
    expect((await put(INSP, `${INSP2}/sneaky.pdf`)).ok).toBe(false)
    expect((await put(BUYER, `${BUYER}/not-an-inspector.pdf`)).ok).toBe(false)
    const visible = async (who: string) => (await call(who, `select name from storage.objects where bucket_id='inspector-docs'`)).rows.map((r: any) => r.name)
    expect(await visible(INSP)).toEqual(expect.arrayContaining([`${INSP}/id-front.jpg`, `${INSP}/licence.pdf`]))
    expect(await visible(INSP)).not.toContain(`${INSP2}/other.jpg`)
    expect((await visible(SUPPORT)).length).toBe(3)
    expect((await visible(ADMIN)).length).toBe(3)
    expect(await visible(BUYER)).toEqual([])
  })
  it('the bucket is private with a size and type limit', async () => {
    expect((await db.query<any>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='inspector-docs'`)).rows[0])
      .toEqual({ public: false, file_size_limit: 10485760, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] })
  })
  it('the operator list shows document counts and paths; buyers and inspectors are refused', async () => {
    await call(INSP, REG, ['licence', `${INSP}/licence.pdf`, 'licence.pdf'])
    const row = (await call(ADMIN, `select * from public.admin_list_inspectors('pending')`)).rows.find((r: any) => r.id === INSP)
    expect(Number(row.docs_pending)).toBe(2)
    const docs = (await call(SUPPORT, 'select * from public.admin_list_documents($1)', [INSP])).rows
    expect(docs.map((d: any) => d.kind).sort()).toEqual(['id', 'licence'])
    expect(docs[0].storage_path.startsWith(INSP + '/')).toBe(true)
    for (const who of [BUYER, INSP])
      expect((await attempt(() => call(who, 'select * from public.admin_list_documents($1)', [INSP]))).error).toMatch(/Admin access required|permission/i)
  })
  it('reviewing needs the admin role, a reason to reject, notifies the inspector and is audited', async () => {
    const docs = (await call(ADMIN, 'select * from public.admin_list_documents($1)', [INSP])).rows
    const idDoc = docs.find((d: any) => d.kind === 'id').id, licDoc = docs.find((d: any) => d.kind === 'licence').id
    expect((await attempt(() => call(SUPPORT, 'select public.admin_review_document($1,true)', [idDoc]))).error).toMatch(/admin role/)
    expect((await attempt(() => call(ADMIN, 'select public.admin_review_document($1,false,$2)', [idDoc, ' ']))).ok).toBe(false)
    expect((await attempt(() => call(ADMIN, 'select public.admin_review_document($1,true)', [uid(900)]))).ok).toBe(false)
    await call(ADMIN, 'select public.admin_review_document($1,false,$2)', [licDoc, 'photo is blurry'])
    await call(ADMIN, 'select public.admin_review_document($1,true)', [idDoc])
    const mine = (await call(INSP, 'select * from public.my_documents()')).rows
    expect(mine.find((d: any) => d.kind === 'licence')).toMatchObject({ status: 'rejected', reject_reason: 'photo is blurry' })
    expect(mine.find((d: any) => d.kind === 'id').status).toBe('approved')
    expect((await db.query<any>(`select body from public.notifications where user_id=$1 and title='Document needs attention'`, [INSP])).rows[0].body).toContain('photo is blurry')
    expect((await db.query<any>(`select action from public.admin_audit_log where action like 'document_%' order by id`)).rows.map((r: any) => r.action))
      .toEqual(['document_rejected', 'document_approved'])
  })
  it('with documents required, approval waits for an approved ID and an approved licence; suspending is never blocked', async () => {
    await call(ADMIN, `select public.admin_update_settings(100,75,1800,5150,0,100,true,'require docs')`)
    const r = await attempt(() => call(ADMIN, 'select public.admin_set_inspector_approval($1,true,null)', [INSP]))
    expect(r.ok).toBe(false); expect(r.error).toMatch(/Approve an ID document and a licence/)
    await addFile(`${INSP}/licence2.pdf`)
    const lic2 = (await call(INSP, REG, ['licence', `${INSP}/licence2.pdf`, 'licence2.pdf'])).rows[0].id
    await call(ADMIN, 'select public.admin_review_document($1,true)', [lic2])
    await call(ADMIN, 'select public.admin_set_inspector_approval($1,true,null)', [INSP])
    expect((await db.query<any>('select approved from public.profiles where id=$1', [INSP])).rows[0].approved).toBe(true)
    await call(ADMIN, 'select public.admin_set_inspector_approval($1,false,$2)', [INSP2, 'paused'])   // INSP2 has no documents
    expect((await db.query<any>('select approved from public.profiles where id=$1', [INSP2])).rows[0].approved).toBe(false)
    await call(ADMIN, 'select public.admin_set_inspector_approval($1,true,null)', [INSP2]).catch(() => undefined)
    await call(ADMIN, `select public.admin_update_settings(100,75,1800,5150,0,100,false,'documents optional again')`)
    await call(ADMIN, 'select public.admin_set_inspector_approval($1,true,null)', [INSP2])
  })
  it('the cap is 12 documents', async () => {
    for (let i = 0; i < 12; i++) await addFile(`${INSP}/bulk-${i}.jpg`)
    const have = Number((await db.query<any>('select count(*) n from public.inspector_documents where user_id=$1', [INSP])).rows[0].n)
    let err = ''
    for (let i = 0; i < 12; i++) {
      const r = await attempt(() => call(INSP, REG, ['other', `${INSP}/bulk-${i}.jpg`, `bulk-${i}.jpg`]))
      if (!r.ok) { err = r.error!; break }
    }
    expect(have).toBeLessThan(12)
    expect(err).toMatch(/maximum number/)
  })
})

describe('support tickets', () => {
  let ticket = ''
  const OPEN = 'select public.open_ticket($1,$2,$3) as id'
  it('validates the subject, message and booking ownership', async () => {
    for (const args of [['hi', 'body', null], ['A real subject', '   ', null], ['A real subject', 'x'.repeat(4001), null], ['A real subject', 'help', bookingId]])
      expect((await attempt(() => call(BUYER2, OPEN, args))).ok, JSON.stringify(args).slice(0, 40)).toBe(false)
    expect((await asAnon(db, () => attempt(() => db.query(OPEN, ['A real subject', 'help', null])))).ok).toBe(false)
  })
  it('a customer opens a ticket about their own booking; both roles can do it', async () => {
    ticket = (await call(BUYER, OPEN, ['Inspector never arrived', 'Nobody came to Midrand.', bookingId])).rows[0].id
    await call(INSP2, OPEN, ['Payout question', 'When do I get paid?', bookingId])
    const mine = (await call(BUYER, 'select * from public.my_tickets()')).rows
    expect(mine.length).toBe(1)
    expect(mine[0]).toMatchObject({ subject: 'Inspector never arrived', status: 'open', booking_id: bookingId })
    expect(Number(mine[0].messages)).toBe(1)
  })
  it('users cannot read or write tickets directly or see each other\'s threads', async () => {
    for (const who of [BUYER, ADMIN])
      for (const sql of ['select * from public.support_tickets', 'select * from public.ticket_messages',
                         `insert into public.ticket_messages (ticket_id, author_id, body) values ('${ticket}', '${who}', 'x')`])
        expect((await attempt(() => call(who, sql))).ok, sql).toBe(false)
    expect((await attempt(() => call(BUYER2, 'select * from public.my_ticket_thread($1)', [ticket]))).error).toMatch(/No such ticket/)
    expect((await attempt(() => call(BUYER2, 'select public.reply_my_ticket($1,$2)', [ticket, 'hijack']))).error).toMatch(/No such ticket/)
  })
  it('operators of both roles read the queue and thread; customers and anonymous callers cannot', async () => {
    for (const who of [ADMIN, SUPPORT]) {
      const q = (await call(who, 'select * from public.admin_list_tickets()')).rows
      expect(q.length).toBe(2)
      expect(q.find((t: any) => t.id === ticket)).toMatchObject({ vin: VIN, role: 'buyer' })
      expect((await call(who, 'select * from public.admin_ticket_thread($1)', [ticket])).rows.map((m: any) => m.body)).toEqual(['Nobody came to Midrand.'])
    }
    expect((await call(ADMIN, `select * from public.admin_list_tickets('all', $1)`, [VIN.toLowerCase()])).rows.length).toBe(2)
    expect((await call(ADMIN, `select * from public.admin_list_tickets('all', '%')`)).rows.length).toBe(0)
    expect((await attempt(() => call(ADMIN, `select * from public.admin_list_tickets('bogus')`))).ok).toBe(false)
    for (const sql of ['select * from public.admin_list_tickets()', `select * from public.admin_ticket_thread('${ticket}')`,
                       `select public.admin_reply_ticket('${ticket}','x')`, `select public.admin_set_ticket_status('${ticket}','resolved')`]) {
      expect((await attempt(() => call(BUYER, sql))).error, sql).toMatch(/Admin access required|permission/i)
      expect((await attempt(() => asAnon(db, () => db.query(sql)))).ok, sql).toBe(false)
    }
  })
  it('a support-role reply notifies the customer, marks it answered and is audited', async () => {
    expect((await attempt(() => call(SUPPORT, 'select public.admin_reply_ticket($1,$2)', [ticket, '   ']))).ok).toBe(false)
    await call(SUPPORT, 'select public.admin_reply_ticket($1,$2)', [ticket, 'Sorry about that, we are sending another inspector.'])
    expect((await call(BUYER, 'select * from public.my_tickets()')).rows[0].status).toBe('answered')
    const thread = (await call(BUYER, 'select * from public.my_ticket_thread($1)', [ticket])).rows
    expect(thread.map((m: any) => m.from_staff)).toEqual([false, true])
    expect((await db.query<any>(`select count(*)::int n from public.notifications where user_id=$1 and title='Support replied'`, [BUYER])).rows[0].n).toBe(1)
    expect((await db.query<any>(`select detail from public.admin_audit_log where action='ticket_replied'`)).rows[0].detail).toEqual({ resolved: false })
  })
  it('a customer reply reopens it; resolving works with a reply or by status; a reply to a resolved ticket reopens it', async () => {
    await call(BUYER, 'select public.reply_my_ticket($1,$2)', [ticket, 'Thank you'])
    expect((await call(BUYER, 'select * from public.my_tickets()')).rows[0].status).toBe('open')
    await call(ADMIN, 'select public.admin_reply_ticket($1,$2,true)', [ticket, 'Fixed, closing this.'])
    expect((await call(BUYER, 'select * from public.my_tickets()')).rows[0].status).toBe('resolved')
    expect((await call(ADMIN, `select * from public.admin_list_tickets('unresolved')`)).rows.map((t: any) => t.id)).not.toContain(ticket)
    await call(BUYER, 'select public.reply_my_ticket($1,$2)', [ticket, 'Actually it happened again'])
    expect((await call(BUYER, 'select * from public.my_tickets()')).rows[0].status).toBe('open')
    await call(SUPPORT, `select public.admin_set_ticket_status($1,'resolved')`, [ticket])
    expect((await attempt(() => call(SUPPORT, `select public.admin_set_ticket_status($1,'bogus')`, [ticket]))).ok).toBe(false)
    expect((await db.query<any>(`select detail from public.admin_audit_log where action='ticket_status'`)).rows[0].detail).toEqual({ from: 'open', to: 'resolved' })
  })
  it('a customer can have at most 5 unresolved tickets', async () => {
    for (let i = 0; i < 5; i++) await call(BUYER2, OPEN, [`Question number ${i}`, 'help', null])
    const r = await attempt(() => call(BUYER2, OPEN, ['One too many', 'help', null]))
    expect(r.ok).toBe(false); expect(r.error).toMatch(/too many open tickets/)
    const first = (await call(BUYER2, 'select * from public.my_tickets()')).rows[0].id
    await call(ADMIN, `select public.admin_set_ticket_status($1,'resolved')`, [first])
    expect((await attempt(() => call(BUYER2, OPEN, ['Now there is room', 'help', null]))).ok).toBe(true)
  })
})

describe('analytics and overview', () => {
  it('only operators can read analytics; days are clamped', async () => {
    for (const who of [BUYER, INSP]) expect((await attempt(() => call(who, 'select public.admin_analytics(30)'))).error).toMatch(/Admin access required|permission/i)
    expect((await asAnon(db, () => attempt(() => db.query('select public.admin_analytics(30)')))).ok).toBe(false)
    expect((await call(SUPPORT, 'select public.admin_analytics(1) as a')).rows[0].a.days).toBe(7)
    expect((await call(SUPPORT, 'select public.admin_analytics(9999) as a')).rows[0].a.days).toBe(365)
    expect((await call(SUPPORT, 'select public.admin_analytics(null) as a')).rows[0].a.days).toBe(30)
  })
  it('returns one point per day with the right counts, a funnel, repeat buyers and top inspectors', async () => {
    const iid = (await db.query<any>(`insert into public.inspections (booking_id, vin, inspector_id, score, verdict, full_price, report_price, payer_cut, inspector_cut, report_number)
      values ($1,$2,$3,70,'ok',500,90,46,44,'LC-AN-1') returning id`, [bookingId, VIN, INSP2])).rows[0].id
    await db.query(`insert into public.report_purchases (inspection_id, buyer_id, amount_paid, payer_earning, inspector_earning) values ($1,$2,90,46,44)`, [iid, BUYER2])
    await db.query(`insert into public.bookings (buyer_id, inspector_id, vin, location, status, inspection_fee, amount_due, paid, payment_status)
                    values ($1,$2,$3,'Sandton','pending',500,675,false,'unpaid')`, [BUYER, INSP2, VIN])
    const a = (await call(ADMIN, 'select public.admin_analytics(14) as a')).rows[0].a
    expect(a.series.length).toBe(14)
    expect(a.series.map((d: any) => d.day)).toEqual(a.series.map((d: any) => d.day).sort())
    const today = a.series[13]
    expect(today).toMatchObject({ bookings: 2, paid_bookings: 1, booking_revenue: 675, report_sales: 1, report_revenue: 90 })
    expect(a.series.slice(0, 13).every((d: any) => d.bookings === 0 && d.report_sales === 0)).toBe(true)
    expect(a.funnel).toEqual({ created: 2, paid: 1, accepted: 1, completed: 1, cancelled: 0 })
    expect(a.repeat_buyers).toEqual({ buyers: 1, repeat: 0 })
    expect(a.inspectors).toMatchObject({ approved: 2, worked_in_period: 1 })
    expect(a.top_inspectors).toEqual([expect.objectContaining({ jobs: 1 })])
    expect(a.totals).toEqual({ booking_revenue: 675, report_revenue: 90, report_sales: 1 })
  })
  it('the overview includes the new queues and keeps the old keys', async () => {
    await call(INSP, REG, ['other', `${INSP}/licence.pdf`, 'dup.pdf']).catch(() => undefined)
    const o = (await call(SUPPORT, 'select public.admin_overview() as o')).rows[0].o
    for (const k of ['inspectors_pending_approval', 'refunds_due', 'paid_bookings_amount', 'payment_problems_7d', 'bookings_by_status'])
      expect(Object.keys(o)).toContain(k)
    expect(o).toMatchObject({ withdrawals_requested: 0, withdrawals_requested_amount: 0, reports_taken_down: 0 })
    expect(Number(o.tickets_open)).toBeGreaterThanOrEqual(1)
    expect(Number(o.documents_pending)).toBeGreaterThanOrEqual(0)
  })
})
