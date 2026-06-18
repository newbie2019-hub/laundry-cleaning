// Validates a backup file, computes a dry-run ImportPlan that the dialog
// shows the user (with per-row Skip/Overwrite buttons for conflicts), and
// then applies the plan to the active SQLite database when the user
// confirms.
//
// Notes on atomicity: the Tauri SQL plugin uses a sqlx connection pool and
// CANNOT span BEGIN/COMMIT across multiple `execute()` calls (this is also
// why `finalizePayroll` and `voidPayroll` in repository.ts manually clean
// up on failure rather than wrapping their statements in a transaction).
// So this module disables foreign key checks during apply, runs each row
// independently, and collects per-row failures into the summary instead of
// aborting the whole import on a single bad row. The dry-run validation
// catches the bulk of issues before any write happens.

import { format } from 'date-fns'
import { getActiveBusinessId } from '../../lib/db/business'
import { getDatabase } from '../../lib/db/client'
import { findTransactionByIdentity } from '../../lib/db/repository'
import { buildBackupFile, canonicalJson } from './backup-export'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  ENTITY_APPLY_ORDER,
  SUPPORTED_SCHEMA_VERSION,
  emptyEntityPlan,
  emptyEntitySummary,
  makeResolutionKey,
  type BackupEntities,
  type BackupFile,
  type EntityKey,
  type EntityPlan,
  type EntitySummary,
  type ExportCategory,
  type ExportCustomer,
  type ExportIncidentReport,
  type ExportIncomeShareMonth,
  type ExportIncomeShareRule,
  type ExportInventoryCategory,
  type ExportInventoryItem,
  type ExportInventoryMaintenance,
  type ExportInventoryMovement,
  type ExportSettings,
  type ExportStaff,
  type ExportStaffAttendance,
  type ExportStaffCashAdvance,
  type ExportStaffPayroll,
  type ExportTransaction,
  type ExportTransactionTemplate,
  type ExportTransactionType,
  type ImportPlan,
  type ImportSummary,
  type PlanItem,
  type ResolutionMap,
  type ValidationIssue,
} from './backup-types'

// ─── Public errors ───────────────────────────────────────────────────────────

export class BackupValidationError extends Error {
  issues: ValidationIssue[]
  constructor(message: string, issues: ValidationIssue[]) {
    super(message)
    this.name = 'BackupValidationError'
    this.issues = issues
  }
}

// ─── Validation + Plan (dry-run) ─────────────────────────────────────────────

const MAX_FILE_BYTES = 200 * 1024 * 1024

/**
 * Reads a JSON file the user picked, runs all validation checks, then builds
 * the ImportPlan. Throws `BackupValidationError` on any fatal issue; the
 * dialog catches it and shows the issues list.
 */
