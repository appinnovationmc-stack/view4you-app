// A stored inspector position disappears when the inspector goes offline or loses approval.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { makeDb, addUser, asUser, asAnon, attempt, uid, type Db } from './harness'

let db: Db
const BUYER = uid(1), INSP = uid(2)

const call = (who: string, sql: string, args: unknown[] = []) => asUser(db, who, () => db.query<any>(sql, args))
const count = async () => Number((await db.query<any>('select count(*)::int as n from public.inspector_locations')).rows[0].n)

beforeAll(async () => {
  db = await makeDb({ migrations: true })
  await addUser(db, BUYER, 'buyer', 'Buyer')
  await addUser(db, INSP, 'inspector', 'Inspector')
})

beforeEach(async () => {
  await db.query(`update public.profiles set approved=true, online=true, price=500 where id=$1`, [INSP])
  await db.query(`delete from public.inspector_locations`)
  await db.query(`insert into public.inspector_locations (inspector_id, lat, lng) values ($1, -26.204, 28.047)`, [INSP])
})

describe('location lifetime', () => {
  it('stays while the inspector is online and approved', async () => {
    await db.query(`update public.profiles set rating=4.5 where id=$1`, [INSP])
    expect(await count()).toBe(1)
  })
  it('is deleted when the inspector goes offline', async () => {
    await call(INSP, 'select public.set_online($1)', [false])
    expect(await count()).toBe(0)
  })
  it('is deleted when approval is withdrawn', async () => {
    await db.query(`update public.profiles set approved=false where id=$1`, [INSP])
    expect(await count()).toBe(0)
  })
})

describe('direct access stays closed', () => {
  it('buyers and anonymous callers cannot read the table', async () => {
    const b = await attempt(() => asUser(db, BUYER, () => db.query('select * from public.inspector_locations')))
    expect(b.ok).toBe(false)
    const a = await attempt(() => asAnon(db, () => db.query('select * from public.inspector_locations')))
    expect(a.ok).toBe(false)
  })
  it('the unused duplicate RPCs are gone', async () => {
    const r = await db.query<any>(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('set_my_location','list_inspector_locations')`)
    expect(r.rows[0].n).toBe(0)
  })
})
