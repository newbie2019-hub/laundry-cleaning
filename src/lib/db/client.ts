import Database from '@tauri-apps/plugin-sql'
import { addDays, format } from 'date-fns'

const DB_PATH = 'sqlite:business-ledger.db'
const SHARED_SEEDED_PASSWORD_HASH =
  'pbkdf2$sha256$120000$UmwJ+8Wp9zmA4V6P792Snw==$Woc8PjrCgqYy2PUjXzQcHo9G+Y5Nh1nbtpde4YNCEIU='

let databasePromise: Promise<Database> | null = null

type CountRow = { count: number }
type IdRow = { id: number }
type CategoryLookupRow = { code: string; id: number; label: string }
type RuleRow = { id: number; name: string }

const demoUsers = [
  {
    displayName: 'Operations Manager',
    roleName: 'manager',
    username: 'manager',
  },
  {
    displayName: 'Front Desk Staff',
    roleName: 'staff',
    username: 'staff',
  },
]

const demoShareVersions = {
  '2026-01': {
    'Share A': 35,
    'Share B': 27,
    'Share C': 20,
    'Share D': 15,
  },
  '2026-02': {
    'Share A': 34,
    'Share B': 28,
    'Share C': 20,
    'Share D': 15,
  },
  '2026-03': {
    'Share A': 33,
    'Share B': 28,
    'Share C': 21,
    'Share D': 15,
  },
} as const

async function getCount(database: Database, tableName: string) {
  const rows = await database.select<CountRow[]>(`SELECT COUNT(*) AS count FROM ${tableName}`)
  return Number(rows[0]?.count ?? 0)
}

async function getSingleId(database: Database, sql: string, params: unknown[]) {
  const rows = await database.select<IdRow[]>(sql, params)
  return Number(rows[0]?.id ?? 0)
}

async function ensureDemoUsers(database: Database) {
  for (const user of demoUsers) {
    await database.execute(
      `
        INSERT OR IGNORE INTO users (username, password_hash, display_name, is_active)
        VALUES ($1, $2, $3, 1)
      `,
      [user.username, SHARED_SEEDED_PASSWORD_HASH, user.displayName],
    )

    await database.execute(
      `
        INSERT OR IGNORE INTO user_roles (user_id, role_id)
        SELECT users.id, roles.id
        FROM users
        JOIN roles ON roles.name = $2
        WHERE users.username = $1
      `,
      [user.username, user.roleName],
    )
  }
}

async function ensureDemoShareVersions(database: Database) {
  const rules = await database.select<RuleRow[]>(
    'SELECT id, name FROM income_share_rules ORDER BY id',
  )

  for (const [monthKey, percentages] of Object.entries(demoShareVersions)) {
    for (const rule of rules) {
      const percentage = percentages[rule.name as keyof typeof percentages]

      if (typeof percentage !== 'number') {
        continue
      }

      await database.execute(
        `
          INSERT OR IGNORE INTO income_share_monthly_versions (month_key, rule_id, percentage)
          VALUES ($1, $2, $3)
        `,
        [monthKey, rule.id, percentage],
      )
    }
  }
}

