// Inventory-only export / import.
//
// Goals:
//   1. Carry **only** the inventory section (categories, items, alt selling
//      units, movements, maintenance records). Nothing else.
//   2. Be **safe across schema migrations** — older files import cleanly into
//      a newer DB (missing optional fields default), and newer files refuse
//      to import only if the *core* identity fields (name, code) are missing.
//      Extra fields the local app doesn't recognize are silently ignored.
//   3. **Never delete or overwrite** existing local rows by default. The
//      planner classifies every incoming row as `insert` (no local match),
//      `skipIdentical` (local match, all fields equal), or `conflict` (local
//      match, fields differ). Conflicts are *skipped* unless the user ticks
//      "Overwrite when item already exists". Pre-existing local rows with no
//      counterpart in the file are always left alone.
//
// File envelope:
//   {
//     "format": "business-ledger-inventory-export",
//     "formatVersion": 1,
//     "schemaVersion": <local DB schema version at export time>,
//     "businessId": "laundry" | "cleaning",
//     "exportedAt": ISO date,
//     "appVersion": "...",
//     "checksum": sha-256 hex of canonical(entities),
//     "counts": { ... },
//     "entities": {
//       "categories": [...],
//       "items": [...],
//       "movements": [...],          // optional
//       "maintenanceRecords": [...]  // optional
//     }
//   }
//
// Identity / fingerprints (used to detect duplicates on import):
//   - category:  ['inventoryCategory', code]
//   - item:      ['inventoryItem', lower(name)]
//   - movement:  ['inventoryMovement', lower(itemName), date, type, qty, cost, notes]
//   - service:   ['inventoryMaintenance', lower(itemName), serviceDate, serviceType, performedBy]
//
// Apply order is parents-first (categories → items → alt units → movements →
// maintenance). Foreign keys are temporarily disabled around the apply phase
// to mirror what the full backup importer does, since the Tauri SQL plugin
// can't span BEGIN/COMMIT across statements.

import { format as formatDate } from 'date-fns'
import { BUSINESSES, getActiveBusinessId, type BusinessId } from '../../lib/db/business'
import { getDatabase } from '../../lib/db/client'
import { saveBytesAsDownload } from '../../lib/save-file-download'
import { canonicalJson, fingerprint } from '../backup/backup-export'

// ─── Format constants ────────────────────────────────────────────────────────

export const INVENTORY_BACKUP_FORMAT = 'business-ledger-inventory-export' as const
/**
 * Bump this when the *file shape* changes in a way that older readers can't
 * understand. New optional fields do NOT require a bump — readers tolerate
 * missing fields by defaulting them.
 */
export const INVENTORY_BACKUP_FORMAT_VERSION = 1
/**
 * Highest DB schema version this build can fully understand. Files written
 * with a newer schema are still accepted (we only read fields we know about),
 * but we record this in the envelope so future debugging is easier.
 */
export const INVENTORY_SUPPORTED_SCHEMA_VERSION = 23

// ─── Types ───────────────────────────────────────────────────────────────────

export type InventoryItemRef = { name: string }

export type ExportInventoryCategory = {
  fingerprint: string
  code: string
  label: string
  isSystem: boolean
  isActive: boolean
  sortOrder: number
}

export type ExportInventoryAltUnit = {
  unitLabel: string
  unitsPerBase: number
  unitPrice: number
  sortOrder: number
  isActive: boolean
}

export type ExportInventoryItem = {
  fingerprint: string
  name: string
  description: string
  unitType: string
  unitLabel: string
  costPerUnit: number
  sellingPrice: number
  isActive: boolean
  lowStockThreshold: number
  /** Soft reference. If the local DB doesn't have this code, we fall back to "other". */
  categoryCode: string
  supplier: string
  /** Equipment-only fields — empty string when not equipment. */
  status: string
  lastMaintenanceDate: string
  /** Optional alt sale units. Tolerated as missing on older files. */
  altUnits?: ExportInventoryAltUnit[]
}

export type ExportInventoryMovement = {
  fingerprint: string
  itemRef: InventoryItemRef
  movementType: 'IN' | 'OUT'
  quantity: number
  unitCost: number
  notes: string
  movementDate: string
  createdAt: string
}

export type ExportInventoryMaintenance = {
  fingerprint: string
  itemRef: InventoryItemRef
  serviceDate: string
  serviceType: string
  performedBy: string
  cost: number
  description: string
  nextServiceDate: string
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  createdAt: string
}

export type InventoryBackupEntities = {
  categories: ExportInventoryCategory[]
  items: ExportInventoryItem[]
  movements?: ExportInventoryMovement[]
  maintenanceRecords?: ExportInventoryMaintenance[]
}

export type InventoryBackupCounts = {
  categories: number
  items: number
  altUnits: number
  movements: number
  maintenanceRecords: number
}

export type InventoryBackupFile = {
  format: typeof INVENTORY_BACKUP_FORMAT
  formatVersion: number
  schemaVersion: number
  businessId: BusinessId
  exportedAt: string
  appVersion: string
  checksum: string
  counts: InventoryBackupCounts
  entities: InventoryBackupEntities
}

// ─── Small helpers ───────────────────────────────────────────────────────────

const textEncoder = new TextEncoder()

async function sha256Hex(input: string): Promise<string> {
  const data = textEncoder.encode(input)
  const buf = await crypto.subtle.digest(
    'SHA-256',
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  )
  const bytes = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, '0')
  }
  return out
}

function asString(value: unknown): string {
  return value == null ? '' : String(value)
}

function asNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function asBool(value: unknown): boolean {
  return Boolean(asNumber(value))
}

