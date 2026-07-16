import type Database from '@tauri-apps/plugin-sql'
import { differenceInCalendarDays, format, isValid, parseISO, subDays, subMonths } from 'date-fns'
import {
  type AdjustmentKind,
  type AdjustmentSource,
  type AttendanceStatus,
  computeDayPay,
  defaultMultiplierForStatus,
  isCutoffDay,
  roundMoney,
} from '../../features/staff/lib/attendance'
import { hashPassword } from '../security/password'
import { getDatabase } from './client'

export type TransactionType = {
  code: string
  id: number
  isSystem: boolean
  label: string
}

export type Category = {
  id: number
  isArchived: boolean
  isLoadable: boolean
  isSeeded: boolean
  label: string
  relatedRecordsCount: number
  transactionTypeCode: string
  transactionTypeId: number
}

export type LedgerTransaction = {
  amount: number
  categoryId: number
  categoryLabel: string
  createdAt: string
  createdByName: string | null
  customerId: number | null
  customerName: string | null
  description: string
  entryDate: string
  id: number
  isLoyaltyReward: boolean
  kg: number | null
  loads: number | null
  staffCount: number | null
  transactionTypeCode: string
  transactionTypeId: number
  transactionTypeLabel: string
  updatedAt: string
  updatedByName: string | null
}

export type TransactionFilters = {
  categoryId?: number | null
  customerId?: number | null
  dateFrom?: string
  dateTo?: string
  entryDate?: string
  monthKey?: string
  transactionTypeId?: number | null
}

export type TransactionLineItem = {
  id: number
  inventoryItemId: number | null
  label: string
  /** Line total = quantity × unitPrice. Persisted for backwards-compat reads. */
  price: number
  /** Number entered by the user, in `saleUnitLabel` if present, else base. */
  quantity: number
  /** Per-unit price in `saleUnitLabel` if present, else base. */
  unitPrice: number
  /** Empty string for the inventory item's base unit, e.g. 'cup' otherwise. */
  saleUnitLabel: string
  /** Snapshotted conversion: how many sale units fit in one base unit (1 = base). */
  saleUnitFactor: number
  /** Informational FK to the inventory_item_units row chosen at sale time. */
  saleUnitId: number | null
  sortOrder: number
}

export type TransactionLineItemDraft = {
  inventoryItemId: number | null
  label: string
  /**
   * Number of units sold/charged on this line. Defaults to 1 when omitted so
   * legacy callers that only supplied `price` keep working.
   */
  quantity?: number
  /**
   * Per-unit price. When omitted, falls back to the lump-sum `price` (for
   * backwards compatibility with callers that haven't been updated yet).
   */
  unitPrice?: number
  /**
   * Lump-sum price for the line. When `quantity` and `unitPrice` are
   * supplied, this can be omitted — it will be derived as quantity × unitPrice.
   */
  price?: number
  /**
   * Sale-unit snapshot. Leave undefined / empty / 1 to mean "base unit".
   * When the user picks an alt unit, supply all three so the line can
   * reproduce the conversion in the future even if the alt unit changes.
   */
  saleUnitLabel?: string
  saleUnitFactor?: number
  saleUnitId?: number | null
}

export type TransactionDraft = {
  amount: number
  /**
   * When the category is "Cash Advance" (EXPENSE), bind the transaction to a
   * staff member so a `staff_cash_advances` record is upserted alongside it.
   */
  cashAdvanceStaffId?: number | null
  categoryId: number
  customerId: number | null
  description: string
  entryDate: string
  isLoyaltyReward: boolean
  kg: number | null
  /** Additional charges (e.g. detergent, softener) added on top of the base amount. */
  lineItems?: TransactionLineItemDraft[] | null
  loads: number | null
  staffCount: number | null
  /** When set with non-empty templateItems, OUT movements are created for a SALE. */
  templateId?: number | null
  templateItems?: Array<{
    inventoryItemId: number
    quantity: number
    saleUnitLabel?: string
    saleUnitFactor?: number
    saleUnitId?: number | null
  }> | null
  transactionTypeId: number
}

export type LoyaltySettings = {
  freeAfterLoads: number
  kgPerLoad: number
}

export type CustomerLoyaltyStatus = {
  freeAfterLoads: number
  isEligibleForReward: boolean
  isLoyaltyEnabled: boolean
  lastRewardDate: string | null
  paidLoadsSinceLastReward: number
  totalPaidLoads: number
  totalRewardsRedeemed: number
}

export type Customer = {
  company: string
  email: string
  id: number
  isArchived: boolean
  isLoyaltyEnabled: boolean
  name: string
  phone: string
}

export type CustomerDraft = {
  company: string
  email: string
  isLoyaltyEnabled?: boolean
  name: string
  phone: string
}

export type CustomerSummary = Customer & {
  createdAt: string
  freeAfterLoads: number
  isEligibleForReward: boolean
  lastTransactionAmount: number | null
  lastTransactionDate: string | null
  paidLoadsSinceLastReward: number
  totalSpent: number
  transactionCount: number
}

export type UserListItem = {
  displayName: string
  id: number
  isActive: boolean
  roles: string[]
  username: string
}

export type Role = {
  id: number
  isSystem: boolean
  name: string
}

export type Permission = {
  id: number
  key: string
  label: string
}

export type RolePermissionMatrix = {
  permissions: Permission[]
  roles: Array<Role & { allowedPermissionIds: number[] }>
}

export type SaveUserInput = {
  displayName: string
  id?: number
  isActive: boolean
  password?: string
  roleIds: number[]
  username: string
}

export type IncomeShareRuleMonth = {
  monthKey: string
  percentage: number
  ruleId: number
  ruleName: string
}

export type DashboardKpis = {
  expense: number
  grossIncome: number
  incomeShareAllocationBase: number
  netIncome: number
  operatingExpense: number
  totalExpenses: number
  totalSales: number
}

export type DashboardData = {
  categoryBreakdown: Array<{
    categoryLabel: string
    totalAmount: number
    transactionTypeCode: string
  }>
  dailySeries: Array<{
    date: string
    expense: number
    operatingExpense: number
    sales: number
  }>
  incomeShares: Array<{
    allocatedAmount: number
    percentage: number
    ruleName: string
  }>
  kpis: DashboardKpis
  monthKey: string
  monthlySeries: Array<{
    expense: number
    monthKey: string
    netIncome: number
    sales: number
  }>
  previousMonth: {
    kpis: DashboardKpis
    monthKey: string
  } | null
  transactionTypeBreakdown: Array<{
    totalAmount: number
    transactionTypeCode: string
  }>
}

type CountRow = { count: number }
type UserRoleRow = {
  displayName: string
  id: number
  isActive: number
  roleName: string | null
  username: string
}
type MatrixRow = {
  allowed: number | null
  permissionId: number
  permissionKey: string
  permissionLabel: string
  roleId: number
  roleIsSystem: number
  roleName: string
}

function toNumber(value: unknown) {
  return Number(value ?? 0)
}

function normalizeInventoryCategoryCode(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'other'
}

function getPreviousMonthKey(monthKey: string) {
  return format(subMonths(new Date(`${monthKey}-01T00:00:00`), 1), 'yyyy-MM')
}

async function getCount(database: Database, tableName: string) {
  const rows = await database.select<CountRow[]>(`SELECT COUNT(*) AS count FROM ${tableName}`)
  return toNumber(rows[0]?.count)
}

async function ensureIncomeShareMonth(database: Database, monthKey: string) {
  const existingRows = await database.select<CountRow[]>(
    `
      SELECT COUNT(*) AS count
      FROM income_share_monthly_versions
      WHERE month_key = $1
    `,
    [monthKey],
  )

  if (toNumber(existingRows[0]?.count) > 0) {
    return
  }

  const previousMonthKey = getPreviousMonthKey(monthKey)
  const previousRows = await database.select<
    Array<{ percentage: number; ruleId: number }>
  >(
    `
      SELECT rule_id AS ruleId, percentage
      FROM income_share_monthly_versions
      WHERE month_key = $1
      ORDER BY rule_id
    `,
    [previousMonthKey],
  )

  if (previousRows.length > 0) {
    for (const row of previousRows) {
      await database.execute(
        `
          INSERT OR IGNORE INTO income_share_monthly_versions (month_key, rule_id, percentage)
          VALUES ($1, $2, $3)
        `,
        [monthKey, row.ruleId, row.percentage],
      )
    }
    return
  }

  const defaults = await database.select<Array<{ percentage: number; ruleId: number }>>(
    `
      SELECT id AS ruleId, percentage
      FROM income_share_rules
      WHERE is_active = 1
      ORDER BY id
    `,
  )

  for (const row of defaults) {
    await database.execute(
      `
        INSERT OR IGNORE INTO income_share_monthly_versions (month_key, rule_id, percentage)
        VALUES ($1, $2, $3)
      `,
      [monthKey, row.ruleId, row.percentage],
    )
  }
}

async function buildKpis(database: Database, monthKey: string): Promise<DashboardKpis> {
  const rows = await database.select<
    Array<{
      expense: number
      operatingExpense: number
      operatingExcludingRent: number
      totalSales: number
    }>
  >(
    `
      SELECT
        COALESCE(SUM(CASE WHEN transaction_types.code = 'SALE' THEN transactions.amount END), 0) AS totalSales,
        COALESCE(SUM(CASE WHEN transaction_types.code = 'EXPENSE' THEN transactions.amount END), 0) AS expense,
        COALESCE(SUM(CASE WHEN transaction_types.code = 'OPERATING EXPENSE' THEN transactions.amount END), 0) AS operatingExpense,
        COALESCE(SUM(
          CASE
            WHEN transaction_types.code = 'OPERATING EXPENSE' AND categories.label != 'Rent'
            THEN transactions.amount
            ELSE 0
          END
        ), 0) AS operatingExcludingRent
      FROM transactions
      JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
      JOIN categories ON categories.id = transactions.category_id
      WHERE substr(transactions.entry_date, 1, 7) = $1
    `,
    [monthKey],
  )

  const totals = rows[0] ?? {
    expense: 0,
    operatingExcludingRent: 0,
    operatingExpense: 0,
    totalSales: 0,
  }

  const totalSales = toNumber(totals.totalSales)
  const expense = toNumber(totals.expense)
  const operatingExpense = toNumber(totals.operatingExpense)
  const totalExpenses = expense + operatingExpense

  return {
    expense,
    grossIncome: totalSales,
    incomeShareAllocationBase: totalSales - toNumber(totals.operatingExcludingRent),
    netIncome: totalSales - totalExpenses,
    operatingExpense,
    totalExpenses,
    totalSales,
  }
}

async function buildKpisByRange(
  database: Database,
  dateFrom: string,
  dateTo: string,
): Promise<DashboardKpis> {
  const rows = await database.select<
    Array<{
      expense: number
      operatingExpense: number
      operatingExcludingRent: number
      totalSales: number
    }>
  >(
    `
      SELECT
        COALESCE(SUM(CASE WHEN transaction_types.code = 'SALE' THEN transactions.amount END), 0) AS totalSales,
        COALESCE(SUM(CASE WHEN transaction_types.code = 'EXPENSE' THEN transactions.amount END), 0) AS expense,
        COALESCE(SUM(CASE WHEN transaction_types.code = 'OPERATING EXPENSE' THEN transactions.amount END), 0) AS operatingExpense,
        COALESCE(SUM(
          CASE
            WHEN transaction_types.code = 'OPERATING EXPENSE' AND categories.label != 'Rent'
            THEN transactions.amount
            ELSE 0
          END
        ), 0) AS operatingExcludingRent
      FROM transactions
      JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
      JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.entry_date >= $1 AND transactions.entry_date <= $2
    `,
    [dateFrom, dateTo],
  )

  const totals = rows[0] ?? {
    expense: 0,
    operatingExcludingRent: 0,
    operatingExpense: 0,
    totalSales: 0,
  }

  const totalSales = toNumber(totals.totalSales)
  const expense = toNumber(totals.expense)
  const operatingExpense = toNumber(totals.operatingExpense)
  const totalExpenses = expense + operatingExpense

  return {
    expense,
    grossIncome: totalSales,
    incomeShareAllocationBase: totalSales - toNumber(totals.operatingExcludingRent),
    netIncome: totalSales - totalExpenses,
    operatingExpense,
    totalExpenses,
    totalSales,
  }
}

export async function createTransactionType(input: { code: string; label: string }) {
  const database = await getDatabase()
  await database.execute(
    `INSERT INTO transaction_types (code, label, is_system) VALUES ($1, $2, 0)`,
    [input.code.toUpperCase().trim(), input.label.trim()],
  )
}

export async function deleteTransactionType(id: number): Promise<void> {
  const database = await getDatabase()
  await database.execute('DELETE FROM categories WHERE transaction_type_id = $1', [id])
  await database.execute('DELETE FROM transaction_types WHERE id = $1 AND is_system = 0', [id])
}

export async function listTransactionTypes() {
  const database = await getDatabase()
  return database.select<TransactionType[]>(
    `
      SELECT
        id,
        code,
        label,
        is_system AS isSystem
      FROM transaction_types
      ORDER BY id
    `,
  )
}

export async function listCategories(includeArchived = false) {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      id: number
      isArchived: number
      isLoadable: number
      isSeeded: number
      label: string
      relatedRecordsCount: number
      transactionTypeCode: string
      transactionTypeId: number
    }>
  >(
    `
      SELECT
        categories.id AS id,
        categories.label AS label,
        categories.transaction_type_id AS transactionTypeId,
        categories.is_seeded AS isSeeded,
        categories.is_archived AS isArchived,
        categories.is_loadable AS isLoadable,
        COUNT(transactions.id) AS relatedRecordsCount,
        transaction_types.code AS transactionTypeCode
      FROM categories
      JOIN transaction_types ON transaction_types.id = categories.transaction_type_id
      LEFT JOIN transactions
        ON transactions.category_id = categories.id
       AND transactions.transaction_type_id = categories.transaction_type_id
      ${includeArchived ? '' : 'WHERE categories.is_archived = 0'}
      GROUP BY categories.id, transaction_types.code
      ORDER BY transaction_types.id, categories.label
    `,
  )
  return rows.map((row) => ({
    id: row.id,
    isArchived: Boolean(row.isArchived),
    isLoadable: Boolean(row.isLoadable),
    isSeeded: Boolean(row.isSeeded),
    label: row.label,
    relatedRecordsCount: toNumber(row.relatedRecordsCount),
    transactionTypeCode: row.transactionTypeCode,
    transactionTypeId: row.transactionTypeId,
  }))
}

type LedgerTransactionSelectRow = {
  amount: number
  categoryId: number
  categoryLabel: string
  createdAt: string
  createdByName: string | null
  customerId: number | null
  customerName: string | null
  description: string
  entryDate: string
  id: number
  isLoyaltyReward: number | boolean
  kg: number | null
  loads: number | null
  staffCount: number | null
  transactionTypeCode: string
  transactionTypeId: number
  transactionTypeLabel: string
  updatedAt: string
  updatedByName: string | null
}

export async function listTransactions(filters: TransactionFilters = {}) {
  const database = await getDatabase()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters.entryDate) {
    params.push(filters.entryDate)
    conditions.push(`transactions.entry_date = $${params.length}`)
  }

  if (filters.monthKey) {
    params.push(filters.monthKey)
    conditions.push(`substr(transactions.entry_date, 1, 7) = $${params.length}`)
  }

  if (filters.dateFrom) {
    params.push(filters.dateFrom)
    conditions.push(`transactions.entry_date >= $${params.length}`)
  }

  if (filters.dateTo) {
    params.push(filters.dateTo)
    conditions.push(`transactions.entry_date <= $${params.length}`)
  }

  if (filters.transactionTypeId) {
    params.push(filters.transactionTypeId)
    conditions.push(`transactions.transaction_type_id = $${params.length}`)
  }

  if (filters.categoryId) {
    params.push(filters.categoryId)
    conditions.push(`transactions.category_id = $${params.length}`)
  }

  if (filters.customerId) {
    params.push(filters.customerId)
    conditions.push(`transactions.customer_id = $${params.length}`)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return database.select<LedgerTransactionSelectRow[]>(
    `
      SELECT
        transactions.id AS id,
        transactions.entry_date AS entryDate,
        transactions.description AS description,
        transactions.amount AS amount,
        transactions.staff_count AS staffCount,
        transactions.kg AS kg,
        transactions.loads AS loads,
        transactions.is_loyalty_reward AS isLoyaltyReward,
        transactions.category_id AS categoryId,
        categories.label AS categoryLabel,
        transactions.customer_id AS customerId,
        customer.name AS customerName,
        transaction_types.id AS transactionTypeId,
        transaction_types.code AS transactionTypeCode,
        transaction_types.label AS transactionTypeLabel,
        transactions.created_at AS createdAt,
        transactions.updated_at AS updatedAt,
        created_by_user.display_name AS createdByName,
        updated_by_user.display_name AS updatedByName
      FROM transactions
      JOIN categories ON categories.id = transactions.category_id
      JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
      LEFT JOIN customers AS customer ON customer.id = transactions.customer_id
      LEFT JOIN users AS created_by_user ON created_by_user.id = transactions.created_by
      LEFT JOIN users AS updated_by_user ON updated_by_user.id = transactions.updated_by
      ${whereClause}
      ORDER BY transactions.entry_date DESC, transactions.id DESC
    `,
    params,
  ).then((rows) => rows.map(mapLedgerTransactionRow))
}

function mapLedgerTransactionRow(row: LedgerTransactionSelectRow): LedgerTransaction {
  return {
    amount: toNumber(row.amount),
    categoryId: row.categoryId,
    categoryLabel: row.categoryLabel,
    createdAt: row.createdAt ?? '',
    createdByName: row.createdByName,
    customerId: row.customerId,
    customerName: row.customerName,
    description: row.description,
    entryDate: row.entryDate,
    id: row.id,
    isLoyaltyReward: Boolean(row.isLoyaltyReward),
    kg: row.kg == null || Number.isNaN(Number(row.kg)) ? null : Number(row.kg),
    loads: row.loads == null || Number.isNaN(Number(row.loads)) ? null : Number(row.loads),
    staffCount: row.staffCount,
    transactionTypeCode: row.transactionTypeCode,
    transactionTypeId: row.transactionTypeId,
    transactionTypeLabel: row.transactionTypeLabel,
    updatedAt: row.updatedAt ?? '',
    updatedByName: row.updatedByName,
  }
}

export async function getTransactionById(id: number): Promise<LedgerTransaction | null> {
  const database = await getDatabase()
  const rows = await database.select<LedgerTransactionSelectRow[]>(
    `
      SELECT
        transactions.id AS id,
        transactions.entry_date AS entryDate,
        transactions.description AS description,
        transactions.amount AS amount,
        transactions.staff_count AS staffCount,
        transactions.kg AS kg,
        transactions.loads AS loads,
        transactions.is_loyalty_reward AS isLoyaltyReward,
        transactions.category_id AS categoryId,
        categories.label AS categoryLabel,
        transactions.customer_id AS customerId,
        customer.name AS customerName,
        transaction_types.id AS transactionTypeId,
        transaction_types.code AS transactionTypeCode,
        transaction_types.label AS transactionTypeLabel,
        transactions.created_at AS createdAt,
        transactions.updated_at AS updatedAt,
        created_by_user.display_name AS createdByName,
        updated_by_user.display_name AS updatedByName
      FROM transactions
      JOIN categories ON categories.id = transactions.category_id
      JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
      LEFT JOIN customers AS customer ON customer.id = transactions.customer_id
      LEFT JOIN users AS created_by_user ON created_by_user.id = transactions.created_by
      LEFT JOIN users AS updated_by_user ON updated_by_user.id = transactions.updated_by
      WHERE transactions.id = $1
    `,
    [id],
  )
  const row = rows[0]
  return row ? mapLedgerTransactionRow(row) : null
}

async function syncSaleTemplateMovementsForTransaction(
  database: Database,
  params: {
    entryDate: string
    isSale: boolean
    templateId: number | null | undefined
    templateItems: Array<{
      inventoryItemId: number
      quantity: number
      saleUnitLabel?: string
      saleUnitFactor?: number
      saleUnitId?: number | null
    }> | null | undefined
    transactionId: number
    userId: number
  },
): Promise<void> {
  const explicitTemplatePayload = params.templateItems !== undefined

  if (!explicitTemplatePayload) {
    if (!params.isSale) {
      await database.execute(
        `DELETE FROM inventory_movements WHERE transaction_id = $1 AND template_id IS NOT NULL`,
        [params.transactionId],
      )
    }
    return
  }

  await database.execute(
    `DELETE FROM inventory_movements WHERE transaction_id = $1 AND template_id IS NOT NULL`,
    [params.transactionId],
  )

  if (!params.isSale) {
    return
  }

  const lines =
    (params.templateItems ?? []).filter(
      (row) =>
        Number.isFinite(row.quantity) &&
        row.quantity > 0 &&
        Number.isFinite(row.inventoryItemId) &&
        row.inventoryItemId > 0,
    )
  if (lines.length === 0) {
    return
  }

  const templateIdForRow = params.templateId ?? null
  let templateLabel = 'Sale template'
  if (templateIdForRow != null) {
    const names = await database.select<{ name: string }[]>(
      `SELECT name FROM transaction_templates WHERE id = $1`,
      [templateIdForRow],
    )
    const n = names[0]?.name
    if (n) templateLabel = n
  }

  const ids = [...new Set(lines.map((l) => l.inventoryItemId))]
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const costRows = await database.select<Array<{ cost_per_unit: number; id: number }>>(
    `SELECT id, cost_per_unit FROM inventory_items WHERE id IN (${placeholders})`,
    ids,
  )
  const costById = new Map(costRows.map((r) => [r.id, toNumber(r.cost_per_unit)]))

  for (const line of lines) {
    const cost = costById.get(line.inventoryItemId) ?? 0
    const factor =
      line.saleUnitFactor != null && Number.isFinite(line.saleUnitFactor) && line.saleUnitFactor > 0
        ? line.saleUnitFactor
        : 1
    const baseQuantity = factor > 0 ? line.quantity / factor : line.quantity
    const altLabel = line.saleUnitLabel?.trim() ?? ''
    const notes =
      altLabel && factor !== 1
        ? `Stock out (${templateLabel}) — ${line.quantity} ${altLabel}`
        : `Stock out (${templateLabel})`
    await database.execute(
      `
        INSERT INTO inventory_movements (
          item_id, movement_type, quantity, unit_cost, notes, movement_date, created_by, transaction_id, template_id
        )
        VALUES ($1, 'OUT', $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        line.inventoryItemId,
        baseQuantity,
        cost,
        notes,
        params.entryDate,
        params.userId,
        params.transactionId,
        templateIdForRow,
      ],
    )
  }
}

export async function saveTransaction(input: TransactionDraft, userId: number, transactionId?: number): Promise<number> {
  const database = await getDatabase()

  const metaRows = await database.select<
    Array<{ code: string; isLoadable: number; label: string }>
  >(
    `
      SELECT
        transaction_types.code AS code,
        categories.is_loadable AS isLoadable,
        categories.label AS label
      FROM categories
      JOIN transaction_types ON transaction_types.id = categories.transaction_type_id
      WHERE categories.id = $1
    `,
    [input.categoryId],
  )
  const meta = metaRows[0]
  if (!meta) {
    throw new Error('Category not found.')
  }

  const isSale = meta.code === 'SALE'
  const categoryLoadable = Boolean(meta.isLoadable)
  const isLoyaltyReward = Boolean(input.isLoyaltyReward)
  const isCashAdvanceCategory =
    meta.code === 'EXPENSE' && meta.label.trim().toLowerCase() === 'cash advance'
  const cashAdvanceStaffId =
    isCashAdvanceCategory && input.cashAdvanceStaffId != null && Number.isFinite(Number(input.cashAdvanceStaffId))
      ? Number(input.cashAdvanceStaffId)
      : null
  if (isCashAdvanceCategory && cashAdvanceStaffId == null) {
    throw new Error('Select the staff member who received this cash advance.')
  }

  if (isLoyaltyReward) {
    if (!isSale || !categoryLoadable) {
      throw new Error('Loyalty rewards can only be recorded on loadable sale categories.')
    }

    if (input.customerId == null) {
      throw new Error('Customer is required to redeem a loyalty reward.')
    }
  }

  let kg: number | null = input.kg
  let loads: number | null = input.loads
  let isRewardInt = isLoyaltyReward ? 1 : 0

  if (!isSale || !categoryLoadable) {
    kg = null
    loads = null
    isRewardInt = 0
    if (isLoyaltyReward) {
      throw new Error('Invalid category for loyalty reward.')
    }
  } else if (!isLoyaltyReward) {
    const loadsNum = loads == null ? Number.NaN : Number(loads)
    if (!Number.isFinite(loadsNum) || loadsNum <= 0) {
      throw new Error(
        'Enter a positive number of loads (or enter kg to calculate loads) for this loadable sale category.',
      )
    }
    loads = loadsNum
    if (kg != null) {
      const kgNum = Number(kg)
      kg = Number.isFinite(kgNum) && kgNum >= 0 ? kgNum : null
    }
  } else {
    const loadsNum = loads == null || !Number.isFinite(Number(loads)) ? 1 : Number(loads)
    loads = loadsNum > 0 ? loadsNum : 1
    if (kg != null) {
      const kgNum = Number(kg)
      kg = Number.isFinite(kgNum) && kgNum >= 0 ? kgNum : null
    }
  }

  let finalTransactionId: number

  if (transactionId) {
    await database.execute(
      `
        UPDATE transactions
        SET
          entry_date = $1,
          transaction_type_id = $2,
          category_id = $3,
          description = $4,
          amount = $5,
          staff_count = $6,
          customer_id = $7,
          kg = $8,
          loads = $9,
          is_loyalty_reward = $10,
          updated_by = $11,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $12
      `,
      [
        input.entryDate,
        input.transactionTypeId,
        input.categoryId,
        input.description,
        input.amount,
        input.staffCount,
        input.customerId,
        kg,
        loads,
        isRewardInt,
        userId,
        transactionId,
      ],
    )
    finalTransactionId = transactionId
  } else {
    const insertResult = await database.execute(
      `
        INSERT INTO transactions (
          entry_date,
          transaction_type_id,
          category_id,
          description,
          amount,
          staff_count,
          customer_id,
          kg,
          loads,
          is_loyalty_reward,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
      `,
      [
        input.entryDate,
        input.transactionTypeId,
        input.categoryId,
        input.description,
        input.amount,
        input.staffCount,
        input.customerId,
        kg,
        loads,
        isRewardInt,
        userId,
      ],
    )
    const lid = insertResult.lastInsertId
    finalTransactionId = typeof lid === 'number' ? lid : Number(lid)
    if (!Number.isFinite(finalTransactionId) || finalTransactionId <= 0) {
      throw new Error('Failed to create transaction.')
    }
  }

  await syncSaleTemplateMovementsForTransaction(database, {
    entryDate: input.entryDate,
    isSale,
    templateId: input.templateId,
    templateItems: input.templateItems,
    transactionId: finalTransactionId,
    userId,
  })

  if (input.lineItems !== undefined) {
    // Deleting the line items cascades to any inventory_movements rows
    // that were linked via line_item_id, so we always start from a clean slate.
    await database.execute('DELETE FROM transaction_line_items WHERE transaction_id = $1', [finalTransactionId])
    const rawItems = Array.isArray(input.lineItems) ? input.lineItems : []
    const normalized = rawItems
      .map((item) => {
        const rawQty = item.quantity != null ? Number(item.quantity) : NaN
        const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1
        const rawUnitPrice = item.unitPrice != null ? Number(item.unitPrice) : NaN
        const rawTotal = item.price != null ? Number(item.price) : NaN
        // Prefer the explicit unit price; otherwise derive it from the
        // legacy lump-sum `price` field so older callers keep working.
        const unitPrice =
          Number.isFinite(rawUnitPrice) && rawUnitPrice >= 0
            ? rawUnitPrice
            : Number.isFinite(rawTotal) && rawTotal >= 0
              ? rawTotal / quantity
              : NaN
        const lineTotal = Number.isFinite(unitPrice) ? quantity * unitPrice : NaN
        const rawFactor = item.saleUnitFactor != null ? Number(item.saleUnitFactor) : NaN
        const saleUnitFactor = Number.isFinite(rawFactor) && rawFactor > 0 ? rawFactor : 1
        const saleUnitLabel =
          typeof item.saleUnitLabel === 'string' ? item.saleUnitLabel.trim() : ''
        return {
          inventoryItemId:
            item.inventoryItemId != null && Number.isFinite(Number(item.inventoryItemId))
              ? Number(item.inventoryItemId)
              : null,
          label: typeof item.label === 'string' ? item.label.trim() : '',
          price: lineTotal,
          quantity,
          saleUnitFactor,
          saleUnitId:
            item.saleUnitId != null && Number.isFinite(Number(item.saleUnitId))
              ? Number(item.saleUnitId)
              : null,
          saleUnitLabel,
          unitPrice,
        }
      })
      .filter(
        (item) =>
          item.label !== '' &&
          Number.isFinite(item.unitPrice) &&
          item.unitPrice >= 0 &&
          Number.isFinite(item.price) &&
          item.price >= 0 &&
          item.quantity > 0,
      )

    const inventoryLinkedIds = [
      ...new Set(
        normalized
          .map((item) => item.inventoryItemId)
          .filter((id): id is number => id != null && id > 0),
      ),
    ]
    const costByInventoryId = new Map<number, number>()
    if (isSale && inventoryLinkedIds.length > 0) {
      const placeholders = inventoryLinkedIds.map((_, idx) => `$${idx + 1}`).join(', ')
      const costRows = await database.select<Array<{ cost_per_unit: number; id: number }>>(
        `SELECT id, cost_per_unit FROM inventory_items WHERE id IN (${placeholders})`,
        inventoryLinkedIds,
      )
      for (const row of costRows) {
        costByInventoryId.set(Number(row.id), toNumber(row.cost_per_unit))
      }
    }

    for (let i = 0; i < normalized.length; i += 1) {
      const item = normalized[i]!
      const insertResult = await database.execute(
        `
          INSERT INTO transaction_line_items (
            transaction_id, inventory_item_id, label, price, quantity, unit_price,
            sale_unit_label, sale_unit_factor, sale_unit_id, sort_order
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          finalTransactionId,
          item.inventoryItemId,
          item.label,
          item.price,
          item.quantity,
          item.unitPrice,
          item.saleUnitLabel,
          item.saleUnitFactor,
          item.saleUnitId,
          i,
        ],
      )

      if (isSale && item.inventoryItemId != null) {
        const rawId = insertResult.lastInsertId
        const lineItemId = typeof rawId === 'number' ? rawId : Number(rawId)
        if (Number.isFinite(lineItemId) && lineItemId > 0) {
          const unitCost = costByInventoryId.get(item.inventoryItemId) ?? 0
          // Convert the line's quantity into base units for the OUT movement.
          // sale_unit_factor = "alt units per base", so qty_in_base = qty / factor.
          const baseQuantity =
            item.saleUnitFactor > 0 ? item.quantity / item.saleUnitFactor : item.quantity
          // Enrich notes with the sale-unit context so the inventory movements
          // page can show "Sold as 2 cups" without needing to join back.
          const notes =
            item.saleUnitLabel && item.saleUnitFactor !== 1
              ? `Sold: ${item.label} (${item.quantity} ${item.saleUnitLabel})`
              : `Sold: ${item.label}`
          await database.execute(
            `
              INSERT INTO inventory_movements (
                item_id, movement_type, quantity, unit_cost, notes, movement_date,
                created_by, transaction_id, template_id, line_item_id
              )
              VALUES ($1, 'OUT', $2, $3, $4, $5, $6, $7, NULL, $8)
            `,
            [
              item.inventoryItemId,
              baseQuantity,
              unitCost,
              notes,
              input.entryDate,
              userId,
              finalTransactionId,
              lineItemId,
            ],
          )
        }
      }
    }
  }

  if (isCashAdvanceCategory && cashAdvanceStaffId != null) {
    const existingRows = await database.select<
      Array<{ id: number; status: CashAdvanceStatus }>
    >(
      `SELECT id, status FROM staff_cash_advances WHERE transaction_id = $1 LIMIT 1`,
      [finalTransactionId],
    )
    const existing = existingRows[0]
    const normalizedNotes = (input.description ?? '').trim()

    if (existing) {
      if (existing.status === 'void') {
        await database.execute(
          `
            UPDATE staff_cash_advances
            SET
              staff_id = $1,
              advance_date = $2,
              amount = $3,
              notes = $4,
              status = 'outstanding',
              updated_by = $5,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
          `,
          [cashAdvanceStaffId, input.entryDate, input.amount, normalizedNotes, userId, existing.id],
        )
      } else {
        await database.execute(
          `
            UPDATE staff_cash_advances
            SET
              staff_id = $1,
              advance_date = $2,
              amount = $3,
              notes = $4,
              updated_by = $5,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
          `,
          [cashAdvanceStaffId, input.entryDate, input.amount, normalizedNotes, userId, existing.id],
        )
      }
    } else {
      await database.execute(
        `
          INSERT INTO staff_cash_advances (
            staff_id, advance_date, amount, notes, status,
            transaction_id, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, 'outstanding', $5, $6, $6)
        `,
        [
          cashAdvanceStaffId,
          input.entryDate,
          input.amount,
          normalizedNotes,
          finalTransactionId,
          userId,
        ],
      )
    }
  } else if (transactionId) {
    // Category was changed away from "Cash Advance" on edit — clear any
    // outstanding binding so we don't leave a stale staff advance pointing at
    // a transaction that no longer represents one. Settled advances are left
    // alone because they already flowed through payroll.
    await database.execute(
      `
        DELETE FROM staff_cash_advances
        WHERE transaction_id = $1 AND status = 'outstanding'
      `,
      [finalTransactionId],
    )
  }

  return finalTransactionId
}

