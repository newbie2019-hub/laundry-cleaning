import type Database from '@tauri-apps/plugin-sql'
import { appConfigDir, join } from '@tauri-apps/api/path'
import type { BusinessId } from '../db/business'
import { CLOUD_TABLE } from './config'
import { getSyncTables, payloadColumns, type SyncTable } from './registry'
import { getSupabase } from './supabase'
import {
  clearResetPending,
  getLastPulledAt,
  getRole,
  isBootstrapped,
  isResetPending,
  markBootstrapped,
  setLastPulledAt,
  setSyncValue,
  SYNC_KEYS,
} from './state'

const EPOCH = '1970-01-01T00:00:00Z'
const PAGE_SIZE = 1000
const UPSERT_CHUNK = 500

// The JSON payload stored in the cloud for one local row. `cols` holds the
// row's own scalar values (never the local integer id, uuid, or synced_at).
// `refs` maps each foreign-key column to the PARENT ROW'S uuid, because integer
// ids are meaningless across devices — the pull step resolves these back to the
// local id.
type RowPayload = {
  cols: Record<string, unknown>
  refs: Record<string, string | null>
}

type CloudRow = {
  business_id: string
  table_name: string
  uuid: string
  updated_at: string
  deleted_at: string | null
  data: RowPayload | null
}

export type SyncResult = {
  pushed: number
  pulled: number
  deleted: number
  error?: string
}

// Live progress emitted while a sync runs, so the UI can show a running toast.
// `total` is 0 while a phase can't yet know its size (e.g. still scanning), in
// which case the UI shows an indeterminate count instead of a percentage.
export type SyncPhase = 'preparing' | 'uploading' | 'downloading' | 'applying'
export type SyncProgress = {
  phase: SyncPhase
  processed: number
  total: number
}
export type ProgressFn = (progress: SyncProgress) => void

function nowIso(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// PUSH
// ---------------------------------------------------------------------------

/** Resolve a parent row's uuid from its local integer id, with a per-sync cache. */
async function parentUuidById(
  db: Database,
  parentTable: string,
  localId: number,
  cache: Map<string, Map<number, string | null>>,
): Promise<string | null> {
  let table = cache.get(parentTable)
  if (!table) {
    table = new Map()
    cache.set(parentTable, table)
  }
  if (table.has(localId)) return table.get(localId)!
  const rows = await db.select<Array<{ uuid: string | null }>>(
    `SELECT uuid FROM ${parentTable} WHERE id = $1`,
    [localId],
  )
  const uuid = rows[0]?.uuid ?? null
  table.set(localId, uuid)
  return uuid
}

async function buildPayload(
  db: Database,
  table: SyncTable,
  row: Record<string, unknown>,
  cache: Map<string, Map<number, string | null>>,
): Promise<RowPayload> {
  const fkColumns = new Set(table.foreignKeys.map((fk) => fk.column))
  const cols: Record<string, unknown> = {}
  for (const col of payloadColumns(table)) {
    if (fkColumns.has(col)) continue // FK values travel in `refs` as uuids
    cols[col] = row[col] ?? null
  }
  const refs: Record<string, string | null> = {}
  for (const fk of table.foreignKeys) {
    const localId = row[fk.column]
    refs[fk.column] =
      localId == null ? null : await parentUuidById(db, fk.parentTable, Number(localId), cache)
  }
  return { cols, refs }
}

async function chunkedUpsert(
  rows: CloudRow[],
  onChunk?: (uploaded: number) => void,
): Promise<void> {
  const supabase = getSupabase()
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK)
    const { error } = await supabase
      .from(CLOUD_TABLE)
      .upsert(chunk, { onConflict: 'business_id,table_name,uuid' })
    if (error) throw new Error(`push failed: ${error.message}`)
    onChunk?.(chunk.length)
  }
}

/**
 * Upload every locally-changed row (updated_at > synced_at) and every pending
 * tombstone. `pushAll` forces all rows regardless of dirty state — used for the
 * primary device's first bootstrap.
 */