function lower(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

// ─── Export ──────────────────────────────────────────────────────────────────

export type ExportOptions = {
  /** Include movements (stock-in / stock-out). Default true. */
  includeMovements?: boolean
  /** Include maintenance records. Default true. */
  includeMaintenanceRecords?: boolean
}

export type ExportResult = {
  filename: string
  byteLength: number
  counts: InventoryBackupCounts
}

function makeFilename(businessId: BusinessId): string {
  const stamp = formatDate(new Date(), 'yyyy-MM-dd-HHmm')
  return `business-ledger-inventory-${businessId}-${stamp}.json`
}

/** Build an in-memory inventory backup file from the active DB. */
export async function buildInventoryBackupFile(
  options: ExportOptions = {},
): Promise<InventoryBackupFile> {
  const businessId = getActiveBusinessId()
  // Touch the BUSINESSES map so the import side has a stable definition to
  // validate against. (No runtime effect, but keeps the dependency explicit.)
  void BUSINESSES[businessId]

  const includeMovements = options.includeMovements !== false
  const includeMaintenance = options.includeMaintenanceRecords !== false

  const entities = await loadInventoryEntities({ includeMovements, includeMaintenance })

  const counts: InventoryBackupCounts = {
    categories: entities.categories.length,
    items: entities.items.length,
    altUnits: entities.items.reduce((acc, i) => acc + (i.altUnits?.length ?? 0), 0),
    movements: entities.movements?.length ?? 0,
    maintenanceRecords: entities.maintenanceRecords?.length ?? 0,
  }

  const checksum = await sha256Hex(canonicalJson(entities))

  return {
    format: INVENTORY_BACKUP_FORMAT,
    formatVersion: INVENTORY_BACKUP_FORMAT_VERSION,
    schemaVersion: INVENTORY_SUPPORTED_SCHEMA_VERSION,
    businessId,
    exportedAt: new Date().toISOString(),
    appVersion: '0.1.0',
    checksum,
    counts,
    entities,
  }
}

/** Build the file and write it to the user's Downloads folder. */
export async function exportInventoryToJson(options: ExportOptions = {}): Promise<ExportResult> {
  const file = await buildInventoryBackupFile(options)
  const filename = makeFilename(file.businessId)
  const bytes = textEncoder.encode(JSON.stringify(file, null, 2))
  await saveBytesAsDownload(filename, bytes, 'application/json')
  return { filename, byteLength: bytes.byteLength, counts: file.counts }
}

// ─── Per-entity loaders (raw SQL kept here so repository.ts stays small) ─────

type RawCategory = {
  id: number
  code: string
  label: string
  isSystem: number
  isActive: number
  sortOrder: number
}

type RawItem = {
  id: number
  name: string
  description: string
  unitType: string
  unitLabel: string
  costPerUnit: number
  sellingPrice: number
  isActive: number
  lowStockThreshold: number
  categoryCode: string
  supplier: string
  status: string
  lastMaintenanceDate: string
}

type RawAltUnit = {
  itemId: number
  unitLabel: string
  unitsPerBase: number
  unitPrice: number
  sortOrder: number
  isActive: number
}

type RawMovement = {
  itemName: string
  movementType: string
  quantity: number
  unitCost: number
  notes: string
  movementDate: string
  createdAt: string
}

type RawMaintenance = {
  itemName: string
  serviceDate: string
  serviceType: string
  performedBy: string
  cost: number
  description: string
  nextServiceDate: string
  status: string
  createdAt: string
}

async function loadInventoryEntities(opts: {
  includeMovements: boolean
  includeMaintenance: boolean
}): Promise<InventoryBackupEntities> {
  const db = await getDatabase()

  const rawCategories = await db.select<RawCategory[]>(
    `
      SELECT
        id,
        code,
        label,
        is_system AS isSystem,
        is_active AS isActive,
        sort_order AS sortOrder
      FROM inventory_categories
      ORDER BY sort_order, label, id
    `,
  )

  const rawItems = await db.select<RawItem[]>(
    `
      SELECT
        i.id            AS id,
        i.name          AS name,
        i.description   AS description,
        i.unit_type     AS unitType,
        i.unit_label    AS unitLabel,
        i.cost_per_unit AS costPerUnit,
        i.selling_price AS sellingPrice,
        i.is_active     AS isActive,
        i.low_stock_threshold AS lowStockThreshold,
        COALESCE(c.code, lc.code, i.category, 'other') AS categoryCode,
        i.supplier      AS supplier,
        i.status        AS status,
        i.last_maintenance_date AS lastMaintenanceDate
      FROM inventory_items i
      LEFT JOIN inventory_categories c  ON c.id   = i.category_id
      LEFT JOIN inventory_categories lc ON lc.code = i.category
      ORDER BY i.name, i.id
    `,
  )

  const rawAltUnits = await db.select<RawAltUnit[]>(
    `
      SELECT
        item_id        AS itemId,
        unit_label     AS unitLabel,
        units_per_base AS unitsPerBase,
        unit_price     AS unitPrice,
        sort_order     AS sortOrder,
        is_active      AS isActive
      FROM inventory_item_units
      ORDER BY item_id, sort_order, unit_label
    `,
  )
  const altByItem = new Map<number, RawAltUnit[]>()
  for (const u of rawAltUnits) {
    const list = altByItem.get(u.itemId) ?? []
    list.push(u)
    altByItem.set(u.itemId, list)
  }

  const rawMovements = opts.includeMovements
    ? await db.select<RawMovement[]>(
        `
          SELECT
            i.name AS itemName,
            m.movement_type AS movementType,
            m.quantity AS quantity,
            m.unit_cost AS unitCost,
            m.notes AS notes,
            m.movement_date AS movementDate,
            m.created_at AS createdAt
          FROM inventory_movements m
          JOIN inventory_items i ON i.id = m.item_id
          ORDER BY m.movement_date, m.id
        `,
      )
    : []

  const rawMaintenance = opts.includeMaintenance
    ? await db.select<RawMaintenance[]>(
        `
          SELECT
            i.name AS itemName,
            mr.service_date AS serviceDate,
            mr.service_type AS serviceType,
            mr.performed_by AS performedBy,
            mr.cost AS cost,
            mr.description AS description,
            mr.next_service_date AS nextServiceDate,
            mr.status AS status,
            mr.created_at AS createdAt
          FROM inventory_maintenance_records mr
          JOIN inventory_items i ON i.id = mr.item_id
          ORDER BY mr.service_date, mr.id
        `,
      )
    : []

  // Build per-row export shapes with stable fingerprints.
  const categories: ExportInventoryCategory[] = await Promise.all(
    rawCategories.map(async (r) => ({
      fingerprint: await fingerprint(['inventoryCategory', r.code]),
      code: r.code,
      label: r.label,
      isSystem: asBool(r.isSystem),
      isActive: asBool(r.isActive),
      sortOrder: asNumber(r.sortOrder),
    })),
  )

  const items: ExportInventoryItem[] = await Promise.all(
    rawItems.map(async (r) => {
      const alts = altByItem.get(r.id) ?? []
      const item: ExportInventoryItem = {
        fingerprint: await fingerprint(['inventoryItem', lower(r.name)]),
        name: r.name,
        description: asString(r.description),
        unitType: asString(r.unitType),
        unitLabel: asString(r.unitLabel),
        costPerUnit: asNumber(r.costPerUnit),
        sellingPrice: asNumber(r.sellingPrice),
        isActive: asBool(r.isActive),
        lowStockThreshold: asNumber(r.lowStockThreshold),
        categoryCode: asString(r.categoryCode),
        supplier: asString(r.supplier),
        status: asString(r.status),
        lastMaintenanceDate: asString(r.lastMaintenanceDate),
      }
      if (alts.length > 0) {
        item.altUnits = alts.map<ExportInventoryAltUnit>((u) => ({
          unitLabel: asString(u.unitLabel),
          unitsPerBase: asNumber(u.unitsPerBase),
          unitPrice: asNumber(u.unitPrice),
          sortOrder: asNumber(u.sortOrder),
          isActive: asBool(u.isActive),
        }))
      }
      return item
    }),
  )

  const movements: ExportInventoryMovement[] = await Promise.all(
    rawMovements.map(async (r) => ({
      fingerprint: await fingerprint([
        'inventoryMovement',
        lower(r.itemName),
        r.movementDate,
        r.movementType,
        asNumber(r.quantity),
        asNumber(r.unitCost),
        asString(r.notes).trim(),
      ]),
      itemRef: { name: r.itemName },
      movementType: r.movementType === 'OUT' ? 'OUT' : 'IN',
      quantity: asNumber(r.quantity),
      unitCost: asNumber(r.unitCost),
      notes: asString(r.notes),
      movementDate: r.movementDate,
      createdAt: asString(r.createdAt),
    })),
  )

  const maintenanceRecords: ExportInventoryMaintenance[] = await Promise.all(
    rawMaintenance.map(async (r) => ({
      fingerprint: await fingerprint([
        'inventoryMaintenance',
        lower(r.itemName),
        r.serviceDate,
        asString(r.serviceType),
        asString(r.performedBy),
      ]),
      itemRef: { name: r.itemName },
      serviceDate: r.serviceDate,
      serviceType: asString(r.serviceType),
      performedBy: asString(r.performedBy),
      cost: asNumber(r.cost),
      description: asString(r.description),
      nextServiceDate: asString(r.nextServiceDate),
      status:
        r.status === 'scheduled' ||
        r.status === 'in_progress' ||
        r.status === 'completed' ||
        r.status === 'cancelled'
          ? r.status
          : 'completed',
      createdAt: asString(r.createdAt),
    })),
  )

  const out: InventoryBackupEntities = { categories, items }
  if (opts.includeMovements) out.movements = movements
  if (opts.includeMaintenance) out.maintenanceRecords = maintenanceRecords
  return out
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type ValidationIssue = {
  severity: 'error' | 'warning'
  message: string
}

export class InventoryBackupValidationError extends Error {
  issues: ValidationIssue[]
  constructor(message: string, issues: ValidationIssue[]) {
    super(message)
    this.name = 'InventoryBackupValidationError'
    this.issues = issues
  }
}

const MAX_FILE_BYTES = 100 * 1024 * 1024

function checkEnvelope(parsed: unknown): {
  ok: true
  file: InventoryBackupFile
} | {
  ok: false
  issues: ValidationIssue[]
} {
  const issues: ValidationIssue[] = []
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, issues: [{ severity: 'error', message: 'Top-level value must be a JSON object.' }] }
  }
  const obj = parsed as Record<string, unknown>

  if (obj.format !== INVENTORY_BACKUP_FORMAT) {
    issues.push({
      severity: 'error',
      message: `Unrecognized format tag "${String(obj.format)}". Expected "${INVENTORY_BACKUP_FORMAT}".`,
    })
  }

  const formatVersion = Number(obj.formatVersion)
  if (!Number.isFinite(formatVersion) || formatVersion < 1) {
    issues.push({ severity: 'error', message: 'Missing or invalid formatVersion.' })
  } else if (formatVersion > INVENTORY_BACKUP_FORMAT_VERSION) {
    issues.push({
      severity: 'error',
      message: `File was written with formatVersion ${formatVersion}; this build only understands up to ${INVENTORY_BACKUP_FORMAT_VERSION}. Update the app and try again.`,
    })
  }

  // schemaVersion is informational only — we do NOT refuse newer schemas.
  // Older imports just leave the new local columns at their DB defaults, and
  // newer files have extra fields we silently ignore. This keeps the file
  // forward + backward compatible across migrations.
  const schemaVersion = Number(obj.schemaVersion)
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
    issues.push({ severity: 'warning', message: 'Missing or invalid schemaVersion (will continue best-effort).' })
  }

  if (obj.businessId !== 'laundry' && obj.businessId !== 'cleaning') {
    issues.push({
      severity: 'error',
      message: `Unknown businessId "${String(obj.businessId)}".`,
    })
  } else {
    const active = getActiveBusinessId()
    if (obj.businessId !== active) {
      issues.push({
        severity: 'error',
        message: `This file is from the "${obj.businessId}" business but you currently have "${active}" selected. Switch businesses (top-left) and re-import.`,
      })
    }
  }

  if (typeof obj.checksum !== 'string' || obj.checksum.length === 0) {
    issues.push({ severity: 'error', message: 'Missing checksum.' })
  }

  if (obj.entities == null || typeof obj.entities !== 'object') {
    issues.push({ severity: 'error', message: 'Missing entities block.' })
  }

  const fatal = issues.some((i) => i.severity === 'error')
  if (fatal) return { ok: false, issues }
  return { ok: true, file: parsed as InventoryBackupFile }
}

