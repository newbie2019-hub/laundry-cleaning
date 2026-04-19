import Database from '@tauri-apps/plugin-sql'
import { addDays, differenceInCalendarDays, format, startOfYear, subDays } from 'date-fns'

const DB_PATH = 'sqlite:business-ledger.db'
const SHARED_SEEDED_PASSWORD_HASH =
  'pbkdf2$sha256$120000$UmwJ+8Wp9zmA4V6P792Snw==$Woc8PjrCgqYy2PUjXzQcHo9G+Y5Nh1nbtpde4YNCEIU='

let databasePromise: Promise<Database> | null = null

type CountRow = { count: number }
type IdRow = { id: number }
type CategoryLookupRow = { code: string; id: number; label: string }
type RuleRow = { id: number; name: string }
type InventoryItemIdRow = { id: number; name: string }

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

type DateRow = { date: string }

async function ensureDemoTransactions(database: Database) {
  const today = new Date()
  const yearStart = startOfYear(today)
  const yearStartStr = format(yearStart, 'yyyy-MM-dd')
  const todayStr = format(today, 'yyyy-MM-dd')

  const existingDateRows = await database.select<DateRow[]>(
    `
      SELECT DISTINCT entry_date AS date
      FROM transactions
      WHERE entry_date >= $1 AND entry_date <= $2
    `,
    [yearStartStr, todayStr],
  )
  const existingDates = new Set(existingDateRows.map((row) => row.date))

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

  const insertSaleSql = `
    INSERT INTO transactions (
      entry_date, transaction_type_id, category_id, description, amount, staff_count, created_by, updated_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
  `
  const insertExpenseSql = `
    INSERT INTO transactions (
      entry_date, transaction_type_id, category_id, description, amount, created_by, updated_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $6)
  `

  const totalDays = differenceInCalendarDays(today, yearStart)
  const expenseCategories = ['Food', 'Supplies', 'Gasoline', 'Other']

  for (let d = 0; d <= totalDays; d += 1) {
    const date = addDays(yearStart, d)
    const dateStr = format(date, 'yyyy-MM-dd')
    if (existingDates.has(dateStr)) continue

    const dow = date.getDay()
    const monthIndex = date.getMonth()
    const dayOfMonth = date.getDate()
    const isWeekend = dow === 0 || dow === 6

    const walkInAmount = Math.round(
      3800 + monthIndex * 140 + ((d * 37) % 900) + (isWeekend ? 950 : 0),
    )
    await database.execute(insertSaleSql, [
      dateStr,
      typeLookup.sale,
      categoryLookup.get('SALE:Walk-in'),
      `Walk-in sales for ${dateStr}`,
      walkInAmount,
      3 + (d % 3),
      createdBy,
    ])

    if (d % 3 === 0) {
      const regAmount = Math.round(2200 + monthIndex * 95 + ((d * 19) % 650))
      await database.execute(insertSaleSql, [
        dateStr,
        typeLookup.sale,
        categoryLookup.get('SALE:Regular Customer'),
        'Regular customer accounts',
        regAmount,
        2 + (d % 2),
        createdBy,
      ])
    }

    if (dow === 2 || dow === 5) {
      const dormAmount = Math.round(3400 + monthIndex * 110 + ((d * 23) % 820))
      await database.execute(insertSaleSql, [
        dateStr,
        typeLookup.sale,
        categoryLookup.get('SALE:Dorm'),
        'Dorm pickup/delivery service',
        dormAmount,
        2,
        createdBy,
      ])
    }

    if (d % 3 === 0) {
      const category = expenseCategories[(d / 3) % expenseCategories.length | 0]
      const amount = Math.round(380 + monthIndex * 18 + ((d * 17) % 450))
      await database.execute(insertExpenseSql, [
        dateStr,
        typeLookup.expense,
        categoryLookup.get(`EXPENSE:${category}`),
        `${category} purchase`,
        amount,
        createdBy,
      ])
    }

    if (dow === 5) {
      await database.execute(insertExpenseSql, [
        dateStr,
        typeLookup.expense,
        categoryLookup.get('EXPENSE:Staff Salary'),
        'Weekly staff payout',
        4200 + monthIndex * 110,
        createdBy,
      ])
    }

    if (dayOfMonth === 1) {
      await database.execute(insertExpenseSql, [
        dateStr,
        typeLookup.operatingExpense,
        categoryLookup.get('OPERATING EXPENSE:Rent'),
        'Monthly rent',
        18500,
        createdBy,
      ])
    }

    if (dow === 1) {
      await database.execute(insertExpenseSql, [
        dateStr,
        typeLookup.operatingExpense,
        categoryLookup.get('OPERATING EXPENSE:Wage'),
        'Operations wage',
        2800 + monthIndex * 55,
        createdBy,
      ])
    }

    if (d % 11 === 0) {
      await database.execute(insertExpenseSql, [
        dateStr,
        typeLookup.operatingExpense,
        categoryLookup.get('OPERATING EXPENSE:Supplies'),
        'Laundry supplies restock',
        Math.round(1200 + ((d * 11) % 700)),
        createdBy,
      ])
    }

    if (d % 9 === 4) {
      const opCat = (['Food', 'Gasoline', 'Other'] as const)[d % 3]
      await database.execute(insertExpenseSql, [
        dateStr,
        typeLookup.operatingExpense,
        categoryLookup.get(`OPERATING EXPENSE:${opCat}`),
        `${opCat} operating cost`,
        Math.round(520 + ((d * 13) % 480)),
        createdBy,
      ])
    }
  }
}