export async function listTransactionLineItems(transactionId: number): Promise<TransactionLineItem[]> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      id: number
      inventoryItemId: number | null
      label: string
      price: number
      quantity: number | null
      unitPrice: number | null
      saleUnitLabel: string | null
      saleUnitFactor: number | null
      saleUnitId: number | null
      sortOrder: number
    }>
  >(
    `
      SELECT
        id,
        inventory_item_id AS inventoryItemId,
        label,
        price,
        quantity,
        unit_price AS unitPrice,
        sale_unit_label AS saleUnitLabel,
        sale_unit_factor AS saleUnitFactor,
        sale_unit_id AS saleUnitId,
        sort_order AS sortOrder
      FROM transaction_line_items
      WHERE transaction_id = $1
      ORDER BY sort_order ASC, id ASC
    `,
    [transactionId],
  )
  return rows.map((r) => {
    const price = Number(r.price ?? 0)
    const rawQty = r.quantity != null ? Number(r.quantity) : NaN
    const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1
    const rawUnit = r.unitPrice != null ? Number(r.unitPrice) : NaN
    const unitPrice =
      Number.isFinite(rawUnit) && rawUnit >= 0
        ? rawUnit
        : quantity > 0
          ? price / quantity
          : price
    const rawFactor = r.saleUnitFactor != null ? Number(r.saleUnitFactor) : NaN
    const saleUnitFactor = Number.isFinite(rawFactor) && rawFactor > 0 ? rawFactor : 1
    return {
      id: Number(r.id),
      inventoryItemId: r.inventoryItemId != null ? Number(r.inventoryItemId) : null,
      label: String(r.label ?? ''),
      price,
      quantity,
      saleUnitFactor,
      saleUnitId: r.saleUnitId != null ? Number(r.saleUnitId) : null,
      saleUnitLabel: String(r.saleUnitLabel ?? ''),
      sortOrder: Number(r.sortOrder ?? 0),
      unitPrice,
    }
  })
}

export async function deleteTransaction(transactionId: number) {
  const database = await getDatabase()
  await database.execute(
    `UPDATE inventory_movements SET transaction_id = NULL WHERE transaction_id = $1 AND template_id IS NULL`,
    [transactionId],
  )
  await database.execute('DELETE FROM transactions WHERE id = $1', [transactionId])
}

/** Entities the duplicate-cleanup tool can delete. Mirrors DedupEntityKey in
 *  src/features/maintenance/dedup-scan.ts. Each maps to an existing per-entity
 *  delete so FK cleanup, stock-cache triggers, and sync tombstones all fire. */
export type DedupDeletableEntity =
  | 'transactions'
  | 'inventoryMovements'
  | 'staffAttendance'
  | 'incidentReports'
  | 'inventoryMaintenanceRecords'

/**
 * Delete duplicate rows selected in the cleanup dialog. Reuses the same
 * per-entity delete paths the UI uses elsewhere (rather than a raw bulk DELETE)
 * so every row records a sync tombstone and the deletions propagate to other
 * devices on the next sync — which is how cleaning one device fixes the rest.
 * Returns a per-entity count of rows actually removed. Individual failures are
 * collected so one bad row can't abort the whole run.
 */