// ─── Plan (dry-run) ──────────────────────────────────────────────────────────

export type PlanItemKind = 'insert' | 'conflict' | 'skipIdentical' | 'orphan' | 'invalid'

export type PlanItem = {
  fingerprint: string
  kind: PlanItemKind
  label: string
  reason?: string
  /** Field-by-field diff for conflicts. */
  diff?: Array<{ field: string; localValue: unknown; incomingValue: unknown }>
}

export type EntityPlan = {
  insert: PlanItem[]
  conflict: PlanItem[]
  skipIdentical: PlanItem[]
  orphan: PlanItem[]
  invalid: PlanItem[]
}

function emptyEntityPlan(): EntityPlan {
  return { insert: [], conflict: [], skipIdentical: [], orphan: [], invalid: [] }
}

export type InventoryImportPlan = {
  file: InventoryBackupFile
  perEntity: {
    categories: EntityPlan
    items: EntityPlan
    movements: EntityPlan
    maintenanceRecords: EntityPlan
  }
}

/**
 * Reads the file, validates the envelope + checksum, then dry-runs every row
 * against a snapshot of the local DB and buckets it into insert / conflict /
 * skipIdentical / orphan / invalid. Throws `InventoryBackupValidationError`
 * for fatal issues.
 */
export async function validateAndPlanInventoryImport(file: File): Promise<InventoryImportPlan> {
  if (file.size > MAX_FILE_BYTES) {
    throw new InventoryBackupValidationError('File is too large (>100 MB).', [
      {
        severity: 'error',
        message: `File size ${file.size.toLocaleString()} bytes exceeds the 100 MB limit.`,
      },
    ])
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new InventoryBackupValidationError('The selected file is not valid JSON.', [
      { severity: 'error', message: 'JSON parse failed. Pick a JSON file produced by this app.' },
    ])
  }

  const env = checkEnvelope(parsed)
  if (!env.ok) {
    throw new InventoryBackupValidationError('The backup file failed validation.', env.issues)
  }
  const backup = env.file

  // Best-effort checksum check. If the file was hand-edited, refuse it.
  const recomputed = await sha256Hex(canonicalJson(backup.entities))
  if (recomputed !== backup.checksum) {
    throw new InventoryBackupValidationError('Backup file is corrupted.', [
      {
        severity: 'error',
        message: 'Checksum mismatch — the file was modified or truncated after export.',
      },
      {
        severity: 'warning',
        message: `Expected ${backup.checksum.slice(0, 16)}…, got ${recomputed.slice(0, 16)}…`,
      },
    ])
  }

  // Make incoming arrays safe to iterate even if the file is missing them.
  const inCategories = Array.isArray(backup.entities.categories) ? backup.entities.categories : []
  const inItems = Array.isArray(backup.entities.items) ? backup.entities.items : []
  const inMovements = Array.isArray(backup.entities.movements) ? backup.entities.movements : []
  const inMaintenance = Array.isArray(backup.entities.maintenanceRecords)
    ? backup.entities.maintenanceRecords
    : []

  const plan: InventoryImportPlan = {
    file: { ...backup, entities: { ...backup.entities, categories: inCategories, items: inItems, movements: inMovements, maintenanceRecords: inMaintenance } },
    perEntity: {
      categories: emptyEntityPlan(),
      items: emptyEntityPlan(),
      movements: emptyEntityPlan(),
      maintenanceRecords: emptyEntityPlan(),
    },
  }

  // Snapshot of local rows keyed by their fingerprint, used for in-memory
  // dedup/diff lookup so we don't round-trip to SQLite per row.
  const local = await snapshotLocalInventory()

  // ─── categories ──────────────────────────────────────────────────────────
  for (const r of inCategories) {
    if (!isNonEmptyString(r?.code) || !isNonEmptyString(r?.label)) {
      plan.perEntity.categories.invalid.push({
        fingerprint: r?.fingerprint ?? '',
        kind: 'invalid',
        label: asString(r?.label) || '(unnamed)',
        reason: 'Missing code or label.',
      })
      continue
    }
    const fp = r.fingerprint || (await fingerprint(['inventoryCategory', r.code]))
    const localMatch = local.categoriesByCode.get(r.code)
    if (!localMatch) {
      plan.perEntity.categories.insert.push({ fingerprint: fp, kind: 'insert', label: r.label })
      continue
    }
    const diff = diffCategory(localMatch, r)
    if (diff.length === 0) {
      plan.perEntity.categories.skipIdentical.push({ fingerprint: fp, kind: 'skipIdentical', label: r.label })
    } else {
      plan.perEntity.categories.conflict.push({
        fingerprint: fp,
        kind: 'conflict',
        label: r.label,
        diff,
      })
    }
  }

  // Track the union of category codes that will exist locally after import,
  // so item.categoryCode can be validated as soft (falls back to 'other').
  void inCategories

  // ─── items ───────────────────────────────────────────────────────────────
  for (const r of inItems) {
    if (!isNonEmptyString(r?.name)) {
      plan.perEntity.items.invalid.push({
        fingerprint: r?.fingerprint ?? '',
        kind: 'invalid',
        label: '(no name)',
        reason: 'Item name is required.',
      })
      continue
    }
    if (!Number.isFinite(asNumber(r.costPerUnit)) || asNumber(r.costPerUnit) < 0) {
      plan.perEntity.items.invalid.push({
        fingerprint: r.fingerprint ?? '',
        kind: 'invalid',
        label: r.name,
        reason: 'costPerUnit must be a non-negative number.',
      })
      continue
    }
    const fp = r.fingerprint || (await fingerprint(['inventoryItem', lower(r.name)]))
    const localMatch = local.itemsByName.get(lower(r.name))
    if (!localMatch) {
      plan.perEntity.items.insert.push({ fingerprint: fp, kind: 'insert', label: r.name })
      continue
    }
    const diff = diffItem(localMatch.row, r)
    if (diff.length === 0) {
      plan.perEntity.items.skipIdentical.push({ fingerprint: fp, kind: 'skipIdentical', label: r.name })
    } else {
      plan.perEntity.items.conflict.push({
        fingerprint: fp,
        kind: 'conflict',
        label: r.name,
        diff,
      })
    }
  }

  // ─── movements ───────────────────────────────────────────────────────────
  // For movements/maintenance, "orphan" means the referenced item is NOT in
  // the file AND NOT in the local DB.
  const fileItemNames = new Set(inItems.map((i) => lower(i.name)))
  for (const r of inMovements) {
    if (!isNonEmptyString(r?.itemRef?.name)) {
      plan.perEntity.movements.invalid.push({
        fingerprint: r?.fingerprint ?? '',
        kind: 'invalid',
        label: r?.movementDate ?? '',
        reason: 'Movement is missing its item reference.',
      })
      continue
    }
    if (r.movementType !== 'IN' && r.movementType !== 'OUT') {
      plan.perEntity.movements.invalid.push({
        fingerprint: r.fingerprint ?? '',
        kind: 'invalid',
        label: r.itemRef.name,
        reason: `Invalid movementType "${asString(r.movementType)}".`,
      })
      continue
    }
    if (!isIsoDate(r.movementDate)) {
      plan.perEntity.movements.invalid.push({
        fingerprint: r.fingerprint ?? '',
        kind: 'invalid',
        label: r.itemRef.name,
        reason: 'movementDate must be YYYY-MM-DD.',
      })
      continue
    }
    const itemKey = lower(r.itemRef.name)
    if (!fileItemNames.has(itemKey) && !local.itemsByName.has(itemKey)) {
      plan.perEntity.movements.orphan.push({
        fingerprint: r.fingerprint ?? '',
        kind: 'orphan',
        label: `${r.itemRef.name} · ${r.movementDate}`,
        reason: `Unknown inventory item "${r.itemRef.name}".`,
      })
      continue
    }
    const fp =
      r.fingerprint ||
      (await fingerprint([
        'inventoryMovement',
        lower(r.itemRef.name),
        r.movementDate,
        r.movementType,
        asNumber(r.quantity),
        asNumber(r.unitCost),
        asString(r.notes).trim(),
      ]))
    if (local.movementFingerprints.has(fp)) {
      plan.perEntity.movements.skipIdentical.push({
        fingerprint: fp,
        kind: 'skipIdentical',
        label: `${r.itemRef.name} · ${r.movementDate}`,
      })
    } else {
      plan.perEntity.movements.insert.push({
        fingerprint: fp,
        kind: 'insert',
        label: `${r.itemRef.name} · ${r.movementDate}`,
      })
    }
  }

  // ─── maintenance records ─────────────────────────────────────────────────
  for (const r of inMaintenance) {
    if (!isNonEmptyString(r?.itemRef?.name)) {
      plan.perEntity.maintenanceRecords.invalid.push({
        fingerprint: r?.fingerprint ?? '',
        kind: 'invalid',
        label: r?.serviceDate ?? '',
        reason: 'Maintenance record missing item reference.',
      })
      continue
    }
    if (!isIsoDate(r.serviceDate)) {
      plan.perEntity.maintenanceRecords.invalid.push({
        fingerprint: r.fingerprint ?? '',
        kind: 'invalid',
        label: r.itemRef.name,
        reason: 'serviceDate must be YYYY-MM-DD.',
      })
      continue
    }
    const itemKey = lower(r.itemRef.name)
    if (!fileItemNames.has(itemKey) && !local.itemsByName.has(itemKey)) {
      plan.perEntity.maintenanceRecords.orphan.push({
        fingerprint: r.fingerprint ?? '',
        kind: 'orphan',
        label: `${r.itemRef.name} · ${r.serviceDate}`,
        reason: `Unknown inventory item "${r.itemRef.name}".`,
      })
      continue
    }
    const fp =
      r.fingerprint ||
      (await fingerprint([
        'inventoryMaintenance',
        lower(r.itemRef.name),
        r.serviceDate,
        asString(r.serviceType),
        asString(r.performedBy),
      ]))
    if (local.maintenanceFingerprints.has(fp)) {
      plan.perEntity.maintenanceRecords.skipIdentical.push({
        fingerprint: fp,
        kind: 'skipIdentical',
        label: `${r.itemRef.name} · ${r.serviceDate}`,
      })
    } else {
      plan.perEntity.maintenanceRecords.insert.push({
        fingerprint: fp,
        kind: 'insert',
        label: `${r.itemRef.name} · ${r.serviceDate}`,
      })
    }
  }

  return plan
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

// ─── Local snapshot (one query per table, indexed for in-memory lookups) ─────

type LocalItemSnapshot = {
  id: number
  row: ExportInventoryItem
}

type LocalSnapshot = {
  categoriesByCode: Map<string, ExportInventoryCategory>
  itemsByName: Map<string, LocalItemSnapshot>
  movementFingerprints: Set<string>
  maintenanceFingerprints: Set<string>
}

async function snapshotLocalInventory(): Promise<LocalSnapshot> {
  const entities = await loadInventoryEntities({ includeMovements: true, includeMaintenance: true })

  const categoriesByCode = new Map<string, ExportInventoryCategory>()
  for (const c of entities.categories) categoriesByCode.set(c.code, c)

  const itemsByName = new Map<string, LocalItemSnapshot>()
  // We don't actually need DB ids in the snapshot for the plan — only for
  // apply. But the apply step re-queries by name so we just keep `id: 0`.
  for (const i of entities.items) itemsByName.set(lower(i.name), { id: 0, row: i })

  const movementFingerprints = new Set<string>(
    (entities.movements ?? []).map((m) => m.fingerprint),
  )
  const maintenanceFingerprints = new Set<string>(
    (entities.maintenanceRecords ?? []).map((m) => m.fingerprint),
  )

  return { categoriesByCode, itemsByName, movementFingerprints, maintenanceFingerprints }
}

// ─── Diffs (used by planner to detect conflicts) ─────────────────────────────

type FieldDiff = { field: string; localValue: unknown; incomingValue: unknown }

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6
  if (a == null && b == null) return true
  if (typeof a === 'object' && typeof b === 'object') return canonicalJson(a) === canonicalJson(b)
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim()
  return false
}

