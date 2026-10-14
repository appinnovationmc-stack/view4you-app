// Earnings ledger, bank details and withdrawals (user side and operator side).
import { describe, it, expect, beforeAll } from 'vitest'
import { makeDb, addUser, asUser, asAnon, attempt, uid, type Db } from './harness'

let db: Db
const BUYER = uid(1), TRACKER = uid(2), INSP = uid(3), INSP2 = uid(4), ADMIN = uid(90), SUPPORT = uid(91)
const VIN = 'LED111GP'
let inspectionId = ''

const call = (who: string, sql: string, args: unknown[] = []) => asUser(db, who, () => db.query<any>(sql, args))
const bal = async (who: string) => Number((await db.query<any>('select public.lc_balance($1)::int b', [who])).rows[0].b)
const ACCOUNT = ['A Tester', 'FNB', '62001234567', '250655', 'cheque']
const SET_ACC = 'select public.set_my_payout_account($1,$2,$3,$4,$5)'

beforeAll(async () => {
  db = await makeDb({ migrations: true })
  for (const [id, role] of [[BUYER, 'buyer'], [TRACKER, 'buyer'], [INSP, 'inspector'], [INSP2, 'inspector'], [ADMIN, 'buyer'], [SUPPORT, 'buyer']] as const)
    await addUser(db, id, role, 'User ' + id.slice(-2))
  await db.query(`update public.profiles set approved=true, online=true, price=500 where id in ($1,$2)`, [INSP, INSP2])
  await db.query(`insert into public.admin_users (user_id, role) values ($1,'admin'), ($2,'support')`, [ADMIN, SUPPORT])
  await db.query(`insert into public.vehicles (vin, make, model, year, first_tracked_by) values ($1,'Toyota','Corolla',2019,$2)`, [VIN, TRACKER])
  const b = (await db.query<any>(
    `insert into public.bookings (buyer_id, inspector_id, vin, location, status, inspection_fee, amount_due, paid, payment_status)
     values ($1,$2,$3,'Midrand','done',500,675,true,'paid') returning id`, [BUYER, INSP, VIN])).rows[0].id
  inspectionId = (await db.query<any>(
    `insert into public.inspections (booking_id, vin, inspector_id, score, verdict, full_price, report_price, payer_cut, inspector_cut, report_number)
     values ($1,$2,$3,80,'ok',500,90,46,44,'LC-LED-000001') returning id`, [b, VIN, INSP])).rows[0].id
})

const ADMIN_CALLS: [string, string, unknown[]][] = [
  ['balances', 'select * from public.admin_list_balances()', []],
  ['ledger', 'select * from public.admin_list_ledger($1)', [INSP]],
  ['withdrawals', 'select * from public.admin_list_withdrawals()', []],
  ['pay', 'select public.admin_pay_withdrawal($1,$2)', [uid(500), 'ref']],
  ['reject', 'select public.admin_reject_withdrawal($1,$2)', [uid(500), 'why']],
  ['adjust', 'select public.admin_add_adjustment($1,$2,$3)', [INSP, 10, 'why']],
]
const USER_CALLS: [string, string, unknown[]][] = [
  ['set account', SET_ACC, ACCOUNT], ['my account', 'select public.my_payout_account()', []], ['earnings', 'select public.my_earnings()', []],
  ['withdrawals', 'select * from public.my_withdrawals()', []], ['request', 'select public.request_withdrawal(200)', []],
  ['cancel', 'select public.cancel_my_withdrawal($1)', [uid(500)]],
]