type InventoryItemSeed = {
  category: string
  costPerUnit: number
  description?: string
  lastMaintenanceDate?: string
  lowStockThreshold: number
  name: string
  status?: string
  supplier?: string
  unitLabel: string
  unitType: string
}

const demoInventoryItems: InventoryItemSeed[] = [
  {
    category: 'detergent_chemicals',
    costPerUnit: 185,
    description: 'Commercial-grade powder for main wash',
    lowStockThreshold: 15,
    name: 'Detergent Powder',
    supplier: 'CleanCo Supply',
    unitLabel: 'kg',
    unitType: 'weight',
  },
  {
    category: 'detergent_chemicals',
    costPerUnit: 220,
    description: 'Softener for towels and delicates',
    lowStockThreshold: 10,
    name: 'Fabric Softener',
    supplier: 'CleanCo Supply',
    unitLabel: 'L',
    unitType: 'liquid',
  },
  {
    category: 'detergent_chemicals',
    costPerUnit: 140,
    description: 'Chlorine bleach for whites',
    lowStockThreshold: 8,
    name: 'Bleach',
    supplier: 'ChemBright Inc.',
    unitLabel: 'L',
    unitType: 'liquid',
  },
  {
    category: 'detergent_chemicals',
    costPerUnit: 320,
    description: 'Spot stain remover spray',
    lowStockThreshold: 6,
    name: 'Stain Remover',
    supplier: 'ChemBright Inc.',
    unitLabel: 'bottle',
    unitType: 'other',
  },
  {
    category: 'packaging',
    costPerUnit: 3.5,
    description: 'Large plastic bags for finished laundry',
    lowStockThreshold: 100,
    name: 'Plastic Bags (Large)',
    supplier: 'Pack & Wrap Co.',
    unitLabel: 'pcs',
    unitType: 'per_pc',
  },
  {
    category: 'packaging',
    costPerUnit: 1.25,
    description: 'Customer identification tags',
    lowStockThreshold: 200,
    name: 'Laundry Tags',
    supplier: 'Pack & Wrap Co.',
    unitLabel: 'pcs',
    unitType: 'per_pc',
  },
  {
    category: 'packaging',
    costPerUnit: 12,
    description: 'Wire hangers for pressed items',
    lowStockThreshold: 50,
    name: 'Hangers',
    supplier: 'Pack & Wrap Co.',
    unitLabel: 'pcs',
    unitType: 'per_pc',
  },
  {
    category: 'cleaning_materials',
    costPerUnit: 150,
    description: 'Floor broom for shop cleaning',
    lowStockThreshold: 2,
    name: 'Broom',
    supplier: 'Local Hardware',
    unitLabel: 'pcs',
    unitType: 'per_pc',
  },
  {
    category: 'cleaning_materials',
    costPerUnit: 220,
    description: 'Mop for floors',
    lowStockThreshold: 2,
    name: 'Mop',
    supplier: 'Local Hardware',
    unitLabel: 'pcs',
    unitType: 'per_pc',
  },
  {
    category: 'cleaning_materials',
    costPerUnit: 45,
    description: 'Microfiber cleaning cloths',
    lowStockThreshold: 10,
    name: 'Cleaning Cloth',
    supplier: 'Local Hardware',
    unitLabel: 'pcs',
    unitType: 'per_pc',
  },
  {
    category: 'consumable',
    costPerUnit: 85,
    description: 'Thermal receipt paper roll',
    lowStockThreshold: 5,
    name: 'Receipt Paper',
    supplier: 'Office Mart',
    unitLabel: 'roll',
    unitType: 'other',
  },
  {
    category: 'consumable',
    costPerUnit: 480,
    description: 'Ink cartridge for label printer',
    lowStockThreshold: 2,
    name: 'Printer Ink',
    supplier: 'Office Mart',
    unitLabel: 'pcs',
    unitType: 'per_pc',
  },
  {
    category: 'equipment',
    costPerUnit: 45000,
    description: 'Front-load washer, 15kg capacity',
    lastMaintenanceDate: format(subDays(new Date(), 22), 'yyyy-MM-dd'),
    lowStockThreshold: 1,
    name: 'Washing Machine A',
    status: 'operational',
    supplier: 'LaundryTech',
    unitLabel: 'unit',
    unitType: 'per_pc',
  },
  {
    category: 'equipment',
    costPerUnit: 45000,
    description: 'Front-load washer, 15kg capacity',
    lastMaintenanceDate: format(subDays(new Date(), 75), 'yyyy-MM-dd'),
    lowStockThreshold: 1,
    name: 'Washing Machine B',
    status: 'maintenance',
    supplier: 'LaundryTech',
    unitLabel: 'unit',
    unitType: 'per_pc',
  },
  {
    category: 'equipment',
    costPerUnit: 38000,
    description: 'Gas dryer, 12kg capacity',
    lastMaintenanceDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    lowStockThreshold: 1,
    name: 'Dryer A',
    status: 'operational',
    supplier: 'LaundryTech',
    unitLabel: 'unit',
    unitType: 'per_pc',
  },
  {
    category: 'equipment',
    costPerUnit: 38000,
    description: 'Gas dryer, 12kg capacity',
    lastMaintenanceDate: format(subDays(new Date(), 120), 'yyyy-MM-dd'),
    lowStockThreshold: 1,
    name: 'Dryer B',
    status: 'out_of_service',
    supplier: 'LaundryTech',
    unitLabel: 'unit',
    unitType: 'per_pc',
  },
  {
    category: 'equipment',
    costPerUnit: 8500,
    description: 'Steam iron press',
    lastMaintenanceDate: format(subDays(new Date(), 15), 'yyyy-MM-dd'),
    lowStockThreshold: 1,
    name: 'Iron Press',
    status: 'operational',
    supplier: 'LaundryTech',
    unitLabel: 'unit',
    unitType: 'per_pc',
  },
]

