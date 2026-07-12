import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

// A single shared Supabase client. We disable auth session persistence and
// realtime entirely — this app does non-realtime, pull/push sync with the
// public anon key and never signs a user in, so those subsystems are dead
// weight (and realtime would open an unwanted websocket).
let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  }
  return client
}