describe('access', () => {
  it.each(ADMIN_CALLS)('only operators can call admin function: %s', async (_n, sql, args) => {
    for (const who of [BUYER, INSP]) {
      const r = await attempt(() => call(who, sql, args))
      expect(r.ok).toBe(false); expect(r.error).toMatch(/Admin access required|permission denied/i)
    }
    expect((await attempt(() => asAnon(db, () => db.query(sql, args)))).ok).toBe(false)
  })
  it.each(USER_CALLS)('anonymous callers are refused: %s', async (_n, sql, args) => {
    expect((await attempt(() => asAnon(db, () => db.query(sql, args)))).ok).toBe(false)
  })
  it('clients cannot touch the ledger, accounts or requests directly, even an admin', async () => {
    for (const who of [BUYER, INSP, ADMIN])
      for (const sql of [
        'select * from public.ledger_entries', `insert into public.ledger_entries (user_id, kind, amount) values ('${INSP}','adjustment',999)`,
        'select * from public.payout_accounts', 'select * from public.withdrawal_requests',
        `insert into public.withdrawal_requests (user_id, amount, account) values ('${INSP}', 5, '{}')`,
        'select public.lc_balance(\'' + INSP + '\')', 'select public.lc_credit_job_fee()',
      ])
        expect((await attempt(() => call(who, sql))).ok, who.slice(-2) + ' ' + sql).toBe(false)
  })
  it('support can read balances and the ledger but not write or see bank details', async () => {
    expect((await call(SUPPORT, 'select * from public.admin_list_balances()')).rows.length).toBeGreaterThan(0)
    expect((await call(SUPPORT, 'select * from public.admin_list_ledger($1)', [INSP])).rows.length).toBeGreaterThan(0)
    for (const [sql, args] of [
      ['select * from public.admin_list_withdrawals()', []],
      ['select public.admin_add_adjustment($1,$2,$3)', [INSP, 10, 'x']],
      ['select public.admin_pay_withdrawal($1,$2)', [uid(500), 'x']],
    ] as [string, unknown[]][]) {
      const r = await attempt(() => call(SUPPORT, sql, args))
      expect(r.ok, sql).toBe(false); expect(r.error).toMatch(/admin role/i)
    }
  })
})

describe('credits', () => {
  it('a submitted report credits the inspector with the inspection fee, once', async () => {
    expect(await bal(INSP)).toBe(500)
    const e = (await db.query<any>(`select kind, amount, ref_type from public.ledger_entries where user_id=$1`, [INSP])).rows
    expect(e).toEqual([{ kind: 'job_fee', amount: 500, ref_type: 'inspection' }])
    expect((await attempt(() => db.query(`insert into public.ledger_entries (user_id, kind, amount, ref_type, ref_id) values ($1,'job_fee',500,'inspection',$2)`, [INSP, inspectionId]))).ok).toBe(false)
  })
  it('a purchase credits the inspector and the tracker with the stored shares, not the buyer', async () => {
    await db.query(
      `insert into public.report_purchases (inspection_id, buyer_id, amount_paid, payer_earning, inspector_earning)
       values ($1,$2,90,46,44)`, [inspectionId, INSP2])
    expect(await bal(INSP)).toBe(500)
    expect(await bal(TRACKER)).toBe(54)
    expect(await bal(INSP2)).toBe(0)
  })
  it('the tracker buying their own tracked vehicle earns nothing from it', async () => {
    await db.query(`insert into public.report_purchases (inspection_id, buyer_id, amount_paid, payer_earning, inspector_earning)
                    values ($1,$2,90,46,44)`, [inspectionId, TRACKER])
    expect(await bal(TRACKER)).toBe(54)
    expect(await bal(INSP)).toBe(500)
  })
  it('the ledger is append-only for everyone, including the service role', async () => {
    for (const sql of [`update public.ledger_entries set amount = 1`, `delete from public.ledger_entries`]) {
      expect((await attempt(() => db.query(sql))).ok, sql).toBe(false)
      expect((await attempt(() => asUser(db, ADMIN, () => db.query(sql)))).ok, sql).toBe(false)
    }
  })
  it('my_earnings reports balance, minimum and recent entries', async () => {
    const e = (await call(INSP, 'select public.my_earnings() as e')).rows[0].e
    expect(e).toMatchObject({ balance: 500, pending_withdrawal: 0, available: 500, min_payout: 200 })
    expect(e.entries.length).toBe(1)
    expect(e.entries[0].kind).toMatch(/resale|job_fee/)
  })
})

describe('bank details', () => {
  it('validates the account and never returns the full number', async () => {
    for (const bad of [
      ['A', 'FNB', '62001234567', '250655', 'cheque'], ['A Tester', 'FNB', '123', '250655', 'cheque'], ['A Tester', 'FNB', '62001234567', '25065', 'cheque'],
      ['A Tester', 'FNB', 'abcdefgh', '250655', 'cheque'], ['A Tester', 'FNB', '62001234567', '250655', 'gold'],
    ])
      expect((await attempt(() => call(INSP, SET_ACC, bad))).ok, bad.join('|')).toBe(false)
    expect((await call(INSP, 'select public.my_payout_account() as a')).rows[0].a).toBeNull()
    await call(INSP, SET_ACC, ['A Tester', 'FNB', '6200 1234 567', '250 655', 'cheque'])
    const a = (await call(INSP, 'select public.my_payout_account() as a')).rows[0].a
    expect(a).toEqual({ account_holder: 'A Tester', bank_name: 'FNB', branch_code: '250655', account_type: 'cheque', account_last4: '4567' })
    expect(JSON.stringify(a)).not.toContain('62001234567')
    expect((await call(BUYER, 'select public.my_payout_account() as a')).rows[0].a).toBeNull()
  })
})