type MovementSeed = {
  daysAgo: number
  itemName: string
  notes: string
  quantity: number
  type: 'IN' | 'OUT'
  unitCostOverride?: number
}

function buildDemoMovements(): MovementSeed[] {
  const movements: MovementSeed[] = []
  const planByItem: Record<string, { dailyOut: number; restockEvery: number; restockQty: number }> = {
    'Detergent Powder': { dailyOut: 1.5, restockEvery: 14, restockQty: 25 },
    'Fabric Softener': { dailyOut: 0.8, restockEvery: 14, restockQty: 15 },
    'Bleach': { dailyOut: 0.4, restockEvery: 21, restockQty: 10 },
    'Stain Remover': { dailyOut: 0.2, restockEvery: 30, restockQty: 8 },
    'Plastic Bags (Large)': { dailyOut: 18, restockEvery: 20, restockQty: 300 },
    'Laundry Tags': { dailyOut: 25, restockEvery: 20, restockQty: 500 },
    'Hangers': { dailyOut: 4, restockEvery: 30, restockQty: 100 },
    'Cleaning Cloth': { dailyOut: 0.5, restockEvery: 30, restockQty: 20 },
    'Receipt Paper': { dailyOut: 0.15, restockEvery: 30, restockQty: 10 },
  }

  for (const [itemName, plan] of Object.entries(planByItem)) {
    for (let daysAgo = 89; daysAgo >= 0; daysAgo -= 1) {
      if (daysAgo % plan.restockEvery === 0 && daysAgo !== 0) {
        movements.push({
          daysAgo,
          itemName,
          notes: 'Restock from supplier',
          quantity: plan.restockQty,
          type: 'IN',
        })
      }
      const jitter = ((daysAgo * 7) % 5) / 10
      const qty = Math.max(0, Number((plan.dailyOut + plan.dailyOut * jitter).toFixed(2)))
      if (qty > 0 && daysAgo % 2 === 0) {
        movements.push({
          daysAgo,
          itemName,
          notes: 'Daily operations',
          quantity: Number((qty * 2).toFixed(2)),
          type: 'OUT',
        })
      }
    }
  }

  movements.push(
    { daysAgo: 65, itemName: 'Detergent Powder', notes: 'Damaged bag from delivery', quantity: 2, type: 'OUT' },
    { daysAgo: 42, itemName: 'Fabric Softener', notes: 'Expired stock discarded', quantity: 1.5, type: 'OUT' },
    { daysAgo: 28, itemName: 'Bleach', notes: 'Lost container during cleaning', quantity: 1, type: 'OUT' },
    { daysAgo: 18, itemName: 'Plastic Bags (Large)', notes: 'Damaged by water leak', quantity: 35, type: 'OUT' },
    { daysAgo: 10, itemName: 'Hangers', notes: 'Damaged / bent, disposed', quantity: 12, type: 'OUT' },
    { daysAgo: 5, itemName: 'Stain Remover', notes: 'Expired bottle thrown out', quantity: 1, type: 'OUT' },
  )

  movements.push(
    { daysAgo: 55, itemName: 'Broom', notes: 'Initial stock', quantity: 3, type: 'IN' },
    { daysAgo: 55, itemName: 'Mop', notes: 'Initial stock', quantity: 2, type: 'IN' },
    { daysAgo: 55, itemName: 'Printer Ink', notes: 'Initial stock', quantity: 4, type: 'IN' },
    { daysAgo: 48, itemName: 'Printer Ink', notes: 'Used for label printer', quantity: 1, type: 'OUT' },
    { daysAgo: 20, itemName: 'Printer Ink', notes: 'Used for label printer', quantity: 1, type: 'OUT' },
  )

  return movements
}

