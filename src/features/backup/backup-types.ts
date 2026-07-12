// Type definitions shared across the backup/sync export, import, planner,
// and dialog modules. The export file format is JSON with an envelope plus
// an `entities` block; every cross-row reference is denormalized to a
// natural-key tuple so the file can be merged into a different device's
// SQLite DB without colliding on autoincrement primary keys.
//
// IMPORTANT: bump `BACKUP_FORMAT_VERSION` and write a migration helper if
// you ever change the on-disk shape so older files keep loading.

import type { BusinessId } from '../../lib/db/business'

export const BACKUP_FORMAT = 'business-ledger-export' as const
export const BACKUP_FORMAT_VERSION = 1
/**
 * Maximum DB schema version this importer understands. Mirrors the highest
 * `version` in `src-tauri/src/db.rs::build_migrations`. Files exported with
 * a higher schemaVersion are refused with "newer file, please update the app".
 */
export const SUPPORTED_SCHEMA_VERSION = 23

// ─── Natural-key references (replace raw FK ids in the file) ─────────────────

export type CategoryRef = {
  transactionTypeCode: string
  label: string
}

export type CustomerRef = {
  name: string
  phone: string
}

export type StaffRef = {
  firstName: string
  middleName: string
  lastName: string
  birthdate: string
}

export type InventoryItemRef = {
  name: string
}

// ─── Per-entity export shapes (denormalized; no DB ids) ──────────────────────

export type ExportTransactionType = {
  fingerprint: string
  code: string
  label: string
  isSystem: boolean
}

export type ExportCategory = {
  fingerprint: string
  transactionTypeCode: string
  label: string
  isSeeded: boolean
  isArchived: boolean
  isLoadable: boolean
}

export type ExportCustomer = {
  fingerprint: string
  name: string
  company: string
  email: string
  phone: string
  isArchived: boolean
  isLoyaltyEnabled: boolean
}

export type ExportInventoryCategory = {
  fingerprint: string
  code: string
  label: string
  isSystem: boolean
  isActive: boolean
  sortOrder: number
}

