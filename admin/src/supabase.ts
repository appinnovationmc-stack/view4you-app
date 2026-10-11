import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
if (!url || !anonKey) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — add them to .env.')

// Anon key only. Every privileged action goes through an admin_* database function that checks admin_users.
export const supabase = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
