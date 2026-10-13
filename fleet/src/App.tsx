import { useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import * as api from './api'
import { ROLE_LABEL, type Area, type Membership, type Who } from './access'
import { TenantProvider, useCtx } from './context'
import { ErrorBanner, Empty } from './ui'
import logoLight from '../../src/assets/brand/logo-light-bg.svg'
import logoDark from '../../src/assets/brand/logo-dark-bg.svg'
import Dashboard from './pages/Dashboard'
import Costs from './pages/Costs'
import Tracking from './pages/Tracking'
import Reports from './pages/Reports'
import People from './pages/People'
import Platform from './pages/Platform'
import { Properties, PropertyDetail } from './pages/Properties'
import { Audit, Backlog, Compliance, Drivers, Expenses, Fuel, Incidents, Maintenance, Scheduling, Vehicles } from './pages/Lists'

const Logo = ({ className }: { className: string }) => (
  <><img className={`${className} logo-for-light`} src={logoLight} alt="CheckVertical" /><img className={`${className} logo-for-dark`} src={logoDark} alt="CheckVertical" /></>
)

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'in' | 'up'>('in'); const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setErr(null); setNote(null)
    try {
      if (mode === 'in') await api.signIn(email, password)
      else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) setNote('Check your email and confirm your address, then sign in. Access is granted once your organisation has invited you.')
      }
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="login">
      <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div><Logo className="logo-login" /><h1>Fleet & Asset Portal</h1><p className="muted">For organisations managed by CheckVertical</p></div>
        <label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <ErrorBanner message={err} />{note && <div className="banner">{note}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="btn" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'I was invited: create my account' : 'I already have an account'}</button>
      </form>
    </div>
  )
}

const NAV: { to: string; label: string; area: Area; roles?: string[] }[] = [
  { to: '/', label: 'Dashboard', area: 'fleet' },
  { to: '/vehicles', label: 'Vehicles', area: 'fleet' }, { to: '/drivers', label: 'Drivers', area: 'fleet' },
  { to: '/scheduling', label: 'Scheduling', area: 'fleet' }, { to: '/maintenance', label: 'Maintenance', area: 'fleet' },
  { to: '/fuel', label: 'Fuel', area: 'finance' }, { to: '/incidents', label: 'Incidents', area: 'fleet' },
  { to: '/expenses', label: 'Expenses', area: 'finance' }, { to: '/costs', label: 'Cost recovery', area: 'finance' },
  { to: '/tracking', label: 'Locations', area: 'fleet' }, { to: '/compliance', label: 'Compliance', area: 'fleet' },
  { to: '/properties', label: 'Land & buildings', area: 'property' }, { to: '/backlog', label: 'Property backlog', area: 'property' },
  { to: '/reports', label: 'Reports', area: 'fleet' }, { to: '/people', label: 'People & units', area: 'people' }, { to: '/audit', label: 'Audit log', area: 'people' },
]
const DRIVER_NAV = ['/scheduling', '/incidents', '/fuel']

