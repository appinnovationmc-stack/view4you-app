import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Field, ScreenHeader } from '../components/ui'

export function Profile() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState<any>(null)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
    }
    setLoading(false)
  }

  if (user) {
    return (
      <div className="px-5 pt-6 pb-28">
        <ScreenHeader title="Profile" />
        <p className="text-[var(--color-steel-400)] text-sm mb-4">{user.email}</p>
        <Button variant="secondary" onClick={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </div>
    )
  }

  return (
    <div className="px-5 pt-6 pb-28">
      <ScreenHeader title={mode === 'signin' ? 'Sign in' : 'Sign up'} />
      <form onSubmit={handleSubmit} className="grid gap-4">
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-[var(--color-danger)] text-sm">{error}</p>}
        <Button type="submit" disabled={loading}>
          {loading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
      <button
        className="mt-4 text-[13px] text-[var(--color-blue-400)]"
        onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
      >
        {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
      </button>
    </div>
  )
}