async function push(
  db: Database,
  businessId: BusinessId,
  pushAll: boolean,
  onProgress?: ProgressFn,
): Promise<number> {
  const tables = await getSyncTables(db)
  const cache = new Map<string, Map<number, string | null>>()
  const cloudRows: CloudRow[] = []

  for (const table of tables) {
    const dirtyClause = pushAll
      ? ''
      : `WHERE uuid IS NOT NULL AND (synced_at IS NULL OR updated_at > synced_at)`
    const rows = await db.select<Array<Record<string, unknown>>>(
      `SELECT * FROM ${table.name} ${dirtyClause}`,
    )
    for (const row of rows) {
      const uuid = row.uuid as string | null
      if (!uuid) continue
      cloudRows.push({
        business_id: businessId,
        table_name: table.name,
        uuid,
        updated_at: nowIso(), // server trigger overrides with its own clock
        deleted_at: null,
        data: await buildPayload(db, table, row, cache),
      })
      // `total` unknown until every table is scanned, so report indeterminate.
      if (cloudRows.length % 250 === 0) {
        onProgress?.({ phase: 'preparing', processed: cloudRows.length, total: 0 })
      }
    }
  }

  // Tombstones: mark the cloud row deleted so other devices remove it.
  const tombstones = await db.select<Array<{ id: number; table_name: string; row_uuid: string }>>(
    `SELECT id, table_name, row_uuid FROM sync_tombstones WHERE pushed = 0`,
  )
  for (const t of tombstones) {
    cloudRows.push({
      business_id: businessId,
      table_name: t.table_name,
      uuid: t.row_uuid,
      updated_at: nowIso(),
      deleted_at: nowIso(),
      data: null,
    })
  }

  if (cloudRows.length === 0) return 0

  const total = cloudRows.length
  let uploaded = 0
  await chunkedUpsert(cloudRows, (n) => {
    uploaded += n
    onProgress?.({ phase: 'uploading', processed: uploaded, total })
  })

  // Mark local rows clean: synced_at = the updated_at captured at read time, so
  // any edit that lands mid-push (bumping updated_at further) stays dirty.
  for (const table of tables) {
    await db.execute(
      `UPDATE ${table.name} SET synced_at = updated_at
       WHERE uuid IS NOT NULL AND (synced_at IS NULL OR updated_at > synced_at)`,
    )
  }
  if (tombstones.length > 0) {
    await db.execute(`UPDATE sync_tombstones SET pushed = 1 WHERE pushed = 0`)
  }

  return cloudRows.length
}

// ---------------------------------------------------------------------------
// PULL
// ---------------------------------------------------------------------------

/** Resolve a parent uuid to its local integer id, with a per-sync cache. */
async function localIdByUuid(
  db: Database,
  parentTable: string,
  uuid: string,
  cache: Map<string, Map<string, number | null>>,
): Promise<number | null> {
  let table = cache.get(parentTable)
  if (!table) {
    table = new Map()
    cache.set(parentTable, table)
  }
  if (table.has(uuid)) return table.get(uuid)!
  const rows = await db.select<Array<{ id: number }>>(
    `SELECT id FROM ${parentTable} WHERE uuid = $1`,
    [uuid],
  )
  const id = rows[0]?.id ?? null
  table.set(uuid, id)
  return id
}

async function fetchChangedRows(
  businessId: BusinessId,
  since: string,
  onProgress?: ProgressFn,
): Promise<CloudRow[]> {
  const supabase = getSupabase()
  const all: CloudRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(CLOUD_TABLE)
      .select('*')
      .eq('business_id', businessId)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`pull failed: ${error.message}`)
    const page = (data ?? []) as CloudRow[]
    all.push(...page)
    onProgress?.({ phase: 'downloading', processed: all.length, total: 0 })
    if (page.length < PAGE_SIZE) break
  }
  return all
}

/**
 * Apply cloud changes to the local database. Rows are grouped by table and
 * applied in topological order so a child's FK-uuid lookups always find their
 * parent. Returns [appliedRowCount, appliedDeleteCount, maxUpdatedAt].
 */