function diffCategory(local: ExportInventoryCategory, inc: ExportInventoryCategory): FieldDiff[] {
  const out: FieldDiff[] = []
  for (const k of ['label', 'isActive', 'sortOrder'] as const) {
    if (!sameValue(local[k], inc[k])) out.push({ field: k, localValue: local[k], incomingValue: inc[k] })
  }
  return out
}

function canonicalAltUnits(units: ExportInventoryAltUnit[] | undefined): string {
  if (units == null) return ''
  return units
    .map((u) => ({
      unitLabel: lower(u.unitLabel),
      unitsPerBase: asNumber(u.unitsPerBase),
      unitPrice: asNumber(u.unitPrice),
      isActive: u.isActive ? 1 : 0,
    }))
    .filter((u) => u.unitLabel !== '' && u.unitsPerBase > 0)
    .sort((a, b) => a.unitLabel.localeCompare(b.unitLabel))
    .map((u) => `${u.unitLabel}|${u.unitsPerBase}|${u.unitPrice}|${u.isActive}`)
    .join(';')
}

function diffItem(local: ExportInventoryItem, inc: ExportInventoryItem): FieldDiff[] {
  const out: FieldDiff[] = []
  for (const k of [
    'description',
    'unitType',
    'unitLabel',
    'costPerUnit',
    'sellingPrice',
    'isActive',
    'lowStockThreshold',
    'categoryCode',
    'supplier',
    'status',
    'lastMaintenanceDate',
  ] as const) {
    if (!sameValue(local[k], inc[k])) out.push({ field: k, localValue: local[k], incomingValue: inc[k] })
  }
  const a = canonicalAltUnits(local.altUnits)
  const b = canonicalAltUnits(inc.altUnits)
  if (a !== b) out.push({ field: 'altUnits', localValue: a, incomingValue: b })
  return out
}