describe('withdrawals', () => {
  let wid = ''
  it('rejects: no bank details, below the minimum, over the balance, no amount', async () => {
    const fail = async (who: string, amt: number | null, re: RegExp) => {
      const r = await attempt(() => call(who, 'select public.request_withdrawal($1)', [amt]))
      expect(r.ok).toBe(false); expect(r.error).toMatch(re)
    }
    await fail(TRACKER, 54, /minimum withdrawal is R200/)
    await db.query('update public.lc_settings set min_payout = 10')
    await fail(TRACKER, 46, /bank details/)
    await fail(INSP, 501, /more than your available/)
    await fail(INSP, null, /amount/i)
    await fail(INSP, 0, /amount/i)
    await db.query('update public.lc_settings set min_payout = 200')
    await fail(INSP, 199, /minimum/)
  })
  it('creates one open request with a snapshot, reserves it, and blocks a second', async () => {
    wid = (await call(INSP, 'select public.request_withdrawal(200) as id')).rows[0].id
    const e = (await call(INSP, 'select public.my_earnings() as e')).rows[0].e
    expect(e).toMatchObject({ balance: 500, pending_withdrawal: 200, available: 300 })
    expect((await attempt(() => call(INSP, 'select public.request_withdrawal(100)'))).error).toMatch(/already have a withdrawal/)
    expect((await attempt(() => call(INSP, SET_ACC, ACCOUNT))).error).toMatch(/in progress/)
    expect((await call(INSP, 'select * from public.my_withdrawals()')).rows[0]).toMatchObject({ amount: 200, status: 'requested' })
  })
  it('the operator sees the bank details; the request needs a reference to be paid', async () => {
    const r = (await call(ADMIN, `select * from public.admin_list_withdrawals('requested')`)).rows
    expect(r.length).toBe(1)
    expect(r[0]).toMatchObject({ amount: 200, status: 'requested' })
    expect(Number(r[0].balance)).toBe(500)
    expect(r[0].account).toMatchObject({ account_number: '62001234567', branch_code: '250655' })
    expect((await attempt(() => call(ADMIN, 'select public.admin_pay_withdrawal($1,$2)', [wid, ' ']))).ok).toBe(false)
    expect((await attempt(() => call(ADMIN, `select * from public.admin_list_withdrawals('bogus')`))).ok).toBe(false)
  })
  it('paying it writes a negative payout, notifies the user, audits, and cannot be repeated', async () => {
    await call(ADMIN, 'select public.admin_pay_withdrawal($1,$2)', [wid, 'FNB-REF-1'])
    expect(await bal(INSP)).toBe(300)
    expect((await db.query<any>(`select kind, amount from public.ledger_entries where ref_id=$1`, [wid])).rows).toEqual([{ kind: 'payout', amount: -200 }])
    const e = (await call(INSP, 'select public.my_earnings() as e')).rows[0].e
    expect(e).toMatchObject({ balance: 300, pending_withdrawal: 0, available: 300 })
    expect((await db.query<any>(`select body from public.notifications where user_id=$1 and title='Withdrawal paid'`, [INSP])).rows[0].body).toContain('4567')
    expect((await db.query<any>(`select detail from public.admin_audit_log where action='withdrawal_paid'`)).rows[0].detail).toMatchObject({ amount: 200, reference: 'FNB-REF-1' })
    expect((await attempt(() => call(ADMIN, 'select public.admin_pay_withdrawal($1,$2)', [wid, 'again']))).error).toMatch(/already paid/)
    expect((await attempt(() => call(ADMIN, 'select public.admin_reject_withdrawal($1,$2)', [wid, 'late']))).error).toMatch(/already paid/)
    expect((await call(INSP, 'select * from public.my_withdrawals()')).rows[0]).toMatchObject({ status: 'paid', reference: 'FNB-REF-1' })
  })
  it('rejecting leaves the balance untouched and tells the user why', async () => {
    const id = (await call(INSP, 'select public.request_withdrawal(200) as id')).rows[0].id
    expect((await attempt(() => call(ADMIN, 'select public.admin_reject_withdrawal($1,$2)', [id, '']))).ok).toBe(false)
    await call(ADMIN, 'select public.admin_reject_withdrawal($1,$2)', [id, 'bank details look wrong'])
    expect(await bal(INSP)).toBe(300)
    expect((await db.query<any>(`select body from public.notifications where user_id=$1 and title='Withdrawal not processed'`, [INSP])).rows[0].body).toContain('bank details look wrong')
  })
  it('the user can cancel an open request, and only their own', async () => {
    const id = (await call(INSP, 'select public.request_withdrawal(200) as id')).rows[0].id
    expect((await attempt(() => call(BUYER, 'select public.cancel_my_withdrawal($1)', [id]))).ok).toBe(false)
    await call(INSP, 'select public.cancel_my_withdrawal($1)', [id])
    expect((await call(INSP, 'select * from public.my_withdrawals()')).rows[0].status).toBe('cancelled')
    expect((await attempt(() => call(INSP, 'select public.cancel_my_withdrawal($1)', [id]))).ok).toBe(false)
  })
  it('paying is refused when the balance has dropped below the request', async () => {
    const id = (await call(INSP, 'select public.request_withdrawal(200) as id')).rows[0].id
    await call(ADMIN, 'select public.admin_add_adjustment($1,$2,$3)', [INSP, -150, 'chargeback'])
    const r = await attempt(() => call(ADMIN, 'select public.admin_pay_withdrawal($1,$2)', [id, 'x']))
    expect(r.ok).toBe(false); expect(r.error).toMatch(/balance is now lower/)
    await call(ADMIN, 'select public.admin_reject_withdrawal($1,$2)', [id, 'balance changed'])
  })
})