export async function deleteDuplicateRecords(
  items: ReadonlyArray<{ entity: DedupDeletableEntity; id: number }>,
): Promise<{ deleted: number; failures: Array<{ entity: DedupDeletableEntity; id: number; message: string }> }> {
  const deleters: Record<DedupDeletableEntity, (id: number) => Promise<void>> = {
    transactions: deleteTransaction,
    inventoryMovements: deleteInventoryMovement,
    staffAttendance: deleteAttendance,
    incidentReports: deleteIncidentReport,
    inventoryMaintenanceRecords: deleteMaintenanceRecord,
  }
  let deleted = 0
  const failures: Array<{ entity: DedupDeletableEntity; id: number; message: string }> = []
  for (const { entity, id } of items) {
    try {
      await deleters[entity](id)
      deleted += 1
    } catch (err) {
      failures.push({ entity, id, message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }
  return { deleted, failures }
}

type CustomerRow = {
  company: string
  email: string
  id: number
  isArchived: number
  isLoyaltyEnabled: number
  name: string
  phone: string
}

export async function listCustomers(filters?: { includeArchived?: boolean; search?: string }): Promise<Customer[]> {
  const database = await getDatabase()
  const conditions: string[] = []
  const params: unknown[] = []

  if (!filters?.includeArchived) {
    conditions.push('is_archived = 0')
  }

  const search = filters?.search?.trim()
  if (search) {
    const pattern = `%${search}%`
    params.push(pattern, pattern, pattern, pattern)
    const n = params.length
    conditions.push(
      `(name LIKE $${n - 3} OR company LIKE $${n - 2} OR email LIKE $${n - 1} OR phone LIKE $${n})`,
    )
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await database.select<CustomerRow[]>(
    `
      SELECT
        id,
        name,
        company,
        email,
        phone,
        is_archived AS isArchived,
        is_loyalty_enabled AS isLoyaltyEnabled
      FROM customers
      ${whereClause}
      ORDER BY name COLLATE NOCASE ASC
    `,
    params,
  )

  return rows.map((row) => ({
    company: row.company,
    email: row.email,
    id: row.id,
    isArchived: Boolean(row.isArchived),
    isLoyaltyEnabled: Boolean(row.isLoyaltyEnabled),
    name: row.name,
    phone: row.phone,
  }))
}

type CustomerSummaryRow = CustomerRow & {
  createdAt: string
  lastTransactionAmount: number | null
  lastTransactionDate: string | null
  lastRewardId: number | null
  paidLoadsSinceLastReward: number | null
  totalSpent: number | null
  transactionCount: number | null
}

export async function listCustomerSummaries(filters?: {
  includeArchived?: boolean
  search?: string
}): Promise<CustomerSummary[]> {
  const database = await getDatabase()
  const settings = await getLoyaltySettings()
  const freeAfterLoads = settings.freeAfterLoads

  const conditions: string[] = []
  const params: unknown[] = []

  if (!filters?.includeArchived) {
    conditions.push('c.is_archived = 0')
  }

  const search = filters?.search?.trim()
  if (search) {
    const pattern = `%${search}%`
    params.push(pattern, pattern, pattern, pattern)
    const n = params.length
    conditions.push(
      `(c.name LIKE $${n - 3} OR c.company LIKE $${n - 2} OR c.email LIKE $${n - 1} OR c.phone LIKE $${n})`,
    )
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await database.select<CustomerSummaryRow[]>(
    `
      SELECT
        c.id AS id,
        c.name AS name,
        c.company AS company,
        c.email AS email,
        c.phone AS phone,
        c.is_archived AS isArchived,
        c.is_loyalty_enabled AS isLoyaltyEnabled,
        c.created_at AS createdAt,
        last_tx.last_date AS lastTransactionDate,
        last_tx.last_amount AS lastTransactionAmount,
        reward.last_reward_id AS lastRewardId,
        COALESCE(progress.paid_loads, 0) AS paidLoadsSinceLastReward,
        COALESCE(spend.total_spent, 0) AS totalSpent,
        COALESCE(spend.tx_count, 0) AS transactionCount
      FROM customers c
      LEFT JOIN (
        SELECT t.customer_id,
               t.entry_date AS last_date,
               t.amount AS last_amount
        FROM transactions t
        JOIN (
          SELECT customer_id, MAX(id) AS max_id
          FROM transactions
          WHERE customer_id IS NOT NULL
          GROUP BY customer_id
        ) latest ON latest.customer_id = t.customer_id AND latest.max_id = t.id
      ) last_tx ON last_tx.customer_id = c.id
      LEFT JOIN (
        SELECT customer_id, MAX(id) AS last_reward_id
        FROM transactions
        WHERE is_loyalty_reward != 0 AND customer_id IS NOT NULL
        GROUP BY customer_id
      ) reward ON reward.customer_id = c.id
      LEFT JOIN (
        SELECT t.customer_id, SUM(COALESCE(t.loads, 0)) AS paid_loads
        FROM transactions t
        JOIN categories cat ON cat.id = t.category_id
        JOIN transaction_types tt ON tt.id = t.transaction_type_id
        LEFT JOIN (
          SELECT customer_id, MAX(id) AS last_reward_id
          FROM transactions
          WHERE is_loyalty_reward != 0 AND customer_id IS NOT NULL
          GROUP BY customer_id
        ) r ON r.customer_id = t.customer_id
        WHERE t.customer_id IS NOT NULL
          AND t.is_loyalty_reward = 0
          AND tt.code = 'SALE'
          AND cat.is_loadable != 0
          AND (r.last_reward_id IS NULL OR t.id > r.last_reward_id)
        GROUP BY t.customer_id
      ) progress ON progress.customer_id = c.id
      LEFT JOIN (
        SELECT t.customer_id,
               SUM(CASE WHEN tt.code = 'SALE' THEN t.amount ELSE 0 END) AS total_spent,
               COUNT(*) AS tx_count
        FROM transactions t
        JOIN transaction_types tt ON tt.id = t.transaction_type_id
        WHERE t.customer_id IS NOT NULL
        GROUP BY t.customer_id
      ) spend ON spend.customer_id = c.id
      ${whereClause}
      ORDER BY c.name COLLATE NOCASE ASC
    `,
    params,
  )

  return rows.map((row) => {
    const paidLoads = toNumber(row.paidLoadsSinceLastReward)
    const isLoyaltyEnabled = Boolean(row.isLoyaltyEnabled)
    return {
      company: row.company,
      createdAt: row.createdAt ?? '',
      email: row.email,
      freeAfterLoads,
      id: row.id,
      isArchived: Boolean(row.isArchived),
      isEligibleForReward: isLoyaltyEnabled && paidLoads >= freeAfterLoads,
      isLoyaltyEnabled,
      lastTransactionAmount:
        row.lastTransactionAmount != null ? toNumber(row.lastTransactionAmount) : null,
      lastTransactionDate: row.lastTransactionDate ?? null,
      name: row.name,
      paidLoadsSinceLastReward: paidLoads,
      phone: row.phone,
      totalSpent: row.totalSpent != null ? toNumber(row.totalSpent) : 0,
      transactionCount: row.transactionCount != null ? toNumber(row.transactionCount) : 0,
    }
  })
}

export async function getLoyaltySettings(): Promise<LoyaltySettings> {
  const database = await getDatabase()
  const rows = await database.select<Array<{ freeAfterLoads: number; kgPerLoad: number }>>(
    `
      SELECT free_after_loads AS freeAfterLoads, kg_per_load AS kgPerLoad
      FROM loyalty_settings
      WHERE id = 1
    `,
  )
  const row = rows[0]
  if (!row) {
    return { freeAfterLoads: 9, kgPerLoad: 8 }
  }
  return {
    freeAfterLoads: Math.max(1, Math.floor(toNumber(row.freeAfterLoads))),
    kgPerLoad: Math.max(0.1, toNumber(row.kgPerLoad)),
  }
}

export async function saveLoyaltySettings(input: LoyaltySettings): Promise<void> {
  const database = await getDatabase()
  if (input.kgPerLoad < 0.1) {
    throw new Error('Kilograms per load must be at least 0.1.')
  }
  if (input.freeAfterLoads < 1) {
    throw new Error('Free load threshold must be at least 1 paid load.')
  }
  await database.execute(
    `
      UPDATE loyalty_settings
      SET kg_per_load = $1, free_after_loads = $2
      WHERE id = 1
    `,
    [input.kgPerLoad, Math.floor(input.freeAfterLoads)],
  )
}

export async function getCustomerById(id: number): Promise<Customer | null> {
  const database = await getDatabase()
  const rows = await database.select<CustomerRow[]>(
    `
      SELECT
        id,
        name,
        company,
        email,
        phone,
        is_archived AS isArchived,
        is_loyalty_enabled AS isLoyaltyEnabled
      FROM customers
      WHERE id = $1
    `,
    [id],
  )
  const row = rows[0]
  if (!row) return null
  return {
    company: row.company,
    email: row.email,
    id: row.id,
    isArchived: Boolean(row.isArchived),
    isLoyaltyEnabled: Boolean(row.isLoyaltyEnabled),
    name: row.name,
    phone: row.phone,
  }
}

export async function getCustomerLoyaltyStatus(customerId: number): Promise<CustomerLoyaltyStatus> {
  const database = await getDatabase()
  const settings = await getLoyaltySettings()
  const freeAfterLoads = settings.freeAfterLoads

  const enabledRows = await database.select<Array<{ isLoyaltyEnabled: number }>>(
    `SELECT is_loyalty_enabled AS isLoyaltyEnabled FROM customers WHERE id = $1`,
    [customerId],
  )
  const isLoyaltyEnabled = Boolean(enabledRows[0]?.isLoyaltyEnabled)

  const lastRewardRows = await database.select<Array<{ lastId: number | null }>>(
    `
      SELECT MAX(id) AS lastId
      FROM transactions
      WHERE customer_id = $1 AND is_loyalty_reward != 0
    `,
    [customerId],
  )
  const lastRewardId = lastRewardRows[0]?.lastId ?? null

  const paidSinceRows = await database.select<Array<{ sumLoads: number }>>(
    `
      SELECT COALESCE(SUM(COALESCE(t.loads, 0)), 0) AS sumLoads
      FROM transactions t
      JOIN categories c ON c.id = t.category_id
      JOIN transaction_types tt ON tt.id = t.transaction_type_id
      WHERE t.customer_id = $1
        AND t.is_loyalty_reward = 0
        AND tt.code = 'SALE'
        AND c.is_loadable != 0
        AND ($2 IS NULL OR t.id > $2)
    `,
    [customerId, lastRewardId],
  )
  const paidLoadsSinceLastReward = toNumber(paidSinceRows[0]?.sumLoads)

  const totalPaidRows = await database.select<Array<{ sumLoads: number }>>(
    `
      SELECT COALESCE(SUM(COALESCE(t.loads, 0)), 0) AS sumLoads
      FROM transactions t
      JOIN categories c ON c.id = t.category_id
      JOIN transaction_types tt ON tt.id = t.transaction_type_id
      WHERE t.customer_id = $1
        AND t.is_loyalty_reward = 0
        AND tt.code = 'SALE'
        AND c.is_loadable != 0
    `,
    [customerId],
  )
  const totalPaidLoads = toNumber(totalPaidRows[0]?.sumLoads)

  const rewardCountRows = await database.select<Array<{ n: number }>>(
    `
      SELECT COUNT(*) AS n
      FROM transactions
      WHERE customer_id = $1 AND is_loyalty_reward != 0
    `,
    [customerId],
  )
  const totalRewardsRedeemed = toNumber(rewardCountRows[0]?.n)

  const lastDateRows = await database.select<Array<{ entryDate: string }>>(
    `
      SELECT entry_date AS entryDate
      FROM transactions
      WHERE customer_id = $1 AND is_loyalty_reward != 0
      ORDER BY id DESC
      LIMIT 1
    `,
    [customerId],
  )
  const lastRewardDate = lastDateRows[0]?.entryDate ?? null

  return {
    freeAfterLoads,
    isEligibleForReward: isLoyaltyEnabled && paidLoadsSinceLastReward >= freeAfterLoads,
    isLoyaltyEnabled,
    lastRewardDate,
    paidLoadsSinceLastReward,
    totalPaidLoads,
    totalRewardsRedeemed,
  }
}

export async function saveCustomer(input: CustomerDraft, userId: number, customerId?: number): Promise<void> {
  const database = await getDatabase()
  const name = input.name.trim()
  const company = input.company.trim()
  const email = input.email.trim()
  const phone = input.phone.trim()
  const isLoyaltyEnabled = input.isLoyaltyEnabled ? 1 : 0

  if (customerId) {
    if (input.isLoyaltyEnabled === undefined) {
      await database.execute(
        `
          UPDATE customers
          SET
            name = $1,
            company = $2,
            email = $3,
            phone = $4,
            updated_by = $5,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $6
        `,
        [name, company, email, phone, userId, customerId],
      )
    } else {
      await database.execute(
        `
          UPDATE customers
          SET
            name = $1,
            company = $2,
            email = $3,
            phone = $4,
            is_loyalty_enabled = $5,
            updated_by = $6,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $7
        `,
        [name, company, email, phone, isLoyaltyEnabled, userId, customerId],
      )
    }
    return
  }

  await database.execute(
    `
      INSERT INTO customers (name, company, email, phone, is_loyalty_enabled, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $6)
    `,
    [name, company, email, phone, isLoyaltyEnabled, userId],
  )
}

export async function setCustomerLoyaltyEnabled(
  customerId: number,
  isEnabled: boolean,
  userId: number,
): Promise<void> {
  const database = await getDatabase()
  await database.execute(
    `
      UPDATE customers
      SET
        is_loyalty_enabled = $1,
        updated_by = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `,
    [isEnabled ? 1 : 0, userId, customerId],
  )
}

export async function archiveCustomer(id: number, userId: number): Promise<void> {
  const database = await getDatabase()
  await database.execute(
    `
      UPDATE customers
      SET
        is_archived = 1,
        updated_by = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `,
    [userId, id],
  )
}

export async function listUsers() {
  const database = await getDatabase()
  const rows = await database.select<UserRoleRow[]>(
    `
      SELECT
        users.id AS id,
        users.username AS username,
        users.display_name AS displayName,
        users.is_active AS isActive,
        roles.name AS roleName
      FROM users
      LEFT JOIN user_roles ON user_roles.user_id = users.id
      LEFT JOIN roles ON roles.id = user_roles.role_id
      ORDER BY users.username, roles.name
    `,
  )

  const usersById = new Map<number, UserListItem>()

  for (const row of rows) {
    const existing = usersById.get(row.id)

    if (existing) {
      if (row.roleName) {
        existing.roles.push(row.roleName)
      }
      continue
    }

    usersById.set(row.id, {
      displayName: row.displayName,
      id: row.id,
      isActive: Boolean(row.isActive),
      roles: row.roleName ? [row.roleName] : [],
      username: row.username,
    })
  }

  return Array.from(usersById.values())
}

export async function listRoles() {
  const database = await getDatabase()
  return database.select<Role[]>(
    `
      SELECT
        id,
        name,
        is_system AS isSystem
      FROM roles
      ORDER BY id
    `,
  )
}

export async function listRolePermissionMatrix(): Promise<RolePermissionMatrix> {
  const database = await getDatabase()
  const rows = await database.select<MatrixRow[]>(
    `
      SELECT
        roles.id AS roleId,
        roles.name AS roleName,
        roles.is_system AS roleIsSystem,
        permissions.id AS permissionId,
        permissions.key AS permissionKey,
        permissions.label AS permissionLabel,
        role_permissions.allowed AS allowed
      FROM roles
      CROSS JOIN permissions
      LEFT JOIN role_permissions
        ON role_permissions.role_id = roles.id
       AND role_permissions.permission_id = permissions.id
      ORDER BY roles.id, permissions.id
    `,
  )

  const permissionsById = new Map<number, Permission>()
  const rolesById = new Map<number, Role & { allowedPermissionIds: number[] }>()

  for (const row of rows) {
    if (!permissionsById.has(row.permissionId)) {
      permissionsById.set(row.permissionId, {
        id: row.permissionId,
        key: row.permissionKey,
        label: row.permissionLabel,
      })
    }

    const existingRole = rolesById.get(row.roleId)

    if (existingRole) {
      if (row.allowed) {
        existingRole.allowedPermissionIds.push(row.permissionId)
      }
      continue
    }

    rolesById.set(row.roleId, {
      allowedPermissionIds: row.allowed ? [row.permissionId] : [],
      id: row.roleId,
      isSystem: Boolean(row.roleIsSystem),
      name: row.roleName,
    })
  }

  return {
    permissions: Array.from(permissionsById.values()),
    roles: Array.from(rolesById.values()),
  }
}

export async function saveUser(input: SaveUserInput) {
  const database = await getDatabase()

  let userId = input.id

  if (userId) {
    if (input.password) {
      const passwordHash = await hashPassword(input.password)
      await database.execute(
        `
          UPDATE users
          SET
            username = $1,
            display_name = $2,
            is_active = $3,
            password_hash = $4,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $5
        `,
        [input.username, input.displayName, input.isActive ? 1 : 0, passwordHash, userId],
      )
    } else {
      await database.execute(
        `
          UPDATE users
          SET
            username = $1,
            display_name = $2,
            is_active = $3,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $4
        `,
        [input.username, input.displayName, input.isActive ? 1 : 0, userId],
      )
    }
  } else {
    const passwordHash = await hashPassword(input.password || 'admin123')
    const result = await database.execute(
      `
        INSERT INTO users (username, password_hash, display_name, is_active)
        VALUES ($1, $2, $3, $4)
      `,
      [input.username, passwordHash, input.displayName, input.isActive ? 1 : 0],
    )
    userId = Number(result.lastInsertId)
  }

  await database.execute('DELETE FROM user_roles WHERE user_id = $1', [userId])

  for (const roleId of input.roleIds) {
    // Deterministic sync uuid from the (username, role) natural key so the same
    // assignment made on two devices dedupes instead of colliding on the
    // (user_id, role_id) primary key during sync. Mirrors the migration backfill.
    await database.execute(
      `
        INSERT INTO user_roles (user_id, role_id, uuid)
        VALUES (
          $1, $2,
          'seed:userrole:' || (SELECT username FROM users WHERE id = $1)
            || ':' || (SELECT name FROM roles WHERE id = $2)
        )
      `,
      [userId, roleId],
    )
  }
}

export async function updateUserProfile(
  userId: number,
  input: { displayName: string; username: string; newPassword?: string },
) {
  const database = await getDatabase()

  if (input.newPassword) {
    const passwordHash = await hashPassword(input.newPassword)
    await database.execute(
      `
        UPDATE users
        SET username = $1, display_name = $2, password_hash = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `,
      [input.username, input.displayName, passwordHash, userId],
    )
  } else {
    await database.execute(
      `
        UPDATE users
        SET username = $1, display_name = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `,
      [input.username, input.displayName, userId],
    )
  }
}

export async function updateRolePermission(roleId: number, permissionId: number, allowed: boolean) {
  const database = await getDatabase()
  await database.execute(
    `
      INSERT INTO role_permissions (role_id, permission_id, allowed)
      VALUES ($1, $2, $3)
      ON CONFLICT(role_id, permission_id)
      DO UPDATE SET allowed = excluded.allowed
    `,
    [roleId, permissionId, allowed ? 1 : 0],
  )
}

export async function saveCategory(input: {
  id?: number
  isArchived: boolean
  isLoadable?: boolean
  label: string
  transactionTypeId: number
}) {
  const database = await getDatabase()

  const typeRows = await database.select<Array<{ code: string }>>(
    `SELECT code FROM transaction_types WHERE id = $1`,
    [input.transactionTypeId],
  )
  const isSale = typeRows[0]?.code === 'SALE'
  const loadableFlag = isSale && input.isLoadable ? 1 : 0

  if (input.id) {
    await database.execute(
      `
        UPDATE categories
        SET
          label = $1,
          is_archived = $2,
          is_loadable = $3
        WHERE id = $4
      `,
      [input.label, input.isArchived ? 1 : 0, loadableFlag, input.id],
    )
    return
  }

  await database.execute(
    `
      INSERT INTO categories (transaction_type_id, label, is_seeded, is_archived, is_loadable)
      VALUES ($1, $2, 0, $3, $4)
    `,
    [input.transactionTypeId, input.label, input.isArchived ? 1 : 0, loadableFlag],
  )
}

export async function deleteCategory(id: number, transferToCategoryId?: number): Promise<void> {
  const database = await getDatabase()
  const sourceRows = await database.select<
    Array<{ id: number; isSeeded: number; transactionTypeId: number }>
  >(
    `
      SELECT
        id,
        is_seeded AS isSeeded,
        transaction_type_id AS transactionTypeId
      FROM categories
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  )
  const source = sourceRows[0]
  if (!source) {
    throw new Error('Category not found.')
  }

  const usageRows = await database.select<CountRow[]>(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE category_id = $1
    `,
    [id],
  )
  const usageCount = toNumber(usageRows[0]?.count)

  if (usageCount > 0 && transferToCategoryId == null) {
    throw new Error('This category has related transactions. Select a category to transfer data.')
  }

  if (transferToCategoryId != null) {
    if (transferToCategoryId === id) {
      throw new Error('Transfer category must be different from the category being deleted.')
    }
    const targetRows = await database.select<Array<{ id: number; transactionTypeId: number }>>(
      `
        SELECT
          id,
          transaction_type_id AS transactionTypeId
        FROM categories
        WHERE id = $1
          AND is_archived = 0
        LIMIT 1
      `,
      [transferToCategoryId],
    )
    const target = targetRows[0]
    if (!target) {
      throw new Error('Transfer category not found.')
    }
    if (target.transactionTypeId !== source.transactionTypeId) {
      throw new Error('Transfer category must belong to the same transaction type.')
    }
    await database.execute(
      `
        UPDATE transactions
        SET category_id = $1
        WHERE category_id = $2
      `,
      [transferToCategoryId, id],
    )
  }

  if (Boolean(source.isSeeded)) {
    await database.execute(
      `
        UPDATE categories
        SET is_archived = 1
        WHERE id = $1
      `,
      [id],
    )
    return
  }

  await database.execute(
    `
      DELETE FROM categories
      WHERE id = $1
        AND is_seeded = 0
    `,
    [id],
  )
}

export async function listIncomeShareMonth(monthKey: string) {
  const database = await getDatabase()
  await ensureIncomeShareMonth(database, monthKey)

  return database.select<IncomeShareRuleMonth[]>(
    `
      SELECT
        income_share_rules.id AS ruleId,
        income_share_rules.name AS ruleName,
        income_share_monthly_versions.month_key AS monthKey,
        income_share_monthly_versions.percentage AS percentage
      FROM income_share_rules
      JOIN income_share_monthly_versions
        ON income_share_monthly_versions.rule_id = income_share_rules.id
      WHERE income_share_monthly_versions.month_key = $1
      ORDER BY income_share_rules.id
    `,
    [monthKey],
  )
}

export async function saveIncomeShareMonth(
  monthKey: string,
  values: Array<{ percentage: number; ruleId: number }>,
) {
  const database = await getDatabase()
  await ensureIncomeShareMonth(database, monthKey)

  for (const value of values) {
    await database.execute(
      `
        UPDATE income_share_monthly_versions
        SET percentage = $1
        WHERE month_key = $2 AND rule_id = $3
      `,
      [value.percentage, monthKey, value.ruleId],
    )
  }
}

export type IncomeShareRule = {
  id: number
  isActive: boolean
  name: string
  percentage: number
}

export type IncomeShareRuleDraft = {
  isActive: boolean
  name: string
  percentage: number
}

export async function listIncomeShareRules(includeInactive = false): Promise<IncomeShareRule[]> {
  const database = await getDatabase()
  return database.select<Array<{ id: number; isActive: number; name: string; percentage: number }>>(
    `
      SELECT id, name, percentage, is_active AS isActive
      FROM income_share_rules
      ${includeInactive ? '' : 'WHERE is_active = 1'}
      ORDER BY id
    `,
  ).then((rows) =>
    rows.map((row) => ({
      id: row.id,
      isActive: Boolean(row.isActive),
      name: row.name,
      percentage: toNumber(row.percentage),
    })),
  )
}

export async function saveIncomeShareRule(draft: IncomeShareRuleDraft, id?: number): Promise<void> {
  const database = await getDatabase()

  if (id) {
    await database.execute(
      `
        UPDATE income_share_rules
        SET name = $1, percentage = $2, is_active = $3
        WHERE id = $4
      `,
      [draft.name, draft.percentage, draft.isActive ? 1 : 0, id],
    )
    return
  }

  await database.execute(
    `
      INSERT INTO income_share_rules (name, percentage, is_active)
      VALUES ($1, $2, $3)
    `,
    [draft.name, draft.percentage, draft.isActive ? 1 : 0],
  )
}

export async function deleteIncomeShareRule(id: number): Promise<void> {
  const database = await getDatabase()
  await database.execute('DELETE FROM income_share_rules WHERE id = $1', [id])
}

export async function listAvailableMonthKeys() {
  const database = await getDatabase()
  const rows = await database.select<Array<{ monthKey: string }>>(
    `
      SELECT monthKey
      FROM (
        SELECT DISTINCT substr(entry_date, 1, 7) AS monthKey FROM transactions
        UNION
        SELECT DISTINCT month_key AS monthKey FROM income_share_monthly_versions
      )
      ORDER BY monthKey DESC
    `,
  )

  return rows.map((row) => row.monthKey)
}

export async function getDashboardData(monthKey: string): Promise<DashboardData> {
  const database = await getDatabase()
  await ensureIncomeShareMonth(database, monthKey)

  const kpis = await buildKpis(database, monthKey)
  const previousMonthKey = getPreviousMonthKey(monthKey)
  const previousMonthCount = await database.select<CountRow[]>(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE substr(entry_date, 1, 7) = $1
    `,
    [previousMonthKey],
  )

  const previousMonth =
    toNumber(previousMonthCount[0]?.count) > 0
      ? {
          kpis: await buildKpis(database, previousMonthKey),
          monthKey: previousMonthKey,
        }
      : null

  const [dailySeries, transactionTypeBreakdown, categoryBreakdown, monthlySeries, shareRows] =
    await Promise.all([
      database.select<
        Array<{
          date: string
          expense: number
          operatingExpense: number
          sales: number
        }>
      >(
        `
          SELECT
            transactions.entry_date AS date,
            COALESCE(SUM(CASE WHEN transaction_types.code = 'SALE' THEN transactions.amount END), 0) AS sales,
            COALESCE(SUM(CASE WHEN transaction_types.code = 'EXPENSE' THEN transactions.amount END), 0) AS expense,
            COALESCE(SUM(CASE WHEN transaction_types.code = 'OPERATING EXPENSE' THEN transactions.amount END), 0) AS operatingExpense
          FROM transactions
          JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
          WHERE substr(transactions.entry_date, 1, 7) = $1
          GROUP BY transactions.entry_date
          ORDER BY transactions.entry_date
        `,
        [monthKey],
      ),
      database.select<
        Array<{
          totalAmount: number
          transactionTypeCode: string
        }>
      >(
        `
          SELECT
            transaction_types.code AS transactionTypeCode,
            COALESCE(SUM(transactions.amount), 0) AS totalAmount
          FROM transactions
          JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
          WHERE substr(transactions.entry_date, 1, 7) = $1
          GROUP BY transaction_types.code
          ORDER BY totalAmount DESC
        `,
        [monthKey],
      ),
      database.select<
        Array<{
          categoryLabel: string
          totalAmount: number
          transactionTypeCode: string
        }>
      >(
        `
          SELECT
            categories.label AS categoryLabel,
            transaction_types.code AS transactionTypeCode,
            COALESCE(SUM(transactions.amount), 0) AS totalAmount
          FROM categories
          JOIN transaction_types ON transaction_types.id = categories.transaction_type_id
          LEFT JOIN transactions
            ON transactions.category_id = categories.id
            AND substr(transactions.entry_date, 1, 7) = $1
          WHERE categories.is_archived = 0
          GROUP BY categories.label, transaction_types.code
          ORDER BY transaction_types.code, totalAmount DESC
        `,
        [monthKey],
      ),
      database.select<
        Array<{
          expense: number
          monthKey: string
          sales: number
        }>
      >(
        `
          SELECT
            substr(entry_date, 1, 7) AS monthKey,
            COALESCE(SUM(CASE WHEN transaction_types.code = 'SALE' THEN transactions.amount END), 0) AS sales,
            COALESCE(SUM(CASE WHEN transaction_types.code IN ('EXPENSE', 'OPERATING EXPENSE') THEN transactions.amount END), 0) AS expense
          FROM transactions
          JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
          GROUP BY substr(entry_date, 1, 7)
          ORDER BY monthKey
        `,
      ),
      database.select<
        Array<{
          percentage: number
          ruleName: string
        }>
      >(
        `
          SELECT
            income_share_rules.name AS ruleName,
            income_share_monthly_versions.percentage AS percentage
          FROM income_share_monthly_versions
          JOIN income_share_rules ON income_share_rules.id = income_share_monthly_versions.rule_id
          WHERE income_share_monthly_versions.month_key = $1
          ORDER BY income_share_rules.id
        `,
        [monthKey],
      ),
    ])

  return {
    categoryBreakdown: categoryBreakdown.map((row) => ({
      categoryLabel: row.categoryLabel,
      totalAmount: toNumber(row.totalAmount),
      transactionTypeCode: row.transactionTypeCode,
    })),
    dailySeries: dailySeries.map((row) => ({
      date: row.date,
      expense: toNumber(row.expense),
      operatingExpense: toNumber(row.operatingExpense),
      sales: toNumber(row.sales),
    })),
    incomeShares: shareRows.map((row) => ({
      allocatedAmount: (kpis.incomeShareAllocationBase * toNumber(row.percentage)) / 100,
      percentage: toNumber(row.percentage),
      ruleName: row.ruleName,
    })),
    kpis,
    monthKey,
    monthlySeries: monthlySeries.map((row) => ({
      expense: toNumber(row.expense),
      monthKey: row.monthKey,
      netIncome: toNumber(row.sales) - toNumber(row.expense),
      sales: toNumber(row.sales),
    })),
    previousMonth,
    transactionTypeBreakdown: transactionTypeBreakdown.map((row) => ({
      totalAmount: toNumber(row.totalAmount),
      transactionTypeCode: row.transactionTypeCode,
    })),
  }
}

export async function getDashboardDataByRange(
  dateFrom: string,
  dateTo: string,
): Promise<DashboardData> {
  const database = await getDatabase()

  const monthKey = dateFrom.slice(0, 7)
  await ensureIncomeShareMonth(database, monthKey)

  const kpis = await buildKpisByRange(database, dateFrom, dateTo)

  const rangeDays = differenceInCalendarDays(
    new Date(`${dateTo}T00:00:00`),
    new Date(`${dateFrom}T00:00:00`),
  )
  const prevTo = format(
    subDays(new Date(`${dateFrom}T00:00:00`), 1),
    'yyyy-MM-dd',
  )
  const prevFrom = format(
    subDays(new Date(`${dateFrom}T00:00:00`), rangeDays + 1),
    'yyyy-MM-dd',
  )

  const previousCount = await database.select<CountRow[]>(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE entry_date >= $1 AND entry_date <= $2
    `,
    [prevFrom, prevTo],
  )

  const previousMonth =
    toNumber(previousCount[0]?.count) > 0
      ? {
          kpis: await buildKpisByRange(database, prevFrom, prevTo),
          monthKey: prevFrom.slice(0, 7),
        }
      : null

  const [dailySeries, transactionTypeBreakdown, categoryBreakdown, monthlySeries, shareRows] =
    await Promise.all([
      database.select<
        Array<{
          date: string
          expense: number
          operatingExpense: number
          sales: number
        }>
      >(
        `
          SELECT
            transactions.entry_date AS date,
            COALESCE(SUM(CASE WHEN transaction_types.code = 'SALE' THEN transactions.amount END), 0) AS sales,
            COALESCE(SUM(CASE WHEN transaction_types.code = 'EXPENSE' THEN transactions.amount END), 0) AS expense,
            COALESCE(SUM(CASE WHEN transaction_types.code = 'OPERATING EXPENSE' THEN transactions.amount END), 0) AS operatingExpense
          FROM transactions
          JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
          WHERE transactions.entry_date >= $1 AND transactions.entry_date <= $2
          GROUP BY transactions.entry_date
          ORDER BY transactions.entry_date
        `,
        [dateFrom, dateTo],
      ),
      database.select<
        Array<{
          totalAmount: number
          transactionTypeCode: string
        }>
      >(
        `
          SELECT
            transaction_types.code AS transactionTypeCode,
            COALESCE(SUM(transactions.amount), 0) AS totalAmount
          FROM transactions
          JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
          WHERE transactions.entry_date >= $1 AND transactions.entry_date <= $2
          GROUP BY transaction_types.code
          ORDER BY totalAmount DESC
        `,
        [dateFrom, dateTo],
      ),
      database.select<
        Array<{
          categoryLabel: string
          totalAmount: number
          transactionTypeCode: string
        }>
      >(
        `
          SELECT
            categories.label AS categoryLabel,
            transaction_types.code AS transactionTypeCode,
            COALESCE(SUM(transactions.amount), 0) AS totalAmount
          FROM categories
          JOIN transaction_types ON transaction_types.id = categories.transaction_type_id
          LEFT JOIN transactions
            ON transactions.category_id = categories.id
            AND transactions.entry_date >= $1
            AND transactions.entry_date <= $2
          WHERE categories.is_archived = 0
          GROUP BY categories.label, transaction_types.code
          ORDER BY transaction_types.code, totalAmount DESC
        `,
        [dateFrom, dateTo],
      ),
      database.select<
        Array<{
          expense: number
          monthKey: string
          sales: number
        }>
      >(
        `
          SELECT
            substr(entry_date, 1, 7) AS monthKey,
            COALESCE(SUM(CASE WHEN transaction_types.code = 'SALE' THEN transactions.amount END), 0) AS sales,
            COALESCE(SUM(CASE WHEN transaction_types.code IN ('EXPENSE', 'OPERATING EXPENSE') THEN transactions.amount END), 0) AS expense
          FROM transactions
          JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
          GROUP BY substr(entry_date, 1, 7)
          ORDER BY monthKey
        `,
      ),
      database.select<
        Array<{
          percentage: number
          ruleName: string
        }>
      >(
        `
          SELECT
            income_share_rules.name AS ruleName,
            income_share_monthly_versions.percentage AS percentage
          FROM income_share_monthly_versions
          JOIN income_share_rules ON income_share_rules.id = income_share_monthly_versions.rule_id
          WHERE income_share_monthly_versions.month_key = $1
          ORDER BY income_share_rules.id
        `,
        [monthKey],
      ),
    ])

  return {
    categoryBreakdown: categoryBreakdown.map((row) => ({
      categoryLabel: row.categoryLabel,
      totalAmount: toNumber(row.totalAmount),
      transactionTypeCode: row.transactionTypeCode,
    })),
    dailySeries: dailySeries.map((row) => ({
      date: row.date,
      expense: toNumber(row.expense),
      operatingExpense: toNumber(row.operatingExpense),
      sales: toNumber(row.sales),
    })),
    incomeShares: shareRows.map((row) => ({
      allocatedAmount: (kpis.incomeShareAllocationBase * toNumber(row.percentage)) / 100,
      percentage: toNumber(row.percentage),
      ruleName: row.ruleName,
    })),
    kpis,
    monthKey,
    monthlySeries: monthlySeries.map((row) => ({
      expense: toNumber(row.expense),
      monthKey: row.monthKey,
      netIncome: toNumber(row.sales) - toNumber(row.expense),
      sales: toNumber(row.sales),
    })),
    previousMonth,
    transactionTypeBreakdown: transactionTypeBreakdown.map((row) => ({
      totalAmount: toNumber(row.totalAmount),
      transactionTypeCode: row.transactionTypeCode,
    })),
  }
}

export type TransactionsSummaryKpis = {
  avgDailySales: number
  netIncome: number
  operatingExpense: number
  salesPerStaffShift: number
  totalExpenses: number
  totalOperatingExpense: number
  totalSales: number
  totalStaffShifts: number
  transactionCount: number
}

export type TransactionsSummary = {
  categoryBreakdown: Array<{
    categoryLabel: string
    count: number
    totalAmount: number
    transactionTypeCode: string
  }>
  dailySeries: Array<{
    date: string
    expense: number
    netIncome: number
    operatingExpense: number
    sales: number
  }>
  dateFrom: string
  dateTo: string
  kpis: TransactionsSummaryKpis
  monthlySeries: Array<{
    expense: number
    monthKey: string
    netIncome: number
    operatingExpense: number
    sales: number
  }>
  typeBreakdown: Array<{
    count: number
    totalAmount: number
    transactionTypeCode: string
  }>
  weekdayBreakdown: Array<{
    expense: number
    operatingExpense: number
    sales: number
    weekday: number
  }>
}

export async function getTransactionsSummary(
  dateFrom: string,
  dateTo: string,
): Promise<TransactionsSummary> {
  const database = await getDatabase()

  const [
    kpiRows,
    dailyRows,
    typeRows,
    categoryRows,
    monthlyRows,
    weekdayRows,
  ] = await Promise.all([
    database.select<
      Array<{
        expense: number
        operatingExpense: number
        totalSales: number
        totalStaffShifts: number
        transactionCount: number
      }>
    >(
      `
        SELECT
          COALESCE(SUM(CASE WHEN transaction_types.code = 'SALE' THEN transactions.amount END), 0) AS totalSales,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'EXPENSE' THEN transactions.amount END), 0) AS expense,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'OPERATING EXPENSE' THEN transactions.amount END), 0) AS operatingExpense,
          COUNT(*) AS transactionCount,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'SALE' THEN transactions.staff_count END), 0) AS totalStaffShifts
        FROM transactions
        JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
        WHERE transactions.entry_date >= $1 AND transactions.entry_date <= $2
      `,
      [dateFrom, dateTo],
    ),
    database.select<
      Array<{
        date: string
        expense: number
        operatingExpense: number
        sales: number
      }>
    >(
      `
        SELECT
          transactions.entry_date AS date,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'SALE' THEN transactions.amount END), 0) AS sales,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'EXPENSE' THEN transactions.amount END), 0) AS expense,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'OPERATING EXPENSE' THEN transactions.amount END), 0) AS operatingExpense
        FROM transactions
        JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
        WHERE transactions.entry_date >= $1 AND transactions.entry_date <= $2
        GROUP BY transactions.entry_date
        ORDER BY transactions.entry_date
      `,
      [dateFrom, dateTo],
    ),
    database.select<
      Array<{
        count: number
        totalAmount: number
        transactionTypeCode: string
      }>
    >(
      `
        SELECT
          transaction_types.code AS transactionTypeCode,
          COALESCE(SUM(transactions.amount), 0) AS totalAmount,
          COUNT(*) AS count
        FROM transactions
        JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
        WHERE transactions.entry_date >= $1 AND transactions.entry_date <= $2
        GROUP BY transaction_types.code
        ORDER BY totalAmount DESC
      `,
      [dateFrom, dateTo],
    ),
    database.select<
      Array<{
        categoryLabel: string
        count: number
        totalAmount: number
        transactionTypeCode: string
      }>
    >(
      `
        SELECT
          categories.label AS categoryLabel,
          transaction_types.code AS transactionTypeCode,
          COALESCE(SUM(transactions.amount), 0) AS totalAmount,
          COUNT(transactions.id) AS count
        FROM transactions
        JOIN categories ON categories.id = transactions.category_id
        JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
        WHERE transactions.entry_date >= $1 AND transactions.entry_date <= $2
        GROUP BY categories.label, transaction_types.code
        ORDER BY transaction_types.code, totalAmount DESC
      `,
      [dateFrom, dateTo],
    ),
    database.select<
      Array<{
        expense: number
        monthKey: string
        operatingExpense: number
        sales: number
      }>
    >(
      `
        SELECT
          substr(transactions.entry_date, 1, 7) AS monthKey,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'SALE' THEN transactions.amount END), 0) AS sales,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'EXPENSE' THEN transactions.amount END), 0) AS expense,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'OPERATING EXPENSE' THEN transactions.amount END), 0) AS operatingExpense
        FROM transactions
        JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
        WHERE transactions.entry_date >= $1 AND transactions.entry_date <= $2
        GROUP BY substr(transactions.entry_date, 1, 7)
        ORDER BY monthKey
      `,
      [dateFrom, dateTo],
    ),
    database.select<
      Array<{
        expense: number
        operatingExpense: number
        sales: number
        weekday: string
      }>
    >(
      `
        SELECT
          strftime('%w', transactions.entry_date) AS weekday,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'SALE' THEN transactions.amount END), 0) AS sales,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'EXPENSE' THEN transactions.amount END), 0) AS expense,
          COALESCE(SUM(CASE WHEN transaction_types.code = 'OPERATING EXPENSE' THEN transactions.amount END), 0) AS operatingExpense
        FROM transactions
        JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
        WHERE transactions.entry_date >= $1 AND transactions.entry_date <= $2
        GROUP BY strftime('%w', transactions.entry_date)
        ORDER BY weekday
      `,
      [dateFrom, dateTo],
    ),
  ])

  const kpiRow = kpiRows[0] ?? {
    expense: 0,
    operatingExpense: 0,
    totalSales: 0,
    totalStaffShifts: 0,
    transactionCount: 0,
  }

  const totalSales = toNumber(kpiRow.totalSales)
  const expense = toNumber(kpiRow.expense)
  const operatingExpense = toNumber(kpiRow.operatingExpense)
  const totalExpenses = expense + operatingExpense
  const totalStaffShifts = toNumber(kpiRow.totalStaffShifts)
  const transactionCount = toNumber(kpiRow.transactionCount)

  const rangeDays = Math.max(
    1,
    differenceInCalendarDays(
      new Date(`${dateTo}T00:00:00`),
      new Date(`${dateFrom}T00:00:00`),
    ) + 1,
  )

  return {
    categoryBreakdown: categoryRows.map((row) => ({
      categoryLabel: row.categoryLabel,
      count: toNumber(row.count),
      totalAmount: toNumber(row.totalAmount),
      transactionTypeCode: row.transactionTypeCode,
    })),
    dailySeries: dailyRows.map((row) => {
      const dailySales = toNumber(row.sales)
      const dailyExpense = toNumber(row.expense)
      const dailyOperating = toNumber(row.operatingExpense)
      return {
        date: row.date,
        expense: dailyExpense,
        netIncome: dailySales - dailyExpense - dailyOperating,
        operatingExpense: dailyOperating,
        sales: dailySales,
      }
    }),
    dateFrom,
    dateTo,
    kpis: {
      avgDailySales: totalSales / rangeDays,
      netIncome: totalSales - totalExpenses,
      operatingExpense,
      salesPerStaffShift: totalStaffShifts > 0 ? totalSales / totalStaffShifts : 0,
      totalExpenses,
      totalOperatingExpense: operatingExpense,
      totalSales,
      totalStaffShifts,
      transactionCount,
    },
    monthlySeries: monthlyRows.map((row) => {
      const monthSales = toNumber(row.sales)
      const monthExpense = toNumber(row.expense)
      const monthOperating = toNumber(row.operatingExpense)
      return {
        expense: monthExpense,
        monthKey: row.monthKey,
        netIncome: monthSales - monthExpense - monthOperating,
        operatingExpense: monthOperating,
        sales: monthSales,
      }
    }),
    typeBreakdown: typeRows.map((row) => ({
      count: toNumber(row.count),
      totalAmount: toNumber(row.totalAmount),
      transactionTypeCode: row.transactionTypeCode,
    })),
    weekdayBreakdown: weekdayRows.map((row) => ({
      expense: toNumber(row.expense),
      operatingExpense: toNumber(row.operatingExpense),
      sales: toNumber(row.sales),
      weekday: Number(row.weekday),
    })),
  }
}

export async function getAppSummaryCounts() {
  const database = await getDatabase()
  const [transactionTypes, categories, roles, permissions, incomeShareRules, users, transactions] =
    await Promise.all([
      getCount(database, 'transaction_types'),
      getCount(database, 'categories'),
      getCount(database, 'roles'),
      getCount(database, 'permissions'),
      getCount(database, 'income_share_rules'),
      getCount(database, 'users'),
      getCount(database, 'transactions'),
    ])

  return {
    categories,
    incomeShareRules,
    permissions,
    roles,
    transactionTypes,
    transactions,
    users,
  }
}

// ─── Incident Reports ────────────────────────────────────────────────────────

export type IncidentReport = {
  actionTaken: string
  contactNumber: string
  createdAt: string
  createdByName: string | null
  customerName: string
  estimatedLoss: number
  handledBy: string
  id: number
  incidentDate: string
  incidentTime: string
  incidentType: string
  itemsInvolved: string
  quantity: number
  remarks: string
  staffOnDuty: string
  whatHappened: string
}

export type IncidentReportDraft = {
  actionTaken: string
  contactNumber: string
  customerName: string
  estimatedLoss: number
  handledBy: string
  incidentDate: string
  incidentTime: string
  incidentType: string
  itemsInvolved: string
  quantity: number
  remarks: string
  staffOnDuty: string
  whatHappened: string
}

type IncidentReportRow = {
  action_taken: string
  contact_number: string
  created_at: string
  created_by_name: string | null
  customer_name: string
  estimated_loss: number
  handled_by: string
  id: number
  incident_date: string
  incident_time: string
  incident_type: string
  items_involved: string
  quantity: number
  remarks: string
  staff_on_duty: string
  what_happened: string
}

function rowToIncidentReport(row: IncidentReportRow): IncidentReport {
  return {
    actionTaken: row.action_taken,
    contactNumber: row.contact_number,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    customerName: row.customer_name,
    estimatedLoss: toNumber(row.estimated_loss),
    handledBy: row.handled_by,
    id: row.id,
    incidentDate: row.incident_date,
    incidentTime: row.incident_time,
    incidentType: row.incident_type,
    itemsInvolved: row.items_involved,
    quantity: toNumber(row.quantity),
    remarks: row.remarks,
    staffOnDuty: row.staff_on_duty,
    whatHappened: row.what_happened,
  }
}

export async function listIncidentReports(filters?: {
  customerName?: string
  dateFrom?: string
  dateTo?: string
  handledBy?: string
  incidentType?: string
  month?: string
  search?: string
}): Promise<IncidentReport[]> {
  const database = await getDatabase()

  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.dateFrom) {
    conditions.push(`ir.incident_date >= $${params.length + 1}`)
    params.push(filters.dateFrom)
  }

  if (filters?.dateTo) {
    conditions.push(`ir.incident_date <= $${params.length + 1}`)
    params.push(filters.dateTo)
  }

  if (filters?.month) {
    conditions.push(`substr(ir.incident_date, 1, 7) = $${params.length + 1}`)
    params.push(filters.month)
  }

  if (filters?.incidentType) {
    conditions.push(`ir.incident_type = $${params.length + 1}`)
    params.push(filters.incidentType)
  }

  if (filters?.customerName) {
    conditions.push(`ir.customer_name = $${params.length + 1}`)
    params.push(filters.customerName)
  }

  if (filters?.handledBy) {
    conditions.push(`ir.handled_by = $${params.length + 1}`)
    params.push(filters.handledBy)
  }

  if (filters?.search) {
    const idx = params.length + 1
    conditions.push(
      `(ir.what_happened LIKE $${idx} OR ir.customer_name LIKE $${idx} OR ir.handled_by LIKE $${idx} OR ir.items_involved LIKE $${idx})`,
    )
    params.push(`%${filters.search}%`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await database.select<IncidentReportRow[]>(
    `
      SELECT
        ir.id,
        ir.incident_date,
        ir.incident_time,
        ir.staff_on_duty,
        ir.incident_type,
        ir.what_happened,
        ir.customer_name,
        ir.contact_number,
        ir.action_taken,
        ir.handled_by,
        ir.estimated_loss,
        ir.quantity,
        ir.items_involved,
        ir.remarks,
        ir.created_at,
        u.display_name AS created_by_name
      FROM incident_reports ir
      LEFT JOIN users u ON u.id = ir.created_by
      ${where}
      ORDER BY ir.incident_date DESC, ir.incident_time DESC
    `,
    params,
  )

  return rows.map(rowToIncidentReport)
}

export async function saveIncidentReport(
  draft: IncidentReportDraft,
  createdBy: number,
  id?: number,
): Promise<void> {
  const database = await getDatabase()

  if (id) {
    await database.execute(
      `
        UPDATE incident_reports SET
          incident_date = $1,
          incident_time = $2,
          staff_on_duty = $3,
          incident_type = $4,
          what_happened = $5,
          customer_name = $6,
          contact_number = $7,
          action_taken = $8,
          handled_by = $9,
          estimated_loss = $10,
          quantity = $11,
          items_involved = $12,
          remarks = $13,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $14
      `,
      [
        draft.incidentDate,
        draft.incidentTime,
        draft.staffOnDuty,
        draft.incidentType,
        draft.whatHappened,
        draft.customerName,
        draft.contactNumber,
        draft.actionTaken,
        draft.handledBy,
        draft.estimatedLoss,
        draft.quantity,
        draft.itemsInvolved,
        draft.remarks,
        id,
      ],
    )
  } else {
    await database.execute(
      `
        INSERT INTO incident_reports (
          incident_date, incident_time, staff_on_duty, incident_type,
          what_happened, customer_name, contact_number, action_taken,
          handled_by, estimated_loss, quantity, items_involved, remarks, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        draft.incidentDate,
        draft.incidentTime,
        draft.staffOnDuty,
        draft.incidentType,
        draft.whatHappened,
        draft.customerName,
        draft.contactNumber,
        draft.actionTaken,
        draft.handledBy,
        draft.estimatedLoss,
        draft.quantity,
        draft.itemsInvolved,
        draft.remarks,
        createdBy,
      ],
    )
  }
}

export async function deleteIncidentReport(id: number): Promise<void> {
  const database = await getDatabase()
  await database.execute('DELETE FROM incident_reports WHERE id = $1', [id])
}

export async function listAvailableIncidentMonthKeys(): Promise<string[]> {
  const database = await getDatabase()
  const rows = await database.select<Array<{ monthKey: string }>>(
    `
      SELECT DISTINCT substr(incident_date, 1, 7) AS monthKey
      FROM incident_reports
      WHERE incident_date IS NOT NULL AND incident_date <> ''
      ORDER BY monthKey DESC
    `,
  )

  return rows.map((row) => row.monthKey)
}

export async function listDistinctIncidentCustomerNames(): Promise<string[]> {
  const database = await getDatabase()
  const rows = await database.select<Array<{ name: string }>>(
    `
      SELECT DISTINCT TRIM(customer_name) AS name
      FROM incident_reports
      WHERE customer_name IS NOT NULL AND TRIM(customer_name) <> ''
      ORDER BY name COLLATE NOCASE ASC
    `,
  )

  return rows.map((row) => row.name).filter(Boolean)
}

export async function listDistinctIncidentHandledBy(): Promise<string[]> {
  const database = await getDatabase()
  const rows = await database.select<Array<{ name: string }>>(
    `
      SELECT DISTINCT TRIM(handled_by) AS name
      FROM incident_reports
      WHERE handled_by IS NOT NULL AND TRIM(handled_by) <> ''
      ORDER BY name COLLATE NOCASE ASC
    `,
  )

  return rows.map((row) => row.name).filter(Boolean)
}

// ─── Transaction inventory templates (SALE stock-out sets) ───────────────────

export type TransactionTemplateItemLine = {
  inventoryItemId: number
  isItemActive: boolean
  itemName: string
  /** Quantity in the template's chosen sale unit. */
  quantity: number
  /** Per-unit selling price stored with the template. May differ from the
   *  inventory item's default selling price (e.g. a combo discount). */
  unitPrice: number
  /** Inventory item's base unit label (e.g. "gallon"). */
  unitLabel: string
  /** Empty string when authored in the base unit, otherwise the alt unit. */
  saleUnitLabel: string
  /** Snapshotted conversion ratio (1 = base unit). */
  saleUnitFactor: number
  saleUnitId: number | null
  sortOrder: number
}

export type TransactionTemplateSummary = {
  description: string
  id: number
  isActive: boolean
  items: TransactionTemplateItemLine[]
  name: string
}

export type TransactionTemplateItemDraft = {
  inventoryItemId: number
  quantity: number
  sortOrder?: number
  /** Optional. When omitted, persists 0 — the apply step then falls back to
   *  the inventory item's selling price. */
  unitPrice?: number
  /** Sale-unit snapshot for templates. Leave undefined to mean "base unit". */
  saleUnitLabel?: string
  saleUnitFactor?: number
  saleUnitId?: number | null
}

export type TransactionTemplateDraft = {
  description: string
  id?: number
  isActive: boolean
  items: TransactionTemplateItemDraft[]
  name: string
}

type TransactionTemplateFlatRow = {
  inventory_item_id: number | null
  item_is_active: number | null
  item_name: string | null
  quantity: number | null
  sale_unit_factor: number | null
  sale_unit_id: number | null
  sale_unit_label: string | null
  sort_order: number | null
  template_description: string
  template_id: number
  template_is_active: number
  template_name: string
  unit_label: string | null
  unit_price: number | null
}

function mapFlatRowsToTemplateSummaries(rows: TransactionTemplateFlatRow[]): TransactionTemplateSummary[] {
  const byId = new Map<number, TransactionTemplateSummary>()
  for (const row of rows) {
    let t = byId.get(row.template_id)
    if (!t) {
      t = {
        description: row.template_description,
        id: row.template_id,
        isActive: Boolean(row.template_is_active),
        items: [],
        name: row.template_name,
      }
      byId.set(row.template_id, t)
    }
    if (row.inventory_item_id != null && row.quantity != null) {
      const rawFactor = row.sale_unit_factor != null ? Number(row.sale_unit_factor) : NaN
      t.items.push({
        inventoryItemId: row.inventory_item_id,
        isItemActive: Boolean(row.item_is_active),
        itemName: row.item_name ?? '(unknown item)',
        quantity: toNumber(row.quantity),
        saleUnitFactor: Number.isFinite(rawFactor) && rawFactor > 0 ? rawFactor : 1,
        saleUnitId: row.sale_unit_id != null ? Number(row.sale_unit_id) : null,
        saleUnitLabel: row.sale_unit_label != null ? String(row.sale_unit_label) : '',
        sortOrder: row.sort_order ?? 0,
        unitLabel: row.unit_label ?? '',
        unitPrice: row.unit_price != null ? toNumber(row.unit_price) : 0,
      })
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function listTransactionTemplates(): Promise<TransactionTemplateSummary[]> {
  const database = await getDatabase()
  const rows = await database.select<TransactionTemplateFlatRow[]>(
    `
      SELECT
        tt.id AS template_id,
        tt.name AS template_name,
        tt.description AS template_description,
        tt.is_active AS template_is_active,
        ti.inventory_item_id AS inventory_item_id,
        ti.quantity AS quantity,
        ti.unit_price AS unit_price,
        ti.sale_unit_label AS sale_unit_label,
        ti.sale_unit_factor AS sale_unit_factor,
        ti.sale_unit_id AS sale_unit_id,
        ti.sort_order AS sort_order,
        i.name AS item_name,
        i.unit_label AS unit_label,
        i.is_active AS item_is_active
      FROM transaction_templates tt
      LEFT JOIN transaction_template_items ti ON ti.template_id = tt.id
      LEFT JOIN inventory_items i ON i.id = ti.inventory_item_id
      ORDER BY tt.name COLLATE NOCASE ASC, ti.sort_order ASC, ti.id ASC
    `,
  )
  return mapFlatRowsToTemplateSummaries(rows)
}

export async function getTransactionTemplateById(id: number): Promise<TransactionTemplateSummary | null> {
  const database = await getDatabase()
  const rows = await database.select<TransactionTemplateFlatRow[]>(
    `
      SELECT
        tt.id AS template_id,
        tt.name AS template_name,
        tt.description AS template_description,
        tt.is_active AS template_is_active,
        ti.inventory_item_id AS inventory_item_id,
        ti.quantity AS quantity,
        ti.unit_price AS unit_price,
        ti.sale_unit_label AS sale_unit_label,
        ti.sale_unit_factor AS sale_unit_factor,
        ti.sale_unit_id AS sale_unit_id,
        ti.sort_order AS sort_order,
        i.name AS item_name,
        i.unit_label AS unit_label,
        i.is_active AS item_is_active
      FROM transaction_templates tt
      LEFT JOIN transaction_template_items ti ON ti.template_id = tt.id
      LEFT JOIN inventory_items i ON i.id = ti.inventory_item_id
      WHERE tt.id = $1
      ORDER BY ti.sort_order ASC, ti.id ASC
    `,
    [id],
  )
  const list = mapFlatRowsToTemplateSummaries(rows)
  return list[0] ?? null
}

export async function saveTransactionTemplate(draft: TransactionTemplateDraft): Promise<number> {
  const database = await getDatabase()
  const name = draft.name.trim()
  if (!name) {
    throw new Error('Template name is required.')
  }

  const seenItemIds = new Set<number>()
  for (const item of draft.items) {
    if (!Number.isFinite(item.inventoryItemId) || item.inventoryItemId <= 0) {
      throw new Error('Each line must reference a valid inventory item.')
    }
    if (seenItemIds.has(item.inventoryItemId)) {
      throw new Error('Duplicate inventory item in template.')
    }
    seenItemIds.add(item.inventoryItemId)
    const q = Number(item.quantity)
    if (!Number.isFinite(q) || q <= 0) {
      throw new Error('Each line must have a positive quantity.')
    }
    if (item.unitPrice != null) {
      const u = Number(item.unitPrice)
      if (!Number.isFinite(u) || u < 0) {
        throw new Error('Each line must have a non-negative unit price.')
      }
    }
  }

  if (draft.id) {
    await database.execute(
      `
        UPDATE transaction_templates
        SET
          name = $1,
          description = $2,
          is_active = $3,
          updated_at = datetime('now')
        WHERE id = $4
      `,
      [name, draft.description.trim(), draft.isActive ? 1 : 0, draft.id],
    )
    await database.execute(`DELETE FROM transaction_template_items WHERE template_id = $1`, [draft.id])
    let order = 0
    for (const item of draft.items) {
      const unitPrice =
        item.unitPrice != null && Number.isFinite(item.unitPrice) && item.unitPrice >= 0
          ? item.unitPrice
          : 0
      const factor =
        item.saleUnitFactor != null &&
        Number.isFinite(item.saleUnitFactor) &&
        item.saleUnitFactor > 0
          ? item.saleUnitFactor
          : 1
      const altLabel = item.saleUnitLabel?.trim() ?? ''
      const saleUnitId =
        item.saleUnitId != null && Number.isFinite(Number(item.saleUnitId))
          ? Number(item.saleUnitId)
          : null
      await database.execute(
        `
          INSERT INTO transaction_template_items (
            template_id, inventory_item_id, quantity, unit_price,
            sale_unit_label, sale_unit_factor, sale_unit_id, sort_order
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          draft.id,
          item.inventoryItemId,
          item.quantity,
          unitPrice,
          altLabel,
          factor,
          saleUnitId,
          item.sortOrder ?? order,
        ],
      )
      order += 1
    }
    return draft.id
  }

  const insertResult = await database.execute(
    `
      INSERT INTO transaction_templates (name, description, is_active)
      VALUES ($1, $2, $3)
    `,
    [name, draft.description.trim(), draft.isActive ? 1 : 0],
  )
  const lid = insertResult.lastInsertId
  const templateId = typeof lid === 'number' ? lid : Number(lid)
  if (!Number.isFinite(templateId) || templateId <= 0) {
    throw new Error('Failed to create template.')
  }
  let order = 0
  for (const item of draft.items) {
    const unitPrice =
      item.unitPrice != null && Number.isFinite(item.unitPrice) && item.unitPrice >= 0
        ? item.unitPrice
        : 0
    const factor =
      item.saleUnitFactor != null &&
      Number.isFinite(item.saleUnitFactor) &&
      item.saleUnitFactor > 0
        ? item.saleUnitFactor
        : 1
    const altLabel = item.saleUnitLabel?.trim() ?? ''
    const saleUnitId =
      item.saleUnitId != null && Number.isFinite(Number(item.saleUnitId))
        ? Number(item.saleUnitId)
        : null
    await database.execute(
      `
        INSERT INTO transaction_template_items (
          template_id, inventory_item_id, quantity, unit_price,
          sale_unit_label, sale_unit_factor, sale_unit_id, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        templateId,
        item.inventoryItemId,
        item.quantity,
        unitPrice,
        altLabel,
        factor,
        saleUnitId,
        item.sortOrder ?? order,
      ],
    )
    order += 1
  }
  return templateId
}

export async function deleteTransactionTemplate(id: number): Promise<void> {
  const database = await getDatabase()
  // `inventory_movements.template_id` references `transaction_templates(id)`
  // with no ON DELETE clause (defined in migration 16), which means a template
  // that has ever been used in a sale would be blocked from deletion by the
  // foreign key. Nullify those references first so the template — and its
  // line items via ON DELETE CASCADE — can be removed cleanly. The historical
  // movements stay attached to their transactions; only the template link
  // is dropped.
  await database.execute(
    `UPDATE inventory_movements SET template_id = NULL WHERE template_id = $1`,
    [id],
  )
  await database.execute(`DELETE FROM transaction_templates WHERE id = $1`, [id])
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export type InventoryCategory = {
  id: number
  code: string
  isActive: boolean
  isSystem: boolean
  label: string
  relatedRecordsCount: number
  sortOrder: number
}

export type InventoryCategoryDraft = {
  code: string
  isActive: boolean
  label: string
  sortOrder: number
}

export type InventoryItem = {
  /** Alternate sale units (e.g. selling a "gallon" item by the "cup"). Always
   * sorted by `sortOrder` then label. Empty when the item has no alt units. */
  altUnits: InventoryItemUnit[]
  categoryCode: string
  categoryId: number | null
  categoryLabel: string
  category: string
  costPerUnit: number
  currentStock: number
  description: string
  id: number
  isActive: boolean
  isLowStock: boolean
  lastMaintenanceDate: string
  lastRestockedDate: string | null
  lowStockThreshold: number
  name: string
  /** Default per-unit selling price used when the item is added to a sale. */
  sellingPrice: number
  status: string
  stockValue: number
  supplier: string
  /** FK to the suppliers table. Null when no supplier is set. The free-text
   * `supplier` name is kept alongside for display/backup compatibility. */
  supplierId: number | null
  unitLabel: string
  unitType: string
}

export type InventoryItemUnit = {
  id: number
  itemId: number
  unitLabel: string
  /** How many of this alt unit fit in one base unit (e.g. 31 cups per gallon). */
  unitsPerBase: number
  /** Optional default per-unit price for this alt unit. 0 means "compute as
   * inventory's selling price ÷ unitsPerBase" at point-of-sale. */
  unitPrice: number
  sortOrder: number
  isActive: boolean
}

export type InventoryItemUnitDraft = {
  /** Set when updating an existing alt unit, omit to insert a new one. */
  id?: number
  unitLabel: string
  unitsPerBase: number
  unitPrice: number
  sortOrder?: number
  isActive?: boolean
}

export type InventoryItemDraft = {
  /** Optional. When provided, replaces the item's alt unit set atomically.
   * Pass `[]` to remove all alt units; omit to leave them untouched. */
  altUnits?: InventoryItemUnitDraft[]
  category: string
  categoryId?: number | null
  costPerUnit: number
  description: string
  isActive: boolean
  lastMaintenanceDate: string
  lowStockThreshold: number
  name: string
  sellingPrice: number
  status: string
  supplier: string
  /** Optional explicit supplier FK. When omitted, saveInventoryItem derives it
   * from the free-text `supplier` name (find-or-create). */
  supplierId?: number | null
  unitLabel: string
  unitType: string
}

export type InventoryMovement = {
  createdAt: string
  createdByName: string | null
  id: number
  itemId: number
  itemName: string
  movementDate: string
  movementType: 'IN' | 'OUT'
  notes: string
  quantity: number
  templateId: number | null
  templateName: string | null
  transactionId: number | null
  unitCost: number
  unitLabel: string
}

export type InventoryMovementDraft = {
  itemId: number
  movementDate: string
  movementType: 'IN' | 'OUT'
  notes: string
  quantity: number
  templateId?: number | null
  transactionId?: number | null
  unitCost: number
}

type InventoryItemRow = {
  categoryCode: string
  categoryId: number | null
  categoryLabel: string
  costPerUnit: number
  currentStock: number
  description: string
  id: number
  isActive: number
  lastMaintenanceDate: string
  lastRestockedDate: string | null
  lowStockThreshold: number
  name: string
  sellingPrice: number
  status: string
  supplier: string
  supplierId: number | null
  unitLabel: string
  unitType: string
}

type InventoryCategoryRow = {
  code: string
  id: number
  isActive: number
  isSystem: number
  label: string
  relatedRecordsCount: number
  sortOrder: number
}

async function resolveInventoryCategory(
  database: Database,
  categoryId?: number | null,
  categoryCode?: string,
): Promise<{ code: string; id: number | null }> {
  if (categoryId != null) {
    const byId = await database.select<Array<{ code: string; id: number }>>(
      `
        SELECT id, code
        FROM inventory_categories
        WHERE id = $1
        LIMIT 1
      `,
      [categoryId],
    )
    if (byId[0]) {
      return { code: byId[0].code, id: byId[0].id }
    }
  }

  const normalizedCode = normalizeInventoryCategoryCode(categoryCode ?? '')
  const byCode = await database.select<Array<{ code: string; id: number }>>(
    `
      SELECT id, code
      FROM inventory_categories
      WHERE code = $1
      LIMIT 1
    `,
    [normalizedCode],
  )
  if (byCode[0]) {
    return { code: byCode[0].code, id: byCode[0].id }
  }

  const other = await database.select<Array<{ code: string; id: number }>>(
    `
      SELECT id, code
      FROM inventory_categories
      WHERE code = 'other'
      LIMIT 1
    `,
  )
  if (other[0]) {
    return { code: other[0].code, id: other[0].id }
  }

  return { code: normalizedCode || 'other', id: categoryId ?? null }
}

export async function listInventoryCategories(includeInactive = false): Promise<InventoryCategory[]> {
  const database = await getDatabase()
  const rows = await database.select<InventoryCategoryRow[]>(
    `
      SELECT
        c.id,
        c.code,
        c.label,
        c.is_system AS isSystem,
        c.is_active AS isActive,
        c.sort_order AS sortOrder,
        COUNT(i.id) AS relatedRecordsCount
      FROM inventory_categories c
      LEFT JOIN inventory_items i
        ON i.category_id = c.id
        OR (i.category_id IS NULL AND i.category = c.code)
      ${includeInactive ? '' : 'WHERE c.is_active = 1'}
      GROUP BY c.id
      ORDER BY c.sort_order, c.label
    `,
  )
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    isActive: Boolean(row.isActive),
    isSystem: Boolean(row.isSystem),
    label: row.label,
    relatedRecordsCount: toNumber(row.relatedRecordsCount),
    sortOrder: toNumber(row.sortOrder),
  }))
}

export async function saveInventoryCategory(input: InventoryCategoryDraft, id?: number): Promise<number> {
  const database = await getDatabase()
  const code = normalizeInventoryCategoryCode(input.code)
  const label = input.label.trim()
  const sortOrder = Math.max(0, Math.floor(toNumber(input.sortOrder)))
  const isActive = input.isActive ? 1 : 0

  if (id) {
    await database.execute(
      `
        UPDATE inventory_categories
        SET code = $1,
            label = $2,
            is_active = $3,
            sort_order = $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
      `,
      [code, label, isActive, sortOrder, id],
    )
    return id
  }

  const result = await database.execute(
    `
      INSERT INTO inventory_categories (code, label, is_system, is_active, sort_order)
      VALUES ($1, $2, 0, $3, $4)
    `,
    [code, label, isActive, sortOrder],
  )
  return Number(result.lastInsertId)
}

export async function deleteInventoryCategory(id: number, transferToCategoryId?: number): Promise<void> {
  const database = await getDatabase()
  const sourceRows = await database.select<Array<{ code: string; isSystem: number }>>(
    `
      SELECT code, is_system AS isSystem
      FROM inventory_categories
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  )
  const source = sourceRows[0]
  if (!source) {
    throw new Error('Inventory category not found.')
  }

  const refs = await database.select<CountRow[]>(
    `
      SELECT COUNT(*) AS count
      FROM inventory_items
      WHERE category_id = $1
        OR (
          category_id IS NULL
          AND category = (
            SELECT code
            FROM inventory_categories
            WHERE id = $1
            LIMIT 1
          )
        )
    `,
    [id],
  )
  const hasReferences = toNumber(refs[0]?.count) > 0

  if (hasReferences && transferToCategoryId == null) {
    throw new Error('This category has related inventory items. Select another category to transfer data.')
  }

  if (transferToCategoryId != null) {
    if (transferToCategoryId === id) {
      throw new Error('Transfer category must be different from the category being deleted.')
    }
    const transfer = await resolveInventoryCategory(database, transferToCategoryId)
    if (transfer.id == null) {
      throw new Error('Transfer category not found.')
    }
    await database.execute(
      `
        UPDATE inventory_items
        SET category_id = $1,
            category = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE category_id = $3
           OR (category_id IS NULL AND category = $4)
      `,
      [transfer.id, transfer.code, id, source.code],
    )
  }

  const isSystem = Boolean(source.isSystem)

  if (isSystem) {
    await database.execute(
      `
        UPDATE inventory_categories
        SET is_active = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [id],
    )
    return
  }

  await database.execute(
    `
      DELETE FROM inventory_categories
      WHERE id = $1
        AND is_system = 0
    `,
    [id],
  )
}

type InventoryMovementRow = {
  created_at: string
  created_by_name: string | null
  id: number
  item_id: number
  item_name: string
  movement_date: string
  movement_type: string
  notes: string
  quantity: number
  template_id: number | null
  template_name: string | null
  transaction_id: number | null
  unit_cost: number
  unit_label: string
}

export async function listInventoryItems(filters?: {
  category?: string
  includeInactive?: boolean
  stockStatus?: 'all' | 'low' | 'out' | 'in'
}): Promise<InventoryItem[]> {
  const database = await getDatabase()
  const conditions: string[] = []
  const params: unknown[] = []

  if (!filters?.includeInactive) {
    conditions.push('i.is_active = 1')
  }
  if (filters?.category) {
    params.push(filters.category)
    conditions.push(`COALESCE(c.code, lc.code, 'other') = $${params.length}`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await database.select<InventoryItemRow[]>(
    `
      SELECT
        i.id,
        i.name,
        i.description,
        i.unit_type AS unitType,
        i.unit_label AS unitLabel,
        i.cost_per_unit AS costPerUnit,
        i.selling_price AS sellingPrice,
        i.is_active AS isActive,
        i.low_stock_threshold AS lowStockThreshold,
        i.category_id AS categoryId,
        COALESCE(c.code, lc.code, 'other') AS categoryCode,
        COALESCE(c.label, lc.label, 'Other') AS categoryLabel,
        i.supplier,
        i.supplier_id AS supplierId,
        i.status,
        i.last_maintenance_date AS lastMaintenanceDate,
        i.current_stock AS currentStock,
        (SELECT MAX(m2.movement_date) FROM inventory_movements m2 WHERE m2.item_id = i.id AND m2.movement_type = 'IN') AS lastRestockedDate
      FROM inventory_items i
      LEFT JOIN inventory_categories c ON c.id = i.category_id
      LEFT JOIN inventory_categories lc ON lc.code = i.category
      ${where}
      ORDER BY i.name
    `,
    params,
  )

  // Batch-load alt units for all items in one query to avoid N+1.
  const altUnitsByItemId = new Map<number, InventoryItemUnit[]>()
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id)
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
    const altRows = await database.select<
      Array<{
        id: number
        item_id: number
        unit_label: string
        units_per_base: number
        unit_price: number
        sort_order: number
        is_active: number
      }>
    >(
      `
        SELECT id, item_id, unit_label, units_per_base, unit_price,
               sort_order, is_active
        FROM inventory_item_units
        WHERE item_id IN (${placeholders})
        ORDER BY item_id, sort_order, unit_label
      `,
      ids,
    )
    for (const r of altRows) {
      const list = altUnitsByItemId.get(r.item_id) ?? []
      list.push({
        id: Number(r.id),
        itemId: Number(r.item_id),
        unitLabel: String(r.unit_label ?? ''),
        unitsPerBase: toNumber(r.units_per_base),
        unitPrice: toNumber(r.unit_price),
        sortOrder: Number(r.sort_order ?? 0),
        isActive: Boolean(r.is_active),
      })
      altUnitsByItemId.set(r.item_id, list)
    }
  }

  let items = rows.map((row) => {
    const currentStock = toNumber(row.currentStock)
    const costPerUnit = toNumber(row.costPerUnit)
    const sellingPrice = toNumber(row.sellingPrice)
    const lowStockThreshold = toNumber(row.lowStockThreshold)
    return {
      altUnits: altUnitsByItemId.get(row.id) ?? [],
      category: row.categoryCode,
      categoryCode: row.categoryCode,
      categoryId: row.categoryId,
      categoryLabel: row.categoryLabel,
      costPerUnit,
      currentStock,
      description: row.description,
      id: row.id,
      isActive: Boolean(row.isActive),
      isLowStock: currentStock <= lowStockThreshold,
      lastMaintenanceDate: row.lastMaintenanceDate,
      lastRestockedDate: row.lastRestockedDate,
      lowStockThreshold,
      name: row.name,
      sellingPrice,
      status: row.status,
      stockValue: currentStock * costPerUnit,
      supplier: row.supplier,
      supplierId: row.supplierId,
      unitLabel: row.unitLabel,
      unitType: row.unitType,
    }
  })

  if (filters?.stockStatus === 'low') {
    items = items.filter((i) => i.isLowStock && i.currentStock > 0)
  } else if (filters?.stockStatus === 'out') {
    items = items.filter((i) => i.currentStock <= 0)
  } else if (filters?.stockStatus === 'in') {
    items = items.filter((i) => !i.isLowStock && i.currentStock > 0)
  }

  return items
}

/**
 * Update every `inventory_movements` row for the given item that still has
 * `unit_cost = 0` so it picks up the supplied non-zero cost. This is used
 * when the user originally added an item without a cost (the linked stock
 * movements were created with 0 as a placeholder) and later sets the real
 * cost on the inventory item — the placeholder rows are then "filled in".
 *
 * Returns the number of movement rows that were updated, so callers can
 * surface a toast like "Updated 3 past stock movements with the new cost."
 *
 * Movements that already have a non-zero `unit_cost` are left untouched —
 * they are deliberate historical snapshots of what was paid/charged at the
 * time of the movement.
 */
export async function backfillZeroUnitCostMovements(
  itemId: number,
  newCostPerUnit: number,
): Promise<number> {
  if (!Number.isFinite(newCostPerUnit) || newCostPerUnit <= 0) return 0
  const database = await getDatabase()
  const rows = await database.select<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM inventory_movements WHERE item_id = $1 AND unit_cost = 0`,
    [itemId],
  )
  const count = rows.length > 0 ? Number(rows[0]?.count ?? 0) : 0
  if (count === 0) return 0
  await database.execute(
    `UPDATE inventory_movements SET unit_cost = $1 WHERE item_id = $2 AND unit_cost = 0`,
    [newCostPerUnit, itemId],
  )
  return count
}

/**
 * Resolve a free-text supplier name to a supplier id, creating the supplier row
 * if it doesn't exist yet. Returns null for an empty name. This keeps the item
 * form's free-text supplier field working while populating the supplier_id FK.
 */
async function resolveSupplierIdByName(
  database: Database,
  name: string,
): Promise<number | null> {
  const trimmed = name.trim()
  if (!trimmed) return null
  const existing = await database.select<Array<{ id: number }>>(
    `SELECT id FROM suppliers WHERE name = $1 LIMIT 1`,
    [trimmed],
  )
  if (existing[0]) return Number(existing[0].id)
  const res = await database.execute(`INSERT INTO suppliers (name) VALUES ($1)`, [trimmed])
  return res.lastInsertId as number
}

export async function saveInventoryItem(draft: InventoryItemDraft, id?: number): Promise<number> {
  const database = await getDatabase()
  const resolvedCategory = await resolveInventoryCategory(database, draft.categoryId, draft.category)

  const sellingPrice =
    Number.isFinite(draft.sellingPrice) && draft.sellingPrice >= 0 ? draft.sellingPrice : 0

  // An explicit supplierId wins; otherwise derive one from the free-text name.
  const supplierId =
    draft.supplierId !== undefined
      ? draft.supplierId
      : await resolveSupplierIdByName(database, draft.supplier)

  if (id) {
    await database.execute(
      `
        UPDATE inventory_items SET
          name = $1,
          description = $2,
          unit_type = $3,
          unit_label = $4,
          cost_per_unit = $5,
          is_active = $6,
          low_stock_threshold = $7,
          category_id = $8,
          category = $9,
          supplier = $10,
          status = $11,
          last_maintenance_date = $12,
          selling_price = $13,
          supplier_id = $14,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $15
      `,
      [
        draft.name,
        draft.description,
        draft.unitType,
        draft.unitLabel,
        draft.costPerUnit,
        draft.isActive ? 1 : 0,
        draft.lowStockThreshold,
        resolvedCategory.id,
        resolvedCategory.code,
        draft.supplier,
        draft.status,
        draft.lastMaintenanceDate,
        sellingPrice,
        supplierId,
        id,
      ],
    )
    if (draft.altUnits !== undefined) {
      await replaceInventoryItemUnits(id, draft.altUnits)
    }
    // NOTE: Back-fill of past `inventory_movements` rows that have
    // `unit_cost = 0` is intentionally NOT done here. Callers (the inventory
    // page) invoke `backfillZeroUnitCostMovements` explicitly so they can
    // surface a toast with the affected row count. Doing it silently here
    // would also mean every callsite (backup import, etc.) inherits the
    // mutation, which is not always desirable.
    return id
  }

  const result = await database.execute(
    `
      INSERT INTO inventory_items (
        name,
        description,
        unit_type,
        unit_label,
        cost_per_unit,
        is_active,
        low_stock_threshold,
        category_id,
        category,
        supplier,
        status,
        last_maintenance_date,
        selling_price,
        supplier_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `,
    [
      draft.name,
      draft.description,
      draft.unitType,
      draft.unitLabel,
      draft.costPerUnit,
      draft.isActive ? 1 : 0,
      draft.lowStockThreshold,
      resolvedCategory.id,
      resolvedCategory.code,
      draft.supplier,
      draft.status,
      draft.lastMaintenanceDate,
      sellingPrice,
      supplierId,
    ],
  )
  const newId = result.lastInsertId as number
  if (draft.altUnits !== undefined) {
    await replaceInventoryItemUnits(newId, draft.altUnits)
  }
  return newId
}

export async function listInventoryItemUnits(itemId: number): Promise<InventoryItemUnit[]> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      id: number
      item_id: number
      unit_label: string
      units_per_base: number
      unit_price: number
      sort_order: number
      is_active: number
    }>
  >(
    `
      SELECT id, item_id, unit_label, units_per_base, unit_price,
             sort_order, is_active
      FROM inventory_item_units
      WHERE item_id = $1
      ORDER BY sort_order ASC, unit_label ASC
    `,
    [itemId],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    itemId: Number(r.item_id),
    unitLabel: String(r.unit_label ?? ''),
    unitsPerBase: toNumber(r.units_per_base),
    unitPrice: toNumber(r.unit_price),
    sortOrder: Number(r.sort_order ?? 0),
    isActive: Boolean(r.is_active),
  }))
}

/**
 * Atomically replace the alt unit set for an item. Existing rows that
 * collide on `(item_id, unit_label)` are updated in place to preserve their
 * `id` (so historical line items still reference them); any prior rows
 * whose label is not in the new set are deleted.
 */
export async function replaceInventoryItemUnits(
  itemId: number,
  drafts: InventoryItemUnitDraft[],
): Promise<void> {
  const database = await getDatabase()
  const normalized = drafts
    .map((d, idx) => {
      const label = (d.unitLabel ?? '').trim()
      const ratio = Number(d.unitsPerBase)
      const price = Number(d.unitPrice)
      return {
        id: d.id != null && Number.isFinite(d.id) && d.id > 0 ? Number(d.id) : null,
        unitLabel: label,
        unitsPerBase: Number.isFinite(ratio) && ratio > 0 ? ratio : NaN,
        unitPrice: Number.isFinite(price) && price >= 0 ? price : 0,
        sortOrder: d.sortOrder ?? idx,
        isActive: d.isActive == null ? true : Boolean(d.isActive),
      }
    })
    .filter((d) => d.unitLabel !== '' && Number.isFinite(d.unitsPerBase))

  // Reject duplicate labels in the same item to keep UNIQUE(item_id, unit_label) clean.
  const seen = new Set<string>()
  for (const d of normalized) {
    const key = d.unitLabel.toLowerCase()
    if (seen.has(key)) {
      throw new Error(`Duplicate alt unit label "${d.unitLabel}".`)
    }
    seen.add(key)
  }

  const existing = await database.select<Array<{ id: number; unit_label: string }>>(
    `SELECT id, unit_label FROM inventory_item_units WHERE item_id = $1`,
    [itemId],
  )
  const existingByLabel = new Map<string, number>()
  for (const r of existing) {
    existingByLabel.set(String(r.unit_label).toLowerCase(), Number(r.id))
  }

  const keepIds = new Set<number>()
  for (const d of normalized) {
    const matchedId =
      d.id != null && existing.some((e) => Number(e.id) === d.id)
        ? d.id
        : existingByLabel.get(d.unitLabel.toLowerCase()) ?? null
    if (matchedId != null) {
      await database.execute(
        `
          UPDATE inventory_item_units SET
            unit_label = $1,
            units_per_base = $2,
            unit_price = $3,
            sort_order = $4,
            is_active = $5
          WHERE id = $6 AND item_id = $7
        `,
        [
          d.unitLabel,
          d.unitsPerBase,
          d.unitPrice,
          d.sortOrder,
          d.isActive ? 1 : 0,
          matchedId,
          itemId,
        ],
      )
      keepIds.add(matchedId)
    } else {
      const ins = await database.execute(
        `
          INSERT INTO inventory_item_units (
            item_id, unit_label, units_per_base, unit_price, sort_order, is_active
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          itemId,
          d.unitLabel,
          d.unitsPerBase,
          d.unitPrice,
          d.sortOrder,
          d.isActive ? 1 : 0,
        ],
      )
      const lid = ins.lastInsertId
      const newId = typeof lid === 'number' ? lid : Number(lid)
      if (Number.isFinite(newId) && newId > 0) keepIds.add(newId)
    }
  }

  // Delete any prior rows that weren't kept. ON DELETE SET NULL on the
  // line/template snapshots preserves the historical conversion factor.
  for (const e of existing) {
    if (!keepIds.has(Number(e.id))) {
      await database.execute(`DELETE FROM inventory_item_units WHERE id = $1`, [e.id])
    }
  }
}

export async function listInventoryMovements(filters?: {
  dateFrom?: string
  dateTo?: string
  itemId?: number | null
  limit?: number
  monthKey?: string
  movementType?: string
}): Promise<InventoryMovement[]> {
  const database = await getDatabase()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.monthKey) {
    params.push(filters.monthKey)
    conditions.push(`substr(m.movement_date, 1, 7) = $${params.length}`)
  }

  if (filters?.dateFrom) {
    params.push(filters.dateFrom)
    conditions.push(`m.movement_date >= $${params.length}`)
  }

  if (filters?.dateTo) {
    params.push(filters.dateTo)
    conditions.push(`m.movement_date <= $${params.length}`)
  }

  if (filters?.itemId) {
    params.push(filters.itemId)
    conditions.push(`m.item_id = $${params.length}`)
  }

  if (filters?.movementType) {
    params.push(filters.movementType)
    conditions.push(`m.movement_type = $${params.length}`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limitClause = filters?.limit != null ? `LIMIT ${Number(filters.limit)}` : ''

  const rows = await database.select<InventoryMovementRow[]>(
    `
      SELECT
        m.id,
        m.item_id,
        m.movement_type,
        m.quantity,
        m.unit_cost,
        m.notes,
        m.movement_date,
        m.created_at,
        m.transaction_id,
        m.template_id,
        tt.name AS template_name,
        i.name AS item_name,
        i.unit_label,
        u.display_name AS created_by_name
      FROM inventory_movements m
      JOIN inventory_items i ON i.id = m.item_id
      LEFT JOIN users u ON u.id = m.created_by
      LEFT JOIN transaction_templates tt ON tt.id = m.template_id
      ${where}
      ORDER BY m.movement_date DESC, m.id DESC
      ${limitClause}
    `,
    params,
  )

  return rows.map((row) => ({
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    movementDate: row.movement_date,
    movementType: row.movement_type as 'IN' | 'OUT',
    notes: row.notes,
    quantity: toNumber(row.quantity),
    templateId: row.template_id ?? null,
    templateName: row.template_name ?? null,
    transactionId: row.transaction_id ?? null,
    unitCost: toNumber(row.unit_cost),
    unitLabel: row.unit_label,
  }))
}

export async function listInventoryMovementsByTransaction(transactionId: number): Promise<InventoryMovement[]> {
  const database = await getDatabase()
  const rows = await database.select<InventoryMovementRow[]>(
    `
      SELECT
        m.id,
        m.item_id,
        m.movement_type,
        m.quantity,
        m.unit_cost,
        m.notes,
        m.movement_date,
        m.created_at,
        m.transaction_id,
        m.template_id,
        tt.name AS template_name,
        i.name AS item_name,
        i.unit_label,
        u.display_name AS created_by_name
      FROM inventory_movements m
      JOIN inventory_items i ON i.id = m.item_id
      LEFT JOIN users u ON u.id = m.created_by
      LEFT JOIN transaction_templates tt ON tt.id = m.template_id
      WHERE m.transaction_id = $1
      ORDER BY m.movement_date DESC, m.id DESC
    `,
    [transactionId],
  )

  return rows.map((row) => ({
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    movementDate: row.movement_date,
    movementType: row.movement_type as 'IN' | 'OUT',
    notes: row.notes,
    quantity: toNumber(row.quantity),
    templateId: row.template_id ?? null,
    templateName: row.template_name ?? null,
    transactionId: row.transaction_id ?? null,
    unitCost: toNumber(row.unit_cost),
    unitLabel: row.unit_label,
  }))
}

export async function saveInventoryMovement(
  draft: InventoryMovementDraft,
  userId: number,
  id?: number,
): Promise<void> {
  const database = await getDatabase()

  if (id) {
    if (draft.transactionId !== undefined && draft.templateId !== undefined) {
      await database.execute(
        `
          UPDATE inventory_movements SET
            item_id = $1,
            movement_type = $2,
            quantity = $3,
            unit_cost = $4,
            notes = $5,
            movement_date = $6,
            transaction_id = $7,
            template_id = $8
          WHERE id = $9
        `,
        [
          draft.itemId,
          draft.movementType,
          draft.quantity,
          draft.unitCost,
          draft.notes,
          draft.movementDate,
          draft.transactionId,
          draft.templateId,
          id,
        ],
      )
    } else if (draft.transactionId !== undefined) {
      await database.execute(
        `
          UPDATE inventory_movements SET
            item_id = $1,
            movement_type = $2,
            quantity = $3,
            unit_cost = $4,
            notes = $5,
            movement_date = $6,
            transaction_id = $7
          WHERE id = $8
        `,
        [draft.itemId, draft.movementType, draft.quantity, draft.unitCost, draft.notes, draft.movementDate, draft.transactionId, id],
      )
    } else if (draft.templateId !== undefined) {
      await database.execute(
        `
          UPDATE inventory_movements SET
            item_id = $1,
            movement_type = $2,
            quantity = $3,
            unit_cost = $4,
            notes = $5,
            movement_date = $6,
            template_id = $7
          WHERE id = $8
        `,
        [draft.itemId, draft.movementType, draft.quantity, draft.unitCost, draft.notes, draft.movementDate, draft.templateId, id],
      )
    } else {
      await database.execute(
        `
          UPDATE inventory_movements SET
            item_id = $1,
            movement_type = $2,
            quantity = $3,
            unit_cost = $4,
            notes = $5,
            movement_date = $6
          WHERE id = $7
        `,
        [draft.itemId, draft.movementType, draft.quantity, draft.unitCost, draft.notes, draft.movementDate, id],
      )
    }
    return
  }

  let movementTransactionId = draft.transactionId ?? null
  if (movementTransactionId == null && draft.movementType === 'IN') {
    const itemRows = await database.select<Array<{ name: string; unitLabel: string }>>(
      `
        SELECT name, unit_label AS unitLabel
        FROM inventory_items
        WHERE id = $1
        LIMIT 1
      `,
      [draft.itemId],
    )
    const item = itemRows[0]
    if (!item) {
      throw new Error('Inventory item not found.')
    }

    const expenseTypeRows = await database.select<Array<{ id: number }>>(
      `SELECT id FROM transaction_types WHERE code = 'EXPENSE' LIMIT 1`,
    )
    const expenseTypeId = expenseTypeRows[0]?.id
    if (!expenseTypeId) {
      throw new Error('Expense transaction type is not configured.')
    }

    const preferredCategoryRows = await database.select<Array<{ id: number }>>(
      `
        SELECT id
        FROM categories
        WHERE transaction_type_id = $1
          AND is_archived = 0
          AND LOWER(label) IN ('supplies', 'inventory', 'stock', 'other')
        ORDER BY
          CASE LOWER(label)
            WHEN 'supplies' THEN 0
            WHEN 'inventory' THEN 1
            WHEN 'stock' THEN 2
            WHEN 'other' THEN 3
            ELSE 99
          END
        LIMIT 1
      `,
      [expenseTypeId],
    )
    let expenseCategoryId = preferredCategoryRows[0]?.id
    if (!expenseCategoryId) {
      const fallbackRows = await database.select<Array<{ id: number }>>(
        `
          SELECT id
          FROM categories
          WHERE transaction_type_id = $1
            AND is_archived = 0
          ORDER BY id ASC
          LIMIT 1
        `,
        [expenseTypeId],
      )
      expenseCategoryId = fallbackRows[0]?.id
    }
    if (!expenseCategoryId) {
      throw new Error('No active expense category found for stock-in.')
    }

    const totalAmount = roundMoney(draft.quantity * draft.unitCost)
    const qtyLabel = `${draft.quantity}${item.unitLabel ? ` ${item.unitLabel}` : ''}`
    const notePart = draft.notes.trim() ? ` · ${draft.notes.trim()}` : ''
    const description = `Stock-in: ${item.name} (${qtyLabel})${notePart}`

    const transactionResult = await database.execute(
      `
        INSERT INTO transactions (
          entry_date,
          transaction_type_id,
          category_id,
          description,
          amount,
          staff_count,
          customer_id,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $6)
      `,
      [draft.movementDate, expenseTypeId, expenseCategoryId, description, totalAmount, userId],
    )
    const rawTxnId = transactionResult.lastInsertId
    const createdTxnId = typeof rawTxnId === 'number' ? rawTxnId : Number(rawTxnId)
    if (!Number.isFinite(createdTxnId) || createdTxnId <= 0) {
      throw new Error('Failed to create expense transaction for stock-in.')
    }
    movementTransactionId = createdTxnId
  }

  await database.execute(
    `
      INSERT INTO inventory_movements (item_id, movement_type, quantity, unit_cost, notes, movement_date, created_by, transaction_id, template_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      draft.itemId,
      draft.movementType,
      draft.quantity,
      draft.unitCost,
      draft.notes,
      draft.movementDate,
      userId,
      movementTransactionId,
      draft.templateId !== undefined ? draft.templateId : null,
    ],
  )
}

export async function deleteInventoryMovement(id: number): Promise<void> {
  const database = await getDatabase()
  await database.execute('DELETE FROM inventory_movements WHERE id = $1', [id])
}

// ─────────────────────────────────────────────────────────────────────────────
// Suppliers
// ─────────────────────────────────────────────────────────────────────────────

export type Supplier = {
  id: number
  name: string
  contactName: string
  phone: string
  email: string
  notes: string
  isActive: boolean
  /** Number of active inventory items pointing at this supplier. */
  itemCount: number
  /** Purchase orders referencing this supplier that are not yet closed. */
  openPoCount: number
}

export type SupplierDraft = {
  name: string
  contactName: string
  phone: string
  email: string
  notes: string
  isActive: boolean
}

export async function listSuppliers(includeInactive = false): Promise<Supplier[]> {
  const database = await getDatabase()
  const where = includeInactive ? '' : 'WHERE s.is_active = 1'
  const rows = await database.select<
    Array<{
      id: number
      name: string
      contact_name: string
      phone: string
      email: string
      notes: string
      is_active: number
      item_count: number
      open_po_count: number
    }>
  >(
    `
      SELECT
        s.id, s.name, s.contact_name, s.phone, s.email, s.notes, s.is_active,
        (SELECT COUNT(*) FROM inventory_items i WHERE i.supplier_id = s.id) AS item_count,
        (SELECT COUNT(*) FROM purchase_orders p WHERE p.supplier_id = s.id AND p.status IN ('draft', 'ordered')) AS open_po_count
      FROM suppliers s
      ${where}
      ORDER BY s.name COLLATE NOCASE
    `,
  )
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ''),
    contactName: String(r.contact_name ?? ''),
    phone: String(r.phone ?? ''),
    email: String(r.email ?? ''),
    notes: String(r.notes ?? ''),
    isActive: Boolean(r.is_active),
    itemCount: Number(r.item_count ?? 0),
    openPoCount: Number(r.open_po_count ?? 0),
  }))
}

export async function saveSupplier(draft: SupplierDraft, id?: number): Promise<number> {
  const database = await getDatabase()
  const name = draft.name.trim()
  if (!name) throw new Error('Supplier name is required.')
  if (id) {
    await database.execute(
      `
        UPDATE suppliers SET
          name = $1, contact_name = $2, phone = $3, email = $4, notes = $5,
          is_active = $6, updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
      `,
      [name, draft.contactName.trim(), draft.phone.trim(), draft.email.trim(), draft.notes.trim(), draft.isActive ? 1 : 0, id],
    )
    return id
  }
  const res = await database.execute(
    `
      INSERT INTO suppliers (name, contact_name, phone, email, notes, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [name, draft.contactName.trim(), draft.phone.trim(), draft.email.trim(), draft.notes.trim(), draft.isActive ? 1 : 0],
  )
  return res.lastInsertId as number
}

/**
 * Delete a supplier. Refuses when it is still referenced by items or POs so the
 * caller can prompt the user to reassign/deactivate first (mirrors the category
 * delete guard). Deactivating via saveSupplier is the soft alternative.
 */
export async function deleteSupplier(id: number): Promise<void> {
  const database = await getDatabase()
  const refs = await database.select<Array<{ item_count: number; po_count: number }>>(
    `
      SELECT
        (SELECT COUNT(*) FROM inventory_items WHERE supplier_id = $1) AS item_count,
        (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = $1) AS po_count
    `,
    [id],
  )
  const itemCount = Number(refs[0]?.item_count ?? 0)
  const poCount = Number(refs[0]?.po_count ?? 0)
  if (itemCount > 0 || poCount > 0) {
    throw new Error(
      `This supplier is used by ${itemCount} item(s) and ${poCount} purchase order(s). Reassign or deactivate it instead.`,
    )
  }
  await database.execute('DELETE FROM suppliers WHERE id = $1', [id])
}

// ─────────────────────────────────────────────────────────────────────────────
// Purchase orders
// ─────────────────────────────────────────────────────────────────────────────

export type PurchaseOrderStatus = 'draft' | 'ordered' | 'received' | 'cancelled'

export type PurchaseOrderLine = {
  id: number
  purchaseOrderId: number
  itemId: number
  itemName: string
  unitLabel: string
  quantity: number
  unitCost: number
  receivedQuantity: number
}

export type PurchaseOrder = {
  id: number
  supplierId: number | null
  supplierName: string | null
  status: PurchaseOrderStatus
  reference: string
  orderDate: string
  expectedDate: string
  receivedDate: string
  notes: string
  createdByName: string | null
  createdAt: string
  lineCount: number
  totalCost: number
  /** Populated by getPurchaseOrder; empty in the list view. */
  lines: PurchaseOrderLine[]
}

export type PurchaseOrderLineDraft = {
  id?: number
  itemId: number
  quantity: number
  unitCost: number
}

export type PurchaseOrderDraft = {
  supplierId: number | null
  status?: PurchaseOrderStatus
  reference: string
  orderDate: string
  expectedDate: string
  notes: string
  lines: PurchaseOrderLineDraft[]
}

const PO_STATUSES: PurchaseOrderStatus[] = ['draft', 'ordered', 'received', 'cancelled']

function normalizePoStatus(value: string): PurchaseOrderStatus {
  return (PO_STATUSES as string[]).includes(value) ? (value as PurchaseOrderStatus) : 'draft'
}

export async function listPurchaseOrders(filters?: {
  status?: PurchaseOrderStatus
  supplierId?: number
}): Promise<PurchaseOrder[]> {
  const database = await getDatabase()
  const conditions: string[] = []
  const params: unknown[] = []
  if (filters?.status) {
    params.push(filters.status)
    conditions.push(`p.status = $${params.length}`)
  }
  if (filters?.supplierId != null) {
    params.push(filters.supplierId)
    conditions.push(`p.supplier_id = $${params.length}`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await database.select<
    Array<{
      id: number
      supplier_id: number | null
      supplier_name: string | null
      status: string
      reference: string
      order_date: string
      expected_date: string
      received_date: string
      notes: string
      created_by_name: string | null
      created_at: string
      line_count: number
      total_cost: number
    }>
  >(
    `
      SELECT
        p.id, p.supplier_id, s.name AS supplier_name, p.status, p.reference,
        p.order_date, p.expected_date, p.received_date, p.notes, p.created_at,
        u.name AS created_by_name,
        (SELECT COUNT(*) FROM purchase_order_items pi WHERE pi.purchase_order_id = p.id) AS line_count,
        (SELECT COALESCE(SUM(pi.quantity * pi.unit_cost), 0) FROM purchase_order_items pi WHERE pi.purchase_order_id = p.id) AS total_cost
      FROM purchase_orders p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN users u ON u.id = p.created_by
      ${where}
      ORDER BY (p.order_date = '') ASC, p.order_date DESC, p.id DESC
    `,
    params,
  )
  return rows.map((r) => ({
    id: Number(r.id),
    supplierId: r.supplier_id != null ? Number(r.supplier_id) : null,
    supplierName: r.supplier_name ?? null,
    status: normalizePoStatus(r.status),
    reference: String(r.reference ?? ''),
    orderDate: String(r.order_date ?? ''),
    expectedDate: String(r.expected_date ?? ''),
    receivedDate: String(r.received_date ?? ''),
    notes: String(r.notes ?? ''),
    createdByName: r.created_by_name ?? null,
    createdAt: String(r.created_at ?? ''),
    lineCount: Number(r.line_count ?? 0),
    totalCost: toNumber(r.total_cost),
    lines: [],
  }))
}

export async function getPurchaseOrder(id: number): Promise<PurchaseOrder | null> {
  const database = await getDatabase()
  const headers = await listPurchaseOrders()
  const header = headers.find((h) => h.id === id)
  if (!header) return null
  const lineRows = await database.select<
    Array<{
      id: number
      purchase_order_id: number
      item_id: number
      item_name: string
      unit_label: string
      quantity: number
      unit_cost: number
      received_quantity: number
    }>
  >(
    `
      SELECT
        pi.id, pi.purchase_order_id, pi.item_id, i.name AS item_name,
        i.unit_label, pi.quantity, pi.unit_cost, pi.received_quantity
      FROM purchase_order_items pi
      JOIN inventory_items i ON i.id = pi.item_id
      WHERE pi.purchase_order_id = $1
      ORDER BY pi.id
    `,
    [id],
  )
  header.lines = lineRows.map((r) => ({
    id: Number(r.id),
    purchaseOrderId: Number(r.purchase_order_id),
    itemId: Number(r.item_id),
    itemName: String(r.item_name ?? ''),
    unitLabel: String(r.unit_label ?? ''),
    quantity: toNumber(r.quantity),
    unitCost: toNumber(r.unit_cost),
    receivedQuantity: toNumber(r.received_quantity),
  }))
  return header
}

export async function savePurchaseOrder(
  draft: PurchaseOrderDraft,
  id?: number,
  userId?: number | null,
): Promise<number> {
  const database = await getDatabase()
  const status = draft.status ? normalizePoStatus(draft.status) : 'draft'
  let poId: number
  if (id) {
    await database.execute(
      `
        UPDATE purchase_orders SET
          supplier_id = $1, status = $2, reference = $3, order_date = $4,
          expected_date = $5, notes = $6, updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
      `,
      [draft.supplierId, status, draft.reference.trim(), draft.orderDate, draft.expectedDate, draft.notes.trim(), id],
    )
    poId = id
    await database.execute('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [poId])
  } else {
    const res = await database.execute(
      `
        INSERT INTO purchase_orders (supplier_id, status, reference, order_date, expected_date, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [draft.supplierId, status, draft.reference.trim(), draft.orderDate, draft.expectedDate, draft.notes.trim(), userId ?? null],
    )
    poId = res.lastInsertId as number
  }
  for (const line of draft.lines) {
    if (!line.itemId || !(line.quantity > 0)) continue
    await database.execute(
      `
        INSERT INTO purchase_order_items (purchase_order_id, item_id, quantity, unit_cost)
        VALUES ($1, $2, $3, $4)
      `,
      [poId, line.itemId, line.quantity, line.unitCost],
    )
  }
  return poId
}

export async function setPurchaseOrderStatus(id: number, status: PurchaseOrderStatus): Promise<void> {
  const database = await getDatabase()
  await database.execute(
    `UPDATE purchase_orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [normalizePoStatus(status), id],
  )
}

export async function deletePurchaseOrder(id: number): Promise<void> {
  const database = await getDatabase()
  await database.execute('DELETE FROM purchase_orders WHERE id = $1', [id])
}

/**
 * Receive a purchase order: for each line with a positive received quantity,
 * record an IN inventory movement (which the stock-cache triggers apply) and
 * update the line's received_quantity. Flips the PO to 'received' and stamps
 * the received date. `movementDate` defaults to today.
 */
export async function receivePurchaseOrder(
  id: number,
  receipts: Array<{ lineId: number; receivedQuantity: number }>,
  userId: number,
  movementDate?: string,
): Promise<void> {
  const database = await getDatabase()
  const po = await getPurchaseOrder(id)
  if (!po) throw new Error('Purchase order not found.')
  const date = movementDate ?? format(new Date(), 'yyyy-MM-dd')
  const refLabel = po.reference.trim() || `PO #${po.id}`

  for (const receipt of receipts) {
    const line = po.lines.find((l) => l.id === receipt.lineId)
    if (!line) continue
    const qty = receipt.receivedQuantity
    if (!(qty > 0)) continue
    await saveInventoryMovement(
      {
        itemId: line.itemId,
        movementDate: date,
        movementType: 'IN',
        notes: `Received from ${refLabel}`,
        quantity: qty,
        unitCost: line.unitCost,
      },
      userId,
    )
    await database.execute(
      `UPDATE purchase_order_items SET received_quantity = received_quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [qty, line.id],
    )
  }
  await database.execute(
    `UPDATE purchase_orders SET status = 'received', received_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [date, id],
  )
}

export type ReorderDraftGroup = {
  supplierId: number | null
  supplierName: string | null
  lines: Array<PurchaseOrderLineDraft & { itemName: string; unitLabel: string }>
}

/**
 * Build one draft-PO group per supplier from the coverage report, containing the
 * items whose suggested reorder quantity is positive. Items with no supplier are
 * grouped under a null supplier. Powers "create PO from reorder suggestions".
 */
export async function buildReorderDraftsFromCoverage(usageWindowDays = 30): Promise<ReorderDraftGroup[]> {
  const coverage = await getInventoryCoverage(usageWindowDays)
  const needing = coverage.filter((c) => c.suggestedReorderQty > 0)
  const groups = new Map<string, ReorderDraftGroup>()
  for (const row of needing) {
    const key = row.supplierId == null ? 'none' : String(row.supplierId)
    let group = groups.get(key)
    if (!group) {
      group = { supplierId: row.supplierId, supplierName: row.supplierName, lines: [] }
      groups.set(key, group)
    }
    group.lines.push({
      itemId: row.id,
      itemName: row.name,
      unitLabel: row.unitLabel,
      quantity: row.suggestedReorderQty,
      unitCost: row.costPerUnit,
    })
  }
  return [...groups.values()]
}

export type InventoryItemSummary = {
  category: string
  categoryLabel: string
  currentStock: number
  id: number
  lowStockThreshold: number
  name: string
  stockValue: number
  totalIn: number
  totalInCost: number
  totalOut: number
  totalOutCost: number
  unitLabel: string
  wastageCostThisMonth: number
}

type InventoryItemSummaryRow = {
  category: string
  categoryLabel: string
  costPerUnit: number
  currentStock: number
  id: number
  lowStockThreshold: number
  name: string
  totalIn: number
  totalInCost: number
  totalOut: number
  totalOutCost: number
  unitLabel: string
  wastageCostThisMonth: number
}

export async function getInventoryItemSummaries(monthKey?: string): Promise<InventoryItemSummary[]> {
  const database = await getDatabase()
  const monthFilter = monthKey ? `AND substr(m.movement_date, 1, 7) = $1` : ''
  const wastageMonthFilter = monthKey ? `AND substr(mw.movement_date, 1, 7) = $2` : ''
  const params = monthKey ? [monthKey, monthKey] : []

  const rows = await database.select<InventoryItemSummaryRow[]>(
    `
      SELECT
        i.id,
        i.name,
        COALESCE(c.code, lc.code, 'other') AS category,
        COALESCE(c.label, lc.label, 'Other') AS categoryLabel,
        i.low_stock_threshold AS lowStockThreshold,
        i.unit_label AS unitLabel,
        i.cost_per_unit AS costPerUnit,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity ELSE 0 END), 0) AS totalIn,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity * m.unit_cost ELSE 0 END), 0) AS totalInCost,
        COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity ELSE 0 END), 0) AS totalOut,
        COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity * m.unit_cost ELSE 0 END), 0) AS totalOutCost,
        COALESCE((
          SELECT SUM(CASE WHEN m2.movement_type = 'IN' THEN m2.quantity ELSE -m2.quantity END)
          FROM inventory_movements m2 WHERE m2.item_id = i.id
        ), 0) AS currentStock,
        COALESCE((
          SELECT SUM(mw.quantity * mw.unit_cost)
          FROM inventory_movements mw
          WHERE mw.item_id = i.id
            AND mw.movement_type = 'OUT'
            ${wastageMonthFilter}
            AND (
              LOWER(COALESCE(mw.notes, '')) LIKE '%damaged%'
              OR LOWER(COALESCE(mw.notes, '')) LIKE '%expired%'
              OR LOWER(COALESCE(mw.notes, '')) LIKE '%lost%'
            )
        ), 0) AS wastageCostThisMonth
      FROM inventory_items i
      LEFT JOIN inventory_categories c ON c.id = i.category_id
      LEFT JOIN inventory_categories lc ON lc.code = i.category
      LEFT JOIN inventory_movements m ON m.item_id = i.id ${monthFilter}
      WHERE i.is_active = 1
      GROUP BY i.id
      ORDER BY i.name
    `,
    params,
  )

  return rows.map((row) => {
    const currentStock = toNumber(row.currentStock)
    const costPerUnit = toNumber(row.costPerUnit)
    return {
      category: row.category,
      categoryLabel: row.categoryLabel,
      currentStock,
      id: row.id,
      lowStockThreshold: toNumber(row.lowStockThreshold),
      name: row.name,
      stockValue: currentStock * costPerUnit,
      totalIn: toNumber(row.totalIn),
      totalInCost: toNumber(row.totalInCost),
      totalOut: toNumber(row.totalOut),
      totalOutCost: toNumber(row.totalOutCost),
      unitLabel: row.unitLabel,
      wastageCostThisMonth: toNumber(row.wastageCostThisMonth),
    }
  })
}

export type InventoryDailyTrend = {
  date: string
  totalIn: number
  totalOut: number
}

type InventoryDailyTrendRow = {
  date: string
  totalIn: number
  totalOut: number
}

export async function getInventoryDailyTrend(monthKey: string): Promise<InventoryDailyTrend[]> {
  const database = await getDatabase()
  const rows = await database.select<InventoryDailyTrendRow[]>(
    `
      SELECT
        m.movement_date AS date,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity ELSE 0 END), 0) AS totalIn,
        COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity ELSE 0 END), 0) AS totalOut
      FROM inventory_movements m
      WHERE substr(m.movement_date, 1, 7) = $1
      GROUP BY m.movement_date
      ORDER BY m.movement_date
    `,
    [monthKey],
  )

  return rows.map((row) => ({
    date: row.date,
    totalIn: toNumber(row.totalIn),
    totalOut: toNumber(row.totalOut),
  }))
}

export type InventoryMonthlyTrend = {
  monthKey: string
  totalIn: number
  totalInCost: number
  totalOut: number
  totalOutCost: number
}

type InventoryMonthlyTrendRow = {
  monthKey: string
  totalIn: number
  totalInCost: number
  totalOut: number
  totalOutCost: number
}

export async function getInventoryMonthlyTrend(months = 6): Promise<InventoryMonthlyTrend[]> {
  const database = await getDatabase()
  const startMonth = format(subMonths(new Date(), months - 1), 'yyyy-MM')

  const rows = await database.select<InventoryMonthlyTrendRow[]>(
    `
      SELECT
        substr(m.movement_date, 1, 7) AS monthKey,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity ELSE 0 END), 0) AS totalIn,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity * m.unit_cost ELSE 0 END), 0) AS totalInCost,
        COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity ELSE 0 END), 0) AS totalOut,
        COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity * m.unit_cost ELSE 0 END), 0) AS totalOutCost
      FROM inventory_movements m
      WHERE substr(m.movement_date, 1, 7) >= $1
      GROUP BY substr(m.movement_date, 1, 7)
      ORDER BY substr(m.movement_date, 1, 7)
    `,
    [startMonth],
  )

  return rows.map((row) => ({
    monthKey: row.monthKey,
    totalIn: toNumber(row.totalIn),
    totalInCost: toNumber(row.totalInCost),
    totalOut: toNumber(row.totalOut),
    totalOutCost: toNumber(row.totalOutCost),
  }))
}

// ─── Dashboard Helpers ───────────────────────────────────────────────────────

export type LowStockItem = {
  currentStock: number
  id: number
  lowStockThreshold: number
  name: string
  stockValue: number
  unitLabel: string
}

export async function getLowStockItems(): Promise<LowStockItem[]> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      costPerUnit: number
      currentStock: number
      id: number
      lowStockThreshold: number
      name: string
      unitLabel: string
    }>
  >(
    `
      SELECT
        i.id,
        i.name,
        i.unit_label AS unitLabel,
        i.cost_per_unit AS costPerUnit,
        i.low_stock_threshold AS lowStockThreshold,
        COALESCE(SUM(
          CASE WHEN m.movement_type = 'IN' THEN m.quantity
               WHEN m.movement_type = 'OUT' THEN -m.quantity
               ELSE 0 END
        ), 0) AS currentStock
      FROM inventory_items i
      LEFT JOIN inventory_movements m ON m.item_id = i.id
      WHERE i.is_active = 1
      GROUP BY i.id
      HAVING currentStock <= i.low_stock_threshold
      ORDER BY currentStock ASC
    `,
  )

  return rows.map((row) => {
    const currentStock = toNumber(row.currentStock)
    return {
      currentStock,
      id: row.id,
      lowStockThreshold: toNumber(row.lowStockThreshold),
      name: row.name,
      stockValue: currentStock * toNumber(row.costPerUnit),
      unitLabel: row.unitLabel,
    }
  })
}

export type InventoryActionCounts = {
  equipmentDown: number
  lowStock: number
  needsReorder: number
  outOfStock: number
}

export async function getInventoryActionCounts(usageWindowDays = 30): Promise<InventoryActionCounts> {
  const database = await getDatabase()
  const fromDate = format(subDays(new Date(), usageWindowDays), 'yyyy-MM-dd')
  const rows = await database.select<
    Array<{
      equipmentDown: number
      lowStock: number
      needsReorder: number
      outOfStock: number
    }>
  >(
    `
      WITH item_stock AS (
        SELECT
          i.id,
          COALESCE(c.code, lc.code, 'other') AS categoryCode,
          i.status,
          i.low_stock_threshold AS threshold,
          COALESCE((
            SELECT SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity ELSE -m.quantity END)
            FROM inventory_movements m WHERE m.item_id = i.id
          ), 0) AS current_stock,
          COALESCE((
            SELECT SUM(m.quantity)
            FROM inventory_movements m
            WHERE m.item_id = i.id
              AND m.movement_type = 'OUT'
              AND m.movement_date >= $1
          ), 0) / $2 AS avg_daily_out
        FROM inventory_items i
        LEFT JOIN inventory_categories c ON c.id = i.category_id
        LEFT JOIN inventory_categories lc ON lc.code = i.category
        WHERE i.is_active = 1
      )
      SELECT
        SUM(CASE WHEN current_stock <= 0 THEN 1 ELSE 0 END) AS outOfStock,
        SUM(CASE WHEN current_stock > 0 AND current_stock <= threshold THEN 1 ELSE 0 END) AS lowStock,
        SUM(CASE WHEN categoryCode = 'equipment' AND status IN ('maintenance', 'out_of_service') THEN 1 ELSE 0 END) AS equipmentDown,
        SUM(CASE
          WHEN categoryCode != 'equipment' AND (
            current_stock <= threshold
            OR (avg_daily_out > 0 AND (current_stock / avg_daily_out) < 7)
          ) THEN 1
          ELSE 0
        END) AS needsReorder
      FROM item_stock
    `,
    [fromDate, usageWindowDays],
  )
  const r = rows[0]
  return {
    equipmentDown: toNumber(r?.equipmentDown),
    lowStock: toNumber(r?.lowStock),
    needsReorder: toNumber(r?.needsReorder),
    outOfStock: toNumber(r?.outOfStock),
  }
}

export type InventoryCoverageRow = {
  avgDailyUsage: number
  costPerUnit: number
  currentStock: number
  daysOfSupply: number | null
  id: number
  lowStockThreshold: number
  name: string
  suggestedReorderQty: number
  supplierId: number | null
  supplierName: string | null
  unitLabel: string
}

export async function getInventoryCoverage(usageWindowDays = 30): Promise<InventoryCoverageRow[]> {
  const database = await getDatabase()
  const fromDate = format(subDays(new Date(), usageWindowDays), 'yyyy-MM-dd')
  const safetyBuffer = 0.1

  const rows = await database.select<
    Array<{
      avgDailyOut: number
      costPerUnit: number
      currentStock: number
      id: number
      lowStockThreshold: number
      name: string
      supplierId: number | null
      supplierName: string | null
      unitLabel: string
    }>
  >(
    `
      SELECT
        i.id,
        i.name,
        i.unit_label AS unitLabel,
        i.low_stock_threshold AS lowStockThreshold,
        i.cost_per_unit AS costPerUnit,
        i.supplier_id AS supplierId,
        s.name AS supplierName,
        i.current_stock AS currentStock,
        COALESCE((
          SELECT SUM(m.quantity)
          FROM inventory_movements m
          WHERE m.item_id = i.id
            AND m.movement_type = 'OUT'
            AND m.movement_date >= $1
        ), 0) / $2 AS avgDailyOut
      FROM inventory_items i
      LEFT JOIN inventory_categories c ON c.id = i.category_id
      LEFT JOIN inventory_categories lc ON lc.code = i.category
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.is_active = 1
        AND COALESCE(c.code, lc.code, 'other') != 'equipment'
      ORDER BY i.name
    `,
    [fromDate, usageWindowDays],
  )

  return rows.map((row) => {
    const currentStock = toNumber(row.currentStock)
    const avgDailyUsage = toNumber(row.avgDailyOut)
    const threshold = toNumber(row.lowStockThreshold)
    const costPerUnit = toNumber(row.costPerUnit)
    let daysOfSupply: number | null = null
    if (avgDailyUsage > 0) {
      daysOfSupply = currentStock / avgDailyUsage
    }
    const baseReorder = Math.max(0, threshold - currentStock)
    const suggestedReorderQty =
      avgDailyUsage > 0
        ? Math.ceil(baseReorder + avgDailyUsage * usageWindowDays * safetyBuffer)
        : Math.ceil(baseReorder || threshold || 1)

    return {
      avgDailyUsage,
      costPerUnit,
      currentStock,
      daysOfSupply,
      id: row.id,
      lowStockThreshold: threshold,
      name: row.name,
      suggestedReorderQty,
      supplierId: row.supplierId != null ? Number(row.supplierId) : null,
      supplierName: row.supplierName ?? null,
      unitLabel: row.unitLabel,
    }
  })
}

export type InventoryWastageSummary = {
  byReason: { damaged: number; expired: number; lost: number }
  totalCost: number
  totalQty: number
}

export async function getInventoryWastage(monthKey: string): Promise<InventoryWastageSummary> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      damagedCost: number
      damagedQty: number
      expiredCost: number
      expiredQty: number
      lostCost: number
      lostQty: number
      totalCost: number
      totalQty: number
    }>
  >(
    `
      SELECT
        COALESCE(SUM(CASE
          WHEN movement_type = 'OUT' AND LOWER(COALESCE(notes, '')) LIKE '%damaged%'
          THEN quantity ELSE 0 END), 0) AS damagedQty,
        COALESCE(SUM(CASE
          WHEN movement_type = 'OUT' AND LOWER(COALESCE(notes, '')) LIKE '%damaged%'
          THEN quantity * unit_cost ELSE 0 END), 0) AS damagedCost,
        COALESCE(SUM(CASE
          WHEN movement_type = 'OUT' AND LOWER(COALESCE(notes, '')) LIKE '%expired%'
            AND LOWER(COALESCE(notes, '')) NOT LIKE '%damaged%'
          THEN quantity ELSE 0 END), 0) AS expiredQty,
        COALESCE(SUM(CASE
          WHEN movement_type = 'OUT' AND LOWER(COALESCE(notes, '')) LIKE '%expired%'
            AND LOWER(COALESCE(notes, '')) NOT LIKE '%damaged%'
          THEN quantity * unit_cost ELSE 0 END), 0) AS expiredCost,
        COALESCE(SUM(CASE
          WHEN movement_type = 'OUT'
            AND LOWER(COALESCE(notes, '')) LIKE '%lost%'
            AND LOWER(COALESCE(notes, '')) NOT LIKE '%lost and found%'
            AND LOWER(COALESCE(notes, '')) NOT LIKE '%damaged%'
            AND LOWER(COALESCE(notes, '')) NOT LIKE '%expired%'
          THEN quantity ELSE 0 END), 0) AS lostQty,
        COALESCE(SUM(CASE
          WHEN movement_type = 'OUT'
            AND LOWER(COALESCE(notes, '')) LIKE '%lost%'
            AND LOWER(COALESCE(notes, '')) NOT LIKE '%lost and found%'
            AND LOWER(COALESCE(notes, '')) NOT LIKE '%damaged%'
            AND LOWER(COALESCE(notes, '')) NOT LIKE '%expired%'
          THEN quantity * unit_cost ELSE 0 END), 0) AS lostCost,
        COALESCE(SUM(CASE
          WHEN movement_type = 'OUT' AND (
            LOWER(COALESCE(notes, '')) LIKE '%damaged%'
            OR LOWER(COALESCE(notes, '')) LIKE '%expired%'
            OR (LOWER(COALESCE(notes, '')) LIKE '%lost%' AND LOWER(COALESCE(notes, '')) NOT LIKE '%lost and found%')
          )
          THEN quantity ELSE 0 END), 0) AS totalQty,
        COALESCE(SUM(CASE
          WHEN movement_type = 'OUT' AND (
            LOWER(COALESCE(notes, '')) LIKE '%damaged%'
            OR LOWER(COALESCE(notes, '')) LIKE '%expired%'
            OR (LOWER(COALESCE(notes, '')) LIKE '%lost%' AND LOWER(COALESCE(notes, '')) NOT LIKE '%lost and found%')
          )
          THEN quantity * unit_cost ELSE 0 END), 0) AS totalCost
      FROM inventory_movements
      WHERE substr(movement_date, 1, 7) = $1
        AND movement_type = 'OUT'
    `,
    [monthKey],
  )
  const r = rows[0]
  const damagedCost = toNumber(r?.damagedCost)
  const expiredCost = toNumber(r?.expiredCost)
  const lostCost = toNumber(r?.lostCost)
  return {
    byReason: { damaged: damagedCost, expired: expiredCost, lost: lostCost },
    totalCost: toNumber(r?.totalCost),
    totalQty: toNumber(r?.totalQty),
  }
}