async function applyCloudRows(
  db: Database,
  tables: SyncTable[],
  cloudRows: CloudRow[],
  onProgress?: ProgressFn,
): Promise<{ pulled: number; deleted: number; maxUpdatedAt: string }> {
  const total = cloudRows.length
  let applied = 0
  const byTable = new Map<string, CloudRow[]>()
  let maxUpdatedAt = EPOCH
  for (const row of cloudRows) {
    if (row.updated_at > maxUpdatedAt) maxUpdatedAt = row.updated_at
    const list = byTable.get(row.table_name)
    if (list) list.push(row)
    else byTable.set(row.table_name, [row])
  }

  const idCache = new Map<string, Map<string, number | null>>()
  let pulled = 0
  let deleted = 0

  // Snapshot the tombstone id high-water so echoes created by the deletes we
  // apply below can be suppressed (they must not be re-pushed to the cloud).
  const tombMaxRows = await db.select<Array<{ m: number | null }>>(
    `SELECT MAX(id) AS m FROM sync_tombstones`,
  )
  const tombSnapshot = tombMaxRows[0]?.m ?? 0

  let skipped = 0

  for (const table of tables) {
    const rows = byTable.get(table.name)
    if (!rows) continue
    const fkByColumn = new Map(table.foreignKeys.map((fk) => [fk.column, fk.parentTable]))

    for (const row of rows) {
      try {
        await applyOneRow(db, table.name, fkByColumn, row, idCache)
          .then((outcome) => {
            if (outcome === 'inserted') pulled += 1
            else if (outcome === 'deleted') deleted += 1
          })
      } catch (error) {
        // A single row must never abort the whole sync (e.g. a natural-key
        // clash from two devices independently creating the same master-data
        // row). Skip it; other rows and future syncs continue.
        skipped += 1
        console.warn(`[sync] skipped ${table.name}/${row.uuid}:`, error)
      }
      applied += 1
      if (applied % 100 === 0 || applied === total) {
        onProgress?.({ phase: 'applying', processed: applied, total })
      }
    }
  }

  if (skipped > 0) console.warn(`[sync] ${skipped} row(s) skipped this pull`)

  // Suppress echo: any tombstone created by the deletes we just applied is an
  // echo of a remote delete and must not be pushed back.
  if (deleted > 0) {
    await db.execute(`UPDATE sync_tombstones SET pushed = 1 WHERE id > $1`, [tombSnapshot])
  }

  return { pulled, deleted, maxUpdatedAt }
}

type ApplyOutcome = 'inserted' | 'deleted' | 'skipped'

async function applyOneRow(
  db: Database,
  tableName: string,
  fkByColumn: Map<string, string>,
  row: CloudRow,
  idCache: Map<string, Map<string, number | null>>,
): Promise<ApplyOutcome> {
  // Deletion: remove the local row if present; FK cascades handle children.
  if (row.deleted_at) {
    await db.execute(`DELETE FROM ${tableName} WHERE uuid = $1`, [row.uuid])
    return 'deleted'
  }
  if (!row.data) return 'skipped'

  // The row's ORIGINAL edit time (source device's SQLite `updated_at`, carried
  // in the payload) drives last-write-wins. This is distinct from the cloud
  // row's server `updated_at`, which only drives the pull high-water mark.
  const remoteUpdatedAt = String(row.data.cols['updated_at'] ?? '')

  // Last-write-wins by edit time:
  //  - a dirty local row (unpushed edit) is kept; it will push and contend on
  //    the server on its own turn;
  //  - a clean local row of the same age or newer is kept;
  //  - otherwise the (newer) remote row is applied.
  const localRows = await db.select<Array<{ lu: string | null; dirty: number }>>(
    `SELECT updated_at AS lu, (updated_at > COALESCE(synced_at, '')) AS dirty
     FROM ${tableName} WHERE uuid = $1`,
    [row.uuid],
  )
  const local = localRows[0]
  if (local) {
    if (local.dirty === 1) return 'skipped'
    if ((local.lu ?? '') >= remoteUpdatedAt) return 'skipped'
  }

  // Resolve FK uuids -> local ids. If a referenced parent isn't present locally
  // yet, defer this row to a later sync pass rather than corrupt it.
  const resolved: Record<string, unknown> = { ...row.data.cols }
  for (const [col, parentUuid] of Object.entries(row.data.refs)) {
    const parentTable = fkByColumn.get(col)
    if (!parentTable) continue
    if (parentUuid == null) {
      resolved[col] = null
      continue
    }
    const localId = await localIdByUuid(db, parentTable, parentUuid, idCache)
    if (localId == null) return 'skipped' // defer until parent arrives
    resolved[col] = localId
  }

  // `resolved` already contains `updated_at` (a payload col). We add uuid and
  // set synced_at = the applied updated_at so the row reads as clean (not dirty)
  // and never echoes back on the next push.
  const cols = Object.keys(resolved)
  const insertCols = [...cols, 'uuid', 'synced_at']
  const placeholders = insertCols.map((_, i) => `$${i + 1}`)
  const values = [...cols.map((c) => resolved[c]), row.uuid, remoteUpdatedAt]
  const updateAssignments = [...cols, 'synced_at']
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')

  await db.execute(
    `INSERT INTO ${tableName} (${insertCols.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT(uuid) DO UPDATE SET ${updateAssignments}`,
    values,
  )
  return 'inserted'
}

