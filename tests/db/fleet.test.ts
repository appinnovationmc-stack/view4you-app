// Fleet & Asset Portal: tenancy, two-sided roles, unit scope, module rules, reporting maths, audit, documents.
import { describe, it, expect, beforeAll } from 'vitest'
import { makeDb, addUser, asUser, asAnon, attempt, uid, type Db } from './harness'

let db: Db
const PA = uid(700), PS = uid(701)                       // CheckVertical platform admin / support
const A_ADMIN = uid(710), A_FLEET = uid(711), A_PROP = uid(712), A_FIN = uid(713), A_SITE = uid(714), A_DRV = uid(715), A_AUD = uid(716)
const B_ADMIN = uid(720)                                  // a second client organisation
const CONSUMER = uid(730)                                 // an ordinary CheckVertical app user
const NEWBIE = uid(731)                                   // signs up later and claims an invite
const T_ARC = uid(800), T_B = uid(801)
const U_HQ = uid(810), U_GP = uid(811), U_GP_DEPOT = uid(812), U_LP = uid(813), U_B_HQ = uid(814)
const M_DRV = uid(820)
let V1 = '', V2 = '', V3 = '', DRV1 = '', DRV2 = '', P1 = ''

const as = (who: string, sql: string, args: unknown[] = []) => asUser(db, who, () => db.query<any>(sql, args))
const q = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows
// "refused" = the database raised an error, OR an UPDATE / DELETE silently matched no row (what RLS does to rows you cannot see)
const refused = async (who: string, sql: string, args: unknown[] = []) => {
  try {
    const r = await as(who, sql, args)
    return /^\s*(update|delete)/i.test(sql) && !/returning/i.test(sql) && (r.affectedRows ?? 1) === 0
  } catch { return true }
}

beforeAll(async () => {
  db = await makeDb({ migrations: true })
  const people: [string, string][] = [[PA, 'pa'], [PS, 'ps'], [A_ADMIN, 'arc admin'], [A_FLEET, 'arc fleet'], [A_PROP, 'arc property'],
    [A_FIN, 'arc finance'], [A_SITE, 'arc site'], [A_DRV, 'arc driver'], [A_AUD, 'arc auditor'], [B_ADMIN, 'b admin'], [CONSUMER, 'consumer'], [NEWBIE, 'newbie']]
  for (const [id, n] of people) await addUser(db, id, 'buyer', n)
  await db.query(`insert into public.fleet_platform_staff (user_id, role) values ($1,'platform_admin'), ($2,'platform_support')`, [PA, PS])
  await db.query(`insert into public.fleet_tenants (id, name, kind) values ($1,'ARC','government'), ($2,'Beta Haulage','company')`, [T_ARC, T_B])
  await db.query(`insert into public.fleet_units (id, tenant_id, parent_id, name, kind) values
    ($1,$5,null,'ARC Head Office','head_office'), ($2,$5,$1,'Gauteng Region','region'), ($3,$5,$2,'Roodeplaat Depot','depot'),
    ($4,$5,$1,'Limpopo Region','region'), ($6,$7,null,'Beta HQ','head_office')`, [U_HQ, U_GP, U_GP_DEPOT, U_LP, T_ARC, U_B_HQ, T_B])
  const mem = (id: string, user: string, role: string, unit: string | null, tenant = T_ARC) =>
    db.query(`insert into public.fleet_members (id, tenant_id, user_id, role, unit_id) values ($1,$2,$3,$4,$5)`, [id, tenant, user, role, unit])
  await mem(uid(821), A_ADMIN, 'tenant_admin', null)
  await mem(uid(822), A_FLEET, 'fleet_manager', null)
  await mem(uid(823), A_PROP, 'property_manager', null)
  await mem(uid(824), A_FIN, 'finance_officer', null)
  await mem(uid(825), A_SITE, 'site_manager', U_GP)
  await mem(M_DRV, A_DRV, 'driver', null)
  await mem(uid(827), A_AUD, 'auditor', null)
  await mem(uid(828), B_ADMIN, 'tenant_admin', null, T_B)
  // vehicles: V1 at head office level (no unit), V2 in the Gauteng depot (rented), V3 in Limpopo
  V1 = (await q(`insert into public.fleet_vehicles (tenant_id, reg_number, make, model, category, odometer_km, acquisition_date, tracker_installed)
                 values ($1,'AB12CDGP','Toyota','Hilux','bakkie',14500, current_date - 1826, true) returning id`, [T_ARC]))[0].id
  V2 = (await q(`insert into public.fleet_vehicles (tenant_id, unit_id, reg_number, make, model, category, ownership, rental_supplier, rental_rate_per_day, rental_start, rental_end, odometer_km)
                 values ($1,$2,'RN34EDGP','Toyota','Quantum','minibus','rented','Avis',500,'2025-03-01','2025-03-10',3000) returning id`, [T_ARC, U_GP_DEPOT]))[0].id
  V3 = (await q(`insert into public.fleet_vehicles (tenant_id, unit_id, reg_number, category, status) values ($1,$2,'LP56GHLP','tractor','active') returning id`, [T_ARC, U_LP]))[0].id
  DRV1 = (await q(`insert into public.fleet_drivers (tenant_id, unit_id, full_name, member_id) values ($1,$2,'Thabo Driver',$3) returning id`, [T_ARC, U_GP, M_DRV]))[0].id
  DRV2 = (await q(`insert into public.fleet_drivers (tenant_id, full_name) values ($1,'Sipho Second') returning id`, [T_ARC]))[0].id
})

describe('outsiders', () => {
  const TABLES = ['fleet_tenants', 'fleet_units', 'fleet_members', 'fleet_invites', 'fleet_audit_log', 'fleet_vehicles', 'fleet_drivers', 'fleet_allocations',
    'fleet_maintenance', 'fleet_maintenance_plans', 'fleet_fuel_logs', 'fleet_incidents', 'fleet_locations', 'fleet_compliance', 'fleet_expenses',
    'fleet_properties', 'fleet_property_valuations', 'fleet_property_maintenance', 'fleet_v_compliance', 'fleet_v_maintenance_due', 'fleet_v_fuel', 'fleet_v_property_value']
  it.each(TABLES)('a consumer app user sees nothing in %s', async (t) => {
    const rows = (await as(CONSUMER, `select * from public.${t}`)).rows
    expect(rows).toHaveLength(0)
  })
  it.each(TABLES)('anonymous callers are refused on %s', async (t) => {
    expect((await attempt(() => asAnon(db, () => db.query(`select * from public.${t}`)))).ok).toBe(false)
  })
  it('nobody can read or write fleet_platform_staff, and nobody can make themselves staff', async () => {
    for (const who of [CONSUMER, A_ADMIN, PA]) {
      expect(await refused(who, `select * from public.fleet_platform_staff`)).toBe(true)
      expect(await refused(who, `insert into public.fleet_platform_staff (user_id, role) values ('${who}', 'platform_admin')`)).toBe(true)
    }
  })
  it('a consumer cannot create or join an organisation', async () => {
    expect(await refused(CONSUMER, `insert into public.fleet_tenants (name, kind) values ('Mine','company')`)).toBe(true)
    expect(await refused(CONSUMER, `select public.fleet_platform_create_tenant('X','company','x@x.co.za')`)).toBe(true)
    expect(await refused(CONSUMER, `insert into public.fleet_members (tenant_id, user_id, role) values ('${T_ARC}','${CONSUMER}','tenant_admin')`)).toBe(true)
    expect(await refused(CONSUMER, `select public.fleet_invite_member('${T_ARC}','c@x.co.za','tenant_admin')`)).toBe(true)
  })
})