export type InventoryCategoryBreakdownRow = {
  category: string
  categoryLabel: string
  stockValue: number
  totalIn: number
  totalOut: number
}

export async function getInventoryCategoryBreakdown(monthKey: string): Promise<InventoryCategoryBreakdownRow[]> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      category: string
      categoryLabel: string
      stockValue: number
      totalIn: number
      totalOut: number
    }>
  >(
    `
      SELECT
        COALESCE(c.code, lc.code, 'other') AS category,
        COALESCE(c.label, lc.label, 'Other') AS categoryLabel,
        SUM(
          COALESCE((
            SELECT SUM(CASE WHEN m2.movement_type = 'IN' THEN m2.quantity ELSE -m2.quantity END)
            FROM inventory_movements m2 WHERE m2.item_id = i.id
          ), 0) * i.cost_per_unit
        ) AS stockValue,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity ELSE 0 END), 0) AS totalIn,
        COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity ELSE 0 END), 0) AS totalOut
      FROM inventory_items i
      LEFT JOIN inventory_categories c ON c.id = i.category_id
      LEFT JOIN inventory_categories lc ON lc.code = i.category
      LEFT JOIN inventory_movements m ON m.item_id = i.id AND substr(m.movement_date, 1, 7) = $1
      WHERE i.is_active = 1
      GROUP BY category, categoryLabel
      ORDER BY category
    `,
    [monthKey],
  )

  return rows.map((row) => ({
    category: row.category,
    categoryLabel: row.categoryLabel,
    stockValue: toNumber(row.stockValue),
    totalIn: toNumber(row.totalIn),
    totalOut: toNumber(row.totalOut),
  }))
}