async function ensureDemoTransactions(database: Database) {
  const transactionCount = await getCount(database, 'transactions')

  if (transactionCount > 0) {
    return
  }

  const categoryRows = await database.select<CategoryLookupRow[]>(
    `
      SELECT
        categories.id AS id,
        categories.label AS label,
        transaction_types.code AS code
      FROM categories
      JOIN transaction_types ON transaction_types.id = categories.transaction_type_id
      WHERE categories.is_archived = 0
      ORDER BY transaction_types.id, categories.id
    `,
  )

  const categoryLookup = new Map(
    categoryRows.map((row) => [`${row.code}:${row.label}`, Number(row.id)]),
  )

  const typeLookup = {
    expense: await getSingleId(
      database,
      'SELECT id FROM transaction_types WHERE code = $1',
      ['EXPENSE'],
    ),
    operatingExpense: await getSingleId(
      database,
      'SELECT id FROM transaction_types WHERE code = $1',
      ['OPERATING EXPENSE'],
    ),
    sale: await getSingleId(
      database,
      'SELECT id FROM transaction_types WHERE code = $1',
      ['SALE'],
    ),
  }

  const createdBy = await getSingleId(
    database,
    'SELECT id FROM users WHERE username = $1',
    ['admin'],
  )

  const monthKeys = ['2026-01', '2026-02', '2026-03']
  const dayOffsets = [1, 3, 5, 7, 10, 12, 15, 18, 20, 23, 25, 27]
  const saleCategories = ['Walk-in', 'Regular Customer', 'Dorm']
  const expenseCategories = ['Staff Salary', 'Food', 'Gasoline', 'Supplies', 'Other']
  const operatingCategories = ['Wage', 'Food', 'Gasoline', 'Supplies', 'Other', 'Rent']

  for (const [monthIndex, monthKey] of monthKeys.entries()) {
    const monthStart = new Date(`${monthKey}-01T00:00:00`)

    for (const [offsetIndex, dayOffset] of dayOffsets.entries()) {
      const entryDate = format(addDays(monthStart, dayOffset), 'yyyy-MM-dd')
      const saleCategory = saleCategories[offsetIndex % saleCategories.length]
      const expenseCategory = expenseCategories[offsetIndex % expenseCategories.length]
      const operatingCategory =
        offsetIndex % 4 === 0
          ? 'Rent'
          : operatingCategories[offsetIndex % (operatingCategories.length - 1)]

      const saleAmount =
        4200 + monthIndex * 325 + offsetIndex * 175 + (offsetIndex % 3) * 140
      const expenseAmount = 540 + monthIndex * 45 + offsetIndex * 28
      const operatingAmount =
        operatingCategory === 'Rent'
          ? 1850 + monthIndex * 120 + offsetIndex * 22
          : 430 + monthIndex * 35 + offsetIndex * 21

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
          entryDate,
          typeLookup.sale,
          categoryLookup.get(`SALE:${saleCategory}`),
          `${saleCategory} sales for ${entryDate}`,
          saleAmount,
          3 + (offsetIndex % 4),
          createdBy,
        ],
      )

      if (offsetIndex % 3 === 0) {
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
            entryDate,
            typeLookup.sale,
            categoryLookup.get('SALE:Walk-in'),
            `Extra walk-in sales burst for ${entryDate}`,
            saleAmount * 0.46,
            2 + (offsetIndex % 3),
            createdBy,
          ],
        )
      }

      await database.execute(
        `
          INSERT INTO transactions (
            entry_date,
            transaction_type_id,
            category_id,
            description,
            amount,
            created_by,
            updated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $6)
        `,
        [
          entryDate,
          typeLookup.expense,
          categoryLookup.get(`EXPENSE:${expenseCategory}`),
          `${expenseCategory} expense for ${entryDate}`,
          expenseAmount,
          createdBy,
        ],
      )

      await database.execute(
        `
          INSERT INTO transactions (
            entry_date,
            transaction_type_id,
            category_id,
            description,
            amount,
            created_by,
            updated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $6)
        `,
        [
          entryDate,
          typeLookup.operatingExpense,
          categoryLookup.get(`OPERATING EXPENSE:${operatingCategory}`),
          `${operatingCategory} operating expense for ${entryDate}`,
          operatingAmount,
          createdBy,
        ],
      )
    }
  }
}

async function ensureSeedData(database: Database) {
  await ensureDemoUsers(database)
  await ensureDemoShareVersions(database)
  await ensureDemoTransactions(database)
}

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = Database.load(DB_PATH).then(async (database) => {
      await ensureSeedData(database)
      return database
    })
  }

  return databasePromise
}