describe('CheckVertical side', () => {
  it('only the platform administrator can create an organisation; support is read-only', async () => {
    expect(await refused(PS, `select public.fleet_platform_create_tenant('Nope','company','nope@x.co.za')`)).toBe(true)
    expect(await refused(PS, `select public.fleet_platform_set_tenant_status('${T_B}','suspended')`)).toBe(true)
    const id = (await as(PA, `select public.fleet_platform_create_tenant('Dept of Agriculture','government','head@dalrrd.test','Head Admin') as id`)).rows[0].id
    const inv = (await q(`select email, role from public.fleet_invites where tenant_id = $1`, [id]))
    expect(inv).toEqual([{ email: 'head@dalrrd.test', role: 'tenant_admin' }])
  })
  it('the invited administrator claims access by signing in with the confirmed email — and only then', async () => {
    const tid = (await as(PA, `select public.fleet_platform_create_tenant('Municipality X','government','newbie@x.test') as id`)).rows[0].id
    await db.query(`update auth.users set email = 'newbie@x.test', email_confirmed_at = null where id = $1`, [NEWBIE])
    expect((await as(NEWBIE, `select public.fleet_claim_invites() as n`)).rows[0].n).toBe(0)     // unconfirmed email: nothing
    await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [NEWBIE])
    expect((await as(NEWBIE, `select public.fleet_claim_invites() as n`)).rows[0].n).toBe(1)
    const who = (await as(NEWBIE, `select public.fleet_whoami() as w`)).rows[0].w
    expect(who.memberships).toHaveLength(1)
    expect(who.memberships[0]).toMatchObject({ tenant_id: tid, role: 'tenant_admin' })
    expect((await as(NEWBIE, `select public.fleet_claim_invites() as n`)).rows[0].n).toBe(0)     // idempotent
  })
  it('platform staff may only invite the first administrator of an organisation they are not inside', async () => {
    expect(await refused(PA, `select public.fleet_invite_member('${T_ARC}','x@x.test','fleet_manager')`)).toBe(true)
  })
  it('platform staff see organisation-level counts but never operational records', async () => {
    const o = (await as(PS, `select public.fleet_platform_overview() as o`)).rows[0].o
    const arc = o.tenants.find((t: any) => t.id === T_ARC)
    expect(arc.vehicles).toBe(3)
    expect(arc.members).toBeGreaterThanOrEqual(7)
    expect(JSON.stringify(o)).not.toMatch(/AB12CDGP|Toyota/)
    for (const t of ['fleet_vehicles', 'fleet_drivers', 'fleet_properties', 'fleet_expenses', 'fleet_allocations', 'fleet_incidents', 'fleet_compliance']) {
      expect((await as(PA, `select * from public.${t}`)).rows).toHaveLength(0)
    }
    expect(await refused(PA, `insert into public.fleet_vehicles (tenant_id, reg_number) values ('${T_ARC}','HACK1')`)).toBe(true)
  })
  it('a suspended organisation loses all access at once', async () => {
    await as(PA, `select public.fleet_platform_set_tenant_status('${T_B}','suspended')`)
    expect((await as(B_ADMIN, `select * from public.fleet_units`)).rows).toHaveLength(0)
    expect((await as(B_ADMIN, `select public.fleet_whoami() as w`)).rows[0].w.memberships).toHaveLength(0)
    await as(PA, `select public.fleet_platform_set_tenant_status('${T_B}','active')`)
    expect((await as(B_ADMIN, `select * from public.fleet_units`)).rows).toHaveLength(1)
  })
})

describe('client side: people and levels', () => {
  it('only the organisation administrator manages people and units', async () => {
    for (const who of [A_FLEET, A_PROP, A_FIN, A_SITE, A_DRV, A_AUD]) {
      expect(await refused(who, `select public.fleet_invite_member('${T_ARC}','z@x.test','driver')`)).toBe(true)
      expect(await refused(who, `insert into public.fleet_units (tenant_id, name) values ('${T_ARC}','Rogue unit')`)).toBe(true)
      expect(await refused(who, `select public.fleet_set_member('${uid(822)}','tenant_admin',null,'active')`)).toBe(true)
    }
    await as(A_ADMIN, `select public.fleet_invite_member($1,'New.Driver@ARC.test','driver',$2,'New Driver')`, [T_ARC, U_GP])
    expect((await q(`select email, unit_id from public.fleet_invites where tenant_id = $1 and role = 'driver'`, [T_ARC]))[0]).toEqual({ email: 'new.driver@arc.test', unit_id: U_GP })
  })
  it('an invitation cannot point at another organisation\'s unit', async () => {
    expect(await refused(A_ADMIN, `select public.fleet_invite_member('${T_ARC}','q@x.test','driver','${U_B_HQ}')`)).toBe(true)
  })
  it('the last administrator cannot be removed or demoted', async () => {
    expect(await refused(A_ADMIN, `select public.fleet_set_member('${uid(821)}','auditor',null,'active')`)).toBe(true)
    expect(await refused(A_ADMIN, `select public.fleet_set_member('${uid(821)}','tenant_admin',null,'suspended')`)).toBe(true)
  })
  it('a member sees colleagues only if admin or auditor; others see themselves', async () => {
    expect((await as(A_ADMIN, `select * from public.fleet_members`)).rows.length).toBeGreaterThanOrEqual(7)
    expect((await as(A_AUD, `select * from public.fleet_members`)).rows.length).toBeGreaterThanOrEqual(7)
    expect((await as(A_FLEET, `select * from public.fleet_members`)).rows).toHaveLength(1)
  })
  it('organisations cannot see each other', async () => {
    expect((await as(B_ADMIN, `select * from public.fleet_vehicles`)).rows).toHaveLength(0)
    expect((await as(B_ADMIN, `select * from public.fleet_members where tenant_id = '${T_ARC}'`)).rows).toHaveLength(0)
    expect(await refused(B_ADMIN, `insert into public.fleet_vehicles (tenant_id, reg_number) values ('${T_ARC}','SNEAK1')`)).toBe(true)
    expect(await refused(B_ADMIN, `select public.fleet_invite_member('${T_ARC}','b@x.test','tenant_admin')`)).toBe(true)
  })
})

