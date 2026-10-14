// Inspector map locations: who can publish, who can see, and when a position disappears.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { makeDb, addUser, asUser, asAnon, attempt, uid, type Db } from './harness'

let db: Db
const BUYER = uid(1), INSP = uid(2), OFFLINE = uid(3), PENDING = uid(4)

const call = (who: string, sql: string, args: unknown[] = []) => asUser(db, who, () => db.query<any>(sql, args))
const rows = async () => (await db.query<any>('select inspector_id, lat::float8 as lat, lng::float8 as lng from public.inspector_locations order by inspector_id')).rows

beforeAll(async () => {
  db = await makeDb({ migrations: true })
  for (const [id, role] of [[BUYER, 'buyer'], [INSP, 'inspector'], [OFFLINE, 'inspector'], [PENDING, 'inspector']] as const)
    await addUser(db, id, role, 'User ' + id.slice(-2))
  await db.query(`update public.profiles set approved=true, online=true, price=500 where id=$1`, [INSP])
  await db.query(`update public.profiles set approved=true, online=false, price=500 where id=$1`, [OFFLINE])
})

beforeEach(async () => {
  await db.query(`update public.profiles set approved=true, online=true where id=$1`, [INSP])
  await db.query(`delete from public.inspector_locations`)
})

describe('publishing a position', () => {
  it('an approved online inspector can share, and the position is rounded to ~110 m', async () => {
    await call(INSP, 'select public.set_my_location($1,$2)', [-26.204137, 28.047391])
    const r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0].lat).toBe(-26.204)
    expect(r[0].lng).toBe(28.047)
  })

  it('sharing again updates the same row', async () => {
    await call(INSP, 'select public.set_my_location($1,$2)', [-26.2, 28.0])
    await call(INSP, 'select public.set_my_location($1,$2)', [-25.9, 28.2])
    const r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0].lat).toBe(-25.9)
  })

  it('an offline inspector is refused', async () => {
    const r = await attempt(() => call(OFFLINE, 'select public.set_my_location($1,$2)', [-26.2, 28.0]))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Go online/)
  })

  it('an unapproved inspector is refused', async () => {
    const r = await attempt(() => call(PENDING, 'select public.set_my_location($1,$2)', [-26.2, 28.0]))
    expect(r.ok).toBe(false)
  })

  it('a buyer is refused', async () => {
    const r = await attempt(() => call(BUYER, 'select public.set_my_location($1,$2)', [-26.2, 28.0]))
    expect(r.ok).toBe(false)
  })

  it('anonymous callers are refused', async () => {
    const r = await attempt(() => asAnon(db, () => db.query('select public.set_my_location($1,$2)', [-26.2, 28.0])))
    expect(r.ok).toBe(false)
  })

  it.each([
    ['out-of-range latitude', 95, 28],
    ['out-of-range longitude', -26, 200],
    ['NaN', NaN, 28],
    ['null', null, null],
  ])('invalid coordinates are refused: %s', async (_n, lat, lng) => {
    const r = await attempt(() => call(INSP, 'select public.set_my_location($1,$2)', [lat, lng]))
    expect(r.ok).toBe(false)
    expect(await rows()).toHaveLength(0)
  })
})

describe('who can see positions', () => {
  it('a buyer sees only online approved inspectors with a fresh position', async () => {
    await call(INSP, 'select public.set_my_location($1,$2)', [-26.2, 28.0])
    const r = await call(BUYER, 'select * from public.list_inspector_locations()')
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].inspector_id).toBe(INSP)
    // nothing but id and a rounded position comes back
    expect(Object.keys(r.rows[0]).sort()).toEqual(['inspector_id', 'lat', 'lng'])
  })

  it('a position older than 30 minutes is not returned', async () => {
    await call(INSP, 'select public.set_my_location($1,$2)', [-26.2, 28.0])
    await db.query(`update public.inspector_locations set updated_at = now() - interval '31 minutes'`)
    const r = await call(BUYER, 'select * from public.list_inspector_locations()')
    expect(r.rows).toHaveLength(0)
  })

  it('inspectors and anonymous callers cannot list positions', async () => {
    const asInsp = await attempt(() => call(INSP, 'select * from public.list_inspector_locations()'))
    expect(asInsp.ok).toBe(false)
    const anon = await attempt(() => asAnon(db, () => db.query('select * from public.list_inspector_locations()')))
    expect(anon.ok).toBe(false)
  })

  it('the table cannot be read or written directly through the API', async () => {
    await call(INSP, 'select public.set_my_location($1,$2)', [-26.2, 28.0])
    for (const who of [BUYER, INSP]) {
      const read = await attempt(() => call(who, 'select * from public.inspector_locations'))
      expect(read.ok && (await call(who, 'select * from public.inspector_locations')).rows.length).toBeFalsy()
      const write = await attempt(() => call(who, `insert into public.inspector_locations (inspector_id, lat, lng) values ($1, 1, 1)`, [who]))
      expect(write.ok).toBe(false)
    }
  })
})

describe('when a position disappears', () => {
  it('going offline removes it at once', async () => {
    await call(INSP, 'select public.set_my_location($1,$2)', [-26.2, 28.0])
    await call(INSP, 'select public.set_online(false)')
    expect(await rows()).toHaveLength(0)
  })

  it('being un-approved removes it at once', async () => {
    await call(INSP, 'select public.set_my_location($1,$2)', [-26.2, 28.0])
    await db.query(`update public.profiles set approved=false where id=$1`, [INSP])
    expect(await rows()).toHaveLength(0)
  })

  it('going online again does not bring the old position back', async () => {
    await call(INSP, 'select public.set_my_location($1,$2)', [-26.2, 28.0])
    await call(INSP, 'select public.set_online(false)')
    await call(INSP, 'select public.set_online(true)')
    expect(await rows()).toHaveLength(0)
    const r = await call(BUYER, 'select * from public.list_inspector_locations()')
    expect(r.rows).toHaveLength(0)
  })
})