async function pull(
  db: Database,
  businessId: BusinessId,
  onProgress?: ProgressFn,
): Promise<{ pulled: number; deleted: number }> {
  const tables = await getSyncTables(db)
  const since = (await getLastPulledAt(db)) ?? EPOCH
  const cloudRows = await fetchChangedRows(businessId, since, onProgress)
  if (cloudRows.length === 0) return { pulled: 0, deleted: 0 }

  const { pulled, deleted, maxUpdatedAt } = await applyCloudRows(db, tables, cloudRows, onProgress)
  if (maxUpdatedAt > since) await setLastPulledAt(db, maxUpdatedAt)
  return { pulled, deleted }
}

// ---------------------------------------------------------------------------
// BOOTSTRAP + top-level sync
// ---------------------------------------------------------------------------

/** Wipe all local sync-table rows (child->parent order) WITHOUT propagating the
 *  deletes — used only for a secondary device adopting the primary's dataset. */
async function wipeLocalData(db: Database, tables: SyncTable[]): Promise<void> {
  for (let i = tables.length - 1; i >= 0; i -= 1) {
    await db.execute(`DELETE FROM ${tables[i]!.name}`)
  }
  // Discard the tombstones the wipe created — a secondary never uploads its
  // pre-existing data or its removal; it simply adopts the cloud dataset.
  await db.execute(`DELETE FROM sync_tombstones`)
}

/**
 * Full backup of the current database via SQLite's online backup (VACUUM INTO),
 * written to an ABSOLUTE path in the app data dir. This runs before a secondary
 * device wipes its local data during bootstrap, so nothing is ever truly lost.
 * Throws on failure so the caller aborts the wipe rather than proceed unsafely.
 */
async function backupDatabase(db: Database, businessId: BusinessId): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  // Write the backup alongside the live DB, which tauri-plugin-sql keeps in the
  // app config dir — guaranteed to exist and be writable. VACUUM INTO writes the
  // file via SQLite directly, so it needs no fs-plugin permission.
  const dir = await appConfigDir()
  const target = await join(dir, `sync-backup-${businessId}-${stamp}.db`)
  const safeTarget = target.replace(/'/g, "''") // escape for the SQL literal
  await db.execute(`VACUUM INTO '${safeTarget}'`)
}

