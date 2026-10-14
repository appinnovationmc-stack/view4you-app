import { beforeAll, describe, expect, it } from 'vitest'
import { makeDb, addUser, asUser, asAnon, asService, attempt, uid, type Db } from './harness'
import { CHECKLIST } from '../../src/lib/reportTemplate'
import { AREAS } from '../../src/lib/reportMapping'

let db: Db
const BUYER = uid(701), BUYER2 = uid(702), BUYER3 = uid(703), BUYER4 = uid(704), BUYER5 = uid(705)
const INSPECTOR = uid(706), SUPPORT = uid(707), ADMIN = uid(708)
const RESELLERS = Array.from({length:10},(_,i)=>uid(710+i))

const ITEMS = CHECKLIST.flatMap(section => section.rows.map(([component, , roadworthy]) => ({
  section: section.key, component, condition: 'good', explanation: null, roadworthy_relevant: !!roadworthy,
})))
const FINDINGS = AREAS.map(area => ({ area, status: 'pass', note: 'checked' }))
const TYRES = ['Front Left', 'Front Right', 'Rear Left', 'Rear Right'].map(position => ({ position, tread_mm: 5.5 }))
const submit = (bookingId: string) => asUser(db, INSPECTOR, () => db.query<any>(
  'select * from public.submit_detailed_report($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb)',
  [bookingId, 100, 'Test report', 85000, 'pass', '[]', '[]', JSON.stringify(FINDINGS), JSON.stringify(ITEMS), '[]', JSON.stringify(TYRES)]))

async function createTierReport(vin: string, foundingLimit = 200) {
  await db.query("update public.lc_settings set tiers_enabled=true, founding_limit=$1 where id=1",[foundingLimit])
  const tier = (await db.query<any>("select id from public.inspection_tiers where name='Standard'")).rows[0]
  const b = (await asUser(db, BUYER, () => db.query<any>(
    'select * from public.create_booking($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    [vin,'Toyota','Corolla',2020,'12 Main Street','',INSPECTOR,'private',null,null,null,null,null,tier.id],
  ))).rows[0]
  expect(b.amount_due).toBe(1250)
  expect(b.inspector_payout).toBe(1000)
  expect(b.platform_gross).toBe(250)
  await asService(db, () => db.query('select public.apply_payfast_itn($1,$2,$3,$4,$5,$6::jsonb)',
    ['booking',b.id,'pf-'+vin,'COMPLETE',1250,'{}']))
  await asUser(db, INSPECTOR, () => db.query('select public.accept_booking($1)', [b.id]))
  const submitted = await submit(b.id)
  const inspectionId = submitted.rows[0].inspection_id
  await db.query('update public.vehicles set first_tracked_by=$1 where vin=$2',[BUYER,vin])
  return { bookingId: b.id as string, inspectionId: inspectionId as string }
}

beforeAll(async () => {
  db = await makeDb({ migrations: true })
  for (const [id,role] of [
    [BUYER,'buyer'],[BUYER2,'buyer'],[BUYER3,'buyer'],[BUYER4,'buyer'],[BUYER5,'buyer'],[INSPECTOR,'inspector'],[SUPPORT,'buyer'],[ADMIN,'buyer'],
  ] as const) await addUser(db,id,role,'Pricing Test '+id.slice(-2))
  for (const id of RESELLERS) await addUser(db,id,'buyer','Reseller '+id.slice(-2))
  await db.query("insert into public.admin_users(user_id,role) values ($1,'support'),($2,'admin')",[SUPPORT,ADMIN])
  await db.query('update public.profiles set approved=true,online=true,price=null where id=$1',[INSPECTOR])
})

