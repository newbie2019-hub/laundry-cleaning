// Pulls every operational row from the active SQLite database, denormalizes
// foreign-key ids into natural-key references, attaches a deterministic
// fingerprint per row, computes an envelope checksum, and writes the whole
// thing to a single timestamped JSON file in the user's Downloads folder.
//
// Auth tables (`users`, `roles`, `permissions`, `role_permissions`,
// `user_roles`) are intentionally NOT included.

import { format } from 'date-fns'
import { getActiveBusinessId, BUSINESSES } from '../../lib/db/business'
import { getDatabase } from '../../lib/db/client'
import { saveBytesWithDialog } from '../../lib/save-file-download'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  SUPPORTED_SCHEMA_VERSION,
  type BackupEntities,
  type BackupFile,
  type CategoryRef,
  type CustomerRef,
  type EntityKey,
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
  type ExportStaffPayrollAdjustment,
  type ExportStaffPayrollItem,
  type ExportTransaction,
  type ExportTransactionLineItem,
  type ExportTransactionTemplate,
  type ExportTransactionTemplateItem,
  type ExportTransactionType,
  type InventoryItemRef,
  type StaffRef,
} from './backup-types'

// ─── Hashing helpers ─────────────────────────────────────────────────────────

const textEncoder = new TextEncoder()

/** Lowercase hex sha-256 of an ArrayBuffer view; uses browser/Tauri WebCrypto. */
async function sha256Hex(input: ArrayBufferView | ArrayBuffer): Promise<string> {
  const data =
    input instanceof ArrayBuffer
      ? input
      : (input.buffer.slice(
          input.byteOffset,
          input.byteOffset + input.byteLength,
        ) as ArrayBuffer)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(hashBuf)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

/**
 * Stable JSON: sorts object keys recursively before stringifying so two
 * inputs with the same fields-but-different-order produce identical bytes.
 * This matters because the fingerprint and envelope checksum must be
 * byte-stable across machines.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const out: Record<string, unknown> = {}
  const keys = Object.keys(value as Record<string, unknown>).sort()
  for (const k of keys) {
    out[k] = canonicalize((value as Record<string, unknown>)[k])
  }
  return out
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export async function fingerprint(parts: unknown[]): Promise<string> {
  // Prefix with a short tag so two different entity types with coincidentally
  // identical natural-key tuples cannot collide in the same Map.
  return sha256Hex(textEncoder.encode(canonicalJson(parts)))
}

// ─── Helper to normalise comparable values ───────────────────────────────────

function lower(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function asNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function asString(value: unknown): string {
  return value == null ? '' : String(value)
}

function asBool(value: unknown): boolean {
  return Boolean(asNumber(value))
}

// ─── Per-entity loaders (raw SQL — kept here so repository.ts stays small) ──

type RawTransactionType = {
  id: number
  code: string
  label: string
  isSystem: number
}

type RawCategory = {
  id: number
  transactionTypeCode: string
  label: string
  isSeeded: number
  isArchived: number
  isLoadable: number
}

type RawCustomer = {
  id: number
  name: string
  company: string
  email: string
  phone: string
  isArchived: number
  isLoyaltyEnabled: number
}

type RawInventoryCategory = {
  id: number
  code: string
  label: string
  isSystem: number
  isActive: number
  sortOrder: number
}

type RawInventoryItem = {
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

type RawInventoryMovement = {
  id: number
  itemName: string
  movementType: 'IN' | 'OUT' | string
  quantity: number
  unitCost: number
  notes: string
  movementDate: string
  createdAt: string
  /** DB foreign key to transactions.id — null for manual stock adjustments. */
  transactionId: number | null
}

