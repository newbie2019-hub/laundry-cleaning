import { format } from 'date-fns'
import type {
  AttendancePreview,
  CreateAttendanceIntent,
  CreateCustomerIntent,
  CreateExpenseIntent,
  CreateInventoryIntent,
  CreateIntent,
  CreatePreview,
  CreateSaleIntent,
  CreateStaffIntent,
  CustomerPreview,
  ExpensePreview,
  InventoryPreview,
  SalePreview,
  SalePreviewLine,
  StaffPreview,
} from '../types'
import {
  listCategories,
  listCustomers,
  listInventoryCategories,
  listInventoryItems,
  listStaff,
  listTransactionTypes,
  saveCustomer,
  saveInventoryItem,
  saveInventoryMovement,
  saveStaff,
  saveTransaction,
  upsertAttendance,
  findStaffByNaturalKey,
} from '../../../lib/db/repository'
import { isValidDate, required, warnDuplicate, warnExistingAttendance } from './validation'
import type { CivilStatus, TransactionDraft } from '../../../lib/db/repository'
import { getDatabase } from '../../../lib/db/client'

const DATE_FMT = 'yyyy-MM-dd'
function today() { return format(new Date(), DATE_FMT) }

// ─── Build preview (no writes) ────────────────────────────────────────────────

export async function buildPreview(intent: CreateIntent): Promise<CreatePreview> {
  switch (intent.entity) {
    case 'customer': return buildCustomerPreview(intent)
    case 'inventory': return buildInventoryPreview(intent)
    case 'sale': return buildSalePreview(intent)
    case 'expense': return buildExpensePreview(intent)
    case 'staff': return buildStaffPreview(intent)
    case 'attendance': return buildAttendancePreview(intent)
  }
}

async function buildCustomerPreview(intent: CreateCustomerIntent): Promise<CustomerPreview> {
  const issues: CustomerPreview['issues'] = []
  required(issues, 'name', intent.fields.name, 'Customer name')
  // Duplicate check
  let duplicate = false
  if (intent.fields.name) {
    const existing = await listCustomers({ search: intent.fields.name })
    if (existing.some((c) => c.name.toLowerCase() === intent.fields.name.toLowerCase())) {
      duplicate = true
      warnDuplicate(issues, 'customer')
    }
  }
  return {
    type: 'customer',
    draft: {
      name: intent.fields.name,
      phone: intent.fields.phone,
      email: intent.fields.email,
      company: intent.fields.company,
    },
    issues,
    duplicate,
  }
}

async function buildInventoryPreview(intent: CreateInventoryIntent): Promise<InventoryPreview> {
  const issues: InventoryPreview['issues'] = []
  required(issues, 'name', intent.fields.name, 'Item name')
  const cost = intent.fields.costPerUnit ?? 0
  const price = intent.fields.sellingPrice ?? 0
  const stock = intent.fields.initialStock ?? 0
  const threshold = intent.fields.lowStockThreshold ?? 0

  if (cost < 0) issues.push({ field: 'costPerUnit', message: 'Cost must be >= 0.', severity: 'error' })
  if (price < 0) issues.push({ field: 'sellingPrice', message: 'Selling price must be >= 0.', severity: 'error' })

  let duplicate = false
  if (intent.fields.name) {
    const items = await listInventoryItems({ includeInactive: true })
    if (items.some((i) => i.name.toLowerCase() === intent.fields.name.toLowerCase())) {
      duplicate = true
      warnDuplicate(issues, 'inventory item')
    }
  }

  return {
    type: 'inventory',
    draft: {
      name: intent.fields.name,
      category: intent.fields.category || 'Other',
      unitLabel: intent.fields.unitLabel || 'pc',
      costPerUnit: cost,
      sellingPrice: price,
      initialStock: stock,
      lowStockThreshold: threshold,
      supplier: intent.fields.supplier,
    },
    issues,
    duplicate,
  }
}