export type EquipmentStatusItem = {
  daysSinceMaintenance: number | null
  id: number
  lastMaintenanceDate: string
  name: string
  status: string
}

export type EquipmentStatusSummary = {
  byStatus: Record<string, EquipmentStatusItem[]>
  counts: Record<string, number>
}

export async function getEquipmentStatusSummary(): Promise<EquipmentStatusSummary> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      id: number
      lastMaintenanceDate: string
      name: string
      status: string
    }>
  >(
    `
      SELECT
        i.id,
        i.name,
        COALESCE(i.status, '') AS status,
        COALESCE(i.last_maintenance_date, '') AS lastMaintenanceDate
      FROM inventory_items i
      LEFT JOIN inventory_categories c ON c.id = i.category_id
      LEFT JOIN inventory_categories lc ON lc.code = i.category
      WHERE i.is_active = 1
        AND COALESCE(c.code, lc.code, 'other') = 'equipment'
      ORDER BY i.status, i.name
    `,
  )

  const byStatus: Record<string, EquipmentStatusItem[]> = {
    maintenance: [],
    operational: [],
    out_of_service: [],
    retired: [],
    unknown: [],
  }
  const counts: Record<string, number> = {
    maintenance: 0,
    operational: 0,
    out_of_service: 0,
    retired: 0,
    unknown: 0,
  }

  const today = new Date()
  for (const row of rows) {
    const rawStatus = row.status?.trim() || 'operational'
    const st = byStatus[rawStatus] != null ? rawStatus : 'unknown'
    let daysSinceMaintenance: number | null = null
    if (row.lastMaintenanceDate) {
      daysSinceMaintenance = differenceInCalendarDays(today, new Date(row.lastMaintenanceDate + 'T12:00:00'))
    }
    const item: EquipmentStatusItem = {
      daysSinceMaintenance,
      id: row.id,
      lastMaintenanceDate: row.lastMaintenanceDate,
      name: row.name,
      status: st,
    }
    byStatus[st].push(item)
    counts[st] = (counts[st] ?? 0) + 1
  }

  return { byStatus, counts }
}