export type ExportInventoryItemAltUnit = {
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
  categoryCode: string
  supplier: string
  status: string
  lastMaintenanceDate: string
  /** Alternate sale units. Optional for backwards compatibility with backups
   *  created before this field existed. */
  altUnits?: ExportInventoryItemAltUnit[]
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
  /**
   * Fingerprint of the parent transaction when this movement was created by a
   * sale/transaction (i.e. the DB row has a non-null `transaction_id`).
   * Optional for backwards compatibility with backup files created before this
   * field existed — older files will simply import movements without a
   * `transaction_id` link.
   */
  transactionRef?: string | null
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

export type ExportTransactionTemplateItem = {
  itemRef: InventoryItemRef
  quantity: number
  /**
   * Per-unit price stored on the template line. Optional for backwards
   * compatibility with backups created before this field existed.
   */
  unitPrice?: number
  /** Sale-unit snapshot fields. All optional for backwards compat. */
  saleUnitLabel?: string
  saleUnitFactor?: number
  sortOrder: number
}

export type ExportTransactionTemplate = {
  fingerprint: string
  name: string
  description: string
  isActive: boolean
  items: ExportTransactionTemplateItem[]
}

export type ExportTransactionLineItem = {
  itemRef: InventoryItemRef | null
  label: string
  price: number
  quantity: number
  unitPrice: number
  /** Sale-unit snapshot fields. All optional for backwards compat. */
  saleUnitLabel?: string
  saleUnitFactor?: number
  sortOrder: number
}

export type ExportTransaction = {
  fingerprint: string
  entryDate: string
  transactionTypeCode: string
  categoryRef: CategoryRef
  description: string
  amount: number
  staffCount: number | null
  customerRef: CustomerRef | null
  kg: number | null
  loads: number | null
  isLoyaltyReward: boolean
  createdAt: string
  updatedAt: string
  lineItems: ExportTransactionLineItem[]
}

export type ExportStaff = {
  fingerprint: string
  firstName: string
  middleName: string
  lastName: string
  address: string
  birthdate: string
  civilStatus: 'Single' | 'Married' | 'Widowed' | 'Separated'
  emergencyContactName: string
  emergencyContactNumber: string
  spouseName: string
  defaultRate: number
  isArchived: boolean
}

export type ExportStaffAttendance = {
  fingerprint: string
  staffRef: StaffRef
  attendanceDate: string
  status: string
  multiplier: number
  rateOverride: number | null
  computedPay: number
  notes: string
}

export type ExportStaffPayrollItem = {
  /** ISO date the day was worked. */
  entryDate: string
  status: string
  rateUsed: number
  multiplier: number
  payAmount: number
}

export type ExportStaffPayrollAdjustment = {
  label: string
  // Current exports write 'earning' | 'deduction'. Backups produced before the
  // export was fixed carry the legacy 'bonus' (== earning); the importer
  // normalizes it. See migration 25 in src-tauri/src/db.rs.
  kind: 'earning' | 'deduction' | 'bonus'
  amount: number
}

export type ExportStaffPayroll = {
  fingerprint: string
  staffRef: StaffRef
  periodStart: string
  periodEnd: string
  payDate: string
  cutoffDay: number
  grossPay: number
  totalAdjustments: number
  netPay: number
  status: 'paid' | 'void'
  notes: string
  items: ExportStaffPayrollItem[]
  adjustments: ExportStaffPayrollAdjustment[]
}

export type ExportStaffCashAdvance = {
  fingerprint: string
  staffRef: StaffRef
  advanceDate: string
  amount: number
  notes: string
  status: 'outstanding' | 'settled' | 'void'
}

export type ExportIncidentReport = {
  fingerprint: string
  incidentDate: string
  incidentTime: string
  staffOnDuty: string
  incidentType: string
  whatHappened: string
  customerName: string
  contactNumber: string
  actionTaken: string
  handledBy: string
  estimatedLoss: number
  quantity: number
  itemsInvolved: string
  remarks: string
  createdAt: string
}

export type ExportIncomeShareRule = {
  fingerprint: string
  name: string
  percentage: number
  isActive: boolean
}

export type ExportIncomeShareMonth = {
  fingerprint: string
  monthKey: string
  ruleName: string
  percentage: number
}

export type ExportSettings = {
  loyalty: {
    kgPerLoad: number
    freeAfterLoads: number
  }
  payroll: {
    cutoffDay: number
    holidayDefaultMultiplier: number
    autoDeductCashAdvances: boolean
  }
}

// ─── Top-level envelope ──────────────────────────────────────────────────────

export type BackupEntities = {
  transactionTypes: ExportTransactionType[]
  categories: ExportCategory[]
  customers: ExportCustomer[]
  inventoryCategories: ExportInventoryCategory[]
  inventoryItems: ExportInventoryItem[]
  inventoryMovements: ExportInventoryMovement[]
  inventoryMaintenanceRecords: ExportInventoryMaintenance[]
  transactionTemplates: ExportTransactionTemplate[]
  transactions: ExportTransaction[]
  staff: ExportStaff[]
  staffAttendance: ExportStaffAttendance[]
  staffPayrolls: ExportStaffPayroll[]
  staffCashAdvances: ExportStaffCashAdvance[]
  incidentReports: ExportIncidentReport[]
  incomeShareRules: ExportIncomeShareRule[]
  incomeShareMonthlyVersions: ExportIncomeShareMonth[]
  settings: ExportSettings
}

export type BackupFile = {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  schemaVersion: number
  businessId: BusinessId
  exportedAt: string
  appVersion: string
  /** sha-256 (hex) of the canonical-JSON serialization of `entities`. */
  checksum: string
  counts: Partial<Record<EntityKey, number>>
  entities: BackupEntities
}

// ─── Identifying every entity by a stable string key ────────────────────────

export type EntityKey =
  | 'transactionTypes'
  | 'categories'
  | 'customers'
  | 'inventoryCategories'
  | 'inventoryItems'
  | 'inventoryMovements'
  | 'inventoryMaintenanceRecords'
  | 'transactionTemplates'
  | 'transactions'
  | 'staff'
  | 'staffAttendance'
  | 'staffPayrolls'
  | 'staffCashAdvances'
  | 'incidentReports'
  | 'incomeShareRules'
  | 'incomeShareMonthlyVersions'
  | 'settings'

export const ENTITY_LABELS: Record<EntityKey, string> = {
  transactionTypes: 'Transaction types',
  categories: 'Categories',
  customers: 'Customers',
  inventoryCategories: 'Inventory categories',
  inventoryItems: 'Inventory items',
  inventoryMovements: 'Inventory movements',
  inventoryMaintenanceRecords: 'Maintenance records',
  transactionTemplates: 'Templates',
  transactions: 'Transactions',
  staff: 'Staff',
  staffAttendance: 'Attendance',
  staffPayrolls: 'Payrolls',
  staffCashAdvances: 'Cash advances',
  incidentReports: 'Incident reports',
  incomeShareRules: 'Income share rules',
  incomeShareMonthlyVersions: 'Income share months',
  settings: 'App settings',
}

/** Apply order — parents first so children always have a target to point at. */
export const ENTITY_APPLY_ORDER: EntityKey[] = [
  'transactionTypes',
  'categories',
  'inventoryCategories',
  'inventoryItems',
  'customers',
  'transactionTemplates',
  'staff',
  'incomeShareRules',
  'transactions',
  'inventoryMovements',
  'inventoryMaintenanceRecords',
  'staffAttendance',
  'staffPayrolls',
  'staffCashAdvances',
  'incidentReports',
  'incomeShareMonthlyVersions',
  'settings',
]

// ─── Validation / planner / summary types ───────────────────────────────────

export type ValidationIssue = {
  severity: 'error' | 'warning'
  /** Free-form message shown in the dialog. */
  message: string
  entity?: EntityKey
  fingerprint?: string
}

/** What the importer plans to do with one row. */
export type PlanItemKind =
  | 'insert'
  | 'update' // identical-key match exists locally and incoming differs (this is a "conflict" in UI; auto-applied if user picks "Overwrite")
  | 'skipIdentical' // identical-key match exists and every other field equals the incoming row; nothing to do
  | 'orphan' // a required parent reference is missing both in the file and the local DB
  | 'invalid' // failed per-row schema validation; never applied

export type PlanItem = {
  fingerprint: string
  kind: PlanItemKind
  /** Human-readable summary of the row, e.g. "ABC Laundry · 2026-04-15 · ₱500". */
  label: string
  /** Field-by-field diff between local and incoming, only filled when kind = 'update'. */
  diff?: Array<{ field: string; localValue: unknown; incomingValue: unknown }>
  /** Reason text for orphan / invalid kinds. */
  reason?: string
}

export type EntityPlan = {
  insert: PlanItem[]
  /** "Conflicts" — matches with differences requiring the user's per-row decision. */
  update: PlanItem[]
  skipIdentical: PlanItem[]
  orphan: PlanItem[]
  invalid: PlanItem[]
}

export type ImportPlan = {
  file: BackupFile
  perEntity: Record<EntityKey, EntityPlan>
}

export type ConflictResolution = 'skip' | 'overwrite'

/**
 * User decisions for every conflicting row, keyed by `${entity}:${fingerprint}`.
 * Conflicts default to "skip" until the user chooses; the apply button stays
 * disabled until every conflict has an explicit decision.
 */
export type ResolutionMap = Record<string, ConflictResolution>

export type EntitySummary = {
  inserted: number
  updated: number
  /** Skipped because an identical local row already exists. */
  skippedIdentical: number
  /** Skipped because the user chose "Skip" on a conflicting row. */
  skippedByUser: number
  /** Skipped because a parent reference could not be resolved. */
  skippedOrphan: number
  /** Skipped because per-row schema validation failed. */
  skippedInvalid: number
  failed: number
  /** Per-row error messages collected during apply. */
  errors: Array<{ fingerprint: string; label: string; message: string }>
}

export type ImportSummary = {
  startedAt: string
  finishedAt: string
  fileName: string | null
  perEntity: Record<EntityKey, EntitySummary>
  /** True when no `failed` counts are above zero. */
  ok: boolean
}

export function emptyEntitySummary(): EntitySummary {
  return {
    inserted: 0,
    updated: 0,
    skippedIdentical: 0,
    skippedByUser: 0,
    skippedOrphan: 0,
    skippedInvalid: 0,
    failed: 0,
    errors: [],
  }
}

export function emptyEntityPlan(): EntityPlan {
  return {
    insert: [],
    update: [],
    skipIdentical: [],
    orphan: [],
    invalid: [],
  }
}

export function makeResolutionKey(entity: EntityKey, fingerprint: string) {
  return `${entity}:${fingerprint}`
}