describe('client side: role matrix', () => {
  it('fleet manager writes fleet records, reads finance and property, cannot write them', async () => {
    const r = await as(A_FLEET, `insert into public.fleet_vehicles (tenant_id, reg_number, category) values ('${T_ARC}','FM01GP','sedan') returning id`)
    expect(r.rows).toHaveLength(1)
    expect(await refused(A_FLEET, `insert into public.fleet_expenses (tenant_id, category, amount) values ('${T_ARC}','insurance',100)`)).toBe(true)
    expect(await refused(A_FLEET, `insert into public.fleet_properties (tenant_id, name) values ('${T_ARC}','Farm')`)).toBe(true)
  })
  it('finance officer writes expenses, reads fleet, cannot write vehicles', async () => {
    expect((await as(A_FIN, `insert into public.fleet_expenses (tenant_id, vehicle_id, category, amount, incurred_on) values ('${T_ARC}','${V1}','insurance',500,'2025-03-15') returning id`)).rows).toHaveLength(1)
    expect((await as(A_FIN, `select * from public.fleet_vehicles`)).rows.length).toBeGreaterThanOrEqual(3)
    expect(await refused(A_FIN, `update public.fleet_vehicles set status = 'disposed' where id = '${V1}'`)).toBe(true)
    expect(await refused(A_FIN, `insert into public.fleet_fuel_logs (tenant_id, vehicle_id, litres, cost) values ('${T_ARC}','${V1}',10,200)`)).toBe(true)
  })
  it('property manager writes property, reads fleet and finance', async () => {
    P1 = (await as(A_PROP, `insert into public.fleet_properties (tenant_id, name, kind, extent_value, extent_unit, title_deed_number, condition_rating)
                            values ('${T_ARC}','Roodeplaat Research Farm','land_and_buildings',2,'ha','T12345/2001','poor') returning id`)).rows[0].id
    expect(P1).toBeTruthy()
    expect(await refused(A_PROP, `insert into public.fleet_vehicles (tenant_id, reg_number) values ('${T_ARC}','PM01GP')`)).toBe(true)
    expect((await as(A_PROP, `select * from public.fleet_vehicles`)).rows.length).toBeGreaterThanOrEqual(3)
  })
  it('auditor reads everything and writes nothing', async () => {
    expect((await as(A_AUD, `select * from public.fleet_vehicles`)).rows.length).toBeGreaterThanOrEqual(3)
    expect((await as(A_AUD, `select * from public.fleet_properties`)).rows.length).toBeGreaterThanOrEqual(1)
    expect((await as(A_AUD, `select * from public.fleet_audit_log`)).rows.length).toBeGreaterThan(0)
    for (const sql of [
      `insert into public.fleet_vehicles (tenant_id, reg_number) values ('${T_ARC}','AUD1')`,
      `update public.fleet_vehicles set notes = 'x' where id = '${V1}'`,
      `delete from public.fleet_vehicles where id = '${V1}'`,
      `insert into public.fleet_expenses (tenant_id, category, amount) values ('${T_ARC}','other',1)`,
    ]) expect(await refused(A_AUD, sql)).toBe(true)
    expect((await q(`select 1 from public.fleet_vehicles where id = $1 and notes is null`, [V1]))).toHaveLength(1)
  })
  it('only the organisation administrator may delete vehicles, drivers or properties', async () => {
    const v = (await as(A_ADMIN, `insert into public.fleet_vehicles (tenant_id, reg_number) values ('${T_ARC}','DEL1GP') returning id`)).rows[0].id
    expect(await refused(A_FLEET, `delete from public.fleet_vehicles where id = '${v}'`)).toBe(true)
    expect((await as(A_FLEET, `delete from public.fleet_vehicles where id = '${v}' returning id`)).rows).toHaveLength(0)
    expect((await as(A_ADMIN, `delete from public.fleet_vehicles where id = '${v}' returning id`)).rows).toHaveLength(1)
  })
  it('registration numbers are unique within an organisation, regardless of case', async () => {
    expect(await refused(A_FLEET, `insert into public.fleet_vehicles (tenant_id, reg_number) values ('${T_ARC}','ab12cdgp')`)).toBe(true)
    expect((await as(B_ADMIN, `insert into public.fleet_vehicles (tenant_id, reg_number) values ('${T_B}','AB12CDGP') returning id`)).rows).toHaveLength(1)
  })
})

describe('client side: unit scope (government hierarchy)', () => {
  it('a Gauteng site manager sees the Gauteng subtree only, and nothing without a unit', async () => {
    const regs = (await as(A_SITE, `select reg_number from public.fleet_vehicles order by 1`)).rows.map((r) => r.reg_number)
    expect(regs).toEqual(['RN34EDGP'])                       // V2 sits in the depot below Gauteng; V1 has no unit; V3 is Limpopo
    expect((await as(A_SITE, `select * from public.fleet_drivers`)).rows.map((r) => r.full_name)).toEqual(['Thabo Driver'])
  })
  it('a unit-scoped manager cannot file records outside their subtree', async () => {
    expect(await refused(A_SITE, `insert into public.fleet_vehicles (tenant_id, unit_id, reg_number) values ('${T_ARC}','${U_LP}','OUT1')`)).toBe(true)
    expect(await refused(A_SITE, `insert into public.fleet_vehicles (tenant_id, reg_number) values ('${T_ARC}','OUT2')`)).toBe(true)
    expect(await refused(A_SITE, `insert into public.fleet_fuel_logs (tenant_id, vehicle_id, litres, cost) values ('${T_ARC}','${V3}',10,200)`)).toBe(true)
    expect((await as(A_SITE, `insert into public.fleet_vehicles (tenant_id, unit_id, reg_number) values ('${T_ARC}','${U_GP}','IN1GP') returning id`)).rows).toHaveLength(1)
  })
  it('child records inherit organisation and unit from the vehicle, even if the client lies', async () => {
    const r = (await as(A_FLEET, `insert into public.fleet_fuel_logs (tenant_id, unit_id, vehicle_id, litres, cost) values ('${T_ARC}','${U_LP}','${V2}',10,200) returning unit_id, tenant_id`)).rows[0]
    expect(r).toEqual({ unit_id: U_GP_DEPOT, tenant_id: T_ARC })
    expect(await refused(B_ADMIN, `insert into public.fleet_fuel_logs (tenant_id, vehicle_id, litres, cost) values ('${T_B}','${V2}',10,200)`)).toBe(true)
  })
  it('moving a vehicle to another unit moves its history with it', async () => {
    const v = (await as(A_FLEET, `insert into public.fleet_vehicles (tenant_id, unit_id, reg_number) values ('${T_ARC}','${U_GP}','MOVE1') returning id`)).rows[0].id
    await as(A_FLEET, `insert into public.fleet_fuel_logs (tenant_id, vehicle_id, litres, cost) values ('${T_ARC}','${v}',5,100)`)
    expect((await as(A_SITE, `select * from public.fleet_fuel_logs where vehicle_id = '${v}'`)).rows).toHaveLength(1)
    await as(A_FLEET, `update public.fleet_vehicles set unit_id = '${U_LP}' where id = '${v}'`)
    expect((await as(A_SITE, `select * from public.fleet_fuel_logs where vehicle_id = '${v}'`)).rows).toHaveLength(0)
    expect((await q(`select unit_id from public.fleet_fuel_logs where vehicle_id = $1`, [v]))[0].unit_id).toBe(U_LP)
  })
  it('a driver, vehicle or unit from another organisation is refused', async () => {
    expect(await refused(A_FLEET, `insert into public.fleet_vehicles (tenant_id, unit_id, reg_number) values ('${T_ARC}','${U_B_HQ}','XT1')`)).toBe(true)
    const bv = (await q(`select id from public.fleet_vehicles where tenant_id = $1`, [T_B]))[0].id
    expect(await refused(A_FLEET, `insert into public.fleet_fuel_logs (tenant_id, vehicle_id, litres, cost) values ('${T_ARC}','${bv}',5,100)`)).toBe(true)
    expect(await refused(B_ADMIN, `insert into public.fleet_allocations (tenant_id, vehicle_id, driver_id, purpose, start_at, end_at) values ('${T_B}','${bv}','${DRV1}','x','2030-01-01','2030-01-02')`)).toBe(true)
  })
})