describe('adjustments', () => {
  it('need a reason and a sane amount, and cannot take a balance below zero', async () => {
    for (const [amt, why] of [[10, ' '], [0, 'x'], [100001, 'x'], [-100001, 'x'], [null, 'x']] as const)
      expect((await attempt(() => call(ADMIN, 'select public.admin_add_adjustment($1,$2,$3)', [INSP, amt, why]))).ok, String(amt)).toBe(false)
    const r = await attempt(() => call(ADMIN, 'select public.admin_add_adjustment($1,$2,$3)', [INSP, -1000, 'too much']))
    expect(r.error).toMatch(/below zero/)
    expect((await attempt(() => call(ADMIN, 'select public.admin_add_adjustment($1,$2,$3)', [uid(777), 10, 'ghost']))).ok).toBe(false)
  })
  it('a credit and a debit are recorded, notified and audited', async () => {
    const before = await bal(INSP2)
    await call(ADMIN, 'select public.admin_add_adjustment($1,$2,$3)', [INSP2, 75, 'goodwill'])
    expect(await bal(INSP2)).toBe(before + 75)
    await call(ADMIN, 'select public.admin_add_adjustment($1,$2,$3)', [INSP2, -25, 'correction'])
    expect(await bal(INSP2)).toBe(before + 50)
    expect((await db.query<any>(`select count(*)::int n from public.notifications where user_id=$1 and title='Balance adjusted'`, [INSP2])).rows[0].n).toBe(2)
    expect((await db.query<any>(`select count(*)::int n from public.admin_audit_log where action='balance_adjusted'`)).rows[0].n).toBe(3)
  })
  it('balances and the ledger show the totals split by kind', async () => {
    const row = (await call(ADMIN, 'select * from public.admin_list_balances($1)', ['user 03'])).rows[0]
    expect(row).toMatchObject({ user_id: INSP })
    expect(Number(row.paid_out)).toBe(200)
    expect(Number(row.adjustments)).toBe(-150)
    expect(Number(row.balance)).toBe(Number(row.earned) - 200 - 150)
    expect((await call(ADMIN, 'select * from public.admin_list_balances($1)', ['%'])).rows.length).toBe(0)
    const l = (await call(ADMIN, 'select * from public.admin_list_ledger($1)', [INSP])).rows
    expect(l.map((x: any) => x.kind)).toContain('payout')
  })
})