export async function validateAndPlan(file: File): Promise<ImportPlan> {
  // Check 1: file size
  if (file.size > MAX_FILE_BYTES) {
    throw new BackupValidationError('File is too large to import (>200 MB).', [
      {
        severity: 'error',
        message: `File size ${file.size.toLocaleString()} bytes exceeds the 200 MB limit.`,
      },
    ])
  }

  // Check 1b: parse JSON
  let parsed: unknown
  try {
    const text = await file.text()
    parsed = JSON.parse(text)
  } catch {
    throw new BackupValidationError('The selected file is not valid JSON.', [
      {
        severity: 'error',
        message: 'JSON parse failed. Pick a backup file produced by this app.',
      },
    ])
  }

  // Check 2-5: envelope, formatVersion, schemaVersion, businessId
  const envelopeIssues = checkEnvelope(parsed)
  if (envelopeIssues.length > 0) {
    throw new BackupValidationError('The backup file failed envelope validation.', envelopeIssues)
  }

  const backup = parsed as BackupFile

  // Check 6: checksum integrity
  const recomputed = await sha256Hex(canonicalJson(backup.entities))
  if (recomputed !== backup.checksum) {
    throw new BackupValidationError('Backup file is corrupted.', [
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

  // Check 7: per-row schema validation (collected as `invalid` plan items
  // instead of throwing — so the user sees how many rows are skipped per
  // entity instead of one aggregated failure).
  const invalidByEntity = collectSchemaIssues(backup.entities)

  // Check 8 + 9: planner (which uses local DB lookups + within-file ref
  // resolution to bucket each row into insert / update / skipIdentical /
  // orphan / invalid).
  const plan = await buildPlan(backup, invalidByEntity)

  return plan
}

function checkEnvelope(parsed: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [{ severity: 'error', message: 'Top-level value must be a JSON object.' }]
  }
  const obj = parsed as Record<string, unknown>

  if (obj.format !== BACKUP_FORMAT) {
    issues.push({
      severity: 'error',
      message: `Unrecognized format tag "${String(obj.format)}". Expected "${BACKUP_FORMAT}".`,
    })
  }

  const formatVersion = Number(obj.formatVersion)
  if (!Number.isFinite(formatVersion) || formatVersion < 1) {
    issues.push({ severity: 'error', message: 'Missing or invalid formatVersion.' })
  } else if (formatVersion > BACKUP_FORMAT_VERSION) {
    issues.push({
      severity: 'error',
      message: `File was written with formatVersion ${formatVersion}; this build only understands up to ${BACKUP_FORMAT_VERSION}. Update the app and try again.`,
    })
  }

  const schemaVersion = Number(obj.schemaVersion)
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
    issues.push({ severity: 'error', message: 'Missing or invalid schemaVersion.' })
  } else if (schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    issues.push({
      severity: 'error',
      message: `File was exported from a newer database schema (v${schemaVersion}); this build supports up to v${SUPPORTED_SCHEMA_VERSION}. Update the app and try again.`,
    })
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

  return issues
}

// ─── Per-row schema validation ───────────────────────────────────────────────

type InvalidRow = { fingerprint: string; label: string; reason: string }
type InvalidByEntity = Partial<Record<EntityKey, InvalidRow[]>>

function collectSchemaIssues(entities: BackupEntities): InvalidByEntity {
  const out: InvalidByEntity = {}

  function flag(entity: EntityKey, row: InvalidRow) {
    const list = out[entity] ?? []
    list.push(row)
    out[entity] = list
  }

  for (const r of entities.transactionTypes) {
    if (!isNonEmptyString(r.code)) flag('transactionTypes', { fingerprint: r.fingerprint, label: r.label || '(unnamed)', reason: 'Missing code.' })
  }

  for (const r of entities.categories) {
    if (!isNonEmptyString(r.transactionTypeCode) || !isNonEmptyString(r.label)) {
      flag('categories', { fingerprint: r.fingerprint, label: r.label || '(unnamed)', reason: 'Missing transaction type or label.' })
    }
  }

  for (const r of entities.customers) {
    if (!isNonEmptyString(r.name)) {
      flag('customers', { fingerprint: r.fingerprint, label: '(no name)', reason: 'Customer name is required.' })
    }
  }

  for (const r of entities.inventoryCategories) {
    if (!isNonEmptyString(r.code) || !isNonEmptyString(r.label)) {
      flag('inventoryCategories', { fingerprint: r.fingerprint, label: r.label || '(unnamed)', reason: 'Missing code or label.' })
    }
  }

  for (const r of entities.inventoryItems) {
    if (!isNonEmptyString(r.name)) {
      flag('inventoryItems', { fingerprint: r.fingerprint, label: '(no name)', reason: 'Item name is required.' })
    } else if (!Number.isFinite(r.costPerUnit) || r.costPerUnit < 0) {
      flag('inventoryItems', { fingerprint: r.fingerprint, label: r.name, reason: 'costPerUnit must be ≥ 0.' })
    }
  }

  for (const r of entities.inventoryMovements) {
    if (!isNonEmptyString(r.itemRef?.name)) {
      flag('inventoryMovements', { fingerprint: r.fingerprint, label: r.movementDate, reason: 'Movement is missing its item reference.' })
    } else if (r.movementType !== 'IN' && r.movementType !== 'OUT') {
      flag('inventoryMovements', { fingerprint: r.fingerprint, label: r.itemRef.name, reason: `Invalid movementType "${r.movementType}".` })
    } else if (!Number.isFinite(r.quantity) || r.quantity < 0) {
      flag('inventoryMovements', { fingerprint: r.fingerprint, label: r.itemRef.name, reason: 'quantity must be ≥ 0.' })
    } else if (!isIsoDate(r.movementDate)) {
      flag('inventoryMovements', { fingerprint: r.fingerprint, label: r.itemRef.name, reason: 'movementDate must be YYYY-MM-DD.' })
    }
  }

  for (const r of entities.inventoryMaintenanceRecords) {
    if (!isNonEmptyString(r.itemRef?.name)) {
      flag('inventoryMaintenanceRecords', { fingerprint: r.fingerprint, label: r.serviceDate, reason: 'Maintenance record missing item reference.' })
    } else if (!isIsoDate(r.serviceDate)) {
      flag('inventoryMaintenanceRecords', { fingerprint: r.fingerprint, label: r.itemRef.name, reason: 'serviceDate must be YYYY-MM-DD.' })
    }
  }

  for (const r of entities.transactionTemplates) {
    if (!isNonEmptyString(r.name)) {
      flag('transactionTemplates', { fingerprint: r.fingerprint, label: '(unnamed)', reason: 'Template name is required.' })
    }
  }

  for (const r of entities.transactions) {
    if (!isIsoDate(r.entryDate)) {
      flag('transactions', { fingerprint: r.fingerprint, label: r.entryDate, reason: 'entryDate must be YYYY-MM-DD.' })
    } else if (!isNonEmptyString(r.transactionTypeCode) || !isNonEmptyString(r.categoryRef?.label)) {
      flag('transactions', { fingerprint: r.fingerprint, label: r.entryDate, reason: 'Transaction missing type or category reference.' })
    } else if (!Number.isFinite(r.amount) || r.amount < 0) {
      flag('transactions', { fingerprint: r.fingerprint, label: r.entryDate, reason: 'amount must be ≥ 0.' })
    }
  }

  for (const r of entities.staff) {
    if (!isNonEmptyString(r.firstName) || !isNonEmptyString(r.lastName)) {
      flag('staff', { fingerprint: r.fingerprint, label: '(unnamed)', reason: 'firstName and lastName are required.' })
    }
  }

  for (const r of entities.staffAttendance) {
    if (!isIsoDate(r.attendanceDate)) {
      flag('staffAttendance', { fingerprint: r.fingerprint, label: r.attendanceDate, reason: 'attendanceDate must be YYYY-MM-DD.' })
    }
  }

  for (const r of entities.staffPayrolls) {
    if (!isIsoDate(r.periodStart) || !isIsoDate(r.periodEnd)) {
      flag('staffPayrolls', { fingerprint: r.fingerprint, label: `${r.periodStart}–${r.periodEnd}`, reason: 'periodStart/periodEnd must be YYYY-MM-DD.' })
    }
  }

  for (const r of entities.staffCashAdvances) {
    if (!isIsoDate(r.advanceDate) || !Number.isFinite(r.amount) || r.amount <= 0) {
      flag('staffCashAdvances', { fingerprint: r.fingerprint, label: r.advanceDate, reason: 'advanceDate must be YYYY-MM-DD and amount > 0.' })
    }
  }

  for (const r of entities.incidentReports) {
    if (!isIsoDate(r.incidentDate)) {
      flag('incidentReports', { fingerprint: r.fingerprint, label: r.incidentDate, reason: 'incidentDate must be YYYY-MM-DD.' })
    }
  }

  for (const r of entities.incomeShareRules) {
    if (!isNonEmptyString(r.name) || !Number.isFinite(r.percentage)) {
      flag('incomeShareRules', { fingerprint: r.fingerprint, label: r.name || '(unnamed)', reason: 'Rule needs a name and numeric percentage.' })
    }
  }

  for (const r of entities.incomeShareMonthlyVersions) {
    if (!isMonthKey(r.monthKey) || !isNonEmptyString(r.ruleName)) {
      flag('incomeShareMonthlyVersions', { fingerprint: r.fingerprint, label: r.monthKey, reason: 'monthKey must be YYYY-MM and ruleName is required.' })
    }
  }

  return out
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
}

// ─── sha-256 helper (re-implemented here to avoid a circular import) ─────────

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
  const bytes = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

// ─── Local snapshot used for dry-run lookups ────────────────────────────────
//
// The planner needs to answer "is there already a row with this natural key
// locally? if yes, what fields does it have?" for every row in the file.
// Doing one query per row would be O(N) round-trips; instead we bulk-load
// each table once into a Map keyed by the same natural key the file uses,
// and the planner does in-memory lookups.

type LocalRow<T> = { id: number; row: T }
type LocalIndex<T> = Map<string, LocalRow<T>>

type LocalSnapshot = {
  transactionTypes: LocalIndex<ExportTransactionType>
  categories: LocalIndex<ExportCategory>
  customers: LocalIndex<ExportCustomer>
  inventoryCategories: LocalIndex<ExportInventoryCategory>
  inventoryItems: LocalIndex<ExportInventoryItem>
  inventoryMovements: LocalIndex<ExportInventoryMovement>
  inventoryMaintenanceRecords: LocalIndex<ExportInventoryMaintenance>
  transactionTemplates: LocalIndex<ExportTransactionTemplate>
  transactions: LocalIndex<ExportTransaction>
  staff: LocalIndex<ExportStaff>
  staffAttendance: LocalIndex<ExportStaffAttendance>
  staffPayrolls: LocalIndex<ExportStaffPayroll>
  staffCashAdvances: LocalIndex<ExportStaffCashAdvance>
  incidentReports: LocalIndex<ExportIncidentReport>
  incomeShareRules: LocalIndex<ExportIncomeShareRule>
  incomeShareMonthlyVersions: LocalIndex<ExportIncomeShareMonth>
  settings: ExportSettings
}

async function loadLocalSnapshot(): Promise<LocalSnapshot> {
  // We re-use the export builders by reading the local DB through the same
  // entity loaders that produce a BackupFile. Pulling once into memory means
  // the planner can do every match by Map lookup instead of round-tripping
  // to SQLite per row.
  const file = await buildBackupFile()

  function indexBy<T extends { fingerprint: string }>(rows: T[]): LocalIndex<T> {
    // The export does NOT include local DB ids by design, so we look them up
    // separately when needed (during apply). For the dry-run, we only need
    // fingerprint→row to know whether a match exists and what fields differ.
    const index: LocalIndex<T> = new Map()
    let pseudoId = 0
    for (const row of rows) {
      pseudoId += 1
      index.set(row.fingerprint, { id: pseudoId, row })
    }
    return index
  }

  return {
    transactionTypes: indexBy(file.entities.transactionTypes),
    categories: indexBy(file.entities.categories),
    customers: indexBy(file.entities.customers),
    inventoryCategories: indexBy(file.entities.inventoryCategories),
    inventoryItems: indexBy(file.entities.inventoryItems),
    inventoryMovements: indexBy(file.entities.inventoryMovements),
    inventoryMaintenanceRecords: indexBy(file.entities.inventoryMaintenanceRecords),
    transactionTemplates: indexBy(file.entities.transactionTemplates),
    transactions: indexBy(file.entities.transactions),
    staff: indexBy(file.entities.staff),
    staffAttendance: indexBy(file.entities.staffAttendance),
    staffPayrolls: indexBy(file.entities.staffPayrolls),
    staffCashAdvances: indexBy(file.entities.staffCashAdvances),
    incidentReports: indexBy(file.entities.incidentReports),
    incomeShareRules: indexBy(file.entities.incomeShareRules),
    incomeShareMonthlyVersions: indexBy(file.entities.incomeShareMonthlyVersions),
    settings: file.entities.settings,
  }
}

// ─── Planner ────────────────────────────────────────────────────────────────

async function buildPlan(file: BackupFile, invalidByEntity: InvalidByEntity): Promise<ImportPlan> {
  const local = await loadLocalSnapshot()

  const perEntity: Record<EntityKey, EntityPlan> = {
    transactionTypes: emptyEntityPlan(),
    categories: emptyEntityPlan(),
    customers: emptyEntityPlan(),
    inventoryCategories: emptyEntityPlan(),
    inventoryItems: emptyEntityPlan(),
    inventoryMovements: emptyEntityPlan(),
    inventoryMaintenanceRecords: emptyEntityPlan(),
    transactionTemplates: emptyEntityPlan(),
    transactions: emptyEntityPlan(),
    staff: emptyEntityPlan(),
    staffAttendance: emptyEntityPlan(),
    staffPayrolls: emptyEntityPlan(),
    staffCashAdvances: emptyEntityPlan(),
    incidentReports: emptyEntityPlan(),
    incomeShareRules: emptyEntityPlan(),
    incomeShareMonthlyVersions: emptyEntityPlan(),
    settings: emptyEntityPlan(),
  }

  // First emit all the per-row schema invalids. They are pure refusals; we
  // never try to insert them so nothing else needs to know about them.
  for (const [entity, rows] of Object.entries(invalidByEntity)) {
    if (!rows) continue
    for (const row of rows) {
      perEntity[entity as EntityKey].invalid.push({
        fingerprint: row.fingerprint,
        kind: 'invalid',
        label: row.label,
        reason: row.reason,
      })
    }
  }
  const invalidFingerprints: Partial<Record<EntityKey, Set<string>>> = {}
  for (const [entity, rows] of Object.entries(invalidByEntity)) {
    if (!rows) continue
    invalidFingerprints[entity as EntityKey] = new Set(rows.map((r) => r.fingerprint))
  }

  // ─── Lookup tables for within-file referential checks ──────────────────────
  // A child row with a parent reference is "orphan" if the parent doesn't
  // exist in the FILE *and* doesn't exist in the LOCAL DB.

  const fileTxnTypeCodes = new Set(file.entities.transactionTypes.map((t) => t.code))
  const fileCategoryKeys = new Set(
    file.entities.categories.map((c) => `${c.transactionTypeCode}::${c.label.toLowerCase()}`),
  )
  const fileCustomerKeys = new Set(
    file.entities.customers.map((c) => `${c.name.trim().toLowerCase()}::${c.phone.trim()}`),
  )
  const fileInventoryItemNames = new Set(
    file.entities.inventoryItems.map((i) => i.name.trim().toLowerCase()),
  )
  const fileInventoryCategoryCodes = new Set(file.entities.inventoryCategories.map((c) => c.code))
  const fileTemplateNames = new Set(file.entities.transactionTemplates.map((t) => t.name))
  const fileStaffKeys = new Set(
    file.entities.staff.map(
      (s) =>
        `${s.firstName.trim().toLowerCase()}::${s.middleName.trim().toLowerCase()}::${s.lastName.trim().toLowerCase()}::${s.birthdate.trim()}`,
    ),
  )
  const fileIncomeShareRuleNames = new Set(file.entities.incomeShareRules.map((r) => r.name))

  const localTxnTypeCodes = new Set<string>()
  for (const v of local.transactionTypes.values()) localTxnTypeCodes.add(v.row.code)
  const localCategoryKeys = new Set<string>()
  for (const v of local.categories.values()) {
    localCategoryKeys.add(`${v.row.transactionTypeCode}::${v.row.label.toLowerCase()}`)
  }
  const localCustomerKeys = new Set<string>()
  for (const v of local.customers.values()) {
    localCustomerKeys.add(`${v.row.name.trim().toLowerCase()}::${v.row.phone.trim()}`)
  }
  const localInventoryItemNames = new Set<string>()
  for (const v of local.inventoryItems.values()) {
    localInventoryItemNames.add(v.row.name.trim().toLowerCase())
  }
  const localInventoryCategoryCodes = new Set<string>()
  for (const v of local.inventoryCategories.values()) {
    localInventoryCategoryCodes.add(v.row.code)
  }
  const localTemplateNames = new Set<string>()
  for (const v of local.transactionTemplates.values()) localTemplateNames.add(v.row.name)
  const localStaffKeys = new Set<string>()
  for (const v of local.staff.values()) {
    const s = v.row
    localStaffKeys.add(
      `${s.firstName.trim().toLowerCase()}::${s.middleName.trim().toLowerCase()}::${s.lastName.trim().toLowerCase()}::${s.birthdate.trim()}`,
    )
  }
  const localIncomeShareRuleNames = new Set<string>()
  for (const v of local.incomeShareRules.values()) localIncomeShareRuleNames.add(v.row.name)

  function categoryRefExists(catRef: { transactionTypeCode: string; label: string }) {
    const key = `${catRef.transactionTypeCode}::${catRef.label.toLowerCase()}`
    return fileCategoryKeys.has(key) || localCategoryKeys.has(key)
  }
  function customerRefExists(custRef: { name: string; phone: string }) {
    const key = `${custRef.name.trim().toLowerCase()}::${custRef.phone.trim()}`
    return fileCustomerKeys.has(key) || localCustomerKeys.has(key)
  }
  function inventoryItemRefExists(ref: { name: string }) {
    const key = ref.name.trim().toLowerCase()
    return fileInventoryItemNames.has(key) || localInventoryItemNames.has(key)
  }
  function staffRefExists(ref: {
    firstName: string
    middleName: string
    lastName: string
    birthdate: string
  }) {
    const key = `${ref.firstName.trim().toLowerCase()}::${ref.middleName.trim().toLowerCase()}::${ref.lastName.trim().toLowerCase()}::${ref.birthdate.trim()}`
    return fileStaffKeys.has(key) || localStaffKeys.has(key)
  }
  function inventoryCategoryCodeExists(code: string) {
    return fileInventoryCategoryCodes.has(code) || localInventoryCategoryCodes.has(code)
  }
  function transactionTypeCodeExists(code: string) {
    return fileTxnTypeCodes.has(code) || localTxnTypeCodes.has(code)
  }
  function templateNameExists(name: string) {
    return fileTemplateNames.has(name) || localTemplateNames.has(name)
  }
  function incomeShareRuleNameExists(name: string) {
    return fileIncomeShareRuleNames.has(name) || localIncomeShareRuleNames.has(name)
  }

  // Tiny helper to bucket a row into insert / update / skipIdentical. Returns
  // the chosen kind for callers that need to know.
  function bucket<T extends { fingerprint: string }>(
    entity: EntityKey,
    incoming: T,
    label: string,
    localIndex: LocalIndex<T>,
    diff: (local: T, incoming: T) => Array<{ field: string; localValue: unknown; incomingValue: unknown }>,
    skipIfInvalid?: boolean,
  ) {
    if (skipIfInvalid && invalidFingerprints[entity]?.has(incoming.fingerprint)) return
    const localMatch = localIndex.get(incoming.fingerprint)
    if (!localMatch) {
      perEntity[entity].insert.push({
        fingerprint: incoming.fingerprint,
        kind: 'insert',
        label,
      })
      return
    }
    const fieldDiffs = diff(localMatch.row, incoming)
    if (fieldDiffs.length === 0) {
      perEntity[entity].skipIdentical.push({
        fingerprint: incoming.fingerprint,
        kind: 'skipIdentical',
        label,
      })
      return
    }
    perEntity[entity].update.push({
      fingerprint: incoming.fingerprint,
      kind: 'update',
      label,
      diff: fieldDiffs,
    })
  }

  // ─── Bucket each entity ──────────────────────────────────────────────────

  for (const r of file.entities.transactionTypes) {
    bucket('transactionTypes', r, r.code, local.transactionTypes, diffTransactionType, true)
  }

  for (const r of file.entities.categories) {
    if (invalidFingerprints.categories?.has(r.fingerprint)) continue
    if (!transactionTypeCodeExists(r.transactionTypeCode)) {
      perEntity.categories.orphan.push({
        fingerprint: r.fingerprint,
        kind: 'orphan',
        label: `${r.transactionTypeCode} · ${r.label}`,
        reason: `Unknown transaction type "${r.transactionTypeCode}".`,
      })
      continue
    }
    bucket('categories', r, `${r.transactionTypeCode} · ${r.label}`, local.categories, diffCategory)
  }

  for (const r of file.entities.customers) {
    bucket('customers', r, r.name, local.customers, diffCustomer, true)
  }

  for (const r of file.entities.inventoryCategories) {
    bucket('inventoryCategories', r, r.label, local.inventoryCategories, diffInventoryCategory, true)
  }

  for (const r of file.entities.inventoryItems) {
    if (invalidFingerprints.inventoryItems?.has(r.fingerprint)) continue
    // Item.categoryCode ref is "soft" — the importer falls back to "other"
    // when the code does not exist anywhere, mirroring resolveInventoryCategory
    // in repository.ts. So no orphan bucket here.
    void inventoryCategoryCodeExists
    bucket('inventoryItems', r, r.name, local.inventoryItems, diffInventoryItem)
  }

  for (const r of file.entities.inventoryMovements) {
    if (invalidFingerprints.inventoryMovements?.has(r.fingerprint)) continue
    if (!inventoryItemRefExists(r.itemRef)) {
      perEntity.inventoryMovements.orphan.push({
        fingerprint: r.fingerprint,
        kind: 'orphan',
        label: `${r.itemRef.name} · ${r.movementDate}`,
        reason: `Unknown inventory item "${r.itemRef.name}".`,
      })
      continue
    }
    bucket('inventoryMovements', r, `${r.itemRef.name} · ${r.movementDate}`, local.inventoryMovements, diffInventoryMovement)
  }

  for (const r of file.entities.inventoryMaintenanceRecords) {
    if (invalidFingerprints.inventoryMaintenanceRecords?.has(r.fingerprint)) continue
    if (!inventoryItemRefExists(r.itemRef)) {
      perEntity.inventoryMaintenanceRecords.orphan.push({
        fingerprint: r.fingerprint,
        kind: 'orphan',
        label: `${r.itemRef.name} · ${r.serviceDate}`,
        reason: `Unknown inventory item "${r.itemRef.name}".`,
      })
      continue
    }
    bucket(
      'inventoryMaintenanceRecords',
      r,
      `${r.itemRef.name} · ${r.serviceDate}`,
      local.inventoryMaintenanceRecords,
      diffInventoryMaintenance,
    )
  }

  for (const r of file.entities.transactionTemplates) {
    if (invalidFingerprints.transactionTemplates?.has(r.fingerprint)) continue
    // Template items can reference inventory items that don't exist yet —
    // those orphans will surface as a warning during apply rather than
    // blocking the parent template insert.
    bucket('transactionTemplates', r, r.name, local.transactionTemplates, diffTemplate)
  }

  for (const r of file.entities.transactions) {
    if (invalidFingerprints.transactions?.has(r.fingerprint)) continue
    if (!transactionTypeCodeExists(r.transactionTypeCode)) {
      perEntity.transactions.orphan.push({
        fingerprint: r.fingerprint,
        kind: 'orphan',
        label: txnLabel(r),
        reason: `Unknown transaction type "${r.transactionTypeCode}".`,
      })
      continue
    }
    if (!categoryRefExists(r.categoryRef)) {
      perEntity.transactions.orphan.push({
        fingerprint: r.fingerprint,
        kind: 'orphan',
        label: txnLabel(r),
        reason: `Unknown category "${r.categoryRef.transactionTypeCode} · ${r.categoryRef.label}".`,
      })
      continue
    }
    if (r.customerRef && !customerRefExists(r.customerRef)) {
      perEntity.transactions.orphan.push({
        fingerprint: r.fingerprint,
        kind: 'orphan',
        label: txnLabel(r),
        reason: `Unknown customer "${r.customerRef.name}".`,
      })
      continue
    }
    bucket('transactions', r, txnLabel(r), local.transactions, diffTransaction)
  }

  for (const r of file.entities.staff) {
    bucket('staff', r, `${r.firstName} ${r.lastName}`.trim(), local.staff, diffStaff, true)
  }

  for (const r of file.entities.staffAttendance) {
    if (invalidFingerprints.staffAttendance?.has(r.fingerprint)) continue
    if (!staffRefExists(r.staffRef)) {
      perEntity.staffAttendance.orphan.push({
        fingerprint: r.fingerprint,
        kind: 'orphan',
        label: `${r.staffRef.firstName} ${r.staffRef.lastName} · ${r.attendanceDate}`,
        reason: 'Attendance row references a staff member not in the file or local DB.',
      })
      continue
    }
    bucket(
      'staffAttendance',
      r,
      `${r.staffRef.firstName} ${r.staffRef.lastName} · ${r.attendanceDate}`,
      local.staffAttendance,
      diffAttendance,
    )
  }

  for (const r of file.entities.staffPayrolls) {
    if (invalidFingerprints.staffPayrolls?.has(r.fingerprint)) continue
    if (!staffRefExists(r.staffRef)) {
      perEntity.staffPayrolls.orphan.push({
        fingerprint: r.fingerprint,
        kind: 'orphan',
        label: `${r.staffRef.firstName} ${r.staffRef.lastName} · ${r.periodStart}–${r.periodEnd}`,
        reason: 'Payroll row references a staff member not in the file or local DB.',
      })
      continue
    }
    bucket(
      'staffPayrolls',
      r,
      `${r.staffRef.firstName} ${r.staffRef.lastName} · ${r.periodStart}–${r.periodEnd}`,
      local.staffPayrolls,
      diffPayroll,
    )
  }

  for (const r of file.entities.staffCashAdvances) {
    if (invalidFingerprints.staffCashAdvances?.has(r.fingerprint)) continue
    if (!staffRefExists(r.staffRef)) {
      perEntity.staffCashAdvances.orphan.push({
        fingerprint: r.fingerprint,
        kind: 'orphan',
        label: `${r.staffRef.firstName} ${r.staffRef.lastName} · ${r.advanceDate}`,
        reason: 'Cash advance references a staff member not in the file or local DB.',
      })
      continue
    }
    bucket(
      'staffCashAdvances',
      r,
      `${r.staffRef.firstName} ${r.staffRef.lastName} · ${r.advanceDate}`,
      local.staffCashAdvances,
      diffCashAdvance,
    )
  }

  for (const r of file.entities.incidentReports) {
    bucket(
      'incidentReports',
      r,
      `${r.incidentDate} · ${r.customerName || r.incidentType || '(no description)'}`,
      local.incidentReports,
      diffIncident,
      true,
    )
  }

  for (const r of file.entities.incomeShareRules) {
    bucket('incomeShareRules', r, r.name, local.incomeShareRules, diffIncomeShareRule, true)
  }

  for (const r of file.entities.incomeShareMonthlyVersions) {
    if (invalidFingerprints.incomeShareMonthlyVersions?.has(r.fingerprint)) continue
    if (!incomeShareRuleNameExists(r.ruleName)) {
      perEntity.incomeShareMonthlyVersions.orphan.push({
        fingerprint: r.fingerprint,
        kind: 'orphan',
        label: `${r.monthKey} · ${r.ruleName}`,
        reason: `Unknown income share rule "${r.ruleName}".`,
      })
      continue
    }
    bucket(
      'incomeShareMonthlyVersions',
      r,
      `${r.monthKey} · ${r.ruleName}`,
      local.incomeShareMonthlyVersions,
      diffIncomeShareMonth,
    )
  }

  // Settings is a singleton — treat as one row with fingerprint 'singleton'.
  const settingsLocal = local.settings
  const settingsFile = file.entities.settings
  const settingsDiff = diffSettings(settingsLocal, settingsFile)
  if (settingsDiff.length === 0) {
    perEntity.settings.skipIdentical.push({
      fingerprint: 'singleton',
      kind: 'skipIdentical',
      label: 'App settings (loyalty + payroll)',
    })
  } else {
    perEntity.settings.update.push({
      fingerprint: 'singleton',
      kind: 'update',
      label: 'App settings (loyalty + payroll)',
      diff: settingsDiff,
    })
  }
  // Suppress "unused" lint when caller only needs a few helpers above.
  void templateNameExists

  return { file, perEntity }
}

function txnLabel(r: ExportTransaction): string {
  const cust = r.customerRef ? ` · ${r.customerRef.name}` : ''
  return `${r.entryDate} · ${r.categoryRef.label} · ${r.amount.toFixed(2)}${cust}`
}

// ─── Per-entity diffs ────────────────────────────────────────────────────────

type FieldDiff = { field: string; localValue: unknown; incomingValue: unknown }

function diffField<T extends Record<string, unknown>>(
  out: FieldDiff[],
  field: keyof T,
  local: T,
  incoming: T,
) {
  const a = local[field]
  const b = incoming[field]
  if (!sameValue(a, b)) {
    out.push({ field: String(field), localValue: a, incomingValue: b })
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-6
  }
  // Compare null/undefined as equal so missing optionals don't trigger conflicts.
  if (a == null && b == null) return true
  // Array / object deep-compare via canonical JSON. Sufficient for our shapes.
  if (typeof a === 'object' && typeof b === 'object') {
    return canonicalJson(a) === canonicalJson(b)
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim() === b.trim()
  }
  return false
}

function diffTransactionType(local: ExportTransactionType, inc: ExportTransactionType): FieldDiff[] {
  const out: FieldDiff[] = []
  diffField(out, 'label', local, inc)
  diffField(out, 'isSystem', local, inc)
  return out
}
function diffCategory(local: ExportCategory, inc: ExportCategory): FieldDiff[] {
  const out: FieldDiff[] = []
  diffField(out, 'isArchived', local, inc)
  diffField(out, 'isLoadable', local, inc)
  diffField(out, 'isSeeded', local, inc)
  return out
}
function diffCustomer(local: ExportCustomer, inc: ExportCustomer): FieldDiff[] {
  const out: FieldDiff[] = []
  diffField(out, 'name', local, inc)
  diffField(out, 'company', local, inc)
  diffField(out, 'email', local, inc)
  diffField(out, 'phone', local, inc)
  diffField(out, 'isArchived', local, inc)
  diffField(out, 'isLoyaltyEnabled', local, inc)
  return out
}
function diffInventoryCategory(local: ExportInventoryCategory, inc: ExportInventoryCategory): FieldDiff[] {
  const out: FieldDiff[] = []
  diffField(out, 'label', local, inc)
  diffField(out, 'isActive', local, inc)
  diffField(out, 'sortOrder', local, inc)
  return out
}
function diffInventoryItem(local: ExportInventoryItem, inc: ExportInventoryItem): FieldDiff[] {
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
    diffField(out, k, local, inc)
  }
  // Detect alt-unit changes so backups that only modify selling units
  // surface as conflicts rather than "identical".
  const localAlt = canonicalAltUnits(local.altUnits)
  const incAlt = canonicalAltUnits(inc.altUnits)
  if (localAlt !== incAlt) {
    out.push({ field: 'altUnits', localValue: localAlt, incomingValue: incAlt })
  }
  return out
}

function canonicalAltUnits(units: ExportInventoryItem['altUnits']): string {
  if (units == null) return ''
  return units
    .map((u) => ({
      unitLabel: (u.unitLabel ?? '').trim().toLowerCase(),
      unitsPerBase: Number(u.unitsPerBase) || 0,
      unitPrice: Number(u.unitPrice) || 0,
      isActive: u.isActive ? 1 : 0,
    }))
    .filter((u) => u.unitLabel !== '' && u.unitsPerBase > 0)
    .sort((a, b) => a.unitLabel.localeCompare(b.unitLabel))
    .map((u) => `${u.unitLabel}|${u.unitsPerBase}|${u.unitPrice}|${u.isActive}`)
    .join(';')
}
function diffInventoryMovement(local: ExportInventoryMovement, inc: ExportInventoryMovement): FieldDiff[] {
  // Fingerprint already covers the immutable identity fields; only `notes`
  // and `unitCost` are commonly tweaked.
  const out: FieldDiff[] = []
  diffField(out, 'notes', local, inc)
  return out
}
function diffInventoryMaintenance(local: ExportInventoryMaintenance, inc: ExportInventoryMaintenance): FieldDiff[] {
  const out: FieldDiff[] = []
  for (const k of ['cost', 'description', 'nextServiceDate', 'status'] as const) {
    diffField(out, k, local, inc)
  }
  return out
}
function diffTemplate(local: ExportTransactionTemplate, inc: ExportTransactionTemplate): FieldDiff[] {
  const out: FieldDiff[] = []
  diffField(out, 'description', local, inc)
  diffField(out, 'isActive', local, inc)
  diffField(out, 'items', local, inc)
  return out
}
function diffTransaction(local: ExportTransaction, inc: ExportTransaction): FieldDiff[] {
  const out: FieldDiff[] = []
  // Fingerprint already covers most user-visible identity fields. Only the
  // line items and staffCount can drift independently.
  diffField(out, 'staffCount', local, inc)
  diffField(out, 'lineItems', local, inc)
  return out
}
function diffStaff(local: ExportStaff, inc: ExportStaff): FieldDiff[] {
  const out: FieldDiff[] = []
  for (const k of [
    'address',
    'civilStatus',
    'emergencyContactName',
    'emergencyContactNumber',
    'spouseName',
    'defaultRate',
    'isArchived',
  ] as const) {
    diffField(out, k, local, inc)
  }
  return out
}
function diffAttendance(local: ExportStaffAttendance, inc: ExportStaffAttendance): FieldDiff[] {
  const out: FieldDiff[] = []
  for (const k of ['status', 'multiplier', 'rateOverride', 'computedPay', 'notes'] as const) {
    diffField(out, k, local, inc)
  }
  return out
}
function diffPayroll(local: ExportStaffPayroll, inc: ExportStaffPayroll): FieldDiff[] {
  const out: FieldDiff[] = []
  for (const k of [
    'payDate',
    'cutoffDay',
    'grossPay',
    'totalAdjustments',
    'netPay',
    'status',
    'notes',
    'items',
    'adjustments',
  ] as const) {
    diffField(out, k, local, inc)
  }
  return out
}
function diffCashAdvance(local: ExportStaffCashAdvance, inc: ExportStaffCashAdvance): FieldDiff[] {
  const out: FieldDiff[] = []
  diffField(out, 'status', local, inc)
  diffField(out, 'notes', local, inc)
  return out
}
function diffIncident(local: ExportIncidentReport, inc: ExportIncidentReport): FieldDiff[] {
  const out: FieldDiff[] = []
  for (const k of [
    'staffOnDuty',
    'contactNumber',
    'actionTaken',
    'handledBy',
    'estimatedLoss',
    'quantity',
    'itemsInvolved',
    'remarks',
  ] as const) {
    diffField(out, k, local, inc)
  }
  return out
}
function diffIncomeShareRule(local: ExportIncomeShareRule, inc: ExportIncomeShareRule): FieldDiff[] {
  const out: FieldDiff[] = []
  diffField(out, 'percentage', local, inc)
  diffField(out, 'isActive', local, inc)
  return out
}
function diffIncomeShareMonth(local: ExportIncomeShareMonth, inc: ExportIncomeShareMonth): FieldDiff[] {
  const out: FieldDiff[] = []
  diffField(out, 'percentage', local, inc)
  return out
}
function diffSettings(local: ExportSettings, inc: ExportSettings): FieldDiff[] {
  const out: FieldDiff[] = []
  if (!sameValue(local.loyalty, inc.loyalty)) out.push({ field: 'loyalty', localValue: local.loyalty, incomingValue: inc.loyalty })
  if (!sameValue(local.payroll, inc.payroll)) out.push({ field: 'payroll', localValue: local.payroll, incomingValue: inc.payroll })
  return out
}

// ─── Apply ───────────────────────────────────────────────────────────────────

/**
 * Walks the plan in topological order, performing inserts and updates for
 * every row the user did not Skip. Returns a per-entity summary including
 * any per-row failures that happened during apply.
 *
 * `userId` is the currently logged-in user; used to populate created_by /
 * updated_by columns where the schema requires them.
 */
export async function applyImportPlan(
  plan: ImportPlan,
  resolutions: ResolutionMap,
  userId: number,
  fileName: string | null = null,
): Promise<ImportSummary> {
  const startedAt = new Date().toISOString()

  const summary: ImportSummary = {
    startedAt,
    finishedAt: '',
    fileName,
    perEntity: {
      transactionTypes: emptyEntitySummary(),
      categories: emptyEntitySummary(),
      customers: emptyEntitySummary(),
      inventoryCategories: emptyEntitySummary(),
      inventoryItems: emptyEntitySummary(),
      inventoryMovements: emptyEntitySummary(),
      inventoryMaintenanceRecords: emptyEntitySummary(),
      transactionTemplates: emptyEntitySummary(),
      transactions: emptyEntitySummary(),
      staff: emptyEntitySummary(),
      staffAttendance: emptyEntitySummary(),
      staffPayrolls: emptyEntitySummary(),
      staffCashAdvances: emptyEntitySummary(),
      incidentReports: emptyEntitySummary(),
      incomeShareRules: emptyEntitySummary(),
      incomeShareMonthlyVersions: emptyEntitySummary(),
      settings: emptyEntitySummary(),
    },
    ok: true,
  }

  // Pre-tally the easy buckets so the summary numbers match the preview.
  for (const entity of ENTITY_APPLY_ORDER) {
    const sec = plan.perEntity[entity]
    summary.perEntity[entity].skippedIdentical += sec.skipIdentical.length
    summary.perEntity[entity].skippedOrphan += sec.orphan.length
    summary.perEntity[entity].skippedInvalid += sec.invalid.length
  }

  const db = await getDatabase()

  // Disable FK checks for the duration of the import — same pattern as
  // resetAllData(). Some of our parent inserts happen after their children
  // for cyclic refs (transactions ↔ payrolls ↔ cash_advances).
  try {
    await db.execute('PRAGMA foreign_keys = OFF')
  } catch {
    /* best-effort; some sqlite builds may not allow PRAGMA over the pool */
  }

  try {
    // ─── transaction_types ──────────────────────────────────────────────────
    for (const item of plan.perEntity.transactionTypes.insert) {
      await applyRow(summary.perEntity.transactionTypes, item, async () => {
        const row = findInFile(plan.file.entities.transactionTypes, item.fingerprint)!
        await db.execute(
          `INSERT OR IGNORE INTO transaction_types (code, label, is_system) VALUES ($1, $2, $3)`,
          [row.code, row.label, row.isSystem ? 1 : 0],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.transactionTypes.update) {
      await applyConflict(summary.perEntity.transactionTypes, item, resolutions, 'transactionTypes', async () => {
        const row = findInFile(plan.file.entities.transactionTypes, item.fingerprint)!
        await db.execute(
          `UPDATE transaction_types SET label = $1, is_system = $2 WHERE code = $3`,
          [row.label, row.isSystem ? 1 : 0, row.code],
        )
        return 'updated'
      })
    }

    // ─── categories ─────────────────────────────────────────────────────────
    for (const item of plan.perEntity.categories.insert) {
      await applyRow(summary.perEntity.categories, item, async () => {
        const row = findInFile(plan.file.entities.categories, item.fingerprint)!
        const typeId = await fetchTransactionTypeIdByCode(db, row.transactionTypeCode)
        if (typeId == null) {
          throw new Error(`Transaction type "${row.transactionTypeCode}" not found locally.`)
        }
        await db.execute(
          `
            INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded, is_archived, is_loadable)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [typeId, row.label, row.isSeeded ? 1 : 0, row.isArchived ? 1 : 0, row.isLoadable ? 1 : 0],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.categories.update) {
      await applyConflict(summary.perEntity.categories, item, resolutions, 'categories', async () => {
        const row = findInFile(plan.file.entities.categories, item.fingerprint)!
        const typeId = await fetchTransactionTypeIdByCode(db, row.transactionTypeCode)
        if (typeId == null) {
          throw new Error(`Transaction type "${row.transactionTypeCode}" not found locally.`)
        }
        await db.execute(
          `
            UPDATE categories
            SET is_seeded = $1, is_archived = $2, is_loadable = $3
            WHERE transaction_type_id = $4 AND LOWER(TRIM(label)) = LOWER(TRIM($5))
          `,
          [row.isSeeded ? 1 : 0, row.isArchived ? 1 : 0, row.isLoadable ? 1 : 0, typeId, row.label],
        )
        return 'updated'
      })
    }

    // ─── inventory_categories ───────────────────────────────────────────────
    for (const item of plan.perEntity.inventoryCategories.insert) {
      await applyRow(summary.perEntity.inventoryCategories, item, async () => {
        const row = findInFile(plan.file.entities.inventoryCategories, item.fingerprint)!
        await db.execute(
          `
            INSERT OR IGNORE INTO inventory_categories (code, label, is_system, is_active, sort_order)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [row.code, row.label, row.isSystem ? 1 : 0, row.isActive ? 1 : 0, row.sortOrder],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.inventoryCategories.update) {
      await applyConflict(summary.perEntity.inventoryCategories, item, resolutions, 'inventoryCategories', async () => {
        const row = findInFile(plan.file.entities.inventoryCategories, item.fingerprint)!
        await db.execute(
          `
            UPDATE inventory_categories
            SET label = $1, is_active = $2, sort_order = $3, updated_at = CURRENT_TIMESTAMP
            WHERE code = $4
          `,
          [row.label, row.isActive ? 1 : 0, row.sortOrder, row.code],
        )
        return 'updated'
      })
    }

    // ─── inventory_items ────────────────────────────────────────────────────
    for (const item of plan.perEntity.inventoryItems.insert) {
      await applyRow(summary.perEntity.inventoryItems, item, async () => {
        const row = findInFile(plan.file.entities.inventoryItems, item.fingerprint)!
        const catId = await resolveLocalInventoryCategory(db, row.categoryCode)
        await db.execute(
          `
            INSERT INTO inventory_items (
              name, description, unit_type, unit_label, cost_per_unit,
              is_active, low_stock_threshold, category_id, category,
              supplier, status, last_maintenance_date, selling_price
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `,
          [
            row.name,
            row.description,
            row.unitType,
            row.unitLabel,
            row.costPerUnit,
            row.isActive ? 1 : 0,
            row.lowStockThreshold,
            catId,
            row.categoryCode,
            row.supplier,
            row.status,
            row.lastMaintenanceDate,
            row.sellingPrice,
          ],
        )
        await replaceInventoryItemAltUnits(db, row)
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.inventoryItems.update) {
      await applyConflict(summary.perEntity.inventoryItems, item, resolutions, 'inventoryItems', async () => {
        const row = findInFile(plan.file.entities.inventoryItems, item.fingerprint)!
        const catId = await resolveLocalInventoryCategory(db, row.categoryCode)
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
            row.description,
            row.unitType,
            row.unitLabel,
            row.costPerUnit,
            row.isActive ? 1 : 0,
            row.lowStockThreshold,
            catId,
            row.categoryCode,
            row.supplier,
            row.status,
            row.lastMaintenanceDate,
            row.sellingPrice,
            row.name,
          ],
        )
        await replaceInventoryItemAltUnits(db, row)
        return 'updated'
      })
    }

    // ─── customers ──────────────────────────────────────────────────────────
    for (const item of plan.perEntity.customers.insert) {
      await applyRow(summary.perEntity.customers, item, async () => {
        const row = findInFile(plan.file.entities.customers, item.fingerprint)!
        await db.execute(
          `
            INSERT INTO customers (name, company, email, phone, is_archived, is_loyalty_enabled, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          `,
          [
            row.name,
            row.company,
            row.email,
            row.phone,
            row.isArchived ? 1 : 0,
            row.isLoyaltyEnabled ? 1 : 0,
            userId,
          ],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.customers.update) {
      await applyConflict(summary.perEntity.customers, item, resolutions, 'customers', async () => {
        const row = findInFile(plan.file.entities.customers, item.fingerprint)!
        await db.execute(
          `
            UPDATE customers
            SET
              name = $1,
              company = $2,
              email = $3,
              is_archived = $4,
              is_loyalty_enabled = $5,
              updated_by = $6,
              updated_at = CURRENT_TIMESTAMP
            WHERE LOWER(TRIM(name)) = LOWER(TRIM($7))
              AND TRIM(COALESCE(phone, '')) = TRIM(COALESCE($8, ''))
          `,
          [
            row.name,
            row.company,
            row.email,
            row.isArchived ? 1 : 0,
            row.isLoyaltyEnabled ? 1 : 0,
            userId,
            row.name,
            row.phone,
          ],
        )
        return 'updated'
      })
    }

    // ─── transaction_templates (+ items) ────────────────────────────────────
    for (const item of plan.perEntity.transactionTemplates.insert) {
      await applyRow(summary.perEntity.transactionTemplates, item, async () => {
        const row = findInFile(plan.file.entities.transactionTemplates, item.fingerprint)!
        const result = await db.execute(
          `
            INSERT INTO transaction_templates (name, description, is_active)
            VALUES ($1, $2, $3)
          `,
          [row.name, row.description, row.isActive ? 1 : 0],
        )
        const id = Number(result.lastInsertId)
        if (Number.isFinite(id) && id > 0) {
          await replaceTemplateItems(db, id, row)
        }
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.transactionTemplates.update) {
      await applyConflict(summary.perEntity.transactionTemplates, item, resolutions, 'transactionTemplates', async () => {
        const row = findInFile(plan.file.entities.transactionTemplates, item.fingerprint)!
        const id = await fetchSingle(db, `SELECT id FROM transaction_templates WHERE name = $1`, [row.name])
        if (id == null) throw new Error(`Local template "${row.name}" disappeared.`)
        await db.execute(
          `UPDATE transaction_templates SET description = $1, is_active = $2, updated_at = datetime('now') WHERE id = $3`,
          [row.description, row.isActive ? 1 : 0, id],
        )
        await replaceTemplateItems(db, id, row)
        return 'updated'
      })
    }

    // ─── staff ──────────────────────────────────────────────────────────────
    for (const item of plan.perEntity.staff.insert) {
      await applyRow(summary.perEntity.staff, item, async () => {
        const row = findInFile(plan.file.entities.staff, item.fingerprint)!
        await db.execute(
          `
            INSERT INTO staff (
              first_name, middle_name, last_name, address, birthdate, civil_status,
              emergency_contact_name, emergency_contact_number, spouse_name,
              default_rate, is_archived, created_by, updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
          `,
          [
            row.firstName,
            row.middleName,
            row.lastName,
            row.address,
            row.birthdate,
            row.civilStatus,
            row.emergencyContactName,
            row.emergencyContactNumber,
            row.spouseName,
            row.defaultRate,
            row.isArchived ? 1 : 0,
            userId,
          ],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.staff.update) {
      await applyConflict(summary.perEntity.staff, item, resolutions, 'staff', async () => {
        const row = findInFile(plan.file.entities.staff, item.fingerprint)!
        await db.execute(
          `
            UPDATE staff SET
              address = $1,
              civil_status = $2,
              emergency_contact_name = $3,
              emergency_contact_number = $4,
              spouse_name = $5,
              default_rate = $6,
              is_archived = $7,
              updated_by = $8,
              updated_at = CURRENT_TIMESTAMP
            WHERE LOWER(TRIM(first_name)) = LOWER(TRIM($9))
              AND LOWER(TRIM(COALESCE(middle_name, ''))) = LOWER(TRIM(COALESCE($10, '')))
              AND LOWER(TRIM(last_name)) = LOWER(TRIM($11))
              AND TRIM(COALESCE(birthdate, '')) = TRIM(COALESCE($12, ''))
          `,
          [
            row.address,
            row.civilStatus,
            row.emergencyContactName,
            row.emergencyContactNumber,
            row.spouseName,
            row.defaultRate,
            row.isArchived ? 1 : 0,
            userId,
            row.firstName,
            row.middleName,
            row.lastName,
            row.birthdate,
          ],
        )
        return 'updated'
      })
    }

    // ─── income_share_rules ─────────────────────────────────────────────────
    for (const item of plan.perEntity.incomeShareRules.insert) {
      await applyRow(summary.perEntity.incomeShareRules, item, async () => {
        const row = findInFile(plan.file.entities.incomeShareRules, item.fingerprint)!
        await db.execute(
          `INSERT OR IGNORE INTO income_share_rules (name, percentage, is_active) VALUES ($1, $2, $3)`,
          [row.name, row.percentage, row.isActive ? 1 : 0],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.incomeShareRules.update) {
      await applyConflict(summary.perEntity.incomeShareRules, item, resolutions, 'incomeShareRules', async () => {
        const row = findInFile(plan.file.entities.incomeShareRules, item.fingerprint)!
        await db.execute(
          `UPDATE income_share_rules SET percentage = $1, is_active = $2 WHERE name = $3`,
          [row.percentage, row.isActive ? 1 : 0, row.name],
        )
        return 'updated'
      })
    }

    // ─── transactions (+ line_items) ────────────────────────────────────────
    for (const item of plan.perEntity.transactions.insert) {
      await applyRow(summary.perEntity.transactions, item, async () => {
        const row = findInFile(plan.file.entities.transactions, item.fingerprint)!
        await insertTransactionWithLineItems(db, row, userId)
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.transactions.update) {
      await applyConflict(summary.perEntity.transactions, item, resolutions, 'transactions', async () => {
        const row = findInFile(plan.file.entities.transactions, item.fingerprint)!
        await updateTransactionWithLineItems(db, row, userId)
        return 'updated'
      })
    }

    // ─── Build fingerprint → local DB id map for all transactions in the file.
    //
    // Because the autoincrement id is different on every device, inventory
    // movements cannot use the original transaction_id from the source device.
    // Instead the export now stores the transaction fingerprint on each
    // movement, and we resolve the correct local id here — after all
    // transactions have been inserted/updated/skipped — before applying the
    // movements.
    const txFingerprintToLocalId = new Map<string, number>()
    for (const row of plan.file.entities.transactions) {
      const localTxn = await findTransactionByIdentity({
        entryDate: row.entryDate,
        transactionTypeCode: row.transactionTypeCode,
        categoryLabel: row.categoryRef.label,
        amount: row.amount,
        description: row.description,
        customerName: row.customerRef?.name ?? null,
        customerPhone: row.customerRef?.phone ?? null,
        kg: row.kg,
        loads: row.loads,
        isLoyaltyReward: row.isLoyaltyReward,
      })
      if (localTxn) {
        txFingerprintToLocalId.set(row.fingerprint, localTxn.id)
      }
    }

    // ─── inventory_movements ────────────────────────────────────────────────
    for (const item of plan.perEntity.inventoryMovements.insert) {
      await applyRow(summary.perEntity.inventoryMovements, item, async () => {
        const row = findInFile(plan.file.entities.inventoryMovements, item.fingerprint)!
        const itemId = await fetchSingle(
          db,
          `SELECT id FROM inventory_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
          [row.itemRef.name],
        )
        if (itemId == null) throw new Error(`Inventory item "${row.itemRef.name}" not found locally.`)

        // Restore the transaction_id link using the fingerprint-based lookup.
        // Falls back to NULL for manual stock adjustments (no transactionRef)
        // and for old backup files that predate the transactionRef field.
        const transactionId =
          row.transactionRef != null
            ? (txFingerprintToLocalId.get(row.transactionRef) ?? null)
            : null

        await db.execute(
          `
            INSERT INTO inventory_movements (item_id, movement_type, quantity, unit_cost, notes, movement_date, created_by, transaction_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [itemId, row.movementType, row.quantity, row.unitCost, row.notes, row.movementDate, userId, transactionId],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.inventoryMovements.update) {
      await applyConflict(summary.perEntity.inventoryMovements, item, resolutions, 'inventoryMovements', async () => {
        const row = findInFile(plan.file.entities.inventoryMovements, item.fingerprint)!
        await db.execute(
          `
            UPDATE inventory_movements SET notes = $1
            WHERE movement_date = $2
              AND movement_type = $3
              AND quantity = $4
              AND item_id = (SELECT id FROM inventory_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($5)) LIMIT 1)
          `,
          [row.notes, row.movementDate, row.movementType, row.quantity, row.itemRef.name],
        )
        return 'updated'
      })
    }

    // ─── inventory_maintenance_records ──────────────────────────────────────
    for (const item of plan.perEntity.inventoryMaintenanceRecords.insert) {
      await applyRow(summary.perEntity.inventoryMaintenanceRecords, item, async () => {
        const row = findInFile(plan.file.entities.inventoryMaintenanceRecords, item.fingerprint)!
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
            row.serviceType,
            row.performedBy,
            row.cost,
            row.description,
            row.nextServiceDate,
            row.status,
            userId,
          ],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.inventoryMaintenanceRecords.update) {
      await applyConflict(summary.perEntity.inventoryMaintenanceRecords, item, resolutions, 'inventoryMaintenanceRecords', async () => {
        const row = findInFile(plan.file.entities.inventoryMaintenanceRecords, item.fingerprint)!
        await db.execute(
          `
            UPDATE inventory_maintenance_records SET
              cost = $1, description = $2, next_service_date = $3, status = $4,
              updated_at = CURRENT_TIMESTAMP
            WHERE service_date = $5
              AND service_type = $6
              AND performed_by = $7
              AND item_id = (SELECT id FROM inventory_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($8)) LIMIT 1)
          `,
          [
            row.cost,
            row.description,
            row.nextServiceDate,
            row.status,
            row.serviceDate,
            row.serviceType,
            row.performedBy,
            row.itemRef.name,
          ],
        )
        return 'updated'
      })
    }

    // ─── staff_attendance ───────────────────────────────────────────────────
    for (const item of plan.perEntity.staffAttendance.insert) {
      await applyRow(summary.perEntity.staffAttendance, item, async () => {
        const row = findInFile(plan.file.entities.staffAttendance, item.fingerprint)!
        const staffId = await resolveStaffId(db, row.staffRef)
        if (staffId == null) throw new Error('Staff not found locally for attendance row.')
        await db.execute(
          `
            INSERT OR IGNORE INTO staff_attendance (
              staff_id, attendance_date, status, multiplier, rate_override, computed_pay, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            staffId,
            row.attendanceDate,
            row.status,
            row.multiplier,
            row.rateOverride,
            row.computedPay,
            row.notes,
          ],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.staffAttendance.update) {
      await applyConflict(summary.perEntity.staffAttendance, item, resolutions, 'staffAttendance', async () => {
        const row = findInFile(plan.file.entities.staffAttendance, item.fingerprint)!
        const staffId = await resolveStaffId(db, row.staffRef)
        if (staffId == null) throw new Error('Staff not found locally for attendance row.')
        await db.execute(
          `
            UPDATE staff_attendance SET
              status = $1, multiplier = $2, rate_override = $3, computed_pay = $4, notes = $5,
              updated_at = CURRENT_TIMESTAMP
            WHERE staff_id = $6 AND attendance_date = $7
          `,
          [
            row.status,
            row.multiplier,
            row.rateOverride,
            row.computedPay,
            row.notes,
            staffId,
            row.attendanceDate,
          ],
        )
        return 'updated'
      })
    }

    // ─── staff_payrolls (+ items + adjustments) ─────────────────────────────
    for (const item of plan.perEntity.staffPayrolls.insert) {
      await applyRow(summary.perEntity.staffPayrolls, item, async () => {
        const row = findInFile(plan.file.entities.staffPayrolls, item.fingerprint)!
        await insertPayrollWithChildren(db, row)
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.staffPayrolls.update) {
      await applyConflict(summary.perEntity.staffPayrolls, item, resolutions, 'staffPayrolls', async () => {
        const row = findInFile(plan.file.entities.staffPayrolls, item.fingerprint)!
        await updatePayrollWithChildren(db, row)
        return 'updated'
      })
    }

    // ─── staff_cash_advances ────────────────────────────────────────────────
    for (const item of plan.perEntity.staffCashAdvances.insert) {
      await applyRow(summary.perEntity.staffCashAdvances, item, async () => {
        const row = findInFile(plan.file.entities.staffCashAdvances, item.fingerprint)!
        const staffId = await resolveStaffId(db, row.staffRef)
        if (staffId == null) throw new Error('Staff not found locally for cash advance.')
        await db.execute(
          `
            INSERT INTO staff_cash_advances (
              staff_id, advance_date, amount, notes, status, created_by, updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $6)
          `,
          [staffId, row.advanceDate, row.amount, row.notes, row.status, userId],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.staffCashAdvances.update) {
      await applyConflict(summary.perEntity.staffCashAdvances, item, resolutions, 'staffCashAdvances', async () => {
        const row = findInFile(plan.file.entities.staffCashAdvances, item.fingerprint)!
        const staffId = await resolveStaffId(db, row.staffRef)
        if (staffId == null) throw new Error('Staff not found locally for cash advance.')
        await db.execute(
          `
            UPDATE staff_cash_advances SET
              status = $1, notes = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP
            WHERE staff_id = $4 AND advance_date = $5 AND ROUND(amount, 2) = ROUND($6, 2)
          `,
          [row.status, row.notes, userId, staffId, row.advanceDate, row.amount],
        )
        return 'updated'
      })
    }

    // ─── incident_reports ───────────────────────────────────────────────────
    for (const item of plan.perEntity.incidentReports.insert) {
      await applyRow(summary.perEntity.incidentReports, item, async () => {
        const row = findInFile(plan.file.entities.incidentReports, item.fingerprint)!
        await db.execute(
          `
            INSERT INTO incident_reports (
              incident_date, incident_time, staff_on_duty, incident_type,
              what_happened, customer_name, contact_number, action_taken,
              handled_by, estimated_loss, quantity, items_involved, remarks, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `,
          [
            row.incidentDate,
            row.incidentTime,
            row.staffOnDuty,
            row.incidentType,
            row.whatHappened,
            row.customerName,
            row.contactNumber,
            row.actionTaken,
            row.handledBy,
            row.estimatedLoss,
            row.quantity,
            row.itemsInvolved,
            row.remarks,
            userId,
          ],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.incidentReports.update) {
      await applyConflict(summary.perEntity.incidentReports, item, resolutions, 'incidentReports', async () => {
        const row = findInFile(plan.file.entities.incidentReports, item.fingerprint)!
        await db.execute(
          `
            UPDATE incident_reports SET
              staff_on_duty = $1, contact_number = $2, action_taken = $3,
              handled_by = $4, estimated_loss = $5, quantity = $6,
              items_involved = $7, remarks = $8, updated_at = CURRENT_TIMESTAMP
            WHERE incident_date = $9 AND incident_time = $10
              AND incident_type = $11
              AND LOWER(TRIM(customer_name)) = LOWER(TRIM($12))
              AND TRIM(what_happened) = TRIM($13)
          `,
          [
            row.staffOnDuty,
            row.contactNumber,
            row.actionTaken,
            row.handledBy,
            row.estimatedLoss,
            row.quantity,
            row.itemsInvolved,
            row.remarks,
            row.incidentDate,
            row.incidentTime,
            row.incidentType,
            row.customerName,
            row.whatHappened,
          ],
        )
        return 'updated'
      })
    }

    // ─── income_share_monthly_versions ──────────────────────────────────────
    for (const item of plan.perEntity.incomeShareMonthlyVersions.insert) {
      await applyRow(summary.perEntity.incomeShareMonthlyVersions, item, async () => {
        const row = findInFile(plan.file.entities.incomeShareMonthlyVersions, item.fingerprint)!
        const ruleId = await fetchSingle(db, `SELECT id FROM income_share_rules WHERE name = $1`, [row.ruleName])
        if (ruleId == null) throw new Error(`Income share rule "${row.ruleName}" not found locally.`)
        await db.execute(
          `INSERT OR IGNORE INTO income_share_monthly_versions (month_key, rule_id, percentage) VALUES ($1, $2, $3)`,
          [row.monthKey, ruleId, row.percentage],
        )
        return 'inserted'
      })
    }
    for (const item of plan.perEntity.incomeShareMonthlyVersions.update) {
      await applyConflict(summary.perEntity.incomeShareMonthlyVersions, item, resolutions, 'incomeShareMonthlyVersions', async () => {
        const row = findInFile(plan.file.entities.incomeShareMonthlyVersions, item.fingerprint)!
        const ruleId = await fetchSingle(db, `SELECT id FROM income_share_rules WHERE name = $1`, [row.ruleName])
        if (ruleId == null) throw new Error(`Income share rule "${row.ruleName}" not found locally.`)
        await db.execute(
          `UPDATE income_share_monthly_versions SET percentage = $1 WHERE month_key = $2 AND rule_id = $3`,
          [row.percentage, row.monthKey, ruleId],
        )
        return 'updated'
      })
    }

    // ─── settings (singleton) ───────────────────────────────────────────────
    for (const item of plan.perEntity.settings.update) {
      await applyConflict(summary.perEntity.settings, item, resolutions, 'settings', async () => {
        const s = plan.file.entities.settings
        await db.execute(
          `UPDATE loyalty_settings SET kg_per_load = $1, free_after_loads = $2 WHERE id = 1`,
          [s.loyalty.kgPerLoad, Math.max(1, Math.floor(s.loyalty.freeAfterLoads))],
        )
        await db.execute(
          `UPDATE payroll_settings SET cutoff_day = $1, holiday_default_multiplier = $2, auto_deduct_cash_advances = $3 WHERE id = 1`,
          [s.payroll.cutoffDay, s.payroll.holidayDefaultMultiplier, s.payroll.autoDeductCashAdvances ? 1 : 0],
        )
        return 'updated'
      })
    }
  } finally {
    try {
      await db.execute('PRAGMA foreign_keys = ON')
    } catch {
      /* ignore */
    }
  }

  // Mark the summary not-ok if any entity recorded a failure.
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

function findInFile<T extends { fingerprint: string }>(rows: T[], fp: string): T | undefined {
  return rows.find((r) => r.fingerprint === fp)
}

async function applyRow(
  summary: EntitySummary,
  item: PlanItem,
  action: () => Promise<'inserted' | 'updated'>,
) {
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

async function applyConflict(
  summary: EntitySummary,
  item: PlanItem,
  resolutions: ResolutionMap,
  entity: EntityKey,
  action: () => Promise<'inserted' | 'updated'>,
) {
  const choice = resolutions[makeResolutionKey(entity, item.fingerprint)] ?? 'skip'
  if (choice === 'skip') {
    summary.skippedByUser += 1
    return
  }
  await applyRow(summary, item, action)
}

async function fetchTransactionTypeIdByCode(
  db: Awaited<ReturnType<typeof getDatabase>>,
  code: string,
): Promise<number | null> {
  return fetchSingle(db, `SELECT id FROM transaction_types WHERE code = $1`, [code])
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

async function resolveLocalInventoryCategory(
  db: Awaited<ReturnType<typeof getDatabase>>,
  code: string,
): Promise<number | null> {
  const direct = await fetchSingle(db, `SELECT id FROM inventory_categories WHERE code = $1 LIMIT 1`, [code])
  if (direct != null) return direct
  return fetchSingle(db, `SELECT id FROM inventory_categories WHERE code = 'other' LIMIT 1`, [])
}

async function resolveStaffId(
  db: Awaited<ReturnType<typeof getDatabase>>,
  ref: { firstName: string; middleName: string; lastName: string; birthdate: string },
): Promise<number | null> {
  return fetchSingle(
    db,
    `
      SELECT id FROM staff
      WHERE LOWER(TRIM(first_name)) = LOWER(TRIM($1))
        AND LOWER(TRIM(COALESCE(middle_name, ''))) = LOWER(TRIM(COALESCE($2, '')))
        AND LOWER(TRIM(last_name)) = LOWER(TRIM($3))
        AND TRIM(COALESCE(birthdate, '')) = TRIM(COALESCE($4, ''))
      LIMIT 1
    `,
    [ref.firstName, ref.middleName, ref.lastName, ref.birthdate],
  )
}

async function resolveCustomerId(
  db: Awaited<ReturnType<typeof getDatabase>>,
  ref: { name: string; phone: string },
): Promise<number | null> {
  return fetchSingle(
    db,
    `
      SELECT id FROM customers
      WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
        AND TRIM(COALESCE(phone, '')) = TRIM(COALESCE($2, ''))
      ORDER BY id LIMIT 1
    `,
    [ref.name, ref.phone],
  )
}

/**
 * Replace the alt selling units for an inventory item. Resolves the item by
 * its case-insensitive name (matching how every other importer step handles
 * inventory items). Older backups that don't include `altUnits` leave the
 * existing rows alone, so re-importing a pre-v23 file doesn't wipe alt units
 * that were created post-import.
 */
async function replaceInventoryItemAltUnits(
  db: Awaited<ReturnType<typeof getDatabase>>,
  row: { name: string; altUnits?: ExportInventoryItem['altUnits'] },
) {
  if (row.altUnits == null) return
  const itemId = await fetchSingle(
    db,
    `SELECT id FROM inventory_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
    [row.name],
  )
  if (itemId == null) return
  await db.execute(`DELETE FROM inventory_item_units WHERE item_id = $1`, [itemId])
  for (const u of row.altUnits) {
    if (u.unitsPerBase <= 0 || u.unitLabel.trim() === '') continue
    await db.execute(
      `
        INSERT OR IGNORE INTO inventory_item_units (
          item_id, unit_label, units_per_base, unit_price, sort_order, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [itemId, u.unitLabel, u.unitsPerBase, u.unitPrice, u.sortOrder, u.isActive ? 1 : 0],
    )
  }
}

async function replaceTemplateItems(
  db: Awaited<ReturnType<typeof getDatabase>>,
  templateId: number,
  template: ExportTransactionTemplate,
) {
  await db.execute(`DELETE FROM transaction_template_items WHERE template_id = $1`, [templateId])
  let order = 0
  for (const it of template.items) {
    const itemId = await fetchSingle(
      db,
      `SELECT id FROM inventory_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
      [it.itemRef.name],
    )
    if (itemId == null) {
      // The orphan child silently dropped — the parent template still imports.
      continue
    }
    const unitPrice =
      it.unitPrice != null && Number.isFinite(it.unitPrice) && it.unitPrice >= 0
        ? it.unitPrice
        : 0
    const factor =
      it.saleUnitFactor != null &&
      Number.isFinite(it.saleUnitFactor) &&
      it.saleUnitFactor > 0
        ? it.saleUnitFactor
        : 1
    const altLabel = (it.saleUnitLabel ?? '').trim()
    // Resolve to a local alt-unit row if one with the same label exists for
    // this item; otherwise we still persist the snapshot fields and leave
    // sale_unit_id NULL (the historical conversion factor stays correct).
    const altUnitId =
      altLabel !== ''
        ? await fetchSingle(
            db,
            `SELECT id FROM inventory_item_units WHERE item_id = $1 AND LOWER(TRIM(unit_label)) = LOWER(TRIM($2)) LIMIT 1`,
            [itemId, altLabel],
          )
        : null
    await db.execute(
      `
        INSERT OR IGNORE INTO transaction_template_items (
          template_id, inventory_item_id, quantity, unit_price,
          sale_unit_label, sale_unit_factor, sale_unit_id, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        templateId,
        itemId,
        it.quantity,
        unitPrice,
        altLabel,
        factor,
        altUnitId,
        it.sortOrder ?? order,
      ],
    )
    order += 1
  }
}

async function insertTransactionWithLineItems(
  db: Awaited<ReturnType<typeof getDatabase>>,
  row: ExportTransaction,
  userId: number,
) {
  const typeId = await fetchTransactionTypeIdByCode(db, row.transactionTypeCode)
  if (typeId == null) throw new Error(`Transaction type "${row.transactionTypeCode}" not found locally.`)
  const categoryId = await fetchSingle(
    db,
    `SELECT id FROM categories WHERE transaction_type_id = $1 AND LOWER(TRIM(label)) = LOWER(TRIM($2)) LIMIT 1`,
    [typeId, row.categoryRef.label],
  )
  if (categoryId == null) throw new Error(`Category "${row.categoryRef.label}" not found locally.`)

  let customerId: number | null = null
  if (row.customerRef) {
    customerId = await resolveCustomerId(db, row.customerRef)
  }

  const result = await db.execute(
    `
      INSERT INTO transactions (
        entry_date, transaction_type_id, category_id, description, amount,
        staff_count, customer_id, kg, loads, is_loyalty_reward,
        created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
    `,
    [
      row.entryDate,
      typeId,
      categoryId,
      row.description,
      row.amount,
      row.staffCount,
      customerId,
      row.kg,
      row.loads,
      row.isLoyaltyReward ? 1 : 0,
      userId,
    ],
  )
  const txnId = Number(result.lastInsertId)
  if (Number.isFinite(txnId) && txnId > 0) {
    await replaceLineItems(db, txnId, row)
  }
}

async function updateTransactionWithLineItems(
  db: Awaited<ReturnType<typeof getDatabase>>,
  row: ExportTransaction,
  userId: number,
) {
  const existing = await findTransactionByIdentity({
    entryDate: row.entryDate,
    transactionTypeCode: row.transactionTypeCode,
    categoryLabel: row.categoryRef.label,
    amount: row.amount,
    description: row.description,
    customerName: row.customerRef?.name ?? null,
    customerPhone: row.customerRef?.phone ?? null,
    kg: row.kg,
    loads: row.loads,
    isLoyaltyReward: row.isLoyaltyReward,
  })
  if (!existing) throw new Error('Local transaction disappeared between dry-run and apply.')

  await db.execute(
    `
      UPDATE transactions SET
        staff_count = $1,
        updated_by = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `,
    [row.staffCount, userId, existing.id],
  )
  await replaceLineItems(db, existing.id, row)
}

async function replaceLineItems(
  db: Awaited<ReturnType<typeof getDatabase>>,
  txnId: number,
  row: ExportTransaction,
) {
  await db.execute(`DELETE FROM transaction_line_items WHERE transaction_id = $1`, [txnId])
  let order = 0
  for (const li of row.lineItems) {
    let inventoryItemId: number | null = null
    if (li.itemRef) {
      inventoryItemId = await fetchSingle(
        db,
        `SELECT id FROM inventory_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
        [li.itemRef.name],
      )
    }
    const factor =
      li.saleUnitFactor != null &&
      Number.isFinite(li.saleUnitFactor) &&
      li.saleUnitFactor > 0
        ? li.saleUnitFactor
        : 1
    const altLabel = (li.saleUnitLabel ?? '').trim()
    const altUnitId =
      inventoryItemId != null && altLabel !== ''
        ? await fetchSingle(
            db,
            `SELECT id FROM inventory_item_units WHERE item_id = $1 AND LOWER(TRIM(unit_label)) = LOWER(TRIM($2)) LIMIT 1`,
            [inventoryItemId, altLabel],
          )
        : null
    await db.execute(
      `
        INSERT INTO transaction_line_items (
          transaction_id, inventory_item_id, label, price, quantity, unit_price,
          sale_unit_label, sale_unit_factor, sale_unit_id, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        txnId,
        inventoryItemId,
        li.label,
        li.price,
        li.quantity,
        li.unitPrice,
        altLabel,
        factor,
        altUnitId,
        li.sortOrder ?? order,
      ],
    )
    order += 1
  }
}

async function insertPayrollWithChildren(
  db: Awaited<ReturnType<typeof getDatabase>>,
  row: ExportStaffPayroll,
) {
  const staffId = await resolveStaffId(db, row.staffRef)
  if (staffId == null) throw new Error('Staff not found locally for payroll.')

  const result = await db.execute(
    `
      INSERT INTO staff_payrolls (
        staff_id, period_start, period_end, pay_date, cutoff_day,
        gross_pay, total_adjustments, net_pay, status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      staffId,
      row.periodStart,
      row.periodEnd,
      row.payDate,
      row.cutoffDay,
      row.grossPay,
      row.totalAdjustments,
      row.netPay,
      row.status,
      row.notes,
    ],
  )
  const payrollId = Number(result.lastInsertId)
  if (!Number.isFinite(payrollId) || payrollId <= 0) {
    throw new Error('Failed to obtain new payroll id.')
  }
  await insertPayrollItemsAndAdjustments(db, payrollId, staffId, row)
}

async function updatePayrollWithChildren(
  db: Awaited<ReturnType<typeof getDatabase>>,
  row: ExportStaffPayroll,
) {
  const staffId = await resolveStaffId(db, row.staffRef)
  if (staffId == null) throw new Error('Staff not found locally for payroll.')
  const id = await fetchSingle(
    db,
    `SELECT id FROM staff_payrolls WHERE staff_id = $1 AND period_start = $2 AND period_end = $3 LIMIT 1`,
    [staffId, row.periodStart, row.periodEnd],
  )
  if (id == null) throw new Error('Local payroll disappeared between dry-run and apply.')
  await db.execute(
    `
      UPDATE staff_payrolls SET
        pay_date = $1, cutoff_day = $2, gross_pay = $3, total_adjustments = $4,
        net_pay = $5, status = $6, notes = $7, updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
    `,
    [row.payDate, row.cutoffDay, row.grossPay, row.totalAdjustments, row.netPay, row.status, row.notes, id],
  )
  await db.execute(`DELETE FROM staff_payroll_items WHERE payroll_id = $1`, [id])
  await db.execute(`DELETE FROM staff_payroll_adjustments WHERE payroll_id = $1`, [id])
  await insertPayrollItemsAndAdjustments(db, id, staffId, row)
}

async function insertPayrollItemsAndAdjustments(
  db: Awaited<ReturnType<typeof getDatabase>>,
  payrollId: number,
  staffId: number,
  row: ExportStaffPayroll,
) {
  for (const it of row.items) {
    // Look up the local attendance row that this payroll item refers to.
    const attendanceId = await fetchSingle(
      db,
      `SELECT id FROM staff_attendance WHERE staff_id = $1 AND attendance_date = $2 LIMIT 1`,
      [staffId, it.entryDate],
    )
    if (attendanceId == null) {
      // No local attendance — skip this item silently. The payroll totals
      // still reflect the imported gross/adjustments/net, just without the
      // per-day breakdown.
      continue
    }
    await db.execute(
      `
        INSERT OR IGNORE INTO staff_payroll_items (
          payroll_id, attendance_id, entry_date, status, rate_used, multiplier, pay_amount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [payrollId, attendanceId, it.entryDate, it.status, it.rateUsed, it.multiplier, it.payAmount],
    )
  }
  for (const adj of row.adjustments) {
    await db.execute(
      `INSERT INTO staff_payroll_adjustments (payroll_id, label, kind, amount) VALUES ($1, $2, $3, $4)`,
      [payrollId, adj.label, adj.kind, adj.amount],
    )
  }
}

// ─── Public report formatter (handy for "Copy report" buttons) ───────────────

export function formatSummaryReport(summary: ImportSummary, fileName?: string | null): string {
  const lines: string[] = []
  const stamp = format(new Date(), 'yyyy-MM-dd HH:mm')
  lines.push(`Backup import — ${stamp}${fileName ? ` (${fileName})` : ''}`)
  lines.push('')
  for (const key of ENTITY_APPLY_ORDER) {
    const s = summary.perEntity[key]
    const total =
      s.inserted +
      s.updated +
      s.skippedIdentical +
      s.skippedByUser +
      s.skippedOrphan +
      s.skippedInvalid +
      s.failed
    if (total === 0) continue
    lines.push(
      `• ${key} — inserted ${s.inserted}, updated ${s.updated}, skipped (identical) ${s.skippedIdentical}, skipped (your choice) ${s.skippedByUser}, skipped (orphan) ${s.skippedOrphan}, skipped (invalid) ${s.skippedInvalid}, failed ${s.failed}`,
    )
    for (const e of s.errors) {
      lines.push(`    ! ${e.label}: ${e.message}`)
    }
  }
  lines.push('')
  lines.push(summary.ok ? 'Status: OK' : 'Status: completed with errors')
  return lines.join('\n')
}