describe('drivers', () => {
  it('see vehicles in scope and nothing sensitive', async () => {
    expect((await as(A_DRV, `select * from public.fleet_vehicles`)).rows).toHaveLength(0)           // the base table is closed to drivers
    const view = (await as(A_DRV, `select * from public.fleet_v_driver_vehicles`)).rows
    expect(view.length).toBeGreaterThanOrEqual(3)
    expect(Object.keys(view[0])).not.toEqual(expect.arrayContaining(['rental_rate_per_day']))
    expect(Object.keys(view[0])).not.toEqual(expect.arrayContaining(['acquisition_cost']))
    expect(Object.keys(view[0])).not.toEqual(expect.arrayContaining(['tracker_device_id']))
    expect((await as(CONSUMER, `select * from public.fleet_v_driver_vehicles`)).rows).toHaveLength(0)
    expect((await as(A_FLEET, `select * from public.fleet_v_driver_vehicles`)).rows).toHaveLength(0)  // the view is for the driver role only
    for (const t of ['fleet_maintenance', 'fleet_expenses', 'fleet_properties', 'fleet_compliance', 'fleet_property_valuations', 'fleet_members']) {
      const rows = (await as(A_DRV, `select * from public.${t}`)).rows
      expect(t === 'fleet_members' ? rows.every((r) => r.user_id === A_DRV) : rows).toBeTruthy()
      if (t !== 'fleet_members') expect(rows).toHaveLength(0)
    }
    expect(await refused(A_DRV, `update public.fleet_vehicles set status = 'disposed' where id = '${V1}'`)).toBe(true)
  })
  it('can request a vehicle, but not approve it, and sees only their own requests', async () => {
    const mine = await as(A_DRV, `insert into public.fleet_allocations (tenant_id, vehicle_id, requested_by, purpose, start_at, end_at)
                                  values ('${T_ARC}','${V1}','${M_DRV}','Site visit','2030-06-01 08:00+00','2030-06-01 16:00+00') returning id, status`)
    expect(mine.rows[0].status).toBe('requested')
    expect(await refused(A_DRV, `insert into public.fleet_allocations (tenant_id, vehicle_id, requested_by, purpose, start_at, end_at, status)
                                 values ('${T_ARC}','${V1}','${M_DRV}','Self approve','2030-07-01 08:00+00','2030-07-01 16:00+00','approved')`)).toBe(true)
    expect(await refused(A_DRV, `update public.fleet_allocations set status = 'approved' where id = '${mine.rows[0].id}'`)).toBe(true)
    await q(`insert into public.fleet_allocations (tenant_id, vehicle_id, purpose, start_at, end_at) values ($1,$2,'Someone else','2030-08-01 08:00+00','2030-08-01 09:00+00')`, [T_ARC, V3])
    expect((await as(A_DRV, `select purpose from public.fleet_allocations`)).rows.map((r) => r.purpose)).toEqual(['Site visit'])
  })
  it('can log fuel, report incidents and check in a position — and see only their own', async () => {
    await as(A_DRV, `insert into public.fleet_fuel_logs (tenant_id, vehicle_id, litres, cost, odometer_km) values ('${T_ARC}','${V1}',30,640,14600)`)
    await as(A_DRV, `insert into public.fleet_incidents (tenant_id, vehicle_id, kind, description) values ('${T_ARC}','${V1}','damage','Cracked windscreen')`)
    await as(A_DRV, `insert into public.fleet_locations (tenant_id, vehicle_id, lat, lng, source) values ('${T_ARC}','${V1}',-25.7479,28.2293,'driver')`)
    expect((await as(A_DRV, `select * from public.fleet_fuel_logs`)).rows).toHaveLength(1)
    expect((await as(A_DRV, `select * from public.fleet_incidents`)).rows).toHaveLength(1)
    expect(await refused(A_DRV, `insert into public.fleet_incidents (tenant_id, vehicle_id, kind, description, status) values ('${T_ARC}','${V1}','damage','Closed it myself','closed')`)).toBe(true)
    expect(await refused(A_DRV, `insert into public.fleet_fuel_logs (tenant_id, vehicle_id, litres, cost, created_by) values ('${T_ARC}','${V1}',5,5,'${A_FLEET}')`)).toBe(true)
    expect(await refused(A_DRV, `update public.fleet_fuel_logs set cost = 1`)).toBe(true)
    expect((await q(`select odometer_km, last_lat from public.fleet_vehicles where id = $1`, [V1]))[0]).toEqual({ odometer_km: 14600, last_lat: -25.7479 })
  })
})