async function ensureDemoInventory(database: Database) {
  const itemCount = await getCount(database, 'inventory_items')
  if (itemCount > 0) return

  for (const item of demoInventoryItems) {
    await database.execute(
      `
        INSERT INTO inventory_items (
          name, description, unit_type, unit_label, cost_per_unit,
          is_active, low_stock_threshold, category, supplier, status, last_maintenance_date
        ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10)
      `,
      [
        item.name,
        item.description ?? '',
        item.unitType,
        item.unitLabel,
        item.costPerUnit,
        item.lowStockThreshold,
        item.category,
        item.supplier ?? '',
        item.status ?? '',
        item.lastMaintenanceDate ?? '',
      ],
    )
  }

  const itemRows = await database.select<InventoryItemIdRow[]>(
    'SELECT id, name FROM inventory_items',
  )
  const itemLookup = new Map(itemRows.map((row) => [row.name, row.id]))
  const costLookup = new Map(demoInventoryItems.map((item) => [item.name, item.costPerUnit]))

  const createdBy = await getSingleId(
    database,
    'SELECT id FROM users WHERE username = $1',
    ['admin'],
  )

  const today = new Date()
  const movements = buildDemoMovements()

  for (const movement of movements) {
    const itemId = itemLookup.get(movement.itemName)
    if (!itemId) continue
    const cost = movement.unitCostOverride ?? costLookup.get(movement.itemName) ?? 0
    const movementDate = format(subDays(today, movement.daysAgo), 'yyyy-MM-dd')

    await database.execute(
      `
        INSERT INTO inventory_movements (
          item_id, movement_type, quantity, unit_cost, notes, movement_date, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [itemId, movement.type, movement.quantity, cost, movement.notes, movementDate, createdBy],
    )
  }
}

type IncidentSeed = {
  actionTaken: string
  contactNumber?: string
  customerName?: string
  daysAgo: number
  estimatedLoss?: number
  handledBy: string
  incidentTime: string
  incidentType: string
  itemsInvolved?: string
  quantity?: number
  remarks?: string
  staffOnDuty?: string
  whatHappened: string
}

const demoIncidents: IncidentSeed[] = [
  {
    actionTaken: 'Offered reprocess at no cost and provided small discount on next visit.',
    contactNumber: '0917-555-2231',
    customerName: 'Maria Santos',
    daysAgo: 62,
    estimatedLoss: 450,
    handledBy: 'Operations Manager',
    incidentTime: '14:20',
    incidentType: 'Customer Complaint',
    itemsInvolved: 'White blouse, 2 pcs',
    quantity: 2,
    remarks: 'Customer was understanding after resolution. Added note to folder.',
    staffOnDuty: 'Front Desk Staff',
    whatHappened: 'Customer complained about faint yellow stain still visible on white blouse after wash. Claims it was not there before drop-off.',
  },
  {
    actionTaken: 'Replaced item with equivalent new set from supplier. Filed insurance claim.',
    contactNumber: '0928-441-7788',
    customerName: 'Jerome Dela Cruz',
    daysAgo: 48,
    estimatedLoss: 1800,
    handledBy: 'Operations Manager',
    incidentTime: '10:05',
    incidentType: 'Damage to Property',
    itemsInvolved: 'Linen bedsheet set',
    quantity: 1,
    remarks: 'Likely caused by faulty dryer drum. Flagged for maintenance.',
    staffOnDuty: 'Front Desk Staff',
    whatHappened: 'Customer returned bedsheet with tear along the seam, reported that damage occurred during drying cycle.',
  },
  {
    actionTaken: 'Cleaned affected area, removed spoiled items, sanitized shelves.',
    daysAgo: 35,
    estimatedLoss: 320,
    handledBy: 'Operations Manager',
    incidentTime: '08:30',
    incidentType: 'Damage to Property',
    itemsInvolved: 'Detergent Powder, Plastic Bags',
    quantity: 0,
    remarks: 'Roof leak above stockroom shelf. Building maintenance notified.',
    staffOnDuty: 'Operations Manager',
    whatHappened: 'Water leak from ceiling damaged stock of detergent and plastic bags overnight.',
  },
  {
    actionTaken: 'Administered first aid. Incident logged in safety binder.',
    contactNumber: '',
    customerName: '',
    daysAgo: 27,
    estimatedLoss: 0,
    handledBy: 'Operations Manager',
    incidentTime: '16:45',
    incidentType: 'Accident / Injury',
    itemsInvolved: '',
    quantity: 0,
    remarks: 'Staff slipped on wet floor, minor bruise only. Added "Wet Floor" signage.',
    staffOnDuty: 'Front Desk Staff',
    whatHappened: 'Staff slipped near washing area while transferring wet clothes. No serious injury.',
  },
  {
    actionTaken: 'Checked all CCTV, nothing taken. Updated closing checklist.',
    daysAgo: 19,
    estimatedLoss: 0,
    handledBy: 'Operations Manager',
    incidentTime: '06:15',
    incidentType: 'Theft',
    itemsInvolved: 'Coin tray',
    quantity: 1,
    remarks: 'Attempt only, coin tray left on counter overnight. No loss.',
    staffOnDuty: 'Operations Manager',
    whatHappened: 'Suspicious person attempted to open side door during off-hours. Alarm triggered, they fled.',
  },
  {
    actionTaken: 'Evacuated customers, called in technician. Unit tagged out of service.',
    daysAgo: 12,
    estimatedLoss: 2400,
    handledBy: 'Operations Manager',
    incidentTime: '11:55',
    incidentType: 'Fire / Emergency',
    itemsInvolved: 'Dryer B',
    quantity: 1,
    remarks: 'Smoke from Dryer B motor. No fire, but unit marked out of service pending repair.',
    staffOnDuty: 'Front Desk Staff',
    whatHappened: 'Dryer B emitted heavy smoke mid-cycle. Power cut immediately, no flames observed.',
  },
  {
    actionTaken: 'Reimbursed service fee and offered free next wash.',
    contactNumber: '0917-222-8833',
    customerName: 'Anonymous',
    daysAgo: 6,
    estimatedLoss: 280,
    handledBy: 'Front Desk Staff',
    incidentTime: '13:10',
    incidentType: 'Customer Complaint',
    itemsInvolved: 'Mixed load, 8kg',
    quantity: 1,
    remarks: 'Offered free rewash. Customer declined but accepted refund.',
    staffOnDuty: 'Front Desk Staff',
    whatHappened: 'Customer reported missing single sock from finished load.',
  },
]

async function ensureDemoIncidents(database: Database) {
  const count = await getCount(database, 'incident_reports')
  if (count > 0) return

  const createdBy = await getSingleId(
    database,
    'SELECT id FROM users WHERE username = $1',
    ['admin'],
  )

  const today = new Date()

  for (const incident of demoIncidents) {
    const incidentDate = format(subDays(today, incident.daysAgo), 'yyyy-MM-dd')
    await database.execute(
      `
        INSERT INTO incident_reports (
          incident_date, incident_time, staff_on_duty, incident_type,
          what_happened, customer_name, contact_number, action_taken,
          handled_by, estimated_loss, quantity, items_involved, remarks, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        incidentDate,
        incident.incidentTime,
        incident.staffOnDuty ?? '',
        incident.incidentType,
        incident.whatHappened,
        incident.customerName ?? '',
        incident.contactNumber ?? '',
        incident.actionTaken,
        incident.handledBy,
        incident.estimatedLoss ?? 0,
        incident.quantity ?? 0,
        incident.itemsInvolved ?? '',
        incident.remarks ?? '',
        createdBy,
      ],
    )
  }
}