describe('CheckVertical fixed tiers and resale rewards', () => {
  it('seeds the three approved tiers and exact 80/20 maths', async () => {
    const r = await db.query<any>(`select t.name,t.buyer_price,
      round(t.buyer_price*s.take_rate_bp/10000.0)::int platform,
      t.buyer_price-round(t.buyer_price*s.take_rate_bp/10000.0)::int inspector
      from public.inspection_tiers t cross join public.lc_settings s order by t.sort`)
    expect(r.rows).toEqual([
      {name:'Basic',buyer_price:790,platform:158,inspector:632},
      {name:'Standard',buyer_price:1250,platform:250,inspector:1000},
      {name:'Comprehensive',buyer_price:1650,platform:330,inspector:1320},
    ])
    const settings = (await db.query<any>('select tiers_enabled,payer_share_bp,platform_share_bp,min_payout from public.lc_settings where id=1')).rows[0]
    expect(settings).toMatchObject({tiers_enabled:false,payer_share_bp:6000,platform_share_bp:4000,min_payout:200})
  })

  it('keeps tier administration admin-only and audits admin listing', async () => {
    for (const who of [BUYER,INSPECTOR,SUPPORT]) {
      expect((await attempt(() => asUser(db,who,() => db.query('select * from public.admin_list_tiers()')))).ok).toBe(false)
      expect((await attempt(() => asUser(db,who,() => db.query(
        'select public.admin_update_tier(null,$1,$2,$3,$4,$5,$6)',
        ['Basic',790,149,1,true,'unauthorized'])))).ok).toBe(false)
    }
    expect((await attempt(() => asAnon(db,() => db.query('select * from public.inspection_tiers')))).ok).toBe(false)
    expect((await asUser(db,ADMIN,() => db.query<any>('select * from public.admin_list_tiers()'))).rows.length).toBe(3)
    expect((await db.query<any>("select count(*)::int n from public.admin_audit_log where action='tiers_listed'")).rows[0].n).toBe(1)
    expect((await asUser(db,BUYER,() => db.query<any>('select * from public.list_active_inspection_tiers()'))).rows.length).toBe(0)
  })

  it('keeps the legacy seven-argument booking call working while tiers are off', async () => {
    await db.query('update public.lc_settings set tiers_enabled=false where id=1')
    await db.query('update public.profiles set price=500 where id=$1',[INSPECTOR])
    const r = await asUser(db,BUYER,() => db.query<any>(
      'select * from public.create_booking($1,$2,$3,$4,$5,$6,$7)',
      ['LEGACY1GP','Toyota','Corolla',2020,'12 Main Street','',INSPECTOR]))
    expect(r.rows[0].amount_due).toBe(675)
    await db.query('update public.profiles set price=null where id=$1',[INSPECTOR])
  })

  it('uses tier pricing with an inspector whose self-set price is null and credits R1,000', async () => {
    const { bookingId } = await createTierReport('TIER001GP')
    const ledger = (await db.query<any>("select amount from public.ledger_entries where kind='job_fee' and ref_type='inspection' and ref_id in (select id from public.inspections where booking_id=$1)",[bookingId])).rows
    expect(ledger).toEqual([{amount:1000}])
    const booking = (await db.query<any>('select tier_id,travel_fee,platform_fee,amount_due,inspector_payout,platform_gross from public.bookings where id=$1',[bookingId])).rows[0]
    expect(booking).toMatchObject({travel_fee:0,platform_fee:0,amount_due:1250,inspector_payout:1000,platform_gross:250})
  })

  it('reserves a 60/40 resale reward, holds it, and releases it only when due', async () => {
    const { bookingId, inspectionId } = await createTierReport('REWARD1GP')
    await db.query('update public.bookings set founding=false where id=$1',[bookingId])
    const report = (await db.query<any>('select report_price,payer_cut,inspector_cut from public.inspections where id=$1',[inspectionId])).rows[0]
    expect(report).toEqual({report_price:249,payer_cut:149,inspector_cut:0})
    const purchase = (await asService(db,() => db.query<any>(
      'insert into public.report_purchases(inspection_id,buyer_id,amount_paid,payer_earning,inspector_earning) values($1,$2,249,149,0) returning id',
      [inspectionId,BUYER2]))).rows[0]
    const reward = (await db.query<any>('select payer_amount,platform_amount,release_at,released_at from public.resale_rewards where purchase_id=$1',[purchase.id])).rows[0]
    expect(reward).toMatchObject({payer_amount:149,platform_amount:100,released_at:null})
    expect((await db.query<any>("select count(*)::int n from public.ledger_entries where kind='resale_payer' and ref_id=$1",[purchase.id])).rows[0].n).toBe(0)
    await db.query("update public.resale_rewards set release_at=now()-interval '1 minute' where purchase_id=$1",[purchase.id])
    await asService(db,() => db.query('select public.lc_release_resale_rewards()'))
    expect((await db.query<any>("select amount from public.ledger_entries where kind='resale_payer' and ref_id=$1",[purchase.id])).rows).toEqual([{amount:149}])
    expect((await db.query<any>('select released_at from public.resale_rewards where purchase_id=$1',[purchase.id])).rows[0].released_at).not.toBeNull()
    expect((await db.query<any>("select count(*)::int n from public.notifications where user_id=$1 and type='earn'",[BUYER])).rows[0].n).toBe(1)
  })

  it('does not reward a self-purchase and does not duplicate a purchase credit', async () => {
    const { inspectionId } = await createTierReport('SELF001GP')
    const self = (await asService(db,() => db.query<any>(
      'insert into public.report_purchases(inspection_id,buyer_id,amount_paid,payer_earning,inspector_earning) values($1,$2,249,149,0) returning id',
      [inspectionId,BUYER]))).rows[0]
    expect((await db.query<any>('select count(*)::int n from public.resale_rewards where purchase_id=$1',[self.id])).rows[0].n).toBe(0)
    const other = (await asService(db,() => db.query<any>(
      'insert into public.report_purchases(inspection_id,buyer_id,amount_paid,payer_earning,inspector_earning) values($1,$2,249,149,0) returning id',
      [inspectionId,BUYER3]))).rows[0]
    expect((await attempt(() => asService(db,() => db.query(
      'insert into public.report_purchases(inspection_id,buyer_id,amount_paid,payer_earning,inspector_earning) values($1,$2,249,149,0)',
      [inspectionId,BUYER3])))).ok).toBe(false)
    expect((await db.query<any>('select count(*)::int n from public.resale_rewards where purchase_id=$1',[other.id])).rows[0].n).toBe(1)
  })

  it('caps all first-buyer rewards at the original booking price', async () => {
    const { bookingId, inspectionId } = await createTierReport('CAP001GP')
    await db.query('update public.bookings set founding=false where id=$1',[bookingId])
    for (const buyer of RESELLERS) {
      await asService(db,() => db.query(
        'insert into public.report_purchases(inspection_id,buyer_id,amount_paid,payer_earning,inspector_earning) values($1,$2,249,149,0)',
        [inspectionId,buyer]))
    }
    const rewards = (await db.query<any>(
      'select payer_amount,platform_amount from public.resale_rewards where inspection_id=$1 order by created_at',[inspectionId])).rows
    expect(rewards.map((r:any)=>r.payer_amount)).toEqual([149,149,149,149,149,149,149,149,58,0])
    expect(rewards.reduce((sum:number,r:any)=>sum+r.payer_amount,0)).toBe(1250)
    expect(rewards.reduce((sum:number,r:any)=>sum+r.platform_amount,0)).toBe(1240)
  })

  it('limits founding status to the first N paid tier bookings', async () => {
    await db.query('update public.bookings set founding=false')
    const first = await createTierReport('FLIM01GP',1)
    const second = await createTierReport('FLIM02GP',1)
    expect((await db.query<any>('select founding from public.bookings where id=$1',[first.bookingId])).rows[0].founding).toBe(true)
    expect((await db.query<any>('select founding from public.bookings where id=$1',[second.bookingId])).rows[0].founding).toBe(false)
  })

  it('applies the 70% founding share for the first three resales only', async () => {
    const { bookingId, inspectionId } = await createTierReport('FOUND01GP')
    expect((await db.query<any>('select founding from public.bookings where id=$1',[bookingId])).rows[0].founding).toBe(true)
    for (const buyer of [BUYER2,BUYER3,BUYER4,BUYER5]) {
      await asService(db,() => db.query(
        'insert into public.report_purchases(inspection_id,buyer_id,amount_paid,payer_earning,inspector_earning) values($1,$2,249,149,0)',
        [inspectionId,buyer]))
    }
    const r = await db.query<any>('select payer_amount,platform_amount from public.resale_rewards where inspection_id=$1 order by created_at',[inspectionId])
    expect(r.rows.slice(0,3)).toEqual([
      {payer_amount:174,platform_amount:75},{payer_amount:174,platform_amount:75},{payer_amount:174,platform_amount:75},
    ])
    expect(r.rows[3]).toEqual({payer_amount:149,platform_amount:100})
  })
})