describe('scheduling and allocation rules', () => {
  const alloc = (who: string, vehicle: string, start: string, end: string, status: string, driver: string | null = null) =>
    as(who, `insert into public.fleet_allocations (tenant_id, vehicle_id, driver_id, purpose, start_at, end_at, status) values ('${T_ARC}','${vehicle}',${driver ? `'${driver}'` : 'null'},'Trip','${start}','${end}','${status}') returning id`)
  it('refuses double-booking a vehicle but allows back-to-back and overlapping requests', async () => {
    await alloc(A_FLEET, V3, '2031-01-10 08:00+00', '2031-01-10 12:00+00', 'approved')
    const clash = await attempt(() => alloc(A_FLEET, V3, '2031-01-10 11:00+00', '2031-01-10 14:00+00', 'approved'))
    expect(clash.ok).toBe(false)
    expect(clash.error).toMatch(/already allocated/i)
    expect((await alloc(A_FLEET, V3, '2031-01-10 12:00+00', '2031-01-10 14:00+00', 'approved')).rows).toHaveLength(1)
    expect((await alloc(A_FLEET, V3, '2031-01-10 09:00+00', '2031-01-10 10:00+00', 'requested')).rows).toHaveLength(1)
  })
  it('approving a request that now clashes is refused', async () => {
    const id = (await alloc(A_FLEET, V3, '2031-02-01 08:00+00', '2031-02-01 12:00+00', 'requested')).rows[0].id
    await alloc(A_FLEET, V3, '2031-02-01 10:00+00', '2031-02-01 11:00+00', 'approved')
    expect(await refused(A_FLEET, `update public.fleet_allocations set status = 'approved' where id = '${id}'`)).toBe(true)
  })
  it('refuses to double-book a driver', async () => {
    await alloc(A_FLEET, V1, '2031-03-01 08:00+00', '2031-03-01 12:00+00', 'approved', DRV2)
    const r = await attempt(() => alloc(A_FLEET, V3, '2031-03-01 09:00+00', '2031-03-01 10:00+00', 'approved', DRV2))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Driver is already allocated/)
  })
  it('refuses to allocate a vehicle that is in the workshop or out of service', async () => {
    await as(A_FLEET, `update public.fleet_vehicles set status = 'in_workshop' where id = '${V3}'`)
    const r = await attempt(() => alloc(A_FLEET, V3, '2031-04-01 08:00+00', '2031-04-01 09:00+00', 'approved'))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/in workshop/)
    await as(A_FLEET, `update public.fleet_vehicles set status = 'active' where id = '${V3}'`)
  })
  it('end before start is refused; the odometer only moves forward', async () => {
    expect(await refused(A_FLEET, `insert into public.fleet_allocations (tenant_id, vehicle_id, purpose, start_at, end_at) values ('${T_ARC}','${V1}','x','2031-05-01 10:00+00','2031-05-01 09:00+00')`)).toBe(true)
    await alloc(A_FLEET, V2, '2031-05-01 08:00+00', '2031-05-01 12:00+00', 'completed')
    await as(A_FLEET, `update public.fleet_allocations set start_odometer = 3000, end_odometer = 3120 where vehicle_id = '${V2}' and start_at = '2031-05-01 08:00+00'`)
    expect((await q(`select odometer_km from public.fleet_vehicles where id = $1`, [V2]))[0].odometer_km).toBe(3120)
    await as(A_FLEET, `update public.fleet_allocations set end_odometer = 3050 where vehicle_id = '${V2}' and start_at = '2031-05-01 08:00+00'`)
    expect((await q(`select odometer_km from public.fleet_vehicles where id = $1`, [V2]))[0].odometer_km).toBe(3120)
  })
})

describe('maintenance, compliance, fuel', () => {
  it('maintenance plans report ok / due soon / overdue by kilometres and by date; completing linked work resets the plan', async () => {
    const plan = (await as(A_FLEET, `insert into public.fleet_maintenance_plans (tenant_id, vehicle_id, task, interval_km, last_done_km) values ('${T_ARC}','${V1}','Service',10000,5000) returning id`)).rows[0].id
    const state = async () => (await as(A_FLEET, `select state, km_left from public.fleet_v_maintenance_due where plan_id = '${plan}'`)).rows[0]
    await q(`update public.fleet_vehicles set odometer_km = 6000 where id = $1`, [V1])
    expect(await state()).toEqual({ state: 'ok', km_left: 9000 })
    await q(`update public.fleet_vehicles set odometer_km = 14000 where id = $1`, [V1])
    expect(await state()).toEqual({ state: 'due_soon', km_left: 1000 })
    await q(`update public.fleet_vehicles set odometer_km = 16000 where id = $1`, [V1])
    expect(await state()).toEqual({ state: 'overdue', km_left: -1000 })
    await as(A_FLEET, `insert into public.fleet_maintenance (tenant_id, vehicle_id, plan_id, kind, status, description, completed_date, odometer_km, cost)
                       values ('${T_ARC}','${V1}','${plan}','service','completed','10 000 km service', current_date, 16000, 1500)`)
    expect((await q(`select last_done_km, last_done_date = current_date as today from public.fleet_maintenance_plans where id = $1`, [plan]))[0]).toEqual({ last_done_km: 16000, today: true })
    expect(await state()).toEqual({ state: 'ok', km_left: 10000 })
    const late = (await as(A_FLEET, `insert into public.fleet_maintenance_plans (tenant_id, vehicle_id, task, interval_days, last_done_date) values ('${T_ARC}','${V3}','Roadworthy prep',90,current_date - 100) returning id`)).rows[0].id
    expect((await as(A_FLEET, `select state, days_left from public.fleet_v_maintenance_due where plan_id = '${late}'`)).rows[0]).toEqual({ state: 'overdue', days_left: -10 })
    const none = (await as(A_FLEET, `insert into public.fleet_maintenance_plans (tenant_id, vehicle_id, task, interval_km) values ('${T_ARC}','${V3}','Never serviced',15000) returning id`)).rows[0].id
    expect((await as(A_FLEET, `select state from public.fleet_v_maintenance_due where plan_id = '${none}'`)).rows[0].state).toBe('no_history')
  })
  it('a plan needs an interval; cross-vehicle plan resets are ignored', async () => {
    expect(await refused(A_FLEET, `insert into public.fleet_maintenance_plans (tenant_id, vehicle_id, task) values ('${T_ARC}','${V1}','No interval')`)).toBe(true)
  })
  it('compliance shows expired / due soon / valid for vehicles and drivers, and is unit-scoped', async () => {
    const add = (extra: string) => as(A_FLEET, `insert into public.fleet_compliance (tenant_id, ${extra.split('|')[0]}) values ('${T_ARC}', ${extra.split('|')[1]}) returning id`)
    await add(`vehicle_id, kind, expires_on|'${V1}','licence_disc', current_date - 1`)
    await add(`vehicle_id, kind, expires_on|'${V1}','roadworthy', current_date + 10`)
    await add(`vehicle_id, kind, expires_on|'${V1}','insurance', current_date + 100`)
    await add(`driver_id, kind, expires_on|'${DRV1}','driver_licence', current_date + 20`)
    const rows = (await as(A_FLEET, `select kind, state, subject, subject_type from public.fleet_v_compliance order by kind`)).rows
    expect(rows).toEqual([
      { kind: 'driver_licence', state: 'due_soon', subject: 'Thabo Driver', subject_type: 'driver' },
      { kind: 'insurance', state: 'valid', subject: 'AB12CDGP', subject_type: 'vehicle' },
      { kind: 'licence_disc', state: 'expired', subject: 'AB12CDGP', subject_type: 'vehicle' },
      { kind: 'roadworthy', state: 'due_soon', subject: 'AB12CDGP', subject_type: 'vehicle' },
    ])
    expect((await as(A_SITE, `select kind from public.fleet_v_compliance`)).rows).toEqual([{ kind: 'driver_licence' }])   // only the Gauteng driver
    expect(await refused(A_FLEET, `insert into public.fleet_compliance (tenant_id, vehicle_id, driver_id, kind, expires_on) values ('${T_ARC}','${V1}','${DRV1}','other', current_date)`)).toBe(true)
    expect(await refused(A_FLEET, `insert into public.fleet_compliance (tenant_id, kind, expires_on) values ('${T_ARC}','other', current_date)`)).toBe(true)
  })
  it('fuel consumption is km since the previous fill divided by litres', async () => {
    const v = (await as(A_FLEET, `insert into public.fleet_vehicles (tenant_id, reg_number, fuel_type) values ('${T_ARC}','FUEL1GP','diesel') returning id`)).rows[0].id
    for (const [at, l, c, odo] of [['2031-06-01', 40, 800, 1000], ['2031-06-08', 40, 880, 1400], ['2031-06-15', 50, 1100, 1900]])
      await as(A_FLEET, `insert into public.fleet_fuel_logs (tenant_id, vehicle_id, filled_at, litres, cost, odometer_km) values ('${T_ARC}','${v}','${at}',${l},${c},${odo})`)
    const rows = (await as(A_FLEET, `select km_per_litre, price_per_litre from public.fleet_v_fuel where vehicle_id = '${v}' order by filled_at`)).rows
    expect(rows.map((r) => (r.km_per_litre == null ? null : Number(r.km_per_litre)))).toEqual([null, 10, 10])
    expect(Number(rows[1].price_per_litre)).toBe(22)
    expect(await refused(A_FLEET, `insert into public.fleet_fuel_logs (tenant_id, vehicle_id, litres, cost) values ('${T_ARC}','${v}',0,10)`)).toBe(true)
  })
})