export type SlowMoverItem = {
  currentStock: number
  id: number
  name: string
  stockValue: number
  unitLabel: string
}

export async function getSlowMovers(daysSinceLastOut = 60): Promise<SlowMoverItem[]> {
  const database = await getDatabase()
  const fromDate = format(subDays(new Date(), daysSinceLastOut), 'yyyy-MM-dd')
  const rows = await database.select<
    Array<{
      costPerUnit: number
      currentStock: number
      id: number
      name: string
      unitLabel: string
    }>
  >(
    `
      SELECT * FROM (
        SELECT
          i.id,
          i.name,
          i.unit_label AS unitLabel,
          i.cost_per_unit AS costPerUnit,
          COALESCE((
            SELECT SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity ELSE -m.quantity END)
            FROM inventory_movements m WHERE m.item_id = i.id
          ), 0) AS currentStock
        FROM inventory_items i
        WHERE i.is_active = 1
          AND NOT EXISTS (
            SELECT 1 FROM inventory_movements m
            WHERE m.item_id = i.id
              AND m.movement_type = 'OUT'
              AND m.movement_date >= $1
          )
      ) t
      WHERE t.currentStock > 0
      ORDER BY t.name
    `,
    [fromDate],
  )

  return rows.map((row) => {
    const currentStock = toNumber(row.currentStock)
    const costPerUnit = toNumber(row.costPerUnit)
    return {
      currentStock,
      id: row.id,
      name: row.name,
      stockValue: currentStock * costPerUnit,
      unitLabel: row.unitLabel,
    }
  })
}

export async function getRecentInventoryMovements(limit = 10): Promise<InventoryMovement[]> {
  return listInventoryMovements({ limit })
}

// ─── Inventory Maintenance Records ───────────────────────────────────────────

export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export type MaintenanceRecord = {
  cost: number
  createdAt: string
  createdByName: string | null
  description: string
  id: number
  itemId: number
  itemName: string
  nextServiceDate: string
  performedBy: string
  serviceDate: string
  serviceType: string
  status: MaintenanceStatus
}

export type MaintenanceRecordDraft = {
  cost: number
  description: string
  itemId: number
  nextServiceDate: string
  performedBy: string
  serviceDate: string
  serviceType: string
  status: MaintenanceStatus
}

type MaintenanceRecordRow = {
  cost: number
  created_at: string
  created_by_name: string | null
  description: string
  id: number
  item_id: number
  item_name: string
  next_service_date: string
  performed_by: string
  service_date: string
  service_type: string
  status: string
}

function rowToMaintenanceRecord(row: MaintenanceRecordRow): MaintenanceRecord {
  return {
    cost: toNumber(row.cost),
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    description: row.description,
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    nextServiceDate: row.next_service_date,
    performedBy: row.performed_by,
    serviceDate: row.service_date,
    serviceType: row.service_type,
    status: row.status as MaintenanceStatus,
  }
}