async function buildSalePreview(intent: CreateSaleIntent): Promise<SalePreview> {
  const issues: SalePreview['issues'] = []
  const date = intent.fields.date ?? today()

  if (!isValidDate(date)) issues.push({ field: 'date', message: 'Invalid date.', severity: 'error' })

  // Resolve customer
  let customerId: number | null = null
  if (intent.fields.customerName) {
    const customers = await listCustomers({ search: intent.fields.customerName })
    const match = customers.find((c) => c.name.toLowerCase().includes(intent.fields.customerName.toLowerCase()))
    if (match) {
      customerId = match.id
    } else {
      issues.push({ field: 'customerName', message: `Customer "${intent.fields.customerName}" not found — will skip customer link.`, severity: 'warning' })
    }
  }

  // Resolve transaction type + category
  const txTypes = await listTransactionTypes()
  const saleType = txTypes.find((t) => t.code === 'SALE')
  if (!saleType) {
    issues.push({ field: 'transactionType', message: 'SALE transaction type not configured.', severity: 'error' })
  }
  const categories = await listCategories()
  const saleCategories = categories.filter((c) => c.transactionTypeCode === 'SALE')
  const catName = intent.fields.categoryName || 'Sale'
  const cat = saleCategories.find((c) => c.label.toLowerCase().includes(catName.toLowerCase())) ?? saleCategories[0]
  if (!cat) {
    issues.push({ field: 'category', message: 'No SALE categories configured.', severity: 'error' })
  }

  // Resolve inventory items + stock check
  const allItems = await listInventoryItems()
  const lines: SalePreviewLine[] = []
  for (const lineIntent of intent.fields.items) {
    const item = allItems.find((i) => i.name.toLowerCase().includes(lineIntent.itemName.toLowerCase()))
    if (!item) {
      issues.push({ field: 'item', message: `Item "${lineIntent.itemName}" not found in inventory.`, severity: 'warning' })
      continue
    }
    const sufficient = item.currentStock >= lineIntent.quantity
    if (!sufficient) {
      issues.push({ field: 'stock', message: `Insufficient stock for "${item.name}": ${item.currentStock} available, ${lineIntent.quantity} requested.`, severity: 'error' })
    }
    lines.push({
      itemName: item.name,
      itemId: item.id,
      quantity: lineIntent.quantity,
      unitPrice: item.sellingPrice,
      currentStock: item.currentStock,
      stockSufficient: sufficient,
    })
  }

  // Compute amount
  const computedAmount = lines.length > 0
    ? lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
    : (intent.fields.amount ?? 0)
  const amount = intent.fields.amount ?? computedAmount

  if (amount <= 0) issues.push({ field: 'amount', message: 'Amount must be greater than 0.', severity: 'error' })

  return {
    type: 'sale',
    draft: {
      customerName: intent.fields.customerName,
      customerId,
      categoryId: cat?.id ?? 0,
      categoryName: cat?.label ?? catName,
      transactionTypeId: saleType?.id ?? 0,
      amount,
      date,
      description: intent.fields.description,
      items: lines,
    },
    issues,
  }
}

async function buildExpensePreview(intent: CreateExpenseIntent): Promise<ExpensePreview> {
  const issues: ExpensePreview['issues'] = []
  const date = intent.fields.date ?? today()

  required(issues, 'amount', intent.fields.amount, 'Amount')
  if (!isValidDate(date)) issues.push({ field: 'date', message: 'Invalid date.', severity: 'error' })

  const txTypes = await listTransactionTypes()
  // Try EXPENSE first, then any non-SALE type
  const expenseType = txTypes.find((t) => t.code === 'EXPENSE') ?? txTypes.find((t) => t.code !== 'SALE')
  if (!expenseType) {
    issues.push({ field: 'transactionType', message: 'No EXPENSE transaction type configured.', severity: 'error' })
  }

  const categories = await listCategories()
  const expenseCats = categories.filter((c) => c.transactionTypeCode !== 'SALE')
  const catName = intent.fields.categoryName || ''
  const cat = catName
    ? expenseCats.find((c) => c.label.toLowerCase().includes(catName.toLowerCase())) ?? expenseCats[0]
    : expenseCats[0]
  if (!cat) {
    issues.push({ field: 'category', message: 'No expense categories configured.', severity: 'error' })
  }

  return {
    type: 'expense',
    draft: {
      amount: intent.fields.amount ?? 0,
      categoryId: cat?.id ?? 0,
      categoryName: cat?.label ?? catName,
      transactionTypeId: expenseType?.id ?? 0,
      date,
      description: intent.fields.description,
    },
    issues,
  }
}