// ─── Apply ───────────────────────────────────────────────────────────────────

export type ApplyOptions = {
  /**
   * When true, conflicting items/categories are updated in place. Defaults
   * to false — the safe option that preserves every existing local row.
   *
   * Movements and maintenance records are append-only regardless, since
   * their fingerprint already encodes the full row identity and identical
   * incoming rows are filed under skipIdentical.
   */
  overwriteConflicts?: boolean
}

export type EntitySummary = {
  inserted: number
  updated: number
  skippedIdentical: number
  skippedConflict: number
  skippedOrphan: number
  skippedInvalid: number
  failed: number
  errors: Array<{ fingerprint: string; label: string; message: string }>
}

function emptyEntitySummary(): EntitySummary {
  return {
    inserted: 0,
    updated: 0,
    skippedIdentical: 0,
    skippedConflict: 0,
    skippedOrphan: 0,
    skippedInvalid: 0,
    failed: 0,
    errors: [],
  }
}

export type InventoryImportSummary = {
  startedAt: string
  finishedAt: string
  fileName: string | null
  perEntity: {
    categories: EntitySummary
    items: EntitySummary
    movements: EntitySummary
    maintenanceRecords: EntitySummary
  }
  ok: boolean
}

/**
 * Walks the plan and inserts/updates rows. Pre-existing rows that are NOT in
 * the file are never touched. Conflicts are skipped unless
 * `options.overwriteConflicts` is true.
 *
 * `userId` is used to populate `created_by` columns where the schema requires
 * them (currently inventory_movements and inventory_maintenance_records).
 */
