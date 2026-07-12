import type Database from '@tauri-apps/plugin-sql'

// The sync registry is derived by INTROSPECTING SQLite at runtime rather than
// hand-listing 30 tables' columns in three places (migration, cloud schema,
// engine). A table participates in sync iff it has a `uuid` column — exactly
// the set migration v27 stamped — so the registry can never drift from the
// migration. Foreign keys come from PRAGMA foreign_key_list, which tells the
// engine how to translate integer FK ids <-> parent uuids across devices.

export type ForeignKey = {
  /** Local column on this table holding the parent's integer id. */
  column: string
  /** The parent table it references. */
  parentTable: string
}

export type SyncTable = {
  name: string
  /** All column names on the table. */
  columns: string[]
  /** The single integer primary-key column (usually `id`), or null for
   *  composite-key tables (role_permissions, user_roles) which have none. */
  idColumn: string | null
  /** Foreign keys pointing at other sync tables. */
  foreignKeys: ForeignKey[]
}

type PragmaColumnRow = { name: string; pk: number; type: string }
type PragmaFkRow = { table: string; from: string; to: string }
type TableNameRow = { name: string }

// Columns the engine manages itself and never ships inside the JSON payload.
// `current_stock` (inventory_items) is a device-local derived cache maintained
// by triggers on inventory_movements — the movements themselves sync, so each
// device rebuilds current_stock locally. Shipping it would let a stale snapshot
// double-count against the trigger-applied deltas on the receiving device.
const RESERVED_COLUMNS = new Set(['uuid', 'synced_at', 'current_stock'])

let cache: SyncTable[] | null = null

async function tableColumns(db: Database, table: string): Promise<PragmaColumnRow[]> {
  return db.select<PragmaColumnRow[]>(`PRAGMA table_info('${table}')`)
}

/** All base tables (excluding SQLite internals and the sync bookkeeping tables). */
async function listBaseTables(db: Database): Promise<string[]> {
  const rows = await db.select<TableNameRow[]>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name NOT IN ('sync_state', 'sync_tombstones')
     ORDER BY name`,
  )
  return rows.map((r) => r.name)
}

/**
 * Build (and cache) the list of syncable tables in dependency order — every
 * parent appears before any child that references it, so a pull applies parents
 * first and child FK lookups always resolve.
 */
export async function getSyncTables(db: Database): Promise<SyncTable[]> {
  if (cache) return cache

  const baseTables = await listBaseTables(db)
  const tables: SyncTable[] = []

  for (const name of baseTables) {
    const cols = await tableColumns(db, name)
    const hasUuid = cols.some((c) => c.name === 'uuid')
    if (!hasUuid) continue // not a sync table

    const pkCols = cols.filter((c) => c.pk > 0)
    const idColumn =
      pkCols.length === 1 && pkCols[0]!.type.toUpperCase().includes('INT')
        ? pkCols[0]!.name
        : null

    const fkRows = await db.select<PragmaFkRow[]>(`PRAGMA foreign_key_list('${name}')`)
    const foreignKeys: ForeignKey[] = fkRows
      .filter((fk) => baseTables.includes(fk.table))
      .map((fk) => ({ column: fk.from, parentTable: fk.table }))

    tables.push({
      name,
      columns: cols.map((c) => c.name),
      idColumn,
      foreignKeys,
    })
  }

  cache = topologicalSort(tables)
  return cache
}

/** Kahn's algorithm: order tables so parents precede children. Self- and
 *  cyclic references (none expected in this schema) are broken by emitting the
 *  remaining tables in name order, which is safe because FK columns are
 *  nullable-resolved and a missing parent just defers a row to the next pass. */
function topologicalSort(tables: SyncTable[]): SyncTable[] {
  const byName = new Map(tables.map((t) => [t.name, t]))
  const remaining = new Set(tables.map((t) => t.name))
  const ordered: SyncTable[] = []

  while (remaining.size > 0) {
    let progressed = false
    for (const name of [...remaining].sort()) {
      const table = byName.get(name)!
      const deps = table.foreignKeys
        .map((fk) => fk.parentTable)
        .filter((p) => p !== name && remaining.has(p))
      if (deps.length === 0) {
        ordered.push(table)
        remaining.delete(name)
        progressed = true
      }
    }
    if (!progressed) {
      // Cycle fallback: emit whatever is left in a stable order.
      for (const name of [...remaining].sort()) {
        ordered.push(byName.get(name)!)
        remaining.delete(name)
      }
    }
  }

  return ordered
}

export function payloadColumns(table: SyncTable): string[] {
  return table.columns.filter(
    (c) => !RESERVED_COLUMNS.has(c) && c !== table.idColumn,
  )
}

/** Test/maintenance hook: drop the cached introspection (e.g. after migrations). */
export function resetRegistryCache(): void {
  cache = null
}