async function buildStaffPreview(intent: CreateStaffIntent): Promise<StaffPreview> {
  const issues: StaffPreview['issues'] = []
  required(issues, 'firstName', intent.fields.firstName, 'First name')
  required(issues, 'lastName', intent.fields.lastName, 'Last name')
  if (!intent.fields.defaultRate || intent.fields.defaultRate <= 0) {
    issues.push({ field: 'defaultRate', message: 'Daily rate should be greater than 0.', severity: 'warning' })
  }

  let duplicate = false
  if (intent.fields.firstName && intent.fields.lastName) {
    const existing = await findStaffByNaturalKey(
      intent.fields.firstName,
      intent.fields.middleName,
      intent.fields.lastName,
      intent.fields.birthdate ?? '',
    )
    if (existing) {
      duplicate = true
      warnDuplicate(issues, 'staff member')
    }
  }

  return {
    type: 'staff',
    draft: {
      firstName: intent.fields.firstName,
      middleName: intent.fields.middleName,
      lastName: intent.fields.lastName,
      defaultRate: intent.fields.defaultRate ?? 0,
      civilStatus: intent.fields.civilStatus || 'Single',
      birthdate: intent.fields.birthdate || '',
      address: intent.fields.address,
      emergencyContactName: intent.fields.emergencyContactName,
      emergencyContactNumber: intent.fields.emergencyContactNumber,
    },
    issues,
    duplicate,
  }
}

async function buildAttendancePreview(intent: CreateAttendanceIntent): Promise<AttendancePreview> {
  const issues: AttendancePreview['issues'] = []
  required(issues, 'staffName', intent.fields.staffName, 'Staff name')
  const date = intent.fields.date ?? today()
  if (!isValidDate(date)) issues.push({ field: 'date', message: 'Invalid date.', severity: 'error' })

  // Match staff
  const staffList = await listStaff()
  const found = staffList.find((s) =>
    s.displayName.toLowerCase().includes(intent.fields.staffName.toLowerCase()) ||
    s.firstName.toLowerCase().includes(intent.fields.staffName.toLowerCase()) ||
    s.lastName.toLowerCase().includes(intent.fields.staffName.toLowerCase()),
  )
  if (!found) {
    issues.push({ field: 'staffName', message: `Staff member "${intent.fields.staffName}" not found.`, severity: 'error' })
  }

  // Check existing attendance
  let existingRecord = false
  if (found && date) {
    const database = await getDatabase()
    const rows = await database.select<Array<{ id: number }>>(
      `SELECT id FROM staff_attendance WHERE staff_id = $1 AND attendance_date = $2`,
      [found.id, date],
    )
    existingRecord = rows.length > 0
    if (existingRecord) warnExistingAttendance(issues)
  }

  const mult = intent.fields.multiplier ?? 1
  const rate = intent.fields.rateOverride ?? (found?.defaultRate ?? 0)
  const computedPay = rate * mult

  return {
    type: 'attendance',
    draft: {
      staffId: found?.id ?? 0,
      staffName: found?.displayName ?? intent.fields.staffName,
      date,
      status: intent.fields.status,
      multiplier: mult,
      rateOverride: intent.fields.rateOverride ?? null,
      notes: intent.fields.notes,
      computedPay,
    },
    issues,
    existingRecord,
  }
}

// ─── Execute save (only called after user confirms) ───────────────────────────