/** Count live (non-deleted) cloud rows for one business/table. */
async function cloudRowCount(businessId: BusinessId, tableName: string): Promise<number> {
  const supabase = getSupabase()
  const { count, error } = await supabase
    .from(CLOUD_TABLE)
    .select('uuid', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('table_name', tableName)
    .is('deleted_at', null)
  if (error) throw new Error(`cloud check failed: ${error.message}`)
  return count ?? 0
}

async function runBootstrap(
  db: Database,
  businessId: BusinessId,
  onProgress?: ProgressFn,
): Promise<SyncResult> {
  const tables = await getSyncTables(db)
  const role = (await getRole(db)) ?? 'primary'

  if (role === 'secondary') {
    // Safety gate: a secondary adopts the cloud by WIPING its own data, so we
    // must never do that against an empty or half-populated cloud. If the
    // source hasn't finished its first upload — or the cloud was reset while it
    // still thought it was synced — the account tables are missing and this
    // device would be left unable to log in. Abort loudly and leave local data
    // untouched; the user re-runs once the source has synced.
    const accounts = await cloudRowCount(businessId, 'users')
    if (accounts === 0) {
      throw new Error(
        'The cloud has no account data yet for this business. Sync the source device first, then set up this device again.',
      )
    }
    await backupDatabase(db, businessId)
    await wipeLocalData(db, tables)
    const { pulled, deleted } = await pull(db, businessId, onProgress)
    await markBootstrapped(db)
    return { pushed: 0, pulled, deleted }
  }

  // Primary: seed the cloud with the full local dataset, then pull anything new.
  const pushed = await push(db, businessId, /* pushAll */ true, onProgress)
  const { pulled, deleted } = await pull(db, businessId, onProgress)
  await markBootstrapped(db)
  return { pushed, pulled, deleted }
}

/**
 * Recovery: force this device to re-upload its ENTIRE local dataset on the next
 * sync. Marks every syncable row dirty (synced_at = NULL) and rewinds the pull
 * high-water, then runs a normal sync. Used when the cloud was reset/wiped while
 * this device still believed it was fully synced (so the normal incremental
 * push, which only sends dirty rows, would never re-send the missing data).
 * Only meaningful on the source device; never wipes local data.
 */
export async function forceFullResync(
  db: Database,
  businessId: BusinessId,
  onProgress?: ProgressFn,
): Promise<SyncResult> {
  try {
    const tables = await getSyncTables(db)
    for (const table of tables) {
      await db.execute(`UPDATE ${table.name} SET synced_at = NULL WHERE uuid IS NOT NULL`)
    }
    await setLastPulledAt(db, EPOCH)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await setSyncValue(db, SYNC_KEYS.lastError, message).catch(() => {})
    return { pushed: 0, pulled: 0, deleted: 0, error: message }
  }
  return syncBusiness(db, businessId, onProgress)
}

/**
 * Run a full sync for one business database: bootstrap on first run, otherwise
 * the normal incremental pull-then-push. Never throws — failures are captured
 * in the result and recorded so the UI can surface them.
 */
export async function syncBusiness(
  db: Database,
  businessId: BusinessId,
  onProgress?: ProgressFn,
): Promise<SyncResult> {
  try {
    let result: SyncResult
    if (!(await isBootstrapped(db))) {
      result = await runBootstrap(db, businessId, onProgress)
    } else {
      // Pull first so local rows merge on top of remote, then push local edits.
      const resetPending = await isResetPending(db)
      const pulledResult = await pull(db, businessId, onProgress)
      let pushed = 0
      if (resetPending) {
        // This device was just reset and is (near-)empty. The pull above has
        // re-downloaded the cloud data; we deliberately SKIP the push so the
        // empty state never goes up over the good cloud copy. Now that the pull
        // succeeded and repopulated the device, lift the guard — subsequent
        // syncs push normally.
        await clearResetPending(db)
      } else {
        pushed = await push(db, businessId, /* pushAll */ false, onProgress)
      }
      result = { pushed, pulled: pulledResult.pulled, deleted: pulledResult.deleted }
    }
    await setSyncValue(db, SYNC_KEYS.lastSyncedAt, nowIso())
    await setSyncValue(db, SYNC_KEYS.lastError, null)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await setSyncValue(db, SYNC_KEYS.lastError, message).catch(() => {})
    return { pushed: 0, pulled: 0, deleted: 0, error: message }
  }
}
