import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import * as api from './api'
import { AuditPage, BookingsPage, InspectorsPage, OverviewPage, PaymentsPage, type Page } from './pages'
import { PayoutsPage, ReportsPage, SettingsPage, SupportPage } from './pages2'
import { ErrorBanner, useLoad } from './ui'
import logoLight from '../../src/assets/brand/logo-light-bg.svg'
import logoDark from '../../src/assets/brand/logo-dark-bg.svg'

function Logo({ className }: { className: string }) {
  return (<>
    <img className={`${className} logo-for-light`} src={logoLight} alt="CheckVertical" />
    <img className={`${className} logo-for-dark`} src={logoDark} alt="CheckVertical" />
  </>)
}

function Login({ notice }: { notice?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null)
    try { await api.signIn(email.trim(), password) } catch (err) { setError((err as Error).message); setBusy(false) }
  }
  return (
    <div className="login">
      <form onSubmit={(e) => void submit(e)}>
        <div><Logo className="logo-login" /><h1>Admin console</h1><p className="muted">Operator sign in</p></div>
        {notice && <div className="banner bad">{notice}</div>}
        <label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <ErrorBanner message={error} />
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}

function Console({ role, email }: { role: api.AdminRole; email: string }) {
  const [page, setPage] = useState<Page>('overview')
  const [filter, setFilter] = useState<string | undefined>()
  const overview = useLoad(api.overview, [])
  const go = useCallback((p: Page, f?: string) => { setPage(p); setFilter(f) }, [])
  const canWrite = role === 'admin'
  const o = overview.data
  const nav: { id: Page; label: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'inspectors', label: 'Inspectors', badge: (o?.inspectors_pending_approval ?? 0) + (o?.documents_pending ?? 0) },
    { id: 'bookings', label: 'Bookings' },
    { id: 'reports', label: 'Reports' },
    { id: 'payments', label: 'Refunds & payments', badge: (o?.refunds_due ?? 0) + (o?.payment_problems_7d ?? 0) },
    { id: 'payouts', label: 'Payouts', badge: o?.withdrawals_requested },
    { id: 'support', label: 'Support', badge: o?.tickets_open },
    { id: 'settings', label: 'Settings' },
    { id: 'audit', label: 'Audit log' },
  ]
  const props = { canWrite, go, initialFilter: filter }
  return (
    <div className="shell">
      <nav className="side" aria-label="Sections">
        <div className="brand"><Logo className="logo-side" /><small>Admin console</small></div>
        {nav.map((n) => (
          <button key={n.id} className="nav" aria-current={page === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
            {n.label}{n.badge ? <span className="count">{n.badge}</span> : null}
          </button>
        ))}
        <div className="who">
          <span>{email}<br />{canWrite ? 'Admin' : 'Support (read only)'}</span>
          <button className="btn sm" onClick={() => void api.signOut()}>Sign out</button>
        </div>
      </nav>
      <main className="main" key={page + (filter ?? '')}>
        {page === 'overview' && <OverviewPage {...props} />}
        {page === 'inspectors' && <InspectorsPage {...props} />}
        {page === 'bookings' && <BookingsPage {...props} />}
        {page === 'reports' && <ReportsPage canWrite={canWrite} />}
        {page === 'payments' && <PaymentsPage {...props} />}
        {page === 'payouts' && <PayoutsPage canWrite={canWrite} />}
        {page === 'support' && <SupportPage />}
        {page === 'settings' && <SettingsPage canWrite={canWrite} />}
        {page === 'audit' && <AuditPage />}
      </main>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<{ email: string } | null | undefined>(undefined)
  const [role, setRole] = useState<api.AdminRole | null | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ? { email: data.session.user.email ?? '' } : null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s ? { email: s.user.email ?? '' } : null); setRole(undefined) })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    let live = true
    api.whoami().then((r) => { if (live) setRole(r) }).catch((e: Error) => { if (live) { setNotice(e.message); setRole(null) } })
    return () => { live = false }
  }, [session])

  // Signed in but not an operator: sign straight out so the screen explains why.
  useEffect(() => {
    if (session && role === null) { setNotice((n) => n ?? 'This account does not have admin access.'); void api.signOut() }
  }, [session, role])

  if (session === undefined || (session && role === undefined)) return <div className="login"><p className="muted">Loading…</p></div>
  if (!session || !role) return <Login notice={notice} />
  return <Console role={role} email={session.email} />
}