export async function executeCreate(preview: CreatePreview, userId: number): Promise<string> {
  switch (preview.type) {
    case 'customer': {
      await saveCustomer({
        name: preview.draft.name,
        phone: preview.draft.phone,
        email: preview.draft.email,
        company: preview.draft.company,
      }, userId)
      return `Customer "${preview.draft.name}" has been added.`
    }

    case 'inventory': {
      // Resolve or default category
      const cats = await listInventoryCategories()
      const cat = cats.find((c) => c.label.toLowerCase() === preview.draft.category.toLowerCase())
      const itemId = await saveInventoryItem({
        name: preview.draft.name,
        category: preview.draft.category,
        categoryId: cat?.id ?? null,
        unitType: 'piece',
        unitLabel: preview.draft.unitLabel,
        costPerUnit: preview.draft.costPerUnit,
        sellingPrice: preview.draft.sellingPrice,
        lowStockThreshold: preview.draft.lowStockThreshold,
        supplier: preview.draft.supplier,
        description: '',
        isActive: true,
        status: 'active',
        lastMaintenanceDate: today(),
      })
      // Initial stock movement
      if (preview.draft.initialStock > 0) {
        await saveInventoryMovement({
          itemId,
          movementType: 'IN',
          quantity: preview.draft.initialStock,
          movementDate: today(),
          notes: 'Initial stock (created via assistant)',
          unitCost: preview.draft.costPerUnit,
        }, userId)
      }
      return `Inventory item "${preview.draft.name}" added with ${preview.draft.initialStock} ${preview.draft.unitLabel} initial stock.`
    }

    case 'sale': {
      const draft: TransactionDraft = {
        amount: preview.draft.amount,
        categoryId: preview.draft.categoryId,
        customerId: preview.draft.customerId,
        description: preview.draft.description,
        entryDate: preview.draft.date,
        isLoyaltyReward: false,
        kg: null,
        loads: null,
        staffCount: null,
        transactionTypeId: preview.draft.transactionTypeId,
        lineItems: preview.draft.items.map((l) => ({
          inventoryItemId: l.itemId,
          label: l.itemName,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      }
      await saveTransaction(draft, userId)
      return `Sale recorded: ${preview.draft.items.length} item(s), total ₱${preview.draft.amount.toLocaleString()}.`
    }

    case 'expense': {
      const draft: TransactionDraft = {
        amount: preview.draft.amount,
        categoryId: preview.draft.categoryId,
        customerId: null,
        description: preview.draft.description,
        entryDate: preview.draft.date,
        isLoyaltyReward: false,
        kg: null,
        loads: null,
        staffCount: null,
        transactionTypeId: preview.draft.transactionTypeId,
      }
      await saveTransaction(draft, userId)
      return `Expense of ₱${preview.draft.amount.toLocaleString()} recorded under "${preview.draft.categoryName}".`
    }

    case 'staff': {
      await saveStaff({
        firstName: preview.draft.firstName,
        middleName: preview.draft.middleName,
        lastName: preview.draft.lastName,
        defaultRate: preview.draft.defaultRate,
        civilStatus: preview.draft.civilStatus as CivilStatus,
        birthdate: preview.draft.birthdate,
        address: preview.draft.address,
        emergencyContactName: preview.draft.emergencyContactName,
        emergencyContactNumber: preview.draft.emergencyContactNumber,
        spouseName: '',
      }, userId)
      return `Staff member "${preview.draft.firstName} ${preview.draft.lastName}" has been added.`
    }

    case 'attendance': {
      await upsertAttendance(
        preview.draft.staffId,
        preview.draft.date,
        {
          status: preview.draft.status as 'present' | 'absent' | 'half' | 'overtime' | 'holiday',
          multiplier: preview.draft.multiplier,
          rateOverride: preview.draft.rateOverride,
          notes: preview.draft.notes,
        },
        userId,
      )
      return `Attendance for ${preview.draft.staffName} on ${preview.draft.date} saved as "${preview.draft.status}".`
    }
  }
}