describe('incidents and location', () => {
  it('managers triage incidents; a position updates the last-seen fields and ignores stale feeds', async () => {
    const id = (await as(A_FLEET, `insert into public.fleet_incidents (tenant_id, vehicle_id, kind, severity, description, police_case_no, estimated_cost) values ('${T_ARC}','${V3}','accident','major','Rear-ended at N1 off-ramp','CAS 101/10/2026',45000) returning id`)).rows[0].id
    await as(A_FLEET, `update public.fleet_incidents set status = 'claim_lodged', insurance_claim = 'CLM-778' where id = '${id}'`)
    expect((await q(`select status, insurance_claim from public.fleet_incidents where id = $1`, [id]))[0]).toEqual({ status: 'claim_lodged', insurance_claim: 'CLM-778' })
    await as(A_FLEET, `insert into public.fleet_locations (tenant_id, vehicle_id, recorded_at, lat, lng, source) values ('${T_ARC}','${V3}','2031-01-01T10:00:00Z',-23.9,29.45,'tracker')`)
    await as(A_FLEET, `insert into public.fleet_locations (tenant_id, vehicle_id, recorded_at, lat, lng, source) values ('${T_ARC}','${V3}','2031-01-01T09:00:00Z',-26.2,28.0,'tracker')`)
    expect((await q(`select last_lat, last_lng from public.fleet_vehicles where id = $1`, [V3]))[0]).toEqual({ last_lat: -23.9, last_lng: 29.45 })
    expect(await refused(A_FLEET, `insert into public.fleet_locations (tenant_id, vehicle_id, lat, lng) values ('${T_ARC}','${V3}', 123, 10)`)).toBe(true)
  })
})

