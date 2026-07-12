// Cloud sync configuration.
//
// The app authenticates to Supabase with the PUBLIC anon/publishable key and no
// user login — sync works the moment the app is installed. This key is meant to
// be public; what scopes access is the row-level-security policy on the cloud
// `sync_rows` table (see docs/supabase-schema.sql) plus the `business_id` tag on
// every row. Do NOT put the service_role/secret key here — it must never ship
// inside the app.
//
// See docs/sync-design.md and docs/sync-overview.md for the full design.

export const SUPABASE_URL = 'https://kcjccfgnyxlxpjufrwpr.supabase.co'

export const SUPABASE_ANON_KEY = 'sb_publishable_ekGFCVn-bp5tVuUXSACJsw_B-KCig2M'

// The single cloud table all rows sync through. Each row is one local record,
// stored as a JSON payload keyed by (business_id, table_name, uuid).
export const CLOUD_TABLE = 'sync_rows'

// Sync is considered "configured" only when real credentials are present. This
// lets the UI degrade gracefully (hide/disable sync) if they're ever blanked.
export function isSyncConfigured(): boolean {
  return (
    SUPABASE_URL.startsWith('https://') &&
    SUPABASE_ANON_KEY.length > 0 &&
    !SUPABASE_URL.includes('YOUR_PROJECT')
  )
}