export async function listMaintenanceRecords(filters?: {
  itemId?: number
  limit?: number
  status?: MaintenanceStatus
}): Promise<MaintenanceRecord[]> {
  const database = await getDatabase()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.itemId) {
    params.push(filters.itemId)
    conditions.push(`mr.item_id = $${params.length}`)
  }
  if (filters?.status) {
    params.push(filters.status)
    conditions.push(`mr.status = $${params.length}`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limitClause = filters?.limit != null ? `LIMIT ${Number(filters.limit)}` : ''

  const rows = await database.select<MaintenanceRecordRow[]>(
    `
      SELECT
        mr.id,
        mr.item_id,
        mr.service_date,
        mr.service_type,
        mr.performed_by,
        mr.cost,
        mr.description,
        mr.next_service_date,
        mr.status,
        mr.created_at,
        i.name AS item_name,
        u.display_name AS created_by_name
      FROM inventory_maintenance_records mr
      JOIN inventory_items i ON i.id = mr.item_id
      LEFT JOIN users u ON u.id = mr.created_by
      ${where}
      ORDER BY mr.service_date DESC, mr.id DESC
      ${limitClause}
    `,
    params,
  )

  return rows.map(rowToMaintenanceRecord)
}

async function applyMaintenanceStatusToItem(
  database: Database,
  itemId: number,
  status: MaintenanceStatus,
  serviceDate: string,
) {
  if (status === 'completed') {
    await database.execute(
      `
        UPDATE inventory_items
        SET status = 'operational',
            last_maintenance_date = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
          AND COALESCE(
            (SELECT code FROM inventory_categories WHERE id = inventory_items.category_id),
            NULLIF(TRIM(category), ''),
            'other'
          ) = 'equipment'
      `,
      [serviceDate, itemId],
    )
  } else if (status === 'in_progress' || status === 'scheduled') {
    await database.execute(
      `
        UPDATE inventory_items
        SET status = 'maintenance',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND COALESCE(
            (SELECT code FROM inventory_categories WHERE id = inventory_items.category_id),
            NULLIF(TRIM(category), ''),
            'other'
          ) = 'equipment'
      `,
      [itemId],
    )
  }
}

export async function saveMaintenanceRecord(
  draft: MaintenanceRecordDraft,
  userId: number,
  id?: number,
): Promise<number> {
  const database = await getDatabase()

  if (id) {
    await database.execute(
      `
        UPDATE inventory_maintenance_records SET
          item_id = $1,
          service_date = $2,
          service_type = $3,
          performed_by = $4,
          cost = $5,
          description = $6,
          next_service_date = $7,
          status = $8,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
      `,
      [
        draft.itemId,
        draft.serviceDate,
        draft.serviceType,
        draft.performedBy,
        draft.cost,
        draft.description,
        draft.nextServiceDate,
        draft.status,
        id,
      ],
    )
    await applyMaintenanceStatusToItem(database, draft.itemId, draft.status, draft.serviceDate)
    return id
  }

  const result = await database.execute(
    `
      INSERT INTO inventory_maintenance_records (
        item_id, service_date, service_type, performed_by, cost,
        description, next_service_date, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      draft.itemId,
      draft.serviceDate,
      draft.serviceType,
      draft.performedBy,
      draft.cost,
      draft.description,
      draft.nextServiceDate,
      draft.status,
      userId,
    ],
  )
  await applyMaintenanceStatusToItem(database, draft.itemId, draft.status, draft.serviceDate)
  return result.lastInsertId as number
}

export async function deleteMaintenanceRecord(id: number): Promise<void> {
  const database = await getDatabase()
  await database.execute('DELETE FROM inventory_maintenance_records WHERE id = $1', [id])
}

export async function getUpcomingMaintenance(limit = 5): Promise<MaintenanceRecord[]> {
  const database = await getDatabase()
  const rows = await database.select<MaintenanceRecordRow[]>(
    `
      SELECT
        mr.id,
        mr.item_id,
        mr.service_date,
        mr.service_type,
        mr.performed_by,
        mr.cost,
        mr.description,
        mr.next_service_date,
        mr.status,
        mr.created_at,
        i.name AS item_name,
        u.display_name AS created_by_name
      FROM inventory_maintenance_records mr
      JOIN inventory_items i ON i.id = mr.item_id
      LEFT JOIN users u ON u.id = mr.created_by
      WHERE mr.status IN ('scheduled', 'in_progress')
      ORDER BY mr.service_date ASC, mr.id ASC
      LIMIT $1
    `,
    [limit],
  )
  return rows.map(rowToMaintenanceRecord)
}

export async function getRecentTransactions(limit = 5): Promise<LedgerTransaction[]> {
  const database = await getDatabase()
  const rows = await database.select<LedgerTransactionSelectRow[]>(
    `
      SELECT
        transactions.id AS id,
        transactions.entry_date AS entryDate,
        transactions.description AS description,
        transactions.amount AS amount,
        transactions.staff_count AS staffCount,
        transactions.kg AS kg,
        transactions.loads AS loads,
        transactions.is_loyalty_reward AS isLoyaltyReward,
        transactions.category_id AS categoryId,
        categories.label AS categoryLabel,
        transactions.customer_id AS customerId,
        customer.name AS customerName,
        transaction_types.id AS transactionTypeId,
        transaction_types.code AS transactionTypeCode,
        transaction_types.label AS transactionTypeLabel,
        transactions.created_at AS createdAt,
        transactions.updated_at AS updatedAt,
        created_by_user.display_name AS createdByName,
        updated_by_user.display_name AS updatedByName
      FROM transactions
      JOIN categories ON categories.id = transactions.category_id
      JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
      LEFT JOIN customers AS customer ON customer.id = transactions.customer_id
      LEFT JOIN users AS created_by_user ON created_by_user.id = transactions.created_by
      LEFT JOIN users AS updated_by_user ON updated_by_user.id = transactions.updated_by
      ORDER BY transactions.entry_date DESC, transactions.id DESC
      LIMIT $1
    `,
    [limit],
  )
  return rows.map(mapLedgerTransactionRow)
}

export async function getRecentIncidents(limit = 3): Promise<IncidentReport[]> {
  const database = await getDatabase()
  const rows = await database.select<IncidentReportRow[]>(
    `
      SELECT
        ir.id,
        ir.incident_date,
        ir.incident_time,
        ir.staff_on_duty,
        ir.incident_type,
        ir.what_happened,
        ir.customer_name,
        ir.contact_number,
        ir.action_taken,
        ir.handled_by,
        ir.estimated_loss,
        ir.quantity,
        ir.items_involved,
        ir.remarks,
        ir.created_at,
        u.display_name AS created_by_name
      FROM incident_reports ir
      LEFT JOIN users u ON u.id = ir.created_by
      ORDER BY ir.incident_date DESC, ir.incident_time DESC
      LIMIT $1
    `,
    [limit],
  )
  return rows.map(rowToIncidentReport)
}

export async function getTotalInventoryValue(): Promise<number> {
  const database = await getDatabase()
  const rows = await database.select<Array<{ totalValue: number }>>(
    `
      SELECT COALESCE(SUM(
        COALESCE((
          SELECT SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity ELSE -m.quantity END)
          FROM inventory_movements m WHERE m.item_id = i.id
        ), 0) * i.cost_per_unit
      ), 0) AS totalValue
      FROM inventory_items i
      WHERE i.is_active = 1
    `,
  )
  return toNumber(rows[0]?.totalValue)
}

export type TopCustomer = {
  customerId: number
  name: string
  total: number
  transactionCount: number
}

/** Top customers by SALE amount for the given month (yyyy-MM). */
export async function getTopCustomersForMonth(monthKey: string, limit = 5): Promise<TopCustomer[]> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      customerId: number
      name: string
      total: number
      transactionCount: number
    }>
  >(
    `
      SELECT
        c.id AS customerId,
        c.name AS name,
        COALESCE(SUM(transactions.amount), 0) AS total,
        COUNT(*) AS transactionCount
      FROM transactions
      JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
      JOIN customers c ON c.id = transactions.customer_id
      WHERE transaction_types.code = 'SALE'
        AND substr(transactions.entry_date, 1, 7) = $1
        AND transactions.customer_id IS NOT NULL
      GROUP BY c.id, c.name
      ORDER BY total DESC
      LIMIT $2
    `,
    [monthKey, limit],
  )
  return rows.map((row) => ({
    customerId: Number(row.customerId),
    name: row.name,
    total: toNumber(row.total),
    transactionCount: Number(row.transactionCount),
  }))
}

export async function getTransactionCountForMonth(monthKey: string): Promise<number> {
  const database = await getDatabase()
  const rows = await database.select<CountRow[]>(
    `SELECT COUNT(*) AS count FROM transactions WHERE substr(entry_date, 1, 7) = $1`,
    [monthKey],
  )
  return toNumber(rows[0]?.count)
}

// ─── Staff & payroll ─────────────────────────────────────────────────────────

export type CivilStatus = 'Single' | 'Married' | 'Widowed' | 'Separated'

export type Staff = {
  address: string
  birthdate: string
  civilStatus: CivilStatus
  defaultRate: number
  displayName: string
  emergencyContactName: string
  emergencyContactNumber: string
  firstName: string
  id: number
  isArchived: boolean
  lastName: string
  lastPayrollDate: string | null
  middleName: string
  spouseName: string
}

export type StaffDraft = {
  address: string
  birthdate: string
  civilStatus: CivilStatus
  defaultRate: number
  emergencyContactName: string
  emergencyContactNumber: string
  firstName: string
  lastName: string
  middleName: string
  spouseName: string
}

export type AttendanceEntry = {
  attendanceDate: string
  computedPay: number
  id: number
  isPaid: boolean
  multiplier: number
  notes: string
  rateOverride: number | null
  staffId: number
  status: AttendanceStatus
}

export type PayrollSettings = {
  autoDeductCashAdvances: boolean
  cutoffDay: number
  holidayDefaultMultiplier: number
  overtimeMultiplier: number
  standardDayHours: number
}

export type CashAdvanceStatus = 'outstanding' | 'settled' | 'void'

export type CashAdvance = {
  advanceDate: string
  amount: number
  id: number
  notes: string
  settledAt: string | null
  settledPayrollId: number | null
  staffId: number
  status: CashAdvanceStatus
  transactionId: number | null
}

export type CashAdvanceDraft = {
  advanceDate: string
  amount: number
  notes: string
  staffId: number
}

export type PayrollListItem = {
  basePay: number
  cutoffDay: number
  grossPay: number
  id: number
  netPay: number
  notes: string
  payDate: string
  periodEnd: string
  periodStart: string
  staffId: number
  status: 'paid' | 'void'
  totalAdjustments: number
  totalDeductions: number
  totalEarnings: number
  transactionId: number | null
}

export type PayrollAdjustmentDraft = {
  amount: number
  category: string
  kind: AdjustmentKind
  label: string
  quantity?: number | null
  rate?: number | null
  recurringId?: number | null
  source?: AdjustmentSource
  taxable?: boolean
}

export type PayrollAdjustment = {
  amount: number
  category: string
  id: number
  kind: AdjustmentKind
  label: string
  quantity: number | null
  rate: number | null
  recurringId: number | null
  source: AdjustmentSource
  taxable: boolean
}

/** A single applied adjustment line, joined with the payroll run it belongs to. */
export type StaffAdjustmentHistoryEntry = {
  amount: number
  category: string
  id: number
  kind: AdjustmentKind
  label: string
  payDate: string
  payrollId: number
  periodEnd: string
  periodStart: string
  quantity: number | null
  rate: number | null
  source: AdjustmentSource
  taxable: boolean
}

export type PayrollPreviewItem = {
  attendanceId: number
  entryDate: string
  multiplier: number
  payAmount: number
  rateUsed: number
  status: string
}

export type PayrollPreview = {
  basePay: number
  cutoffDay: number
  items: PayrollPreviewItem[]
  overtimeMultiplier: number
  periodEnd: string
  periodStart: string
  staffDefaultRate: number
  standardDayHours: number
}

export type PayrollDetail = {
  adjustments: PayrollAdjustment[]
  items: PayrollPreviewItem[]
  payroll: PayrollListItem
}

export type FinalizePayrollInput = {
  adjustments: PayrollAdjustmentDraft[]
  cashAdvanceIds: number[]
  notes: string
  payDate: string
  periodEnd: string
  periodStart: string
  staffId: number
}

// ─── Recurring payroll adjustments (defined per staff) ───────────────────────

export type RecurringAdjustment = {
  amount: number
  category: string
  endDate: string
  hasBalance: boolean
  id: number
  isActive: boolean
  kind: AdjustmentKind
  label: string
  notes: string
  /** One-time: applied to the next payroll, then auto-deactivated. */
  oneTime: boolean
  originalBalance: number | null
  remainingBalance: number | null
  staffId: number
  startDate: string
  taxable: boolean
}

export type RecurringAdjustmentDraft = {
  amount: number
  category: string
  endDate: string
  hasBalance: boolean
  kind: AdjustmentKind
  label: string
  notes: string
  oneTime: boolean
  originalBalance: number | null
  startDate: string
  taxable: boolean
}

type StaffRow = {
  address: string
  birthdate: string
  civilStatus: string
  defaultRate: number
  emergencyContactName: string
  emergencyContactNumber: string
  firstName: string
  id: number
  isArchived: number
  lastName: string
  lastPayrollDate: string | null
  middleName: string
  spouseName: string
}

function staffRowToStaff(row: StaffRow): Staff {
  const parts = [row.firstName, row.middleName, row.lastName].filter((p) => p.trim().length > 0)
  return {
    address: row.address,
    birthdate: row.birthdate,
    civilStatus: row.civilStatus as CivilStatus,
    defaultRate: toNumber(row.defaultRate),
    displayName: parts.join(' '),
    emergencyContactName: row.emergencyContactName,
    emergencyContactNumber: row.emergencyContactNumber,
    firstName: row.firstName,
    id: row.id,
    isArchived: Boolean(row.isArchived),
    lastName: row.lastName,
    lastPayrollDate: row.lastPayrollDate ?? null,
    middleName: row.middleName,
    spouseName: row.spouseName,
  }
}

async function getExpenseStaffSalaryIds(database: Database): Promise<{ categoryId: number; typeId: number }> {
  const typeRows = await database.select<Array<{ id: number }>>(
    `SELECT id FROM transaction_types WHERE code = $1`,
    ['EXPENSE'],
  )
  const typeId = Number(typeRows[0]?.id ?? 0)
  if (!typeId) throw new Error('EXPENSE transaction type is missing.')

  const catRows = await database.select<Array<{ id: number }>>(
    `
      SELECT categories.id AS id
      FROM categories
      JOIN transaction_types ON transaction_types.id = categories.transaction_type_id
      WHERE transaction_types.code = 'EXPENSE' AND categories.label = 'Staff Salary' AND categories.is_archived = 0
      LIMIT 1
    `,
  )
  const categoryId = Number(catRows[0]?.id ?? 0)
  if (!categoryId) throw new Error('Staff Salary expense category is missing.')
  return { categoryId, typeId }
}

export async function listStaff(filters?: { includeArchived?: boolean; search?: string }): Promise<Staff[]> {
  const database = await getDatabase()
  const conditions: string[] = []
  const params: unknown[] = []

  if (!filters?.includeArchived) {
    conditions.push('staff.is_archived = 0')
  }

  const search = filters?.search?.trim()
  if (search) {
    const pattern = `%${search}%`
    params.push(pattern, pattern, pattern, pattern)
    const n = params.length
    conditions.push(
      `(
        staff.first_name LIKE $${n - 3} OR staff.middle_name LIKE $${n - 2} OR staff.last_name LIKE $${n - 1} OR staff.address LIKE $${n}
      )`,
    )
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await database.select<StaffRow[]>(
    `
      SELECT
        staff.id AS id,
        staff.first_name AS firstName,
        staff.middle_name AS middleName,
        staff.last_name AS lastName,
        staff.address AS address,
        staff.birthdate AS birthdate,
        staff.civil_status AS civilStatus,
        staff.emergency_contact_name AS emergencyContactName,
        staff.emergency_contact_number AS emergencyContactNumber,
        staff.spouse_name AS spouseName,
        staff.default_rate AS defaultRate,
        staff.is_archived AS isArchived,
        (
          SELECT MAX(p.pay_date) FROM staff_payrolls p
          WHERE p.staff_id = staff.id AND p.status = 'paid'
        ) AS lastPayrollDate
      FROM staff
      ${whereClause}
      ORDER BY staff.last_name COLLATE NOCASE ASC, staff.first_name COLLATE NOCASE ASC
    `,
    params,
  )

  return rows.map(staffRowToStaff)
}

export async function getStaff(staffId: number): Promise<Staff | null> {
  const database = await getDatabase()
  const rows = await database.select<StaffRow[]>(
    `
      SELECT
        staff.id AS id,
        staff.first_name AS firstName,
        staff.middle_name AS middleName,
        staff.last_name AS lastName,
        staff.address AS address,
        staff.birthdate AS birthdate,
        staff.civil_status AS civilStatus,
        staff.emergency_contact_name AS emergencyContactName,
        staff.emergency_contact_number AS emergencyContactNumber,
        staff.spouse_name AS spouseName,
        staff.default_rate AS defaultRate,
        staff.is_archived AS isArchived,
        (
          SELECT MAX(p.pay_date) FROM staff_payrolls p
          WHERE p.staff_id = staff.id AND p.status = 'paid'
        ) AS lastPayrollDate
      FROM staff
      WHERE staff.id = $1
    `,
    [staffId],
  )
  const row = rows[0]
  return row ? staffRowToStaff(row) : null
}

export async function saveStaff(input: StaffDraft, userId: number, staffId?: number): Promise<void> {
  const database = await getDatabase()
  if (input.defaultRate <= 0) {
    throw new Error('Default rate must be greater than zero.')
  }

  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()
  if (!firstName || !lastName) {
    throw new Error('First name and last name are required.')
  }

  const values = [
    firstName,
    input.middleName.trim(),
    lastName,
    input.address.trim(),
    input.birthdate.trim(),
    input.civilStatus,
    input.emergencyContactName.trim(),
    input.emergencyContactNumber.trim(),
    input.spouseName.trim(),
    input.defaultRate,
    userId,
  ]

  if (staffId) {
    await database.execute(
      `
        UPDATE staff SET
          first_name = $1,
          middle_name = $2,
          last_name = $3,
          address = $4,
          birthdate = $5,
          civil_status = $6,
          emergency_contact_name = $7,
          emergency_contact_number = $8,
          spouse_name = $9,
          default_rate = $10,
          updated_by = $11,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $12
      `,
      [...values, staffId],
    )
    return
  }

  await database.execute(
    `
      INSERT INTO staff (
        first_name, middle_name, last_name, address, birthdate, civil_status,
        emergency_contact_name, emergency_contact_number, spouse_name,
        default_rate, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
    `,
    values,
  )
}

export async function archiveStaff(id: number, userId: number): Promise<void> {
  await setStaffActive(id, false, userId)
}

export async function setStaffActive(id: number, active: boolean, userId: number): Promise<void> {
  const database = await getDatabase()
  await database.execute(
    `
      UPDATE staff SET
        is_archived = $1,
        updated_by = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `,
    [active ? 0 : 1, userId, id],
  )
}

export async function getPayrollSettings(): Promise<PayrollSettings> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      autoDeductCashAdvances: number
      cutoffDay: number
      holidayDefaultMultiplier: number
      overtimeMultiplier: number
      standardDayHours: number
    }>
  >(
    `
      SELECT
        cutoff_day AS cutoffDay,
        holiday_default_multiplier AS holidayDefaultMultiplier,
        auto_deduct_cash_advances AS autoDeductCashAdvances,
        standard_day_hours AS standardDayHours,
        overtime_multiplier AS overtimeMultiplier
      FROM payroll_settings
      WHERE id = 1
    `,
  )
  const row = rows[0]
  if (!row) {
    return {
      autoDeductCashAdvances: true,
      cutoffDay: 6,
      holidayDefaultMultiplier: 1,
      overtimeMultiplier: 1.25,
      standardDayHours: 8,
    }
  }
  return {
    autoDeductCashAdvances: Boolean(row.autoDeductCashAdvances),
    cutoffDay: Number(row.cutoffDay),
    holidayDefaultMultiplier: toNumber(row.holidayDefaultMultiplier),
    overtimeMultiplier: toNumber(row.overtimeMultiplier),
    standardDayHours: toNumber(row.standardDayHours),
  }
}

export async function savePayrollSettings(input: PayrollSettings): Promise<void> {
  const database = await getDatabase()
  if (input.cutoffDay < 0 || input.cutoffDay > 6) {
    throw new Error('Cutoff day must be between 0 (Sunday) and 6 (Saturday).')
  }
  if (input.holidayDefaultMultiplier < 0) {
    throw new Error('Holiday multiplier cannot be negative.')
  }
  if (input.standardDayHours <= 0) {
    throw new Error('Standard day hours must be greater than zero.')
  }
  if (input.overtimeMultiplier < 0) {
    throw new Error('Overtime multiplier cannot be negative.')
  }
  await database.execute(
    `
      UPDATE payroll_settings
      SET
        cutoff_day = $1,
        holiday_default_multiplier = $2,
        auto_deduct_cash_advances = $3,
        standard_day_hours = $4,
        overtime_multiplier = $5
      WHERE id = 1
    `,
    [
      input.cutoffDay,
      input.holidayDefaultMultiplier,
      input.autoDeductCashAdvances ? 1 : 0,
      input.standardDayHours,
      input.overtimeMultiplier,
    ],
  )
}

type AttendanceRow = {
  attendanceDate: string
  computedPay: number
  id: number
  isPaid: number
  multiplier: number
  notes: string
  rateOverride: number | null
  staffId: number
  status: string
}

export async function listAttendance(filters: {
  from: string
  staffId: number
  to: string
}): Promise<AttendanceEntry[]> {
  const database = await getDatabase()
  const rows = await database.select<AttendanceRow[]>(
    `
      SELECT
        a.id AS id,
        a.staff_id AS staffId,
        a.attendance_date AS attendanceDate,
        a.status AS status,
        a.multiplier AS multiplier,
        a.rate_override AS rateOverride,
        a.computed_pay AS computedPay,
        a.notes AS notes,
        CASE WHEN EXISTS (
          SELECT 1 FROM staff_payroll_items i
          JOIN staff_payrolls p ON p.id = i.payroll_id
          WHERE i.attendance_id = a.id AND p.status = 'paid'
        ) THEN 1 ELSE 0 END AS isPaid
      FROM staff_attendance a
      WHERE a.staff_id = $1 AND a.attendance_date >= $2 AND a.attendance_date <= $3
      ORDER BY a.attendance_date ASC
    `,
    [filters.staffId, filters.from, filters.to],
  )

  return rows.map((row) => ({
    attendanceDate: row.attendanceDate,
    computedPay: toNumber(row.computedPay),
    id: row.id,
    isPaid: Boolean(row.isPaid),
    multiplier: toNumber(row.multiplier),
    notes: row.notes,
    rateOverride: row.rateOverride == null ? null : toNumber(row.rateOverride),
    staffId: row.staffId,
    status: row.status as AttendanceStatus,
  }))
}

export async function listUnpaidAttendanceDates(staffId: number): Promise<string[]> {
  const database = await getDatabase()
  const rows = await database.select<Array<{ d: string }>>(
    `
      SELECT a.attendance_date AS d
      FROM staff_attendance a
      WHERE a.staff_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM staff_payroll_items i
          JOIN staff_payrolls p ON p.id = i.payroll_id
          WHERE i.attendance_id = a.id AND p.status = 'paid'
        )
      ORDER BY a.attendance_date ASC
    `,
    [staffId],
  )
  return rows.map((r) => r.d)
}

async function assertAttendanceNotPaid(database: Database, attendanceId: number) {
  const rows = await database.select<CountRow[]>(
    `
      SELECT COUNT(*) AS count
      FROM staff_payroll_items i
      JOIN staff_payrolls p ON p.id = i.payroll_id
      WHERE i.attendance_id = $1 AND p.status = 'paid'
    `,
    [attendanceId],
  )
  if (toNumber(rows[0]?.count) > 0) {
    throw new Error('This attendance day is already included in a paid payroll.')
  }
}

export async function upsertAttendance(
  staffId: number,
  attendanceDate: string,
  input: {
    multiplier?: number
    notes: string
    rateOverride: number | null
    status: AttendanceStatus
  },
  userId: number,
): Promise<void> {
  void userId
  const database = await getDatabase()
  const settings = await getPayrollSettings()
  const staff = await getStaff(staffId)
  if (!staff) throw new Error('Staff not found.')

  const existing = await database.select<Array<{ id: number }>>(
    `SELECT id FROM staff_attendance WHERE staff_id = $1 AND attendance_date = $2`,
    [staffId, attendanceDate],
  )
  const existingId = existing[0]?.id
  if (existingId) {
    await assertAttendanceNotPaid(database, existingId)
  }

  const mult =
    input.multiplier ??
    defaultMultiplierForStatus(input.status, settings.holidayDefaultMultiplier)
  const computedPay = computeDayPay(staff.defaultRate, mult, input.rateOverride)

  if (existingId) {
    await database.execute(
      `
        UPDATE staff_attendance SET
          status = $1,
          multiplier = $2,
          rate_override = $3,
          computed_pay = $4,
          notes = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
      `,
      [input.status, mult, input.rateOverride, computedPay, input.notes.trim(), existingId],
    )
    return
  }

  await database.execute(
    `
      INSERT INTO staff_attendance (
        staff_id, attendance_date, status, multiplier, rate_override, computed_pay, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [staffId, attendanceDate, input.status, mult, input.rateOverride, computedPay, input.notes.trim()],
  )
}

export async function deleteAttendance(attendanceId: number): Promise<void> {
  const database = await getDatabase()
  await assertAttendanceNotPaid(database, attendanceId)
  await database.execute(`DELETE FROM staff_attendance WHERE id = $1`, [attendanceId])
}

export async function buildPayrollPreview(
  staffId: number,
  periodStart: string,
  periodEnd: string,
): Promise<PayrollPreview> {
  const database = await getDatabase()
  const settings = await getPayrollSettings()
  const parsedStart = parseISO(periodStart)
  const parsedEnd = parseISO(periodEnd)
  if (!isValid(parsedStart) || !isValid(parsedEnd)) {
    throw new Error('Please provide a valid payroll period.')
  }
  if (periodStart > periodEnd) {
    throw new Error('Period start must be on or before period end.')
  }
  if (!isCutoffDay(periodEnd, settings.cutoffDay)) {
    throw new Error(
      `Period end must fall on the payroll cutoff weekday (currently ${settings.cutoffDay}: 0=Sun … 6=Sat).`,
    )
  }
  const staff = await getStaff(staffId)
  if (!staff) throw new Error('Staff not found.')

  const rows = await database.select<
    Array<{
      attendanceDate: string
      computedPay: number
      id: number
      multiplier: number
      rateOverride: number | null
      status: string
    }>
  >(
    `
      SELECT
        a.id AS id,
        a.attendance_date AS attendanceDate,
        a.status AS status,
        a.multiplier AS multiplier,
        a.rate_override AS rateOverride,
        a.computed_pay AS computedPay
      FROM staff_attendance a
      WHERE a.staff_id = $1
        AND a.attendance_date >= $2
        AND a.attendance_date <= $3
        AND NOT EXISTS (
          SELECT 1 FROM staff_payroll_items i
          JOIN staff_payrolls p ON p.id = i.payroll_id
          WHERE i.attendance_id = a.id AND p.status = 'paid'
        )
      ORDER BY a.attendance_date ASC
    `,
    [staffId, periodStart, periodEnd],
  )

  const items: PayrollPreviewItem[] = rows.map((r) => ({
    attendanceId: r.id,
    entryDate: r.attendanceDate,
    multiplier: toNumber(r.multiplier),
    payAmount: toNumber(r.computedPay),
    rateUsed: r.rateOverride == null ? staff.defaultRate : toNumber(r.rateOverride),
    status: r.status,
  }))

  const basePay = roundMoney(items.reduce((s, it) => s + it.payAmount, 0))

  return {
    basePay,
    cutoffDay: settings.cutoffDay,
    items,
    overtimeMultiplier: settings.overtimeMultiplier,
    periodEnd,
    periodStart,
    staffDefaultRate: staff.defaultRate,
    standardDayHours: settings.standardDayHours,
  }
}

export async function finalizePayroll(input: FinalizePayrollInput, userId: number): Promise<{
  payrollId: number
  transactionId: number
}> {
  const database = await getDatabase()
  const preview = await buildPayrollPreview(input.staffId, input.periodStart, input.periodEnd)

  if (preview.periodStart !== input.periodStart) {
    throw new Error('Invalid payroll period.')
  }

  // Cash advances selected for settlement on this payroll become deduction
  // adjustments. They are validated up-front so we don't build a partial
  // payroll that references stale or already-settled advances.
  const cashAdvanceIds = Array.from(new Set(input.cashAdvanceIds ?? [])).filter(
    (id) => Number.isFinite(id) && id > 0,
  )
  const cashAdvancesToSettle: CashAdvance[] = []
  if (cashAdvanceIds.length > 0) {
    const placeholders = cashAdvanceIds.map((_, i) => `$${i + 2}`).join(', ')
    const rows = await database.select<CashAdvanceRow[]>(
      `
        SELECT
          id,
          staff_id AS staffId,
          advance_date AS advanceDate,
          amount,
          notes,
          status,
          transaction_id AS transactionId,
          settled_payroll_id AS settledPayrollId,
          settled_at AS settledAt
        FROM staff_cash_advances
        WHERE staff_id = $1 AND id IN (${placeholders})
      `,
      [input.staffId, ...cashAdvanceIds],
    )
    if (rows.length !== cashAdvanceIds.length) {
      throw new Error('One or more selected cash advances could not be found for this staff member.')
    }
    for (const row of rows) {
      if (row.status !== 'outstanding') {
        throw new Error(`Cash advance dated ${row.advanceDate} is no longer outstanding.`)
      }
      cashAdvancesToSettle.push(cashAdvanceRowToModel(row))
    }
  }

  // Normalise the incoming line items. Cash advances selected above are
  // appended as deduction lines so the payslip records them like any other
  // deduction (and so a later void can revert them alongside the rest).
  const adjustmentLines: PayrollAdjustmentDraft[] = []
  for (const adj of input.adjustments) {
    if (!adj.label.trim()) continue
    if (adj.amount < 0) throw new Error('Adjustment amounts must be zero or positive.')
    adjustmentLines.push({
      amount: roundMoney(adj.amount),
      category: adj.category?.trim() || 'other',
      kind: adj.kind,
      label: adj.label.trim(),
      quantity: adj.quantity ?? null,
      rate: adj.rate ?? null,
      recurringId: adj.recurringId ?? null,
      source: adj.source ?? 'manual',
      taxable: adj.taxable ?? false,
    })
  }
  for (const adv of cashAdvancesToSettle) {
    adjustmentLines.push({
      amount: roundMoney(adv.amount),
      category: 'cash_advance',
      kind: 'deduction',
      label: `Cash advance · ${adv.advanceDate}`,
      quantity: null,
      rate: null,
      recurringId: null,
      source: 'cash_advance',
      taxable: false,
    })
  }

  let earningTotal = 0
  let deductionTotal = 0
  for (const line of adjustmentLines) {
    if (line.kind === 'earning') earningTotal += line.amount
    else deductionTotal += line.amount
  }
  earningTotal = roundMoney(earningTotal)
  deductionTotal = roundMoney(deductionTotal)
  const basePay = preview.basePay
  const grossPay = roundMoney(basePay + earningTotal)
  const netPay = roundMoney(grossPay - deductionTotal)
  if (netPay < 0) {
    throw new Error('Net pay cannot be negative. Reduce deductions or increase earnings.')
  }

  const staff = await getStaff(input.staffId)
  if (!staff) throw new Error('Staff not found.')

  const { categoryId, typeId } = await getExpenseStaffSalaryIds(database)
  const description = `Payroll ${staff.displayName} ${input.periodStart}–${input.periodEnd}`

  for (const item of preview.items) {
    await assertAttendanceNotPaid(database, item.attendanceId)
  }

  // The Tauri SQL plugin uses a connection pool, so BEGIN/COMMIT cannot span
  // multiple `execute()` calls. We run the inserts sequentially and rely on the
  // `lastInsertId` returned by each call. If any step fails we manually clean
  // up whatever was inserted so the ledger stays consistent.
  let transactionId: number | null = null
  let payrollId: number | null = null

  try {
    const txnResult = await database.execute(
      `
        INSERT INTO transactions (
          entry_date, transaction_type_id, category_id, description, amount,
          staff_count, customer_id, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $6)
      `,
      [input.payDate, typeId, categoryId, description, netPay, userId],
    )
    transactionId = typeof txnResult.lastInsertId === 'number' ? txnResult.lastInsertId : null
    if (!transactionId) {
      throw new Error('Failed to record salary expense transaction.')
    }

    const totalAdjustments = roundMoney(earningTotal - deductionTotal)
    const payrollResult = await database.execute(
      `
        INSERT INTO staff_payrolls (
          staff_id, period_start, period_end, pay_date, cutoff_day,
          gross_pay, total_adjustments, net_pay, status, transaction_id, notes,
          base_pay, total_earnings, total_deductions
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'paid', $9, $10, $11, $12, $13)
      `,
      [
        input.staffId,
        input.periodStart,
        input.periodEnd,
        input.payDate,
        preview.cutoffDay,
        grossPay,
        totalAdjustments,
        netPay,
        transactionId,
        input.notes.trim(),
        basePay,
        earningTotal,
        deductionTotal,
      ],
    )
    payrollId = typeof payrollResult.lastInsertId === 'number' ? payrollResult.lastInsertId : null
    if (!payrollId) {
      throw new Error('Failed to create payroll record.')
    }

    for (const item of preview.items) {
      await database.execute(
        `
          INSERT INTO staff_payroll_items (
            payroll_id, attendance_id, entry_date, status, rate_used, multiplier, pay_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          payrollId,
          item.attendanceId,
          item.entryDate,
          item.status,
          item.rateUsed,
          item.multiplier,
          item.payAmount,
        ],
      )
    }

    for (const line of adjustmentLines) {
      await database.execute(
        `
          INSERT INTO staff_payroll_adjustments (
            payroll_id, label, kind, category, amount, taxable, quantity, rate, source, recurring_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          payrollId,
          line.label,
          line.kind,
          line.category,
          line.amount,
          line.taxable ? 1 : 0,
          line.quantity ?? null,
          line.rate ?? null,
          line.source ?? 'manual',
          line.recurringId ?? null,
        ],
      )
      // Draw down a recurring loan/obligation balance as it is applied, and
      // deactivate it once fully paid so it stops appearing on future payrolls.
      // A one-time item is retired after this single application; voiding the
      // payroll reactivates it (see voidPayroll).
      if (line.recurringId) {
        await database.execute(
          `
            UPDATE staff_recurring_adjustments
            SET
              remaining_balance = CASE
                WHEN has_balance = 1 THEN MAX(0, COALESCE(remaining_balance, 0) - $1)
                ELSE remaining_balance
              END,
              is_active = CASE
                WHEN one_time = 1 THEN 0
                WHEN has_balance = 1 AND COALESCE(remaining_balance, 0) - $1 <= 0 THEN 0
                ELSE is_active
              END,
              updated_by = $2,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
          `,
          [line.amount, userId, line.recurringId],
        )
      }
    }

    for (const adv of cashAdvancesToSettle) {
      await database.execute(
        `
          UPDATE staff_cash_advances
          SET
            status = 'settled',
            settled_payroll_id = $1,
            settled_at = CURRENT_TIMESTAMP,
            updated_by = $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `,
        [payrollId, userId, adv.id],
      )
    }

    return { payrollId, transactionId }
  } catch (err) {
    // Best-effort manual rollback. The staff_payrolls cascade deletes the
    // payroll items and adjustments via ON DELETE CASCADE.
    if (payrollId) {
      try {
        await database.execute(`DELETE FROM staff_payrolls WHERE id = $1`, [payrollId])
      } catch {
        /* swallow cleanup errors so the original failure propagates */
      }
    }
    if (transactionId) {
      try {
        await database.execute(`DELETE FROM transactions WHERE id = $1`, [transactionId])
      } catch {
        /* swallow cleanup errors so the original failure propagates */
      }
    }
    throw err
  }
}

type PayrollHeaderRow = {
  basePay: number
  cutoffDay: number
  grossPay: number
  id: number
  netPay: number
  notes: string
  payDate: string
  periodEnd: string
  periodStart: string
  staffId: number
  status: string
  totalAdjustments: number
  totalDeductions: number
  totalEarnings: number
  transactionId: number | null
}

/** Shared column list for reading a staff_payrolls header row into PayrollListItem. */
const PAYROLL_HEADER_COLUMNS = `
  id,
  staff_id AS staffId,
  period_start AS periodStart,
  period_end AS periodEnd,
  pay_date AS payDate,
  cutoff_day AS cutoffDay,
  base_pay AS basePay,
  gross_pay AS grossPay,
  total_earnings AS totalEarnings,
  total_deductions AS totalDeductions,
  total_adjustments AS totalAdjustments,
  net_pay AS netPay,
  status,
  transaction_id AS transactionId,
  notes
`

function payrollHeaderRowToItem(r: PayrollHeaderRow): PayrollListItem {
  return {
    basePay: toNumber(r.basePay),
    cutoffDay: Number(r.cutoffDay),
    grossPay: toNumber(r.grossPay),
    id: r.id,
    netPay: toNumber(r.netPay),
    notes: r.notes,
    payDate: r.payDate,
    periodEnd: r.periodEnd,
    periodStart: r.periodStart,
    staffId: r.staffId,
    status: r.status as 'paid' | 'void',
    totalAdjustments: toNumber(r.totalAdjustments),
    totalDeductions: toNumber(r.totalDeductions),
    totalEarnings: toNumber(r.totalEarnings),
    transactionId: r.transactionId == null ? null : Number(r.transactionId),
  }
}

export async function listPayrolls(staffId: number): Promise<PayrollListItem[]> {
  const database = await getDatabase()
  const rows = await database.select<PayrollHeaderRow[]>(
    `
      SELECT ${PAYROLL_HEADER_COLUMNS}
      FROM staff_payrolls
      WHERE staff_id = $1
      ORDER BY period_end DESC, id DESC
    `,
    [staffId],
  )

  return rows.map(payrollHeaderRowToItem)
}

export type AttendanceDaySummary = {
  absentCount: number
  date: string
  halfCount: number
  holidayCount: number
  overtimeCount: number
  presentCount: number
  totalCount: number
  totalPay: number
}

export type PayrollPayDateSummary = {
  count: number
  payDate: string
  totalGross: number
  totalNet: number
}

export type AllStaffPayrollItem = PayrollListItem & {
  staffDisplayName: string
}

export async function listAttendanceDaySummaries(from: string, to: string): Promise<AttendanceDaySummary[]> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      absentCount: number
      date: string
      halfCount: number
      holidayCount: number
      overtimeCount: number
      presentCount: number
      totalCount: number
      totalPay: number
    }>
  >(
    `
      SELECT
        attendance_date AS date,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS presentCount,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absentCount,
        SUM(CASE WHEN status = 'half' THEN 1 ELSE 0 END) AS halfCount,
        SUM(CASE WHEN status = 'overtime' THEN 1 ELSE 0 END) AS overtimeCount,
        SUM(CASE WHEN status = 'holiday' THEN 1 ELSE 0 END) AS holidayCount,
        COUNT(*) AS totalCount,
        SUM(computed_pay) AS totalPay
      FROM staff_attendance
      WHERE attendance_date >= $1 AND attendance_date <= $2
      GROUP BY attendance_date
      ORDER BY attendance_date ASC
    `,
    [from, to],
  )
  return rows.map((r) => ({
    absentCount: Number(r.absentCount),
    date: r.date,
    halfCount: Number(r.halfCount),
    holidayCount: Number(r.holidayCount),
    overtimeCount: Number(r.overtimeCount),
    presentCount: Number(r.presentCount),
    totalCount: Number(r.totalCount),
    totalPay: toNumber(r.totalPay),
  }))
}

export async function listPayrollPayDateSummaries(from: string, to: string): Promise<PayrollPayDateSummary[]> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      count: number
      payDate: string
      totalGross: number
      totalNet: number
    }>
  >(
    `
      SELECT
        pay_date AS payDate,
        COUNT(*) AS count,
        SUM(gross_pay) AS totalGross,
        SUM(net_pay) AS totalNet
      FROM staff_payrolls
      WHERE pay_date >= $1 AND pay_date <= $2 AND status = 'paid'
      GROUP BY pay_date
      ORDER BY pay_date ASC
    `,
    [from, to],
  )
  return rows.map((r) => ({
    count: Number(r.count),
    payDate: r.payDate,
    totalGross: toNumber(r.totalGross),
    totalNet: toNumber(r.totalNet),
  }))
}

export type AttendanceEntryWithStaff = AttendanceEntry & {
  staffDisplayName: string
}

export async function listAttendanceForDate(date: string): Promise<AttendanceEntryWithStaff[]> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      id: number
      staffId: number
      attendanceDate: string
      status: string
      multiplier: number
      rateOverride: number | null
      computedPay: number
      notes: string
      isPaid: number
      firstName: string
      middleName: string
      lastName: string
    }>
  >(
    `
      SELECT
        a.id,
        a.staff_id AS staffId,
        a.attendance_date AS attendanceDate,
        a.status,
        a.multiplier,
        a.rate_override AS rateOverride,
        a.computed_pay AS computedPay,
        a.notes,
        CASE WHEN EXISTS (
          SELECT 1 FROM staff_payroll_items i
          JOIN staff_payrolls p ON p.id = i.payroll_id
          WHERE i.attendance_id = a.id AND p.status = 'paid'
        ) THEN 1 ELSE 0 END AS isPaid,
        s.first_name AS firstName,
        s.middle_name AS middleName,
        s.last_name AS lastName
      FROM staff_attendance a
      JOIN staff s ON s.id = a.staff_id
      WHERE a.attendance_date = $1
      ORDER BY s.first_name ASC, s.last_name ASC
    `,
    [date],
  )
  return rows.map((r) => {
    const parts = [r.firstName, r.middleName, r.lastName].filter((p) => p && p.trim().length > 0)
    return {
      attendanceDate: r.attendanceDate,
      computedPay: toNumber(r.computedPay),
      id: r.id,
      isPaid: Boolean(r.isPaid),
      multiplier: toNumber(r.multiplier),
      notes: r.notes,
      rateOverride: r.rateOverride == null ? null : toNumber(r.rateOverride),
      staffDisplayName: parts.join(' '),
      staffId: r.staffId,
      status: r.status as AttendanceStatus,
    }
  })
}