describe('reporting maths: cost recovery and dashboard', () => {
  const T_R = uid(802), R_ADMIN = uid(740), U_R = uid(815)
  let RV1 = ''
  beforeAll(async () => {
    await addUser(db, R_ADMIN, 'buyer', 'report admin')
    await db.query(`insert into public.fleet_tenants (id, name, kind) values ($1,'Report Co','company')`, [T_R])
    await db.query(`insert into public.fleet_units (id, tenant_id, name) values ($1,$2,'HQ')`, [U_R, T_R])
    await db.query(`insert into public.fleet_members (tenant_id, user_id, role) values ($1,$2,'tenant_admin')`, [T_R, R_ADMIN])
    const ins = (sql: string) => as(R_ADMIN, sql)
    RV1 = (await ins(`insert into public.fleet_vehicles (tenant_id, reg_number, category, tracker_installed, acquisition_date) values ('${T_R}','R1','bakkie',true, current_date - 730) returning id`)).rows[0].id
    await ins(`insert into public.fleet_vehicles (tenant_id, reg_number, category, ownership, rental_rate_per_day, rental_start, rental_end) values ('${T_R}','R2','sedan','rented',500,'2025-03-01','2025-03-10') returning id`)
    await ins(`insert into public.fleet_vehicles (tenant_id, reg_number, category, status) values ('${T_R}','R3','tractor','in_workshop')`)
    await ins(`insert into public.fleet_vehicles (tenant_id, reg_number, category, status) values ('${T_R}','R4','truck','disposed')`)
    for (const [at, l, c] of [['2025-03-05T10:00:00Z', 40, 800], ['2025-03-20T10:00:00Z', 30, 600], ['2025-04-02T10:00:00Z', 99, 999]])
      await ins(`insert into public.fleet_fuel_logs (tenant_id, vehicle_id, filled_at, litres, cost) values ('${T_R}','${RV1}','${at}',${l},${c})`)
    await ins(`insert into public.fleet_maintenance (tenant_id, vehicle_id, kind, status, description, completed_date, cost) values ('${T_R}','${RV1}','repair','completed','Brake pads','2025-03-12',1500)`)
    await ins(`insert into public.fleet_maintenance (tenant_id, vehicle_id, kind, status, description, scheduled_date, cost) values ('${T_R}','${RV1}','repair','scheduled','Not yet done','2025-03-14',700)`)
    await ins(`insert into public.fleet_expenses (tenant_id, vehicle_id, category, amount, incurred_on) values ('${T_R}','${RV1}','insurance',500,'2025-03-15')`)
    await ins(`insert into public.fleet_expenses (tenant_id, vehicle_id, category, amount, incurred_on, status) values ('${T_R}','${RV1}','fines',250,'2025-03-16','disputed')`)
    await ins(`insert into public.fleet_allocations (tenant_id, vehicle_id, purpose, start_at, end_at, status, start_odometer, end_odometer) values ('${T_R}','${RV1}','Field work','2025-03-10T08:00:00Z','2025-03-10T18:00:00Z','completed',1000,1200)`)
    // this month: fuel and workshop
    await ins(`insert into public.fleet_fuel_logs (tenant_id, vehicle_id, litres, cost) values ('${T_R}','${RV1}',20,450)`)
    await ins(`insert into public.fleet_maintenance (tenant_id, vehicle_id, kind, status, description, completed_date, cost) values ('${T_R}','${RV1}','service','completed','Service', current_date, 300)`)
    // compliance, incidents, requests, plan
    await ins(`insert into public.fleet_compliance (tenant_id, vehicle_id, kind, expires_on) values ('${T_R}','${RV1}','licence_disc', current_date - 3)`)
    await ins(`insert into public.fleet_compliance (tenant_id, vehicle_id, kind, expires_on) values ('${T_R}','${RV1}','roadworthy', current_date + 5)`)
    await ins(`insert into public.fleet_maintenance_plans (tenant_id, vehicle_id, task, interval_days, last_done_date) values ('${T_R}','${RV1}','Service',30,current_date - 60)`)
    await ins(`insert into public.fleet_incidents (tenant_id, vehicle_id, kind, description) values ('${T_R}','${RV1}','damage','Dent')`)
    await ins(`insert into public.fleet_incidents (tenant_id, vehicle_id, kind, description, status) values ('${T_R}','${RV1}','breakdown','Flat battery','closed')`)
    await ins(`insert into public.fleet_allocations (tenant_id, vehicle_id, purpose, start_at, end_at) values ('${T_R}','${RV1}','Pending request', now() + interval '2 days', now() + interval '2 days 3 hours')`)
    // property
    const p1 = (await ins(`insert into public.fleet_properties (tenant_id, name, kind, extent_value, extent_unit, condition_rating) values ('${T_R}','Farm','land_and_buildings',2,'ha','poor') returning id`)).rows[0].id
    const p2 = (await ins(`insert into public.fleet_properties (tenant_id, name, kind, extent_value, extent_unit, condition_rating) values ('${T_R}','Office block','building',1000,'m2','good') returning id`)).rows[0].id
    await ins(`insert into public.fleet_property_valuations (tenant_id, property_id, valued_on, market_value, current_value) values ('${T_R}','${p1}','2024-01-01',4000000,3000000)`)
    await ins(`insert into public.fleet_property_valuations (tenant_id, property_id, valued_on, market_value, current_value, maintenance_backlog) values ('${T_R}','${p1}','2026-01-01',5000000,3500000,250000)`)
    await ins(`insert into public.fleet_property_valuations (tenant_id, property_id, valued_on, market_value, current_value) values ('${T_R}','${p2}','2026-01-01',1000000,900000)`)
    for (const [t, st, c] of [['Roof replacement', 'backlog', 200000], ['Fencing', 'planned', 50000], ['Paint', 'completed', 99999], ['Old plan', 'cancelled', 12345]])
      await ins(`insert into public.fleet_property_maintenance (tenant_id, property_id, title, status, estimated_cost) values ('${T_R}','${p1}','${t}','${st}',${c})`)
  })
  it('cost recovery adds fuel, completed workshop work, approved expenses and rental, and divides by hours and km', async () => {
    const rows = (await as(R_ADMIN, `select * from public.fleet_vehicle_costs($1,'2025-03-01','2025-03-31')`, [T_R])).rows
    const r1 = rows.find((r) => r.reg_number === 'R1')
    expect(Number(r1.litres)).toBe(70)
    expect(Number(r1.fuel_cost)).toBe(1400)
    expect(Number(r1.maintenance_cost)).toBe(1500)        // the scheduled R700 job is not a cost yet
    expect(Number(r1.other_cost)).toBe(500)               // the disputed R250 fine is excluded
    expect(Number(r1.total_cost)).toBe(3400)
    expect(Number(r1.hours_used)).toBe(10)
    expect(Number(r1.km_driven)).toBe(200)
    expect(Number(r1.cost_per_hour)).toBe(340)
    expect(Number(r1.cost_per_km)).toBe(17)
    const r2 = rows.find((r) => r.reg_number === 'R2')
    expect(Number(r2.rental_cost)).toBe(5000)             // 10 days at R500
    expect(r2.cost_per_hour).toBeNull()                   // never used: no hourly rate to quote
    expect(rows.find((r) => r.reg_number === 'R4')).toBeUndefined()   // disposed vehicles are left out
    const partial = (await as(R_ADMIN, `select rental_cost from public.fleet_vehicle_costs($1,'2025-03-05','2025-03-31') where reg_number = 'R2'`, [T_R])).rows[0]
    expect(Number(partial.rental_cost)).toBe(3000)        // 5 March to 10 March inclusive = 6 days
  })
  it('cost recovery respects roles and tenants', async () => {
    expect((await as(B_ADMIN, `select * from public.fleet_vehicle_costs($1,'2025-03-01','2025-03-31')`, [T_R])).rows).toHaveLength(0)
    expect((await as(A_DRV, `select * from public.fleet_vehicle_costs($1,'2025-03-01','2025-03-31')`, [T_ARC])).rows.every((r) => Number(r.total_cost) === 0)).toBe(true)
    expect(await refused(CONSUMER, `select public.fleet_dashboard('${T_R}')`)).toBe(false)   // returns an empty-looking dashboard, never data
    expect((await as(CONSUMER, `select public.fleet_dashboard('${T_R}') as d`)).rows[0].d.vehicles_total).toBe(0)
  })
  it('the dashboard counts the fleet, tracking, classification, age, compliance, maintenance and money', async () => {
    const d = (await as(R_ADMIN, `select public.fleet_dashboard($1) as d`, [T_R])).rows[0].d
    expect(d.vehicles_total).toBe(3)                      // the disposed vehicle is excluded
    expect(d.vehicles_tracked).toBe(1)
    expect(d.vehicles_untracked).toBe(2)
    expect(d.by_category).toEqual({ bakkie: 1, sedan: 1, tractor: 1 })
    expect(d.by_ownership).toEqual({ owned: 2, rented: 1 })
    expect(d.by_status).toEqual({ active: 2, in_workshop: 1 })
    expect(d.avg_age_years).toBeGreaterThanOrEqual(1.9)
    expect(d.avg_age_years).toBeLessThanOrEqual(2.1)
    expect(d.compliance_expired).toBe(1)
    expect(d.compliance_due_soon).toBe(1)
    expect(d.maintenance_overdue).toBe(1)
    expect(d.in_workshop).toBe(1)
    expect(d.open_incidents).toBe(1)
    expect(d.requests_pending).toBe(1)
    expect(d.trips_next_7_days).toBe(1)
    expect(Number(d.fuel_cost_month)).toBe(450)
    expect(Number(d.fuel_litres_month)).toBe(20)
    expect(Number(d.maintenance_cost_month)).toBe(300)
    expect(d.properties_total).toBe(2)
    expect(Number(d.properties_extent_m2)).toBe(21000)    // 2 ha + 1 000 m²
    expect(Number(d.property_market_value)).toBe(6000000) // latest valuation per property
    expect(Number(d.property_current_value)).toBe(4400000)
    expect(Number(d.property_open_backlog)).toBe(250000)  // backlog + planned only
    expect(d.property_poor_or_critical).toBe(1)
  })
  it('a unit-scoped dashboard only counts the caller\'s own subtree', async () => {
    const visible = (await as(A_SITE, `select count(*)::int as n from public.fleet_vehicles where status <> 'disposed'`)).rows[0].n
    const d = (await as(A_SITE, `select public.fleet_dashboard($1) as d`, [T_ARC])).rows[0].d
    expect(d.vehicles_total).toBe(visible)
  })
})