type MaintenanceSeed = {
  cost: number
  daysAgo: number
  description: string
  itemName: string
  nextServiceDaysFromNow?: number
  performedBy: string
  serviceType: string
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
}

const demoMaintenanceRecords: MaintenanceSeed[] = [
  {
    cost: 1800,
    daysAgo: 85,
    description: 'Quarterly preventive maintenance: drum cleaning, belt check, water inlet filter replacement.',
    itemName: 'Washing Machine A',
    performedBy: 'LaundryTech Service',
    serviceType: 'preventive',
    status: 'completed',
  },
  {
    cost: 22,
    daysAgo: 22,
    description: 'Routine operational inspection - all systems normal.',
    itemName: 'Washing Machine A',
    nextServiceDaysFromNow: 68,
    performedBy: 'In-house',
    serviceType: 'inspection',
    status: 'completed',
  },
  {
    cost: 0,
    daysAgo: 3,
    description: 'Unusual vibration reported. Technician scheduled to inspect bearings and suspension.',
    itemName: 'Washing Machine B',
    performedBy: 'LaundryTech Service',
    serviceType: 'repair',
    status: 'in_progress',
  },
  {
    cost: 950,
    daysAgo: 76,
    description: 'Replaced worn door gasket. Tested for leaks - OK.',
    itemName: 'Washing Machine B',
    performedBy: 'LaundryTech Service',
    serviceType: 'replacement',
    status: 'completed',
  },
  {
    cost: 450,
    daysAgo: 30,
    description: 'Lint trap deep clean and gas burner check.',
    itemName: 'Dryer A',
    nextServiceDaysFromNow: 60,
    performedBy: 'In-house',
    serviceType: 'cleaning',
    status: 'completed',
  },
  {
    cost: 0,
    daysAgo: -2,
    description: 'Motor emitted heavy smoke during cycle. Unit tagged out of service pending technician visit.',
    itemName: 'Dryer B',
    nextServiceDaysFromNow: 2,
    performedBy: 'LaundryTech Service',
    serviceType: 'repair',
    status: 'scheduled',
  },
  {
    cost: 120,
    daysAgo: 15,
    description: 'Descaled steam chamber, checked thermostat calibration.',
    itemName: 'Iron Press',
    performedBy: 'In-house',
    serviceType: 'cleaning',
    status: 'completed',
  },
]