export async function listPayrollsByPayDate(payDate: string): Promise<AllStaffPayrollItem[]> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<PayrollHeaderRow & { firstName: string; lastName: string; middleName: string }>
  >(
    `
      SELECT
        p.id,
        p.staff_id AS staffId,
        p.period_start AS periodStart,
        p.period_end AS periodEnd,
        p.pay_date AS payDate,
        p.cutoff_day AS cutoffDay,
        p.base_pay AS basePay,
        p.gross_pay AS grossPay,
        p.total_earnings AS totalEarnings,
        p.total_deductions AS totalDeductions,
        p.total_adjustments AS totalAdjustments,
        p.net_pay AS netPay,
        p.status,
        p.transaction_id AS transactionId,
        p.notes,
        s.first_name AS firstName,
        s.middle_name AS middleName,
        s.last_name AS lastName
      FROM staff_payrolls p
      JOIN staff s ON s.id = p.staff_id
      WHERE p.pay_date = $1 AND p.status = 'paid'
      ORDER BY s.first_name ASC, s.last_name ASC
    `,
    [payDate],
  )
  return rows.map((r) => {
    const parts = [r.firstName, r.middleName, r.lastName].filter((p) => p && p.trim().length > 0)
    return {
      ...payrollHeaderRowToItem(r),
      staffDisplayName: parts.join(' '),
    }
  })
}

export async function getPayrollDetail(payrollId: number): Promise<PayrollDetail | null> {
  const database = await getDatabase()
  const payrollRows = await database.select<PayrollHeaderRow[]>(
    `
      SELECT ${PAYROLL_HEADER_COLUMNS}
      FROM staff_payrolls
      WHERE id = $1
    `,
    [payrollId],
  )
  const pr = payrollRows[0]
  if (!pr) return null

  const payroll = payrollHeaderRowToItem(pr)

  const items = await database.select<PayrollPreviewItem[]>(
    `
      SELECT
        i.attendance_id AS attendanceId,
        i.entry_date AS entryDate,
        i.status AS status,
        i.rate_used AS rateUsed,
        i.multiplier AS multiplier,
        i.pay_amount AS payAmount
      FROM staff_payroll_items i
      WHERE i.payroll_id = $1
      ORDER BY i.entry_date ASC
    `,
    [payrollId],
  )

  const adjRows = await database.select<
    Array<{
      amount: number
      category: string
      id: number
      kind: string
      label: string
      quantity: number | null
      rate: number | null
      recurringId: number | null
      source: string
      taxable: number
    }>
  >(
    `
      SELECT
        id, label, kind, category, amount, taxable, quantity, rate, source,
        recurring_id AS recurringId
      FROM staff_payroll_adjustments
      WHERE payroll_id = $1
      ORDER BY id ASC
    `,
    [payrollId],
  )

  const adjustments: PayrollAdjustment[] = adjRows.map((a) => ({
    amount: toNumber(a.amount),
    category: a.category,
    id: a.id,
    kind: a.kind as AdjustmentKind,
    label: a.label,
    quantity: a.quantity == null ? null : toNumber(a.quantity),
    rate: a.rate == null ? null : toNumber(a.rate),
    recurringId: a.recurringId == null ? null : Number(a.recurringId),
    source: a.source as AdjustmentSource,
    taxable: Boolean(a.taxable),
  }))

  return { adjustments, items, payroll }
}

/**
 * All adjustment lines actually applied to a staff member across their paid
 * payroll runs, newest run first. Voided runs are excluded — their lines never
 * affected pay. Both the `payroll_id` and `staff_id` join paths are indexed.
 */
export async function listStaffAdjustmentHistory(
  staffId: number,
): Promise<StaffAdjustmentHistoryEntry[]> {
  const database = await getDatabase()
  const rows = await database.select<
    Array<{
      amount: number
      category: string
      id: number
      kind: string
      label: string
      payDate: string
      payrollId: number
      periodEnd: string
      periodStart: string
      quantity: number | null
      rate: number | null
      source: string
      taxable: number
    }>
  >(
    `
      SELECT
        a.id, a.label, a.kind, a.category, a.amount, a.taxable, a.quantity, a.rate, a.source,
        p.id AS payrollId,
        p.pay_date AS payDate,
        p.period_start AS periodStart,
        p.period_end AS periodEnd
      FROM staff_payroll_adjustments a
      JOIN staff_payrolls p ON p.id = a.payroll_id
      WHERE p.staff_id = $1 AND p.status = 'paid'
      ORDER BY p.pay_date DESC, p.id DESC, a.id ASC
    `,
    [staffId],
  )
  return rows.map((r) => ({
    amount: toNumber(r.amount),
    category: r.category,
    id: r.id,
    kind: r.kind as AdjustmentKind,
    label: r.label,
    payDate: r.payDate,
    payrollId: r.payrollId,
    periodEnd: r.periodEnd,
    periodStart: r.periodStart,
    quantity: r.quantity == null ? null : toNumber(r.quantity),
    rate: r.rate == null ? null : toNumber(r.rate),
    source: r.source as AdjustmentSource,
    taxable: Boolean(r.taxable),
  }))
}

export async function voidPayroll(payrollId: number): Promise<void> {
  const database = await getDatabase()
  const detail = await getPayrollDetail(payrollId)
  if (!detail) throw new Error('Payroll not found.')
  if (detail.payroll.status !== 'paid') {
    throw new Error('Only paid payrolls can be voided.')
  }

  const transactionId = detail.payroll.transactionId

  // The Tauri SQL plugin does not support transactions across multiple
  // `execute()` calls (pooled connections), so we delete child rows first and
  // flip the payroll to `void` at the end; if any step fails mid-way the
  // caller can retry safely because each DELETE/UPDATE is idempotent.

  // Restore any recurring balances this payroll drew down (e.g. a loan) so the
  // obligation is reinstated, and reactivate items that were auto-closed — both
  // fully-paid balance items and one-time items consumed by this run. Must run
  // before the adjustments are deleted below.
  for (const adj of detail.adjustments) {
    if (adj.recurringId == null) continue
    await database.execute(
      `
        UPDATE staff_recurring_adjustments
        SET
          remaining_balance = CASE
            WHEN has_balance = 1 THEN COALESCE(remaining_balance, 0) + $1
            ELSE remaining_balance
          END,
          is_active = CASE WHEN has_balance = 1 OR one_time = 1 THEN 1 ELSE is_active END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [adj.amount, adj.recurringId],
    )
  }

  await database.execute(`DELETE FROM staff_payroll_items WHERE payroll_id = $1`, [payrollId])
  await database.execute(`DELETE FROM staff_payroll_adjustments WHERE payroll_id = $1`, [payrollId])
  await database.execute(
    `
      UPDATE staff_cash_advances
      SET
        status = 'outstanding',
        settled_payroll_id = NULL,
        settled_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE settled_payroll_id = $1
    `,
    [payrollId],
  )
  // Only attempt to remove the ledger entry when it still exists; the FK is
  // ON DELETE SET NULL so a manually-deleted transaction sets this to NULL.
  if (transactionId) {
    await database.execute(`DELETE FROM transactions WHERE id = $1`, [transactionId])
  }
  await database.execute(
    `
      UPDATE staff_payrolls
      SET status = 'void', transaction_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [payrollId],
  )
}

// ─── Recurring payroll adjustments ───────────────────────────────────────────

type RecurringAdjustmentRow = {
  amount: number
  category: string
  endDate: string
  hasBalance: number
  id: number
  isActive: number
  kind: string
  label: string
  notes: string
  oneTime: number
  originalBalance: number | null
  remainingBalance: number | null
  staffId: number
  startDate: string
  taxable: number
}

function recurringRowToModel(row: RecurringAdjustmentRow): RecurringAdjustment {
  return {
    amount: toNumber(row.amount),
    category: row.category,
    endDate: row.endDate,
    hasBalance: Boolean(row.hasBalance),
    id: row.id,
    isActive: Boolean(row.isActive),
    kind: row.kind as AdjustmentKind,
    label: row.label,
    notes: row.notes,
    oneTime: Boolean(row.oneTime),
    originalBalance: row.originalBalance == null ? null : toNumber(row.originalBalance),
    remainingBalance: row.remainingBalance == null ? null : toNumber(row.remainingBalance),
    staffId: row.staffId,
    startDate: row.startDate,
    taxable: Boolean(row.taxable),
  }
}

const RECURRING_COLUMNS = `
  id,
  staff_id AS staffId,
  label,
  kind,
  category,
  amount,
  taxable,
  is_active AS isActive,
  has_balance AS hasBalance,
  original_balance AS originalBalance,
  remaining_balance AS remainingBalance,
  start_date AS startDate,
  end_date AS endDate,
  notes,
  one_time AS oneTime
`

export async function listStaffRecurringAdjustments(
  staffId: number,
  filters?: { activeOnly?: boolean },
): Promise<RecurringAdjustment[]> {
  const database = await getDatabase()
  const conditions = ['staff_id = $1']
  if (filters?.activeOnly) {
    // Active, and — for balance-tracked items — not yet fully paid off.
    conditions.push(`is_active = 1 AND (has_balance = 0 OR COALESCE(remaining_balance, 0) > 0)`)
  }
  const rows = await database.select<RecurringAdjustmentRow[]>(
    `
      SELECT ${RECURRING_COLUMNS}
      FROM staff_recurring_adjustments
      WHERE ${conditions.join(' AND ')}
      ORDER BY kind ASC, label COLLATE NOCASE ASC
    `,
    [staffId],
  )
  return rows.map(recurringRowToModel)
}

function normalizeRecurringDraft(input: RecurringAdjustmentDraft): {
  amount: number
  category: string
  endDate: string
  hasBalance: number
  kind: AdjustmentKind
  label: string
  notes: string
  oneTime: number
  originalBalance: number | null
  startDate: string
  taxable: number
} {
  const label = input.label.trim()
  if (!label) throw new Error('A label is required.')
  if (input.kind !== 'earning' && input.kind !== 'deduction') {
    throw new Error('Recurring item must be an earning or a deduction.')
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error('Amount must be zero or a positive number.')
  }
  // A one-time item is applied once and retired, so a running balance is
  // meaningless for it — the two modes are mutually exclusive.
  const oneTime = input.oneTime ? 1 : 0
  const hasBalance = oneTime ? 0 : input.hasBalance ? 1 : 0
  let originalBalance: number | null = null
  if (hasBalance) {
    if (input.originalBalance == null || !Number.isFinite(input.originalBalance) || input.originalBalance <= 0) {
      throw new Error('A balance-tracked item needs a total balance greater than zero.')
    }
    originalBalance = roundMoney(input.originalBalance)
  }
  return {
    amount: roundMoney(input.amount),
    category: input.category?.trim() || 'other',
    endDate: input.endDate.trim(),
    hasBalance,
    kind: input.kind,
    label,
    notes: input.notes.trim(),
    oneTime,
    originalBalance,
    startDate: input.startDate.trim(),
    taxable: input.taxable ? 1 : 0,
  }
}

export async function saveStaffRecurringAdjustment(
  staffId: number,
  input: RecurringAdjustmentDraft,
  userId: number,
  recurringId?: number,
): Promise<void> {
  const database = await getDatabase()
  const v = normalizeRecurringDraft(input)

  if (recurringId) {
    // Preserve any progress already made against a balance: when the total is
    // unchanged keep the remaining balance; otherwise reset it to the new total.
    const existing = await database.select<Array<{ originalBalance: number | null }>>(
      `SELECT original_balance AS originalBalance FROM staff_recurring_adjustments WHERE id = $1 AND staff_id = $2`,
      [recurringId, staffId],
    )
    if (existing.length === 0) throw new Error('Recurring item not found.')
    const prevOriginal = existing[0]?.originalBalance
    const keepRemaining =
      v.hasBalance === 1 && prevOriginal != null && roundMoney(toNumber(prevOriginal)) === v.originalBalance
    await database.execute(
      `
        UPDATE staff_recurring_adjustments SET
          label = $1,
          kind = $2,
          category = $3,
          amount = $4,
          taxable = $5,
          has_balance = $6,
          original_balance = $7,
          remaining_balance = CASE WHEN $8 = 1 THEN remaining_balance ELSE $7 END,
          start_date = $9,
          end_date = $10,
          notes = $11,
          one_time = $15,
          updated_by = $12,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $13 AND staff_id = $14
      `,
      [
        v.label,
        v.kind,
        v.category,
        v.amount,
        v.taxable,
        v.hasBalance,
        v.originalBalance,
        keepRemaining ? 1 : 0,
        v.startDate,
        v.endDate,
        v.notes,
        userId,
        recurringId,
        staffId,
        v.oneTime,
      ],
    )
    return
  }

  await database.execute(
    `
      INSERT INTO staff_recurring_adjustments (
        staff_id, label, kind, category, amount, taxable, is_active,
        has_balance, original_balance, remaining_balance, start_date, end_date,
        notes, created_by, updated_by, one_time
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $8, $9, $10, $11, $12, $12, $13)
    `,
    [
      staffId,
      v.label,
      v.kind,
      v.category,
      v.amount,
      v.taxable,
      v.hasBalance,
      v.originalBalance,
      v.startDate,
      v.endDate,
      v.notes,
      userId,
      v.oneTime,
    ],
  )
}

export async function setRecurringAdjustmentActive(
  recurringId: number,
  active: boolean,
  userId: number,
): Promise<void> {
  const database = await getDatabase()
  await database.execute(
    `
      UPDATE staff_recurring_adjustments
      SET is_active = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `,
    [active ? 1 : 0, userId, recurringId],
  )
}

export async function deleteStaffRecurringAdjustment(recurringId: number): Promise<void> {
  const database = await getDatabase()
  // Historical payroll adjustments keep their snapshot (recurring_id FK is
  // ON DELETE SET NULL), so removing the definition never rewrites past pay.
  await database.execute(`DELETE FROM staff_recurring_adjustments WHERE id = $1`, [recurringId])
}

// ─── Cash Advances ───────────────────────────────────────────────────────────

type CashAdvanceRow = {
  advanceDate: string
  amount: number
  id: number
  notes: string
  settledAt: string | null
  settledPayrollId: number | null
  staffId: number
  status: string
  transactionId: number | null
}

function cashAdvanceRowToModel(row: CashAdvanceRow): CashAdvance {
  return {
    advanceDate: row.advanceDate,
    amount: toNumber(row.amount),
    id: row.id,
    notes: row.notes,
    settledAt: row.settledAt,
    settledPayrollId: row.settledPayrollId,
    staffId: row.staffId,
    status: row.status as CashAdvanceStatus,
    transactionId: row.transactionId,
  }
}

async function getCashAdvanceCategoryId(database: Database): Promise<{ categoryId: number; typeId: number }> {
  const typeRows = await database.select<Array<{ id: number }>>(
    `SELECT id FROM transaction_types WHERE code = $1`,
    ['EXPENSE'],
  )
  const typeId = Number(typeRows[0]?.id ?? 0)
  if (!typeId) throw new Error('EXPENSE transaction type is missing.')

  const catRows = await database.select<Array<{ id: number }>>(
    `
      SELECT categories.id AS id
      FROM categories
      JOIN transaction_types ON transaction_types.id = categories.transaction_type_id
      WHERE transaction_types.code = 'EXPENSE'
        AND categories.label = 'Cash Advance'
        AND categories.is_archived = 0
      LIMIT 1
    `,
  )
  const categoryId = Number(catRows[0]?.id ?? 0)
  if (!categoryId) throw new Error('Cash Advance expense category is missing.')
  return { categoryId, typeId }
}

export async function listCashAdvances(
  staffId: number,
  filters?: { status?: CashAdvanceStatus | 'all' },
): Promise<CashAdvance[]> {
  const database = await getDatabase()
  const status = filters?.status ?? 'all'
  const clauses = ['staff_id = $1']
  const params: unknown[] = [staffId]
  if (status !== 'all') {
    clauses.push(`status = $${params.length + 1}`)
    params.push(status)
  }
  const rows = await database.select<CashAdvanceRow[]>(
    `
      SELECT
        id,
        staff_id AS staffId,
        advance_date AS advanceDate,
        amount,
        notes,
        status,
        transaction_id AS transactionId,
        settled_payroll_id AS settledPayrollId,
        settled_at AS settledAt
      FROM staff_cash_advances
      WHERE ${clauses.join(' AND ')}
      ORDER BY advance_date DESC, id DESC
    `,
    params,
  )
  return rows.map(cashAdvanceRowToModel)
}

export async function getCashAdvanceByTransactionId(
  transactionId: number,
): Promise<CashAdvance | null> {
  const database = await getDatabase()
  const rows = await database.select<CashAdvanceRow[]>(
    `
      SELECT
        id,
        staff_id AS staffId,
        advance_date AS advanceDate,
        amount,
        notes,
        status,
        transaction_id AS transactionId,
        settled_payroll_id AS settledPayrollId,
        settled_at AS settledAt
      FROM staff_cash_advances
      WHERE transaction_id = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [transactionId],
  )
  const row = rows[0]
  return row ? cashAdvanceRowToModel(row) : null
}

export async function getOutstandingCashAdvanceTotal(staffId: number): Promise<number> {
  const database = await getDatabase()
  const rows = await database.select<Array<{ total: number | null }>>(
    `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM staff_cash_advances
      WHERE staff_id = $1 AND status = 'outstanding'
    `,
    [staffId],
  )
  return toNumber(rows[0]?.total ?? 0)
}

export async function createCashAdvance(
  draft: CashAdvanceDraft,
  userId: number,
): Promise<{ advanceId: number; transactionId: number }> {
  const database = await getDatabase()
  const amount = roundMoney(Number(draft.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Cash advance amount must be greater than zero.')
  }
  if (!draft.advanceDate.trim()) {
    throw new Error('Advance date is required.')
  }

  const staff = await getStaff(draft.staffId)
  if (!staff) throw new Error('Staff not found.')

  const { categoryId, typeId } = await getCashAdvanceCategoryId(database)
  const description = `Cash advance · ${staff.displayName}${
    draft.notes.trim() ? ` — ${draft.notes.trim()}` : ''
  }`

  let transactionId: number | null = null
  let advanceId: number | null = null

  try {
    const txnResult = await database.execute(
      `
        INSERT INTO transactions (
          entry_date, transaction_type_id, category_id, description, amount,
          staff_count, customer_id, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $6)
      `,
      [draft.advanceDate, typeId, categoryId, description, amount, userId],
    )
    transactionId = typeof txnResult.lastInsertId === 'number' ? txnResult.lastInsertId : null
    if (!transactionId) throw new Error('Failed to record cash advance expense.')

    const advResult = await database.execute(
      `
        INSERT INTO staff_cash_advances (
          staff_id, advance_date, amount, notes, status,
          transaction_id, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, 'outstanding', $5, $6, $6)
      `,
      [draft.staffId, draft.advanceDate, amount, draft.notes.trim(), transactionId, userId],
    )
    advanceId = typeof advResult.lastInsertId === 'number' ? advResult.lastInsertId : null
    if (!advanceId) throw new Error('Failed to record cash advance.')

    return { advanceId, transactionId }
  } catch (err) {
    if (transactionId) {
      try {
        await database.execute(`DELETE FROM transactions WHERE id = $1`, [transactionId])
      } catch {
        /* swallow cleanup errors so the original failure propagates */
      }
    }
    throw err
  }
}

export async function voidCashAdvance(advanceId: number, userId: number): Promise<void> {
  const database = await getDatabase()
  const rows = await database.select<CashAdvanceRow[]>(
    `
      SELECT
        id,
        staff_id AS staffId,
        advance_date AS advanceDate,
        amount,
        notes,
        status,
        transaction_id AS transactionId,
        settled_payroll_id AS settledPayrollId,
        settled_at AS settledAt
      FROM staff_cash_advances
      WHERE id = $1
    `,
    [advanceId],
  )
  const row = rows[0]
  if (!row) throw new Error('Cash advance not found.')
  if (row.status !== 'outstanding') {
    throw new Error('Only outstanding cash advances can be voided.')
  }
  if (row.transactionId) {
    await database.execute(`DELETE FROM transactions WHERE id = $1`, [row.transactionId])
  }
  await database.execute(
    `
      UPDATE staff_cash_advances
      SET
        status = 'void',
        transaction_id = NULL,
        updated_by = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `,
    [userId, advanceId],
  )
}

// ─── Database Backup ─────────────────────────────────────────────────────────

/**
 * Creates a full SQLite backup using VACUUM INTO.
 * The resulting file is a valid, self-contained .db file.
 * targetPath must be an absolute filesystem path.
 */
export async function vacuumInto(targetPath: string): Promise<void> {
  const database = await getDatabase()
  // VACUUM INTO does not support parameter binding in SQLite —
  // the path is constructed by us (not user input) so this is safe.
  await database.execute(`VACUUM INTO '${targetPath.replaceAll("'", "''")}'`)
}

// ─── Natural-key lookups for the JSON backup importer ────────────────────────
//
// These four helpers exist so the import flow in `src/features/backup/` can
// resolve incoming foreign-key references (which travel as natural-key tuples
// instead of raw ids) to the LOCAL database id of the matching row. They are
// kept short and read-only on purpose; the importer does its own bulk-loading
// of every entity for the dry-run preview, but uses these per-row queries
// while it walks the apply plan.

export async function findCustomerByNaturalKey(
  name: string,
  phone: string,
): Promise<{ id: number; name: string; phone: string } | null> {
  const database = await getDatabase()
  const rows = await database.select<Array<{ id: number; name: string; phone: string }>>(
    `
      SELECT id, name, phone
      FROM customers
      WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
        AND TRIM(COALESCE(phone, '')) = TRIM(COALESCE($2, ''))
      ORDER BY id
      LIMIT 1
    `,
    [name, phone],
  )
  return rows[0] ?? null
}

export async function findInventoryItemByName(
  name: string,
): Promise<{ id: number; name: string } | null> {
  const database = await getDatabase()
  const rows = await database.select<Array<{ id: number; name: string }>>(
    `
      SELECT id, name
      FROM inventory_items
      WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
      ORDER BY id
      LIMIT 1
    `,
    [name],
  )
  return rows[0] ?? null
}

export async function findStaffByNaturalKey(
  firstName: string,
  middleName: string,
  lastName: string,
  birthdate: string,
): Promise<{ id: number } | null> {
  const database = await getDatabase()
  const rows = await database.select<Array<{ id: number }>>(
    `
      SELECT id
      FROM staff
      WHERE LOWER(TRIM(first_name)) = LOWER(TRIM($1))
        AND LOWER(TRIM(COALESCE(middle_name, ''))) = LOWER(TRIM(COALESCE($2, '')))
        AND LOWER(TRIM(last_name)) = LOWER(TRIM($3))
        AND TRIM(COALESCE(birthdate, '')) = TRIM(COALESCE($4, ''))
      ORDER BY id
      LIMIT 1
    `,
    [firstName, middleName, lastName, birthdate],
  )
  return rows[0] ?? null
}

/**
 * Finds the existing transaction id (if any) matching the same identity
 * fields used by the JSON-backup transaction fingerprint. Looking up by the
 * fields themselves (denormalized SQL) instead of by the hash, since the
 * fingerprint is a derived value never stored in the DB.
 */
export async function findTransactionByIdentity(input: {
  entryDate: string
  transactionTypeCode: string
  categoryLabel: string
  amount: number
  description: string
  customerName: string | null
  customerPhone: string | null
  kg: number | null
  loads: number | null
  isLoyaltyReward: boolean
}): Promise<{ id: number } | null> {
  const database = await getDatabase()
  const wantsCustomer = input.customerName != null
  const rows = await database.select<Array<{ id: number }>>(
    `
      SELECT t.id AS id
      FROM transactions t
      JOIN transaction_types tt ON tt.id = t.transaction_type_id
      JOIN categories c ON c.id = t.category_id
      LEFT JOIN customers cust ON cust.id = t.customer_id
      WHERE t.entry_date = $1
        AND tt.code = $2
        AND LOWER(TRIM(c.label)) = LOWER(TRIM($3))
        AND ROUND(t.amount, 2) = ROUND($4, 2)
        AND COALESCE(TRIM(t.description), '') = COALESCE(TRIM($5), '')
        AND (
          ($6 = 0 AND t.customer_id IS NULL)
          OR (
            $6 = 1
            AND cust.id IS NOT NULL
            AND LOWER(TRIM(cust.name)) = LOWER(TRIM($7))
            AND TRIM(COALESCE(cust.phone, '')) = TRIM(COALESCE($8, ''))
          )
        )
        AND (
          ($9 IS NULL AND t.kg IS NULL)
          OR ($9 IS NOT NULL AND t.kg IS NOT NULL AND ROUND(t.kg, 4) = ROUND($9, 4))
        )
        AND (
          ($10 IS NULL AND t.loads IS NULL)
          OR ($10 IS NOT NULL AND t.loads IS NOT NULL AND ROUND(t.loads, 4) = ROUND($10, 4))
        )
        AND COALESCE(t.is_loyalty_reward, 0) = $11
      ORDER BY t.id
      LIMIT 1
    `,
    [
      input.entryDate,
      input.transactionTypeCode,
      input.categoryLabel,
      input.amount,
      input.description ?? '',
      wantsCustomer ? 1 : 0,
      input.customerName ?? '',
      input.customerPhone ?? '',
      input.kg,
      input.loads,
      input.isLoyaltyReward ? 1 : 0,
    ],
  )
  return rows[0] ?? null
}

// ─── Reset All Data ──────────────────────────────────────────────────────────

/**
 * Wipes every business/operational row from the database while preserving:
 *   - users with the `admin` role (and their role assignments)
 *   - seeded master data (roles, permissions, role_permissions,
 *     transaction_types, seeded categories, income_share_rules)
 *   - payroll_settings and loyalty_settings singleton rows
 *   - the app_state seed flag (so demo data does NOT re-seed on next launch)
 *
 * Intended for use from the Settings "Reset data" action.
 */
export async function resetAllData(): Promise<void> {
  const database = await getDatabase()

  // SQLite does not support deferrable FKs, and there are several cycles in
  // our schema (transactions <-> staff_payrolls <-> staff_cash_advances).
  // Disable FK checks for the duration of the wipe and re-enable after.
  await database.execute('PRAGMA foreign_keys = OFF')

  try {
    // Staff / payroll chain
    await database.execute('DELETE FROM staff_cash_advances')
    await database.execute('DELETE FROM staff_payroll_adjustments')
    await database.execute('DELETE FROM staff_payroll_items')
    await database.execute('DELETE FROM staff_payrolls')
    await database.execute('DELETE FROM staff_attendance')
    await database.execute('DELETE FROM staff')

    // Inventory chain
    await database.execute('DELETE FROM inventory_movements')
    await database.execute('DELETE FROM inventory_maintenance_records')
    await database.execute('DELETE FROM transaction_template_items')
    await database.execute('DELETE FROM transaction_templates')
    await database.execute('DELETE FROM inventory_items')

    // Transactions + customers + incidents
    await database.execute('DELETE FROM transactions')
    await database.execute('DELETE FROM customers')
    await database.execute('DELETE FROM incident_reports')

    // Income share history (keep the rules themselves)
    await database.execute('DELETE FROM income_share_snapshots')
    await database.execute('DELETE FROM income_share_monthly_versions')

    // User-created categories (keep seeded master categories)
    await database.execute('DELETE FROM categories WHERE is_seeded = 0')

    // Remove every user that is NOT an admin, along with their role links.
    await database.execute(`
      DELETE FROM user_roles
      WHERE user_id NOT IN (
        SELECT ur.user_id FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE r.name = 'admin'
      )
    `)
    await database.execute(`
      DELETE FROM users
      WHERE id NOT IN (
        SELECT ur.user_id FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE r.name = 'admin'
      )
    `)

    // Clear the sync deletion log. Every DELETE above fires the per-table
    // tombstone trigger, so without this a reset would leave one tombstone per
    // wiped row (and keep every tombstone from previous resets), which then get
    // pushed as phantom deletions on the next sync. Purging here — after all the
    // deletes have run — makes a reset a genuine fresh start.
    await database.execute('DELETE FROM sync_tombstones')

    // Prepare sync so this now-empty database RE-DOWNLOADS the cloud data on the
    // next sync instead of pushing its emptiness up:
    //  - rewind the pull high-water (last_pulled_at → NULL) so the next pull
    //    re-fetches the entire cloud dataset and repopulates this device;
    //  - raise `reset_pending` so that first sync is PULL-ONLY (the push is
    //    skipped until the pull has restored the data — see syncBusiness).
    // The device stays bootstrapped with its role, so sync keeps running
    // automatically; no manual re-setup is needed.
    await database.execute(
      `UPDATE sync_state SET value = NULL
       WHERE key IN ('last_pulled_at', 'last_synced_at', 'last_error')`,
    )
    await database.execute(
      `INSERT INTO sync_state (key, value) VALUES ('reset_pending', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
    )

    // Reset AUTOINCREMENT counters for cleared tables so new rows start at 1.
    await database.execute(`
      DELETE FROM sqlite_sequence
      WHERE name IN (
        'staff_cash_advances',
        'staff_payroll_adjustments',
        'staff_payroll_items',
        'staff_payrolls',
        'staff_attendance',
        'staff',
        'inventory_movements',
        'inventory_maintenance_records',
        'transaction_template_items',
        'transaction_templates',
        'inventory_items',
        'transactions',
        'customers',
        'incident_reports',
        'income_share_snapshots',
        'income_share_monthly_versions',
        'sync_tombstones'
      )
    `)

    // Make absolutely sure the demo-seed flag stays set so the next app
    // launch does not silently repopulate demo data.
    await database.execute(`
      INSERT INTO app_state (id, demo_seeded) VALUES (1, 1)
      ON CONFLICT(id) DO UPDATE SET demo_seeded = 1
    `)
  } finally {
    await database.execute('PRAGMA foreign_keys = ON')
  }
}