describe('property valuation: market value vs current value', () => {
  it('shows the condition discount and the open backlog next to the latest valuation', async () => {
    const T_R = uid(802), R_ADMIN = uid(740)
    const farm = (await as(R_ADMIN, `select * from public.fleet_v_property_value where name = 'Farm'`)).rows[0]
    expect(Number(farm.market_value)).toBe(5000000)
    expect(Number(farm.current_value)).toBe(3500000)
    expect(Number(farm.condition_discount)).toBe(1500000)
    expect(Number(farm.open_backlog_cost)).toBe(250000)
    expect(Number(farm.open_backlog_items)).toBe(2)
    expect(Number(farm.extent_m2)).toBe(20000)
    expect(T_R).toBeTruthy()
  })
  it('a property manager cannot file valuations against another organisation\'s property', async () => {
    const other = (await q(`select id from public.fleet_properties where tenant_id = $1 limit 1`, [uid(802)]))[0].id
    expect(await refused(A_PROP, `insert into public.fleet_property_valuations (tenant_id, property_id, market_value, current_value) values ('${T_ARC}','${other}',1,1)`)).toBe(true)
  })
  it('title deed, layout plan and valuation data stay inside the organisation', async () => {
    expect((await as(B_ADMIN, `select * from public.fleet_v_property_value`)).rows).toHaveLength(0)
    expect((await as(A_PROP, `select * from public.fleet_v_property_value where tenant_id = '${uid(802)}'`)).rows).toHaveLength(0)
  })
})

describe('audit trail', () => {
  it('records who changed what, and only auditors / administrators can read it', async () => {
    await as(A_FLEET, `update public.fleet_vehicles set notes = 'Fitted bull bar' where id = '${V1}'`)
    const rows = (await as(A_ADMIN, `select actor, action, changes from public.fleet_audit_log where table_name = 'fleet_vehicles' and row_id = '${V1}' and action = 'update' order by id desc`)).rows
    expect(rows[0].actor).toBe(A_FLEET)
    expect(rows[0].changes.notes).toEqual({ old: null, new: 'Fitted bull bar' })
    expect(rows[0].changes.updated_at).toBeUndefined()
    expect((await as(A_FLEET, `select * from public.fleet_audit_log`)).rows).toHaveLength(0)
    expect((await as(A_DRV, `select * from public.fleet_audit_log`)).rows).toHaveLength(0)
    expect((await as(A_AUD, `select * from public.fleet_audit_log`)).rows.length).toBeGreaterThan(0)
  })
  it('audit rows cannot be edited or deleted by anyone with an account', async () => {
    for (const who of [A_ADMIN, A_AUD, PA]) {
      expect(await refused(who, `update public.fleet_audit_log set action = 'x'`)).toBe(true)
      expect(await refused(who, `delete from public.fleet_audit_log`)).toBe(true)
      expect(await refused(who, `insert into public.fleet_audit_log (table_name, action) values ('x','y')`)).toBe(true)
    }
  })
  it('the platform side sees organisation-level audit rows only; the location feed is not audited', async () => {
    const tables = new Set((await as(PA, `select table_name from public.fleet_audit_log`)).rows.map((r) => r.table_name))
    expect(tables.size).toBeGreaterThan(0)
    for (const t of tables) expect(['fleet_tenants', 'fleet_members', 'fleet_invites']).toContain(t)
    expect((await q(`select 1 from public.fleet_audit_log where table_name = 'fleet_locations'`))).toHaveLength(0)
  })
  it('administrators can read member and access changes', async () => {
    await as(A_ADMIN, `select public.fleet_set_member('${uid(825)}','site_manager','${U_LP}','active')`)
    const rows = (await as(A_ADMIN, `select changes from public.fleet_audit_log where table_name = 'fleet_members' and row_id = '${uid(825)}' and action = 'update'`)).rows
    expect(rows[0].changes.unit_id).toEqual({ old: U_GP, new: U_LP })
    await as(A_ADMIN, `select public.fleet_set_member('${uid(825)}','site_manager','${U_GP}','active')`)
  })
})

describe('documents (title deeds, layout plans, licence discs)', () => {
  const put = (who: string, name: string) => as(who, `insert into storage.objects (bucket_id, name) values ('fleet-documents', $1) returning id`, [name])
  it('staff with write access upload under their own organisation\'s folder only', async () => {
    expect((await put(A_PROP, `${T_ARC}/property/${P1}/title-deed.pdf`)).rows).toHaveLength(1)
    expect((await put(A_FLEET, `${T_ARC}/vehicle/${V1}/licence-disc.pdf`)).rows).toHaveLength(1)
    expect((await attempt(() => put(A_PROP, `${T_B}/property/x/deed.pdf`))).ok).toBe(false)
    expect((await attempt(() => put(A_PROP, `not-a-uuid/deed.pdf`))).ok).toBe(false)
    expect((await attempt(() => put(A_DRV, `${T_ARC}/vehicle/${V1}/x.pdf`))).ok).toBe(false)
    expect((await attempt(() => put(A_AUD, `${T_ARC}/vehicle/${V1}/y.pdf`))).ok).toBe(false)
    expect((await attempt(() => put(CONSUMER, `${T_ARC}/vehicle/${V1}/z.pdf`))).ok).toBe(false)
  })
  it('only members can read them, and never across organisations', async () => {
    const read = (who: string) => as(who, `select name from storage.objects where bucket_id = 'fleet-documents'`)
    expect((await read(A_AUD)).rows.length).toBeGreaterThanOrEqual(2)
    expect((await read(A_FIN)).rows.length).toBeGreaterThanOrEqual(2)
    expect((await read(B_ADMIN)).rows).toHaveLength(0)
    expect((await read(CONSUMER)).rows).toHaveLength(0)
    expect((await read(A_DRV)).rows).toHaveLength(0)
  })
})
