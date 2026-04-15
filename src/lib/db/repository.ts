import type Database from '@tauri-apps/plugin-sql'
import { differenceInCalendarDays, format, subDays, subMonths } from 'date-fns'
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
  isSeeded: boolean
  label: string
  transactionTypeCode: string
  transactionTypeId: number
}

export type LedgerTransaction = {
  amount: number
  categoryId: number
  categoryLabel: string
  createdByName: string | null
  description: string
  entryDate: string
  id: number
  staffCount: number | null
  transactionTypeCode: string
  transactionTypeId: number
  transactionTypeLabel: string
  updatedByName: string | null
}

export type TransactionFilters = {
  categoryId?: number | null
  dateFrom?: string
  dateTo?: string
  entryDate?: string
  monthKey?: string
  transactionTypeId?: number | null
}

export type TransactionDraft = {
  amount: number
  categoryId: number
  description: string
  entryDate: string
  staffCount: number | null
  transactionTypeId: number
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
  return database.select<Category[]>(
    `
      SELECT
        categories.id AS id,
        categories.label AS label,
        categories.transaction_type_id AS transactionTypeId,
        categories.is_seeded AS isSeeded,
        categories.is_archived AS isArchived,
        transaction_types.code AS transactionTypeCode
      FROM categories
      JOIN transaction_types ON transaction_types.id = categories.transaction_type_id
      ${includeArchived ? '' : 'WHERE categories.is_archived = 0'}
      ORDER BY transaction_types.id, categories.label
    `,
  )
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

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return database.select<LedgerTransaction[]>(
    `
      SELECT
        transactions.id AS id,
        transactions.entry_date AS entryDate,
        transactions.description AS description,
        transactions.amount AS amount,
        transactions.staff_count AS staffCount,
        transactions.category_id AS categoryId,
        categories.label AS categoryLabel,
        transaction_types.id AS transactionTypeId,
        transaction_types.code AS transactionTypeCode,
        transaction_types.label AS transactionTypeLabel,
        created_by_user.display_name AS createdByName,
        updated_by_user.display_name AS updatedByName
      FROM transactions
      JOIN categories ON categories.id = transactions.category_id
      JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
      LEFT JOIN users AS created_by_user ON created_by_user.id = transactions.created_by
      LEFT JOIN users AS updated_by_user ON updated_by_user.id = transactions.updated_by
      ${whereClause}
      ORDER BY transactions.entry_date DESC, transactions.id DESC
    `,
    params,
  )
}

