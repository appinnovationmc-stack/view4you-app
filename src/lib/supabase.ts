import { createClient } from '@supabase/supabase-js'

// Values are injected at build time via .env (see .env.example).
// Never hardcode the anon key directly in source.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