async function ensureDemoMaintenanceRecords(database: Database) {
  const count = await getCount(database, 'inventory_maintenance_records')
  if (count > 0) return

  const itemRows = await database.select<InventoryItemIdRow[]>(
    `SELECT id, name FROM inventory_items WHERE category = 'equipment'`,
  )
  if (itemRows.length === 0) return

  const itemLookup = new Map(itemRows.map((row) => [row.name, row.id]))

  const createdBy = await getSingleId(
    database,
    'SELECT id FROM users WHERE username = $1',
    ['admin'],
  )

  const today = new Date()

  for (const record of demoMaintenanceRecords) {
    const itemId = itemLookup.get(record.itemName)
    if (!itemId) continue

    const serviceDate = format(
      record.daysAgo >= 0 ? subDays(today, record.daysAgo) : addDays(today, -record.daysAgo),
      'yyyy-MM-dd',
    )
    const nextServiceDate = record.nextServiceDaysFromNow != null
      ? format(addDays(today, record.nextServiceDaysFromNow), 'yyyy-MM-dd')
      : ''

    await database.execute(
      `
        INSERT INTO inventory_maintenance_records (
          item_id, service_date, service_type, performed_by, cost,
          description, next_service_date, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        itemId,
        serviceDate,
        record.serviceType,
        record.performedBy,
        record.cost,
        record.description,
        nextServiceDate,
        record.status,
        createdBy,
      ],
    )
  }
}

async function ensureSeedData(database: Database) {
  await ensureDemoUsers(database)
  await ensureDemoShareVersions(database)
  await ensureDemoTransactions(database)
  await ensureDemoInventory(database)
  await ensureDemoIncidents(database)
  await ensureDemoMaintenanceRecords(database)
}

// The tauri-plugin-sql crate creates SQLite databases with the default journal
// mode (DELETE), which causes readers and writers to block each other. Under
// the plugin's sqlx connection pool this easily hits the 5s busy timeout (e.g.
// saving attendance fails after a ~5s wait). Enabling WAL once persists the
// setting in the database header and removes reader/writer contention for
// every connection thereafter. We also switch synchronous to NORMAL (safe with
// WAL) and raise the busy timeout for added safety on the current connection.
async function applyPragmas(database: Database) {
  try {
    await database.execute('PRAGMA journal_mode = WAL')
    await database.execute('PRAGMA synchronous = NORMAL')
    await database.execute('PRAGMA busy_timeout = 15000')
    await database.execute('PRAGMA foreign_keys = ON')
  } catch (error) {
    // Pragmas are a best-effort performance tweak; never block startup.
    console.warn('[db] failed to apply pragmas', error)
  }
}

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = Database.load(DB_PATH).then(async (database) => {
      await applyPragmas(database)
      await ensureSeedData(database)
      return database
    })
  }

  return databasePromise
}