type RawInventoryMaintenance = {
  id: number
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

type RawTransaction = {
  id: number
  entryDate: string
  transactionTypeCode: string
  categoryLabel: string
  description: string
  amount: number
  staffCount: number | null
  customerName: string | null
  customerPhone: string | null
  kg: number | null
  loads: number | null
  isLoyaltyReward: number
  createdAt: string
  updatedAt: string
}

type RawTransactionLineItem = {
  transactionId: number
  itemName: string | null
  label: string
  price: number
  quantity: number | null
  unitPrice: number | null
  saleUnitLabel: string | null
  saleUnitFactor: number | null
  sortOrder: number
}

type RawTemplate = {
  id: number
  name: string
  description: string
  isActive: number
}

type RawTemplateItem = {
  templateId: number
  itemName: string
  quantity: number
  unitPrice: number
  saleUnitLabel: string | null
  saleUnitFactor: number | null
  sortOrder: number
}

type RawInventoryItemUnit = {
  itemId: number
  unitLabel: string
  unitsPerBase: number
  unitPrice: number
  sortOrder: number
  isActive: number
}

type RawStaff = {
  id: number
  firstName: string
  middleName: string
  lastName: string
  birthdate: string
  address: string
  civilStatus: string
  emergencyContactName: string
  emergencyContactNumber: string
  spouseName: string
  defaultRate: number
  isArchived: number
}

type RawAttendance = {
  id: number
  staffFirstName: string
  staffMiddleName: string
  staffLastName: string
  staffBirthdate: string
  attendanceDate: string
  status: string
  multiplier: number
  rateOverride: number | null
  computedPay: number
  notes: string
}

type RawPayroll = {
  id: number
  staffFirstName: string
  staffMiddleName: string
  staffLastName: string
  staffBirthdate: string
  periodStart: string
  periodEnd: string
  payDate: string
  cutoffDay: number
  grossPay: number
  totalAdjustments: number
  netPay: number
  status: string
  notes: string
}

type RawPayrollItem = {
  payrollId: number
  entryDate: string
  status: string
  rateUsed: number
  multiplier: number
  payAmount: number
}

type RawPayrollAdjustment = {
  payrollId: number
  label: string
  kind: string
  amount: number
}

type RawCashAdvance = {
  id: number
  staffFirstName: string
  staffMiddleName: string
  staffLastName: string
  staffBirthdate: string
  advanceDate: string
  amount: number
  notes: string
  status: string
}

type RawIncidentReport = {
  id: number
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

type RawIncomeShareRule = {
  id: number
  name: string
  percentage: number
  isActive: number
}

type RawIncomeShareMonth = {
  monthKey: string
  ruleName: string
  percentage: number
}

// ─── The actual export ──────────────────────────────────────────────────────

function makeFilename(): string {
  const businessId = getActiveBusinessId()
  const stamp = format(new Date(), 'yyyy-MM-dd-HHmm')
  return `business-ledger-${businessId}-${stamp}.json`
}

export type ExportResult = {
  status: 'saved' | 'cancelled'
  filename: string
  byteLength: number
  counts: Partial<Record<EntityKey, number>>
}

/**
 * Build a `BackupFile` object from the active business's database, prompt the
 * user for a destination via a native "Save As" dialog, write it as a single
 * JSON file, and return some metadata about it. If the user dismisses the
 * dialog, `status` is `'cancelled'` and nothing is written.
 */
export async function exportActiveBusinessToJson(): Promise<ExportResult> {
  const file = await buildBackupFile()
  const filename = makeFilename()
  const bytes = textEncoder.encode(JSON.stringify(file, null, 2))
  const status = await saveBytesWithDialog(filename, bytes, 'application/json', [
    { name: 'JSON Backup', extensions: ['json'] },
  ])
  return {
    status,
    filename,
    byteLength: bytes.byteLength,
    counts: file.counts,
  }
}

/**
 * Build the in-memory `BackupFile` without writing it. Exposed separately so
 * tests / future call sites can hand it off to e.g. a clipboard or a
 * different storage target.
 */
export async function buildBackupFile(): Promise<BackupFile> {
  const businessId = getActiveBusinessId()
  const business = BUSINESSES[businessId]
  void business

  const entities = await loadEntities()

  const counts: Partial<Record<EntityKey, number>> = {
    transactionTypes: entities.transactionTypes.length,
    categories: entities.categories.length,
    customers: entities.customers.length,
    inventoryCategories: entities.inventoryCategories.length,
    inventoryItems: entities.inventoryItems.length,
    inventoryMovements: entities.inventoryMovements.length,
    inventoryMaintenanceRecords: entities.inventoryMaintenanceRecords.length,
    transactionTemplates: entities.transactionTemplates.length,
    transactions: entities.transactions.length,
    staff: entities.staff.length,
    staffAttendance: entities.staffAttendance.length,
    staffPayrolls: entities.staffPayrolls.length,
    staffCashAdvances: entities.staffCashAdvances.length,
    incidentReports: entities.incidentReports.length,
    incomeShareRules: entities.incomeShareRules.length,
    incomeShareMonthlyVersions: entities.incomeShareMonthlyVersions.length,
    settings: 1,
  }

  const checksum = await sha256Hex(textEncoder.encode(canonicalJson(entities)))

  const exportedAt = new Date().toISOString()

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    businessId,
    exportedAt,
    appVersion: '0.1.0',
    checksum,
    counts,
    entities,
  }
}

// ─── Loading + denormalizing every entity ───────────────────────────────────

async function loadEntities(): Promise<BackupEntities> {
  const db = await getDatabase()

  const [
    transactionTypes,
    categories,
    customers,
    inventoryCategories,
    inventoryItems,
    inventoryMovements,
    inventoryMaintenanceRecords,
    templates,
    templateItems,
    transactions,
    transactionLineItems,
    staff,
    attendance,
    payrolls,
    payrollItems,
    payrollAdjustments,
    cashAdvances,
    incidentReports,
    incomeShareRules,
    incomeShareMonthlyVersions,
    loyaltySettings,
    payrollSettings,
  ] = await Promise.all([
    db.select<RawTransactionType[]>(
      `SELECT id, code, label, is_system AS isSystem FROM transaction_types ORDER BY id`,
    ),
    db.select<RawCategory[]>(
      `
        SELECT
          c.id AS id,
          tt.code AS transactionTypeCode,
          c.label AS label,
          c.is_seeded AS isSeeded,
          c.is_archived AS isArchived,
          c.is_loadable AS isLoadable
        FROM categories c
        JOIN transaction_types tt ON tt.id = c.transaction_type_id
        ORDER BY c.id
      `,
    ),
    db.select<RawCustomer[]>(
      `
        SELECT
          id, name, company, email, phone,
          is_archived AS isArchived,
          is_loyalty_enabled AS isLoyaltyEnabled
        FROM customers
        ORDER BY id
      `,
    ),
    db.select<RawInventoryCategory[]>(
      `
        SELECT
          id, code, label,
          is_system AS isSystem,
          is_active AS isActive,
          sort_order AS sortOrder
        FROM inventory_categories
        ORDER BY id
      `,
    ),
    db.select<RawInventoryItem[]>(
      `
        SELECT
          i.id AS id,
          i.name AS name,
          i.description AS description,
          i.unit_type AS unitType,
          i.unit_label AS unitLabel,
          i.cost_per_unit AS costPerUnit,
          i.selling_price AS sellingPrice,
          i.is_active AS isActive,
          i.low_stock_threshold AS lowStockThreshold,
          COALESCE(c.code, lc.code, i.category, 'other') AS categoryCode,
          i.supplier AS supplier,
          i.status AS status,
          i.last_maintenance_date AS lastMaintenanceDate
        FROM inventory_items i
        LEFT JOIN inventory_categories c ON c.id = i.category_id
        LEFT JOIN inventory_categories lc ON lc.code = i.category
        ORDER BY i.id
      `,
    ),
    db.select<RawInventoryMovement[]>(
      `
        SELECT
          m.id AS id,
          i.name AS itemName,
          m.movement_type AS movementType,
          m.quantity AS quantity,
          m.unit_cost AS unitCost,
          m.notes AS notes,
          m.movement_date AS movementDate,
          m.created_at AS createdAt,
          m.transaction_id AS transactionId
        FROM inventory_movements m
        JOIN inventory_items i ON i.id = m.item_id
        ORDER BY m.id
      `,
    ),
    db.select<RawInventoryMaintenance[]>(
      `
        SELECT
          mr.id AS id,
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
        ORDER BY mr.id
      `,
    ),
    db.select<RawTemplate[]>(
      `SELECT id, name, description, is_active AS isActive FROM transaction_templates ORDER BY id`,
    ),
    db.select<RawTemplateItem[]>(
      `
        SELECT
          ti.template_id AS templateId,
          i.name AS itemName,
          ti.quantity AS quantity,
          ti.unit_price AS unitPrice,
          ti.sale_unit_label AS saleUnitLabel,
          ti.sale_unit_factor AS saleUnitFactor,
          ti.sort_order AS sortOrder
        FROM transaction_template_items ti
        JOIN inventory_items i ON i.id = ti.inventory_item_id
        ORDER BY ti.template_id, ti.sort_order, ti.id
      `,
    ),
    db.select<RawTransaction[]>(
      `
        SELECT
          t.id AS id,
          t.entry_date AS entryDate,
          tt.code AS transactionTypeCode,
          c.label AS categoryLabel,
          t.description AS description,
          t.amount AS amount,
          t.staff_count AS staffCount,
          cust.name AS customerName,
          cust.phone AS customerPhone,
          t.kg AS kg,
          t.loads AS loads,
          t.is_loyalty_reward AS isLoyaltyReward,
          t.created_at AS createdAt,
          t.updated_at AS updatedAt
        FROM transactions t
        JOIN transaction_types tt ON tt.id = t.transaction_type_id
        JOIN categories c ON c.id = t.category_id
        LEFT JOIN customers cust ON cust.id = t.customer_id
        ORDER BY t.id
      `,
    ),
    db.select<RawTransactionLineItem[]>(
      `
        SELECT
          li.transaction_id AS transactionId,
          i.name AS itemName,
          li.label AS label,
          li.price AS price,
          li.quantity AS quantity,
          li.unit_price AS unitPrice,
          li.sale_unit_label AS saleUnitLabel,
          li.sale_unit_factor AS saleUnitFactor,
          li.sort_order AS sortOrder
        FROM transaction_line_items li
        LEFT JOIN inventory_items i ON i.id = li.inventory_item_id
        ORDER BY li.transaction_id, li.sort_order, li.id
      `,
    ),
    db.select<RawStaff[]>(
      `
        SELECT
          id,
          first_name AS firstName,
          middle_name AS middleName,
          last_name AS lastName,
          birthdate,
          address,
          civil_status AS civilStatus,
          emergency_contact_name AS emergencyContactName,
          emergency_contact_number AS emergencyContactNumber,
          spouse_name AS spouseName,
          default_rate AS defaultRate,
          is_archived AS isArchived
        FROM staff
        ORDER BY id
      `,
    ),
    db.select<RawAttendance[]>(
      `
        SELECT
          a.id AS id,
          s.first_name AS staffFirstName,
          s.middle_name AS staffMiddleName,
          s.last_name AS staffLastName,
          s.birthdate AS staffBirthdate,
          a.attendance_date AS attendanceDate,
          a.status AS status,
          a.multiplier AS multiplier,
          a.rate_override AS rateOverride,
          a.computed_pay AS computedPay,
          a.notes AS notes
        FROM staff_attendance a
        JOIN staff s ON s.id = a.staff_id
        ORDER BY a.id
      `,
    ),
    db.select<RawPayroll[]>(
      `
        SELECT
          p.id AS id,
          s.first_name AS staffFirstName,
          s.middle_name AS staffMiddleName,
          s.last_name AS staffLastName,
          s.birthdate AS staffBirthdate,
          p.period_start AS periodStart,
          p.period_end AS periodEnd,
          p.pay_date AS payDate,
          p.cutoff_day AS cutoffDay,
          p.gross_pay AS grossPay,
          p.total_adjustments AS totalAdjustments,
          p.net_pay AS netPay,
          p.status AS status,
          p.notes AS notes
        FROM staff_payrolls p
        JOIN staff s ON s.id = p.staff_id
        ORDER BY p.id
      `,
    ),
    db.select<RawPayrollItem[]>(
      `
        SELECT
          payroll_id AS payrollId,
          entry_date AS entryDate,
          status,
          rate_used AS rateUsed,
          multiplier,
          pay_amount AS payAmount
        FROM staff_payroll_items
        ORDER BY payroll_id, entry_date, id
      `,
    ),
    db.select<RawPayrollAdjustment[]>(
      `
        SELECT
          payroll_id AS payrollId,
          label,
          kind,
          amount
        FROM staff_payroll_adjustments
        ORDER BY payroll_id, id
      `,
    ),
    db.select<RawCashAdvance[]>(
      `
        SELECT
          ca.id AS id,
          s.first_name AS staffFirstName,
          s.middle_name AS staffMiddleName,
          s.last_name AS staffLastName,
          s.birthdate AS staffBirthdate,
          ca.advance_date AS advanceDate,
          ca.amount AS amount,
          ca.notes AS notes,
          ca.status AS status
        FROM staff_cash_advances ca
        JOIN staff s ON s.id = ca.staff_id
        ORDER BY ca.id
      `,
    ),
    db.select<RawIncidentReport[]>(
      `
        SELECT
          id,
          incident_date AS incidentDate,
          incident_time AS incidentTime,
          staff_on_duty AS staffOnDuty,
          incident_type AS incidentType,
          what_happened AS whatHappened,
          customer_name AS customerName,
          contact_number AS contactNumber,
          action_taken AS actionTaken,
          handled_by AS handledBy,
          estimated_loss AS estimatedLoss,
          quantity AS quantity,
          items_involved AS itemsInvolved,
          remarks AS remarks,
          created_at AS createdAt
        FROM incident_reports
        ORDER BY id
      `,
    ),
    db.select<RawIncomeShareRule[]>(
      `SELECT id, name, percentage, is_active AS isActive FROM income_share_rules ORDER BY id`,
    ),
    db.select<RawIncomeShareMonth[]>(
      `
        SELECT
          v.month_key AS monthKey,
          r.name AS ruleName,
          v.percentage AS percentage
        FROM income_share_monthly_versions v
        JOIN income_share_rules r ON r.id = v.rule_id
        ORDER BY v.month_key, r.id
      `,
    ),
    db.select<Array<{ kgPerLoad: number; freeAfterLoads: number }>>(
      `SELECT kg_per_load AS kgPerLoad, free_after_loads AS freeAfterLoads FROM loyalty_settings WHERE id = 1`,
    ),
    db.select<
      Array<{
        cutoffDay: number
        holidayDefaultMultiplier: number
        autoDeductCashAdvances: number
      }>
    >(
      `
        SELECT
          cutoff_day AS cutoffDay,
          holiday_default_multiplier AS holidayDefaultMultiplier,
          auto_deduct_cash_advances AS autoDeductCashAdvances
        FROM payroll_settings
        WHERE id = 1
      `,
    ),
  ])

  // ─── Group children by parent id (since we strip ids on output) ──────────

  const lineItemsByTxn = new Map<number, RawTransactionLineItem[]>()
  for (const li of transactionLineItems) {
    const list = lineItemsByTxn.get(li.transactionId) ?? []
    list.push(li)
    lineItemsByTxn.set(li.transactionId, list)
  }

  const templateItemsById = new Map<number, RawTemplateItem[]>()
  for (const ti of templateItems) {
    const list = templateItemsById.get(ti.templateId) ?? []
    list.push(ti)
    templateItemsById.set(ti.templateId, list)
  }

  // Alt sale-unit definitions per inventory item. Loaded separately because
  // they were added in v23 and the rest of the inventory query is shared with
  // older readers.
  const inventoryItemUnits = await db.select<RawInventoryItemUnit[]>(
    `
      SELECT
        item_id AS itemId,
        unit_label AS unitLabel,
        units_per_base AS unitsPerBase,
        unit_price AS unitPrice,
        sort_order AS sortOrder,
        is_active AS isActive
      FROM inventory_item_units
      ORDER BY item_id, sort_order, unit_label
    `,
  )
  const altUnitsByItemId = new Map<number, RawInventoryItemUnit[]>()
  for (const u of inventoryItemUnits) {
    const list = altUnitsByItemId.get(u.itemId) ?? []
    list.push(u)
    altUnitsByItemId.set(u.itemId, list)
  }

  const payrollItemsById = new Map<number, RawPayrollItem[]>()
  for (const it of payrollItems) {
    const list = payrollItemsById.get(it.payrollId) ?? []
    list.push(it)
    payrollItemsById.set(it.payrollId, list)
  }

  const adjustmentsById = new Map<number, RawPayrollAdjustment[]>()
  for (const adj of payrollAdjustments) {
    const list = adjustmentsById.get(adj.payrollId) ?? []
    list.push(adj)
    adjustmentsById.set(adj.payrollId, list)
  }

  // ─── Build the final shape with fingerprints ─────────────────────────────

  // Build a transaction DB-id → fingerprint map so each inventory movement
  // can record which transaction created it. This lets the importer restore
  // the transaction_id link even though the DB ids differ across devices.
  const builtTransactions = await Promise.all(
    transactions.map((t) => buildTransaction(t, lineItemsByTxn.get(t.id) ?? [])),
  )
  const transactionFpByDbId = new Map<number, string>()
  for (let i = 0; i < transactions.length; i++) {
    transactionFpByDbId.set(transactions[i].id, builtTransactions[i].fingerprint)
  }

  const out: BackupEntities = {
    transactionTypes: await Promise.all(
      transactionTypes.map(async (r) => buildTransactionType(r)),
    ),
    categories: await Promise.all(categories.map(buildCategory)),
    customers: await Promise.all(customers.map(buildCustomer)),
    inventoryCategories: await Promise.all(
      inventoryCategories.map(buildInventoryCategory),
    ),
    inventoryItems: await Promise.all(
      inventoryItems.map((r) => buildInventoryItem(r, altUnitsByItemId.get(r.id) ?? [])),
    ),
    inventoryMovements: await Promise.all(
      inventoryMovements.map((r) => buildInventoryMovement(r, transactionFpByDbId)),
    ),
    inventoryMaintenanceRecords: await Promise.all(
      inventoryMaintenanceRecords.map(buildInventoryMaintenance),
    ),
    transactionTemplates: await Promise.all(
      templates.map((t) => buildTemplate(t, templateItemsById.get(t.id) ?? [])),
    ),
    transactions: builtTransactions,
    staff: await Promise.all(staff.map(buildStaff)),
    staffAttendance: await Promise.all(attendance.map(buildAttendance)),
    staffPayrolls: await Promise.all(
      payrolls.map((p) =>
        buildPayroll(p, payrollItemsById.get(p.id) ?? [], adjustmentsById.get(p.id) ?? []),
      ),
    ),
    staffCashAdvances: await Promise.all(cashAdvances.map(buildCashAdvance)),
    incidentReports: await Promise.all(incidentReports.map(buildIncidentReport)),
    incomeShareRules: await Promise.all(incomeShareRules.map(buildIncomeShareRule)),
    incomeShareMonthlyVersions: await Promise.all(
      incomeShareMonthlyVersions.map(buildIncomeShareMonth),
    ),
    settings: buildSettings(loyaltySettings[0], payrollSettings[0]),
  }

  return out
}

// ─── Per-row builders (these define the canonical fingerprint identity) ──────

async function buildTransactionType(r: RawTransactionType): Promise<ExportTransactionType> {
  return {
    fingerprint: await fingerprint(['transactionType', r.code]),
    code: r.code,
    label: r.label,
    isSystem: asBool(r.isSystem),
  }
}

async function buildCategory(r: RawCategory): Promise<ExportCategory> {
  return {
    fingerprint: await fingerprint(['category', r.transactionTypeCode, lower(r.label)]),
    transactionTypeCode: r.transactionTypeCode,
    label: r.label,
    isSeeded: asBool(r.isSeeded),
    isArchived: asBool(r.isArchived),
    isLoadable: asBool(r.isLoadable),
  }
}

async function buildCustomer(r: RawCustomer): Promise<ExportCustomer> {
  return {
    fingerprint: await fingerprint(['customer', lower(r.name), asString(r.phone).trim()]),
    name: r.name,
    company: asString(r.company),
    email: asString(r.email),
    phone: asString(r.phone),
    isArchived: asBool(r.isArchived),
    isLoyaltyEnabled: asBool(r.isLoyaltyEnabled),
  }
}

async function buildInventoryCategory(
  r: RawInventoryCategory,
): Promise<ExportInventoryCategory> {
  return {
    fingerprint: await fingerprint(['inventoryCategory', r.code]),
    code: r.code,
    label: r.label,
    isSystem: asBool(r.isSystem),
    isActive: asBool(r.isActive),
    sortOrder: asNumber(r.sortOrder),
  }
}

async function buildInventoryItem(
  r: RawInventoryItem,
  altUnits: RawInventoryItemUnit[],
): Promise<ExportInventoryItem> {
  return {
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
    ...(altUnits.length > 0
      ? {
          altUnits: altUnits.map((u) => ({
            unitLabel: asString(u.unitLabel),
            unitsPerBase: asNumber(u.unitsPerBase),
            unitPrice: asNumber(u.unitPrice),
            sortOrder: asNumber(u.sortOrder),
            isActive: asBool(u.isActive),
          })),
        }
      : {}),
  }
}

async function buildInventoryMovement(
  r: RawInventoryMovement,
  transactionFpByDbId: Map<number, string>,
): Promise<ExportInventoryMovement> {
  const ref: InventoryItemRef = { name: r.itemName }
  const transactionRef =
    r.transactionId != null ? (transactionFpByDbId.get(r.transactionId) ?? null) : null
  return {
    fingerprint: await fingerprint([
      'inventoryMovement',
      lower(r.itemName),
      r.movementDate,
      r.movementType,
      asNumber(r.quantity),
      asNumber(r.unitCost),
      asString(r.notes).trim(),
    ]),
    itemRef: ref,
    movementType: r.movementType === 'IN' || r.movementType === 'OUT' ? r.movementType : 'IN',
    quantity: asNumber(r.quantity),
    unitCost: asNumber(r.unitCost),
    notes: asString(r.notes),
    movementDate: r.movementDate,
    createdAt: asString(r.createdAt),
    transactionRef,
  }
}

async function buildInventoryMaintenance(
  r: RawInventoryMaintenance,
): Promise<ExportInventoryMaintenance> {
  const ref: InventoryItemRef = { name: r.itemName }
  return {
    fingerprint: await fingerprint([
      'inventoryMaintenance',
      lower(r.itemName),
      r.serviceDate,
      asString(r.serviceType),
      asString(r.performedBy),
    ]),
    itemRef: ref,
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
  }
}

async function buildTemplate(
  r: RawTemplate,
  items: RawTemplateItem[],
): Promise<ExportTransactionTemplate> {
  return {
    fingerprint: await fingerprint(['template', r.name]),
    name: r.name,
    description: asString(r.description),
    isActive: asBool(r.isActive),
    items: items.map<ExportTransactionTemplateItem>((it) => {
      const factor =
        it.saleUnitFactor != null && Number.isFinite(it.saleUnitFactor) && it.saleUnitFactor > 0
          ? Number(it.saleUnitFactor)
          : 1
      const altLabel = asString(it.saleUnitLabel ?? '')
      return {
        itemRef: { name: it.itemName },
        quantity: asNumber(it.quantity),
        ...(altLabel !== '' || factor !== 1
          ? { saleUnitFactor: factor, saleUnitLabel: altLabel }
          : {}),
        sortOrder: asNumber(it.sortOrder),
        unitPrice: asNumber(it.unitPrice),
      }
    }),
  }
}

async function buildTransaction(
  r: RawTransaction,
  lineItems: RawTransactionLineItem[],
): Promise<ExportTransaction> {
  const categoryRef: CategoryRef = {
    transactionTypeCode: r.transactionTypeCode,
    label: r.categoryLabel,
  }
  const customerRef: CustomerRef | null =
    r.customerName != null
      ? { name: r.customerName, phone: asString(r.customerPhone) }
      : null

  // The transaction fingerprint is the user's "transaction id". Includes
  // every field the user can see in a transaction so that *truly* identical
  // entries dedup cleanly while ones that differ in ANY user-visible field
  // are surfaced as conflicts.
  const fp = await fingerprint([
    'transaction',
    r.entryDate,
    r.transactionTypeCode,
    lower(r.categoryLabel),
    asNumber(r.amount).toFixed(2),
    asString(r.description).trim(),
    customerRef ? lower(customerRef.name) : '',
    customerRef ? customerRef.phone.trim() : '',
    asNullableNumber(r.kg)?.toString() ?? '',
    asNullableNumber(r.loads)?.toString() ?? '',
    asBool(r.isLoyaltyReward) ? '1' : '0',
  ])

  return {
    fingerprint: fp,
    entryDate: r.entryDate,
    transactionTypeCode: r.transactionTypeCode,
    categoryRef,
    description: asString(r.description),
    amount: asNumber(r.amount),
    staffCount: asNullableNumber(r.staffCount),
    customerRef,
    kg: asNullableNumber(r.kg),
    loads: asNullableNumber(r.loads),
    isLoyaltyReward: asBool(r.isLoyaltyReward),
    createdAt: asString(r.createdAt),
    updatedAt: asString(r.updatedAt),
    lineItems: lineItems.map<ExportTransactionLineItem>((li) => {
      const factor =
        li.saleUnitFactor != null && Number.isFinite(li.saleUnitFactor) && li.saleUnitFactor > 0
          ? Number(li.saleUnitFactor)
          : 1
      const altLabel = asString(li.saleUnitLabel ?? '')
      return {
        itemRef: li.itemName != null ? { name: li.itemName } : null,
        label: asString(li.label),
        price: asNumber(li.price),
        quantity: asNumber(li.quantity ?? 1) || 1,
        // Only emit when not the default base-unit pair to keep older readers
        // happy (they ignore unknown fields anyway, but this stays compact).
        ...(altLabel !== '' || factor !== 1
          ? { saleUnitFactor: factor, saleUnitLabel: altLabel }
          : {}),
        sortOrder: asNumber(li.sortOrder),
        unitPrice: asNumber(li.unitPrice ?? li.price),
      }
    }),
  }
}

async function buildStaff(r: RawStaff): Promise<ExportStaff> {
  return {
    fingerprint: await fingerprint([
      'staff',
      lower(r.firstName),
      lower(r.middleName),
      lower(r.lastName),
      asString(r.birthdate),
    ]),
    firstName: asString(r.firstName),
    middleName: asString(r.middleName),
    lastName: asString(r.lastName),
    address: asString(r.address),
    birthdate: asString(r.birthdate),
    civilStatus:
      r.civilStatus === 'Single' ||
      r.civilStatus === 'Married' ||
      r.civilStatus === 'Widowed' ||
      r.civilStatus === 'Separated'
        ? r.civilStatus
        : 'Single',
    emergencyContactName: asString(r.emergencyContactName),
    emergencyContactNumber: asString(r.emergencyContactNumber),
    spouseName: asString(r.spouseName),
    defaultRate: asNumber(r.defaultRate),
    isArchived: asBool(r.isArchived),
  }
}

async function buildAttendance(r: RawAttendance): Promise<ExportStaffAttendance> {
  const staffRef: StaffRef = {
    firstName: asString(r.staffFirstName),
    middleName: asString(r.staffMiddleName),
    lastName: asString(r.staffLastName),
    birthdate: asString(r.staffBirthdate),
  }
  return {
    fingerprint: await fingerprint([
      'attendance',
      lower(staffRef.firstName),
      lower(staffRef.middleName),
      lower(staffRef.lastName),
      staffRef.birthdate,
      r.attendanceDate,
    ]),
    staffRef,
    attendanceDate: r.attendanceDate,
    status: asString(r.status),
    multiplier: asNumber(r.multiplier),
    rateOverride: asNullableNumber(r.rateOverride),
    computedPay: asNumber(r.computedPay),
    notes: asString(r.notes),
  }
}

async function buildPayroll(
  r: RawPayroll,
  items: RawPayrollItem[],
  adjustments: RawPayrollAdjustment[],
): Promise<ExportStaffPayroll> {
  const staffRef: StaffRef = {
    firstName: asString(r.staffFirstName),
    middleName: asString(r.staffMiddleName),
    lastName: asString(r.staffLastName),
    birthdate: asString(r.staffBirthdate),
  }
  return {
    fingerprint: await fingerprint([
      'payroll',
      lower(staffRef.firstName),
      lower(staffRef.middleName),
      lower(staffRef.lastName),
      staffRef.birthdate,
      r.periodStart,
      r.periodEnd,
    ]),
    staffRef,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    payDate: r.payDate,
    cutoffDay: asNumber(r.cutoffDay),
    grossPay: asNumber(r.grossPay),
    totalAdjustments: asNumber(r.totalAdjustments),
    netPay: asNumber(r.netPay),
    status: r.status === 'paid' || r.status === 'void' ? r.status : 'paid',
    notes: asString(r.notes),
    items: items.map<ExportStaffPayrollItem>((it) => ({
      entryDate: it.entryDate,
      status: asString(it.status),
      rateUsed: asNumber(it.rateUsed),
      multiplier: asNumber(it.multiplier),
      payAmount: asNumber(it.payAmount),
    })),
    adjustments: adjustments.map<ExportStaffPayrollAdjustment>((a) => ({
      label: asString(a.label),
      kind: a.kind === 'deduction' ? 'deduction' : 'earning',
      amount: asNumber(a.amount),
    })),
  }
}

async function buildCashAdvance(r: RawCashAdvance): Promise<ExportStaffCashAdvance> {
  const staffRef: StaffRef = {
    firstName: asString(r.staffFirstName),
    middleName: asString(r.staffMiddleName),
    lastName: asString(r.staffLastName),
    birthdate: asString(r.staffBirthdate),
  }
  return {
    fingerprint: await fingerprint([
      'cashAdvance',
      lower(staffRef.firstName),
      lower(staffRef.middleName),
      lower(staffRef.lastName),
      staffRef.birthdate,
      r.advanceDate,
      asNumber(r.amount).toFixed(2),
      asString(r.notes).trim(),
    ]),
    staffRef,
    advanceDate: r.advanceDate,
    amount: asNumber(r.amount),
    notes: asString(r.notes),
    status:
      r.status === 'outstanding' || r.status === 'settled' || r.status === 'void'
        ? r.status
        : 'outstanding',
  }
}

async function buildIncidentReport(r: RawIncidentReport): Promise<ExportIncidentReport> {
  return {
    fingerprint: await fingerprint([
      'incident',
      r.incidentDate,
      asString(r.incidentTime),
      asString(r.incidentType),
      lower(r.customerName),
      asString(r.whatHappened).trim(),
    ]),
    incidentDate: r.incidentDate,
    incidentTime: asString(r.incidentTime),
    staffOnDuty: asString(r.staffOnDuty),
    incidentType: asString(r.incidentType),
    whatHappened: asString(r.whatHappened),
    customerName: asString(r.customerName),
    contactNumber: asString(r.contactNumber),
    actionTaken: asString(r.actionTaken),
    handledBy: asString(r.handledBy),
    estimatedLoss: asNumber(r.estimatedLoss),
    quantity: asNumber(r.quantity),
    itemsInvolved: asString(r.itemsInvolved),
    remarks: asString(r.remarks),
    createdAt: asString(r.createdAt),
  }
}

async function buildIncomeShareRule(r: RawIncomeShareRule): Promise<ExportIncomeShareRule> {
  return {
    fingerprint: await fingerprint(['incomeShareRule', r.name]),
    name: r.name,
    percentage: asNumber(r.percentage),
    isActive: asBool(r.isActive),
  }
}

async function buildIncomeShareMonth(r: RawIncomeShareMonth): Promise<ExportIncomeShareMonth> {
  return {
    fingerprint: await fingerprint(['incomeShareMonth', r.monthKey, r.ruleName]),
    monthKey: r.monthKey,
    ruleName: r.ruleName,
    percentage: asNumber(r.percentage),
  }
}

function buildSettings(
  loyalty: { kgPerLoad: number; freeAfterLoads: number } | undefined,
  payroll:
    | {
        cutoffDay: number
        holidayDefaultMultiplier: number
        autoDeductCashAdvances: number
      }
    | undefined,
): ExportSettings {
  return {
    loyalty: {
      kgPerLoad: asNumber(loyalty?.kgPerLoad ?? 8),
      freeAfterLoads: asNumber(loyalty?.freeAfterLoads ?? 9),
    },
    payroll: {
      cutoffDay: asNumber(payroll?.cutoffDay ?? 6),
      holidayDefaultMultiplier: asNumber(payroll?.holidayDefaultMultiplier ?? 1),
      autoDeductCashAdvances: asBool(payroll?.autoDeductCashAdvances ?? 1),
    },
  }
}
