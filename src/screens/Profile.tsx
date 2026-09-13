import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Field, ScreenHeader } from '../components/ui'
import type { User } from '@supabase/supabase-js'

export function Profile() {
  const [user, setUser] = useState<User | null>(null)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  async function handleAuth() {
    setLoading(true)
    setError(null)
    const fn = mode === 'signin' ? supabase.auth.signInWithPassword : supabase.auth.signUp
    const { error } = await fn({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  if (user) {
    return (
      <div className="px-5 pt-6 pb-28">
        <ScreenHeader title="Profile" />
        <p className="text-white font-display font-semibold text-[16px] mb-1">{user.email}</p>
        <p className="text-[var(--color-steel-400)] text-[13px] mb-6">Signed in</p>
        <Button variant="ghost" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    )
  }

  return (
    <div className="px-5 pt-6 pb-28">
      <ScreenHeader title={mode === 'signin' ? 'Sign In' : 'Create Account'} subtitle="Track your bookings and reports" />
      <Field label="Email" value={email} onChange={setEmail} type="email" />
      <Field label="Password" value={password} onChange={setPassword} type="password" />
      {error && <p className="text-[var(--color-danger)] text-[13px] mb-3">{error}</p>}
      <Button full disabled={loading} onClick={handleAuth}>
        {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
      </Button>
      <button
        className="w-full text-center text-[13px] text-[var(--color-blue-400)] mt-4 font-body"
        onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
      >
        {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
      </button>
    </div>
  )
}