function Portal({ who, memberships, switcher, onSignOut }: { who: Who; memberships: Membership[]; switcher: React.ReactNode; onSignOut: () => void }) {
  const ctx = useCtx()
  const nav = NAV.filter((n) => (ctx.role === 'driver' ? DRIVER_NAV.includes(n.to) : n.to === '/people' || n.to === '/audit' ? ['tenant_admin', 'auditor'].includes(ctx.role) : ctx.canRead(n.area) || n.to === '/'))
  const home = ctx.role === 'driver' ? '/scheduling' : '/'
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Logo className="logo-side" /><small>{ctx.tenantKind === 'government' ? 'Government' : 'Company'} portal</small>{ctx.tenantName}</div>
        {nav.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav">{n.label}</NavLink>)}
        <div className="who">
          <div>{ROLE_LABEL[ctx.role]}{ctx.unitId ? ` · ${ctx.lk.unit(ctx.unitId)}` : ''}</div>
          {switcher}
          {who.platform_role && <NavLink to="/platform" className="btn sm">CheckVertical console</NavLink>}
          <button className="btn sm" onClick={onSignOut}>Sign out</button>
          {memberships.length === 0 && null}
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={ctx.role === 'driver' ? <Navigate to={home} replace /> : <Dashboard />} />
          <Route path="/vehicles" element={<Vehicles />} /><Route path="/drivers" element={<Drivers />} />
          <Route path="/scheduling" element={<Scheduling />} /><Route path="/maintenance" element={<Maintenance />} />
          <Route path="/fuel" element={<Fuel />} /><Route path="/incidents" element={<Incidents />} />
          <Route path="/expenses" element={<Expenses />} /><Route path="/costs" element={<Costs />} />
          <Route path="/tracking" element={<Tracking />} /><Route path="/compliance" element={<Compliance />} />
          <Route path="/properties" element={<Properties />} /><Route path="/properties/:id" element={<PropertyDetail />} />
          <Route path="/backlog" element={<Backlog />} /><Route path="/reports" element={<Reports />} />
          <Route path="/people" element={<People />} /><Route path="/audit" element={<Audit />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [who, setWho] = useState<Who | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(() => { try { return localStorage.getItem('cv-fleet-tenant') } catch { return null } })
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  const uid = session?.user.id
  useEffect(() => {
    setWho(null); setErr(null)
    if (uid) api.whoami().then(setWho).catch((e: Error) => setErr(e.message))
  }, [uid])
  const membership = useMemo(() => who?.memberships.find((m) => m.tenant_id === tenantId) ?? who?.memberships[0] ?? null, [who, tenantId])

  if (session === undefined) return <div className="empty">Loading…</div>
  if (!session) return <Login />
  const out = () => { void api.signOut() }
  if (err) return <div className="login"><div><ErrorBanner message={err} /><button className="btn" onClick={out}>Sign out</button></div></div>
  if (!who) return <div className="empty">Loading…</div>
  if (!membership && !who.platform_role) {
    return <div className="login"><div className="panel"><h1>No access yet</h1><p className="muted">{session.user.email} has not been invited to an organisation, or its address is not confirmed. Ask your organisation administrator to invite this address.</p><button className="btn" onClick={out}>Sign out</button></div></div>
  }
  if (!membership) return <PlatformOnly who={who} onSignOut={out} />
  const switcher = who.memberships.length > 1 ? (
    <select aria-label="Organisation" value={membership.tenant_id} onChange={(e) => { setTenantId(e.target.value); try { localStorage.setItem('cv-fleet-tenant', e.target.value) } catch { /* private mode */ } }}>
      {who.memberships.map((m) => <option key={m.tenant_id} value={m.tenant_id}>{m.tenant_name}</option>)}
    </select>
  ) : null
  return (
    <TenantProvider key={membership.tenant_id} membership={membership}>
      <Routes>
        <Route path="/platform" element={who.platform_role ? <PlatformShell who={who} onSignOut={out} /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Portal who={who} memberships={who.memberships} switcher={switcher} onSignOut={out} />} />
      </Routes>
    </TenantProvider>
  )
}

function PlatformShell({ who, onSignOut }: { who: Who; onSignOut: () => void }) {
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Logo className="logo-side" /><small>CheckVertical console</small></div>
        <div className="who"><NavLink to="/" className="btn sm">Back to my organisation</NavLink><button className="btn sm" onClick={onSignOut}>Sign out</button></div>
      </aside>
      <main className="main">{who.platform_role ? <Platform role={who.platform_role} /> : <Empty>No access.</Empty>}</main>
    </div>
  )
}
function PlatformOnly({ who, onSignOut }: { who: Who; onSignOut: () => void }) { return <PlatformShell who={who} onSignOut={onSignOut} /> }