export async function applyInventoryImportPlan(
  plan: InventoryImportPlan,
  options: ApplyOptions,
  userId: number,
  fileName: string | null = null,
): Promise<InventoryImportSummary> {
  const startedAt = new Date().toISOString()
  const summary: InventoryImportSummary = {
    startedAt,
    finishedAt: '',
    fileName,
    perEntity: {
      categories: emptyEntitySummary(),
      items: emptyEntitySummary(),
      movements: emptyEntitySummary(),
      maintenanceRecords: emptyEntitySummary(),
    },
    ok: true,
  }

  const overwrite = options.overwriteConflicts === true

  // Pre-tally easy buckets so the summary mirrors the preview.
  for (const key of ['categories', 'items', 'movements', 'maintenanceRecords'] as const) {
    const sec = plan.perEntity[key]
    summary.perEntity[key].skippedIdentical += sec.skipIdentical.length
    summary.perEntity[key].skippedOrphan += sec.orphan.length
    summary.perEntity[key].skippedInvalid += sec.invalid.length
    if (!overwrite) summary.perEntity[key].skippedConflict += sec.conflict.length
  }

  const db = await getDatabase()

  try {
    await db.execute('PRAGMA foreign_keys = OFF')
  } catch {
    /* best-effort */
  }

  try {
    const file = plan.file

    // ─── categories ────────────────────────────────────────────────────────
    for (const item of plan.perEntity.categories.insert) {
      await applyRow(summary.perEntity.categories, item, async () => {
        const row = findInArr(file.entities.categories, item.fingerprint)!
        await db.execute(
          `
            INSERT OR IGNORE INTO inventory_categories (code, label, is_system, is_active, sort_order)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [row.code, row.label, row.isSystem ? 1 : 0, row.isActive ? 1 : 0, asNumber(row.sortOrder)],
        )
        return 'inserted'
      })
    }
    if (overwrite) {
      for (const item of plan.perEntity.categories.conflict) {
        await applyRow(summary.perEntity.categories, item, async () => {
          const row = findInArr(file.entities.categories, item.fingerprint)!
          await db.execute(
            `
              UPDATE inventory_categories
              SET label = $1,
                  is_active = $2,
                  sort_order = $3,
                  updated_at = CURRENT_TIMESTAMP
              WHERE code = $4
            `,
            [row.label, row.isActive ? 1 : 0, asNumber(row.sortOrder), row.code],
          )
          return 'updated'
        })
      }
    }

    // ─── items (and their alt selling units) ───────────────────────────────
    for (const item of plan.perEntity.items.insert) {
      await applyRow(summary.perEntity.items, item, async () => {
        const row = findInArr(file.entities.items, item.fingerprint)!
        const catId = await resolveLocalCategoryId(db, row.categoryCode)
        await db.execute(
          `
            INSERT INTO inventory_items (
              name, description, unit_type, unit_label, cost_per_unit,
              is_active, low_stock_threshold, category_id, category,
              supplier, status, last_maintenance_date, selling_price
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `,
          [
            row.name,
            asString(row.description),
            asString(row.unitType) || 'per_pc',
            asString(row.unitLabel) || 'unit',
            asNumber(row.costPerUnit),
            row.isActive === false ? 0 : 1,
            asNumber(row.lowStockThreshold),
            catId,
            asString(row.categoryCode) || 'other',
            asString(row.supplier),
            asString(row.status),
            asString(row.lastMaintenanceDate),
            asNumber(row.sellingPrice),
          ],
        )
        await replaceItemAltUnits(db, row)
        return 'inserted'
      })
    }
    if (overwrite) {
      for (const item of plan.perEntity.items.conflict) {
        await applyRow(summary.perEntity.items, item, async () => {
          const row = findInArr(file.entities.items, item.fingerprint)!
          const catId = await resolveLocalCategoryId(db, row.categoryCode)
          await db.execute(
            `
              UPDATE inventory_items SET
                description = $1,
                unit_type = $2,
                unit_label = $3,
                cost_per_unit = $4,
                is_active = $5,
                low_stock_threshold = $6,
                category_id = $7,
                category = $8,
                supplier = $9,
                status = $10,
                last_maintenance_date = $11,
                selling_price = $12,
                updated_at = CURRENT_TIMESTAMP
              WHERE LOWER(TRIM(name)) = LOWER(TRIM($13))
            `,
            [
              asString(row.description),
              asString(row.unitType) || 'per_pc',
              asString(row.unitLabel) || 'unit',
              asNumber(row.costPerUnit),
              row.isActive === false ? 0 : 1,
              asNumber(row.lowStockThreshold),
              catId,
              asString(row.categoryCode) || 'other',
              asString(row.supplier),
              asString(row.status),
              asString(row.lastMaintenanceDate),
              asNumber(row.sellingPrice),
              row.name,
            ],
          )
          await replaceItemAltUnits(db, row)
          return 'updated'
        })
      }
    }

    // ─── movements ─────────────────────────────────────────────────────────
    for (const item of plan.perEntity.movements.insert) {
      await applyRow(summary.perEntity.movements, item, async () => {
        const row = findInArr(file.entities.movements ?? [], item.fingerprint)!
        const itemId = await fetchSingle(
          db,
          `SELECT id FROM inventory_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
          [row.itemRef.name],
        )
        if (itemId == null) throw new Error(`Inventory item "${row.itemRef.name}" not found locally.`)
        await db.execute(
          `
            INSERT INTO inventory_movements (
              item_id, movement_type, quantity, unit_cost, notes,
              movement_date, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            itemId,
            row.movementType,
            asNumber(row.quantity),
            asNumber(row.unitCost),
            asString(row.notes),
            row.movementDate,
            userId,
          ],
        )
        return 'inserted'
      })
    }

    // ─── maintenance records ───────────────────────────────────────────────
    for (const item of plan.perEntity.maintenanceRecords.insert) {
      await applyRow(summary.perEntity.maintenanceRecords, item, async () => {
        const row = findInArr(file.entities.maintenanceRecords ?? [], item.fingerprint)!
        const itemId = await fetchSingle(
          db,
          `SELECT id FROM inventory_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
          [row.itemRef.name],
        )
        if (itemId == null) throw new Error(`Inventory item "${row.itemRef.name}" not found locally.`)
        await db.execute(
          `
            INSERT INTO inventory_maintenance_records (
              item_id, service_date, service_type, performed_by, cost,
              description, next_service_date, status, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            itemId,
            row.serviceDate,
            asString(row.serviceType),
            asString(row.performedBy),
            asNumber(row.cost),
            asString(row.description),
            asString(row.nextServiceDate),
            row.status,
            userId,
          ],
        )
        return 'inserted'
      })
    }
  } finally {
    try {
      await db.execute('PRAGMA foreign_keys = ON')
    } catch {
      /* ignore */
    }
  }

  for (const v of Object.values(summary.perEntity)) {
    if (v.failed > 0) {
      summary.ok = false
      break
    }
  }

  summary.finishedAt = new Date().toISOString()
  return summary
}

// ─── Apply helpers ───────────────────────────────────────────────────────────

async function applyRow(
  summary: EntitySummary,
  item: PlanItem,
  action: () => Promise<'inserted' | 'updated'>,
): Promise<void> {
  try {
    const r = await action()
    if (r === 'inserted') summary.inserted += 1
    else summary.updated += 1
  } catch (err) {
    summary.failed += 1
    summary.errors.push({
      fingerprint: item.fingerprint,
      label: item.label,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

function findInArr<T extends { fingerprint: string }>(rows: T[], fp: string): T | undefined {
  return rows.find((r) => r.fingerprint === fp)
}

async function fetchSingle(
  db: Awaited<ReturnType<typeof getDatabase>>,
  sql: string,
  params: unknown[],
): Promise<number | null> {
  const rows = await db.select<Array<{ id: number }>>(sql, params)
  const id = rows[0]?.id
  return id == null ? null : Number(id)
}

async function resolveLocalCategoryId(
  db: Awaited<ReturnType<typeof getDatabase>>,
  code: string,
): Promise<number | null> {
  const direct = await fetchSingle(
    db,
    `SELECT id FROM inventory_categories WHERE code = $1 LIMIT 1`,
    [code],
  )
  if (direct != null) return direct
  return fetchSingle(db, `SELECT id FROM inventory_categories WHERE code = 'other' LIMIT 1`, [])
}

async function replaceItemAltUnits(
  db: Awaited<ReturnType<typeof getDatabase>>,
  row: ExportInventoryItem,
): Promise<void> {
  if (!Array.isArray(row.altUnits)) return // older files don't include altUnits — leave existing rows alone
  const itemId = await fetchSingle(
    db,
    `SELECT id FROM inventory_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
    [row.name],
  )
  if (itemId == null) return
  await db.execute(`DELETE FROM inventory_item_units WHERE item_id = $1`, [itemId])
  for (const u of row.altUnits) {
    if (asNumber(u.unitsPerBase) <= 0 || asString(u.unitLabel).trim() === '') continue
    await db.execute(
      `
        INSERT OR IGNORE INTO inventory_item_units (
          item_id, unit_label, units_per_base, unit_price, sort_order, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        itemId,
        u.unitLabel,
        asNumber(u.unitsPerBase),
        asNumber(u.unitPrice),
        asNumber(u.sortOrder),
        u.isActive === false ? 0 : 1,
      ],
    )
  }
}

// ─── Public report formatter (for "Copy report" buttons) ─────────────────────

export function formatInventoryImportReport(
  summary: InventoryImportSummary,
  fileName?: string | null,
): string {
  const stamp = formatDate(new Date(), 'yyyy-MM-dd HH:mm')
  const lines: string[] = []
  lines.push(`Inventory import — ${stamp}${fileName ? ` (${fileName})` : ''}`)
  lines.push('')
  for (const key of ['categories', 'items', 'movements', 'maintenanceRecords'] as const) {
    const s = summary.perEntity[key]
    const total =
      s.inserted +
      s.updated +
      s.skippedIdentical +
      s.skippedConflict +
      s.skippedOrphan +
      s.skippedInvalid +
      s.failed
    if (total === 0) continue
    lines.push(
      `• ${key} — inserted ${s.inserted}, updated ${s.updated}, skipped (identical) ${s.skippedIdentical}, skipped (conflict) ${s.skippedConflict}, skipped (orphan) ${s.skippedOrphan}, skipped (invalid) ${s.skippedInvalid}, failed ${s.failed}`,
    )
    for (const e of s.errors) {
      lines.push(`    ! ${e.label}: ${e.message}`)
    }
  }
  lines.push('')
  lines.push(summary.ok ? 'Status: OK' : 'Status: completed with errors')
  return lines.join('\n')
}