export async function saveTransaction(input: TransactionDraft, userId: number, transactionId?: number) {
  const database = await getDatabase()

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
          updated_by = $7,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $8
      `,
      [
        input.entryDate,
        input.transactionTypeId,
        input.categoryId,
        input.description,
        input.amount,
        input.staffCount,
        userId,
        transactionId,
      ],
    )
    return
  }

  await database.execute(
    `
      INSERT INTO transactions (
        entry_date,
        transaction_type_id,
        category_id,
        description,
        amount,
        staff_count,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
    `,
    [
      input.entryDate,
      input.transactionTypeId,
      input.categoryId,
      input.description,
      input.amount,
      input.staffCount,
      userId,
    ],
  )
}

export async function deleteTransaction(transactionId: number) {
  const database = await getDatabase()
  await database.execute('DELETE FROM transactions WHERE id = $1', [transactionId])
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
    await database.execute(
      `
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
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
  label: string
  transactionTypeId: number
}) {
  const database = await getDatabase()

  if (input.id) {
    await database.execute(
      `
        UPDATE categories
        SET
          label = $1,
          is_archived = $2
        WHERE id = $3
      `,
      [input.label, input.isArchived ? 1 : 0, input.id],
    )
    return
  }

  await database.execute(
    `
      INSERT INTO categories (transaction_type_id, label, is_seeded, is_archived)
      VALUES ($1, $2, 0, $3)
    `,
    [input.transactionTypeId, input.label, input.isArchived ? 1 : 0],
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
  dateFrom?: string
  dateTo?: string
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

// ─── Inventory ────────────────────────────────────────────────────────────────

export type InventoryItem = {
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
  status: string
  stockValue: number
  supplier: string
  unitLabel: string
  unitType: string
}

export type InventoryItemDraft = {
  category: string
  costPerUnit: number
  description: string
  isActive: boolean
  lastMaintenanceDate: string
  lowStockThreshold: number
  name: string
  status: string
  supplier: string
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
  unitCost: number
  unitLabel: string
}

export type InventoryMovementDraft = {
  itemId: number
  movementDate: string
  movementType: 'IN' | 'OUT'
  notes: string
  quantity: number
  unitCost: number
}

type InventoryItemRow = {
  category: string
  costPerUnit: number
  currentStock: number
  description: string
  id: number
  isActive: number
  lastMaintenanceDate: string
  lastRestockedDate: string | null
  lowStockThreshold: number
  name: string
  status: string
  supplier: string
  unitLabel: string
  unitType: string
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
    conditions.push(`i.category = $${params.length}`)
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
        i.is_active AS isActive,
        i.low_stock_threshold AS lowStockThreshold,
        i.category,
        i.supplier,
        i.status,
        i.last_maintenance_date AS lastMaintenanceDate,
        COALESCE(SUM(
          CASE WHEN m.movement_type = 'IN' THEN m.quantity
               WHEN m.movement_type = 'OUT' THEN -m.quantity
               ELSE 0 END
        ), 0) AS currentStock,
        (SELECT MAX(m2.movement_date) FROM inventory_movements m2 WHERE m2.item_id = i.id AND m2.movement_type = 'IN') AS lastRestockedDate
      FROM inventory_items i
      LEFT JOIN inventory_movements m ON m.item_id = i.id
      ${where}
      GROUP BY i.id
      ORDER BY i.name
    `,
    params,
  )

  let items = rows.map((row) => {
    const currentStock = toNumber(row.currentStock)
    const costPerUnit = toNumber(row.costPerUnit)
    const lowStockThreshold = toNumber(row.lowStockThreshold)
    return {
      category: row.category,
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
      status: row.status,
      stockValue: currentStock * costPerUnit,
      supplier: row.supplier,
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

export async function saveInventoryItem(draft: InventoryItemDraft, id?: number): Promise<number> {
  const database = await getDatabase()

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
          category = $8,
          supplier = $9,
          status = $10,
          last_maintenance_date = $11,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $12
      `,
      [draft.name, draft.description, draft.unitType, draft.unitLabel, draft.costPerUnit, draft.isActive ? 1 : 0, draft.lowStockThreshold, draft.category, draft.supplier, draft.status, draft.lastMaintenanceDate, id],
    )
    return id
  }

  const result = await database.execute(
    `
      INSERT INTO inventory_items (name, description, unit_type, unit_label, cost_per_unit, is_active, low_stock_threshold, category, supplier, status, last_maintenance_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [draft.name, draft.description, draft.unitType, draft.unitLabel, draft.costPerUnit, draft.isActive ? 1 : 0, draft.lowStockThreshold, draft.category, draft.supplier, draft.status, draft.lastMaintenanceDate],
  )
  return result.lastInsertId as number
}

export async function listInventoryMovements(filters?: {
  itemId?: number | null
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

  if (filters?.itemId) {
    params.push(filters.itemId)
    conditions.push(`m.item_id = $${params.length}`)
  }

  if (filters?.movementType) {
    params.push(filters.movementType)
    conditions.push(`m.movement_type = $${params.length}`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

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
        i.name AS item_name,
        i.unit_label,
        u.display_name AS created_by_name
      FROM inventory_movements m
      JOIN inventory_items i ON i.id = m.item_id
      LEFT JOIN users u ON u.id = m.created_by
      ${where}
      ORDER BY m.movement_date DESC, m.id DESC
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
    return
  }

  await database.execute(
    `
      INSERT INTO inventory_movements (item_id, movement_type, quantity, unit_cost, notes, movement_date, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [draft.itemId, draft.movementType, draft.quantity, draft.unitCost, draft.notes, draft.movementDate, userId],
  )
}

export async function deleteInventoryMovement(id: number): Promise<void> {
  const database = await getDatabase()
  await database.execute('DELETE FROM inventory_movements WHERE id = $1', [id])
}

export type InventoryItemSummary = {
  currentStock: number
  id: number
  name: string
  stockValue: number
  totalIn: number
  totalInCost: number
  totalOut: number
  totalOutCost: number
  unitLabel: string
}

type InventoryItemSummaryRow = {
  currentStock: number
  id: number
  name: string
  totalIn: number
  totalInCost: number
  totalOut: number
  totalOutCost: number
  unitLabel: string
}

export async function getInventoryItemSummaries(monthKey?: string): Promise<InventoryItemSummary[]> {
  const database = await getDatabase()
  const monthFilter = monthKey ? `AND substr(m.movement_date, 1, 7) = $1` : ''
  const params = monthKey ? [monthKey] : []

  const rows = await database.select<InventoryItemSummaryRow[]>(
    `
      SELECT
        i.id,
        i.name,
        i.unit_label AS unitLabel,
        i.cost_per_unit AS costPerUnit,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity ELSE 0 END), 0) AS totalIn,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity * m.unit_cost ELSE 0 END), 0) AS totalInCost,
        COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity ELSE 0 END), 0) AS totalOut,
        COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity * m.unit_cost ELSE 0 END), 0) AS totalOutCost,
        COALESCE((
          SELECT SUM(CASE WHEN m2.movement_type = 'IN' THEN m2.quantity ELSE -m2.quantity END)
          FROM inventory_movements m2 WHERE m2.item_id = i.id
        ), 0) AS currentStock
      FROM inventory_items i
      LEFT JOIN inventory_movements m ON m.item_id = i.id ${monthFilter}
      WHERE i.is_active = 1
      GROUP BY i.id
      ORDER BY i.name
    `,
    params,
  )

  return rows.map((row) => {
    const currentStock = toNumber(row.currentStock)
    return {
      currentStock,
      id: row.id,
      name: row.name,
      stockValue: currentStock * toNumber((row as unknown as Record<string, number>).costPerUnit ?? 0),
      totalIn: toNumber(row.totalIn),
      totalInCost: toNumber(row.totalInCost),
      totalOut: toNumber(row.totalOut),
      totalOutCost: toNumber(row.totalOutCost),
      unitLabel: row.unitLabel,
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

export async function getRecentTransactions(limit = 5): Promise<LedgerTransaction[]> {
  const database = await getDatabase()
  return database.select<LedgerTransaction[]>(
    `
      SELECT
        transactions.id AS id,
        transactions.entry_date AS entryDate,
        transactions.description AS description,
        transactions.amount AS amount,
        transactions.staff_count AS staffCount,
        transactions.category_id AS categoryId,
        categories.label AS categoryLabel,
        transaction_types.id AS transactionTypeId,
        transaction_types.code AS transactionTypeCode,
        transaction_types.label AS transactionTypeLabel,
        created_by_user.display_name AS createdByName,
        updated_by_user.display_name AS updatedByName
      FROM transactions
      JOIN categories ON categories.id = transactions.category_id
      JOIN transaction_types ON transaction_types.id = transactions.transaction_type_id
      LEFT JOIN users AS created_by_user ON created_by_user.id = transactions.created_by
      LEFT JOIN users AS updated_by_user ON updated_by_user.id = transactions.updated_by
      ORDER BY transactions.entry_date DESC, transactions.id DESC
      LIMIT $1
    `,
    [limit],
  )
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

export async function getTransactionCountForMonth(monthKey: string): Promise<number> {
  const database = await getDatabase()
  const rows = await database.select<CountRow[]>(
    `SELECT COUNT(*) AS count FROM transactions WHERE substr(entry_date, 1, 7) = $1`,
    [monthKey],
  )
  return toNumber(rows[0]?.count)
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
