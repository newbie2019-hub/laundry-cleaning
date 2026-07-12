import { getDatabaseFor } from '../db/client'
import { BUSINESS_LIST, getActiveBusinessId, type BusinessId } from '../db/business'
import { isSyncConfigured } from './config'
import {
  forceFullResync,
  syncBusiness,
  type ProgressFn,
  type SyncProgress,
  type SyncResult,
} from './engine'
import {
  getLastSyncedAt,
  getRole,
  getSyncValue,
  isBootstrapped,
  isResetPending,
  setRole,
  SYNC_KEYS,
  type SyncRole,
} from './state'

export { isSyncConfigured } from './config'
export type { SyncRole } from './state'
export type { SyncResult, SyncProgress } from './engine'

/** Live progress for the currently-running sync, tagged with which business
 *  database it is working on. `null` when no sync is in flight. */
export type SyncProgressState = SyncProgress & { businessLabel: string }

export type SyncOverview = {
  configured: boolean
  /** True until the device has been told whether it is primary or secondary,
   *  OR after a local reset until sync setup is re-run. */
  needsSetup: boolean
  /** True when a local "Reset all data" is blocking sync until re-setup. */
  resetPending: boolean
  role: SyncRole | null
  bootstrapped: boolean
  lastSyncedAt: string | null
  lastError: string | null
  syncing: boolean
}

let inFlight: Promise<SyncResult> | null = null
const listeners = new Set<() => void>()

/** Subscribe to sync lifecycle changes (start/finish) so the UI can refresh. */
export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  for (const listener of listeners) listener()
}

// --- Live progress (drives the running "Syncing…" toast) -------------------
let progress: SyncProgressState | null = null
const progressListeners = new Set<() => void>()

/** Subscribe to fine-grained sync progress updates (row counts per phase). */
export function subscribeSyncProgress(listener: () => void): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}

/** Current sync progress, or `null` when nothing is syncing. */
export function getSyncProgress(): SyncProgressState | null {
  return progress
}

function emitProgress(next: SyncProgressState | null): void {
  progress = next
  for (const listener of progressListeners) listener()
}

/** Read the current sync status for the active business (for the indicator). */
export async function getSyncOverview(): Promise<SyncOverview> {
  const configured = isSyncConfigured()
  if (!configured) {
    return {
      configured: false,
      needsSetup: false,
      resetPending: false,
      role: null,
      bootstrapped: false,
      lastSyncedAt: null,
      lastError: null,
      syncing: inFlight != null,
    }
  }
  const db = await getDatabaseFor(getActiveBusinessId())
  const [role, bootstrapped, lastSyncedAt, lastError, resetPending] = await Promise.all([
    getRole(db),
    isBootstrapped(db),
    getLastSyncedAt(db),
    getSyncValue(db, SYNC_KEYS.lastError),
    isResetPending(db),
  ])
  return {
    configured: true,
    needsSetup: !bootstrapped && role == null,
    resetPending,
    role,
    bootstrapped,
    lastSyncedAt,
    lastError,
    syncing: inFlight != null,
  }
}

/**
 * Record whether THIS device is the primary (its data seeds the cloud) or a
 * secondary (it backs up, then adopts the cloud dataset). Applied to every
 * business database, since the role is a property of the device.
 */
export async function chooseDeviceRole(role: SyncRole): Promise<void> {
  for (const business of BUSINESS_LIST) {
    const db = await getDatabaseFor(business.id)
    await setRole(db, role)
  }
  notify()
}

/**
 * Run `run` against ONLY the business the user is currently viewing. Sync is
 * scoped to the active business: on Laundry you sync Laundry, on Cleaning you
 * sync Cleaning. Each business is therefore synced (and first-time bootstrapped)
 * while it is open. Progress is tagged with that business's label for the toast.
 */
async function runForActiveBusiness(
  run: (
    db: Awaited<ReturnType<typeof getDatabaseFor>>,
    id: BusinessId,
    onProgress: ProgressFn,
  ) => Promise<SyncResult>,
): Promise<SyncResult> {
  const businessId = getActiveBusinessId()
  const label = BUSINESS_LIST.find((b) => b.id === businessId)?.shortName ?? ''
  const db = await getDatabaseFor(businessId)
  return run(db, businessId as BusinessId, (p) => emitProgress({ ...p, businessLabel: label }))
}

/**
 * Run a full sync for the ACTIVE business. Concurrent calls share one in-flight
 * run. A no-op (returns needsSetup error) if the device role hasn't been chosen
 * yet and this business hasn't bootstrapped.
 */
export async function runSync(): Promise<SyncResult> {
  if (!isSyncConfigured()) {
    return { pushed: 0, pulled: 0, deleted: 0, error: 'Sync is not configured.' }
  }
  if (inFlight) return inFlight

  inFlight = (async () => {
    // Guard: don't let an un-set-up device silently bootstrap as primary. (A
    // just-reset device stays bootstrapped and syncs normally — its first sync
    // is pull-only, so it re-downloads the cloud data without pushing up its
    // emptiness. See the reset_pending handling in syncBusiness.)
    const activeDb = await getDatabaseFor(getActiveBusinessId())
    if (!(await isBootstrapped(activeDb)) && (await getRole(activeDb)) == null) {
      return { pushed: 0, pulled: 0, deleted: 0, error: 'needs-setup' }
    }
    return runForActiveBusiness(syncBusiness)
  })()

  emitProgress({ phase: 'preparing', processed: 0, total: 0, businessLabel: '' })
  notify()
  try {
    return await inFlight
  } finally {
    inFlight = null
    emitProgress(null)
    notify()
  }
}

/**
 * Force a full re-upload of the ACTIVE business's local data. Recovery path for
 * when the cloud was reset while this device still thought it was fully synced.
 * Shares the same in-flight guard as {@link runSync}.
 */
export async function runFullResync(): Promise<SyncResult> {
  if (!isSyncConfigured()) {
    return { pushed: 0, pulled: 0, deleted: 0, error: 'Sync is not configured.' }
  }
  if (inFlight) return inFlight

  inFlight = runForActiveBusiness(forceFullResync)
  emitProgress({ phase: 'preparing', processed: 0, total: 0, businessLabel: '' })
  notify()
  try {
    return await inFlight
  } finally {
    inFlight = null
    emitProgress(null)
    notify()
  }
}

/** Fire-and-forget sync used on app open. Silent on the needs-setup guard. */
export async function runSyncOnStartup(): Promise<void> {
  if (!isSyncConfigured()) return
  const overview = await getSyncOverview()
  if (overview.needsSetup) return
  await runSync()
}
