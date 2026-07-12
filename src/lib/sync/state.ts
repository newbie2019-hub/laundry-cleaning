import type Database from '@tauri-apps/plugin-sql'

// Thin key/value accessor over the local `sync_state` table (created in
// migration v27). Each business database has its own sync_state, so a device's
// role/bootstrap/high-water values are tracked per business.

export const SYNC_KEYS = {
  deviceId: 'device_id',
  role: 'role', // 'primary' | 'secondary'
  bootstrapped: 'bootstrapped', // '1' once the first sync completed
  lastPulledAt: 'last_pulled_at', // server-side high-water mark (ISO)
  lastSyncedAt: 'last_synced_at', // local wall-clock of last success (ISO)
  lastError: 'last_error', // last sync error message, if any
  resetPending: 'reset_pending', // '1' after a local data reset, until re-setup
} as const

export type SyncRole = 'primary' | 'secondary'

type ValueRow = { value: string | null }

export async function getSyncValue(db: Database, key: string): Promise<string | null> {
  const rows = await db.select<ValueRow[]>('SELECT value FROM sync_state WHERE key = $1', [key])
  return rows[0]?.value ?? null
}

export async function setSyncValue(db: Database, key: string, value: string | null): Promise<void> {
  await db.execute(
    `INSERT INTO sync_state (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  )
}

/** Return this device's stable id, generating and persisting one on first use. */
export async function getDeviceId(db: Database): Promise<string> {
  const existing = await getSyncValue(db, SYNC_KEYS.deviceId)
  if (existing) return existing
  const id = crypto.randomUUID()
  await setSyncValue(db, SYNC_KEYS.deviceId, id)
  return id
}

export async function getRole(db: Database): Promise<SyncRole | null> {
  const value = await getSyncValue(db, SYNC_KEYS.role)
  return value === 'primary' || value === 'secondary' ? value : null
}

export async function setRole(db: Database, role: SyncRole): Promise<void> {
  await setSyncValue(db, SYNC_KEYS.role, role)
}

export async function isBootstrapped(db: Database): Promise<boolean> {
  return (await getSyncValue(db, SYNC_KEYS.bootstrapped)) === '1'
}

export async function markBootstrapped(db: Database): Promise<void> {
  await setSyncValue(db, SYNC_KEYS.bootstrapped, '1')
}

export async function getLastPulledAt(db: Database): Promise<string | null> {
  return getSyncValue(db, SYNC_KEYS.lastPulledAt)
}

export async function setLastPulledAt(db: Database, iso: string): Promise<void> {
  await setSyncValue(db, SYNC_KEYS.lastPulledAt, iso)
}

export async function getLastSyncedAt(db: Database): Promise<string | null> {
  return getSyncValue(db, SYNC_KEYS.lastSyncedAt)
}

/**
 * True after a local "Reset all data" wiped this business, until the user
 * re-runs sync setup. While set, all sync is blocked so the now-empty database
 * can never be pushed up over the good cloud copy.
 */
export async function isResetPending(db: Database): Promise<boolean> {
  return (await getSyncValue(db, SYNC_KEYS.resetPending)) === '1'
}

/** Clear the reset guard once the user has consciously re-set-up sync. */
export async function clearResetPending(db: Database): Promise<void> {
  await setSyncValue(db, SYNC_KEYS.resetPending, null)
}
