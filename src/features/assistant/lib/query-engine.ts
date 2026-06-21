import { format } from 'date-fns'
import type {
  CustomerQueryIntent,
  ExpenseQueryIntent,
  InventoryQueryIntent,
  PayrollQueryIntent,
  QueryIntent,
  SalesQueryIntent,
  StaffQueryIntent,
} from '../types'
import {
  getTransactionsSummary,
  listTransactions,
  listCustomerSummaries,
  listInventoryItems,
  listInventoryMovements,
  getInventoryItemSummaries,
  listAttendanceForDate,
  listAttendanceDaySummaries,
  listPayrollPayDateSummaries,
  listPayrolls,
  listStaff,
} from '../../../lib/db/repository'
import { bulletList, fmtDate, fmtDateRange, fmtPeso, noData, topN } from './formatter'

const DATE_FMT = 'yyyy-MM-dd'
function today() { return format(new Date(), DATE_FMT) }

function defaultRange(intent: QueryIntent) {
  if (intent.dateRange) return intent.dateRange
  const d = today()
  return { from: d, to: d }
}

// ─── Sales ────────────────────────────────────────────────────────────────────

async function handleSales(intent: SalesQueryIntent): Promise<string> {
  const range = defaultRange(intent)
  const summary = await getTransactionsSummary(range.from, range.to)
  const rangeLabel = fmtDateRange(range)

  if (intent.subtype === 'top_selling' || intent.subtype === 'by_item') {
    const monthKey = range.from.slice(0, 7)
    const summaries = await getInventoryItemSummaries(monthKey)
    const sorted = [...summaries].sort((a, b) => b.totalOut - a.totalOut)
    const top = topN(sorted)
    if (!top.length) return noData('item sales')
    const lines = top.map((s, i) => `${i + 1}. ${s.name} — ${s.totalOut} ${s.unitLabel} sold`)
    return `Top selling items (${rangeLabel}):\n${lines.join('\n')}`
  }

  if (intent.subtype === 'by_customer') {
    const txs = await listTransactions({ dateFrom: range.from, dateTo: range.to })
    const saleTxs = txs.filter((t) => t.transactionTypeCode === 'SALE' && t.customerName)
    const byCustomer = new Map<string, number>()
    for (const t of saleTxs) {
      if (t.customerName) {
        byCustomer.set(t.customerName, (byCustomer.get(t.customerName) ?? 0) + t.amount)
      }
    }
    if (!byCustomer.size) return noData('customer sales')
    const sorted = [...byCustomer.entries()].sort((a, b) => b[1] - a[1])
    const lines = topN(sorted).map(([name, amt]) => `${name}: ${fmtPeso(amt)}`)
    return `Sales by customer (${rangeLabel}):\n${bulletList(lines)}\n\nTotal: ${fmtPeso(summary.kpis.totalSales)}`
  }

  if (intent.subtype === 'recent') {
    const txs = await listTransactions({ dateFrom: range.from, dateTo: range.to })
    const sales = txs.filter((t) => t.transactionTypeCode === 'SALE').slice(0, 10)
    if (!sales.length) return noData('recent sales')
    const lines = sales.map((t) => `${fmtDate(t.entryDate)} — ${fmtPeso(t.amount)}${t.customerName ? ` (${t.customerName})` : ''}`)
    return `Recent sales:\n${bulletList(lines)}`
  }

  if (intent.subtype === 'average_daily') {
    const avg = summary.kpis.avgDailySales
    return `Average daily sales (${rangeLabel}): ${fmtPeso(avg)}\n\nTotal: ${fmtPeso(summary.kpis.totalSales)} over ${summary.dailySeries.length} days`
  }

  // Default: total summary
  const { totalSales, totalExpenses, netIncome, transactionCount } = summary.kpis

  const txs = await listTransactions({ dateFrom: range.from, dateTo: range.to })
  const sales = txs.filter((t) => t.transactionTypeCode === 'SALE')
  const topCustomer = (() => {
    const m = new Map<string, number>()
    for (const t of sales) if (t.customerName) m.set(t.customerName, (m.get(t.customerName) ?? 0) + t.amount)
    const e = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
    return e ? e[0] : null
  })()

  const lines: string[] = [
    `${sales.length} sale transaction(s)`,
    topCustomer ? `Top customer: ${topCustomer}` : '',
    `Total expenses: ${fmtPeso(totalExpenses)}`,
    `Net income: ${fmtPeso(netIncome)}`,
    `Total transactions: ${transactionCount}`,
  ].filter(Boolean)

  return `Your total sales (${rangeLabel}): **${fmtPeso(totalSales)}**\n\nSummary:\n${bulletList(lines)}`
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

async function handleExpense(intent: ExpenseQueryIntent): Promise<string> {
  const range = defaultRange(intent)
  const rangeLabel = fmtDateRange(range)
  const summary = await getTransactionsSummary(range.from, range.to)

  if (intent.subtype === 'by_category') {
    const breakdown = summary.categoryBreakdown.filter(
      (c) => c.transactionTypeCode === 'EXPENSE' || c.transactionTypeCode === 'OPERATING_EXPENSE',
    )
    if (!breakdown.length) return noData('expense categories')
    const lines = breakdown
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .map((c) => `${c.categoryLabel}: ${fmtPeso(c.totalAmount)} (${c.count} tx)`)
    return `Expense breakdown (${rangeLabel}):\n${bulletList(lines)}`
  }

  if (intent.subtype === 'operating') {
    const lines = summary.categoryBreakdown
      .filter((c) => c.transactionTypeCode !== 'SALE')
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .map((c) => `${c.categoryLabel}: ${fmtPeso(c.totalAmount)}`)
    if (!lines.length) return noData('operating expenses')
    return `Operating expenses (${rangeLabel}):\n${bulletList(lines)}\n\nTotal: ${fmtPeso(summary.kpis.operatingExpense)}`
  }

  if (intent.subtype === 'largest') {
    const txs = await listTransactions({ dateFrom: range.from, dateTo: range.to })
    const expenses = txs.filter((t) => t.transactionTypeCode !== 'SALE').sort((a, b) => b.amount - a.amount)
    if (!expenses.length) return noData('expenses')
    const lines = topN(expenses).map((t) => `${fmtDate(t.entryDate)} — ${t.categoryLabel}: ${fmtPeso(t.amount)}${t.description ? ` (${t.description})` : ''}`)
    return `Largest expenses (${rangeLabel}):\n${bulletList(lines)}`
  }

  if (intent.subtype === 'recent') {
    const txs = await listTransactions({ dateFrom: range.from, dateTo: range.to })
    const expenses = txs.filter((t) => t.transactionTypeCode !== 'SALE').slice(0, 10)
    if (!expenses.length) return noData('recent expenses')
    const lines = expenses.map((t) => `${fmtDate(t.entryDate)} — ${t.categoryLabel}: ${fmtPeso(t.amount)}`)
    return `Recent expenses:\n${bulletList(lines)}`
  }

  // Total
  const { totalExpenses, operatingExpense } = summary.kpis
  const lines = [
    `Expenses: ${fmtPeso(totalExpenses)}`,
    `Operating expenses: ${fmtPeso(operatingExpense)}`,
    `Combined: ${fmtPeso(totalExpenses + operatingExpense)}`,
  ]
  return `Total spending (${rangeLabel}):\n${bulletList(lines)}`
}

// ─── Customers ────────────────────────────────────────────────────────────────

async function handleCustomer(intent: CustomerQueryIntent): Promise<string> {
  const range = defaultRange(intent)
  const rangeLabel = fmtDateRange(range)

  if (intent.subtype === 'purchase_history' && intent.customerName) {
    const customers = await listCustomerSummaries({ search: intent.customerName })
    const customer = customers[0]
    if (!customer) return `No customer found matching "${intent.customerName}".`
    const txs = await listTransactions({ customerId: customer.id, dateFrom: range.from, dateTo: range.to })
    if (!txs.length) return `No transactions found for ${customer.name} in that period.`
    const lines = txs.map((t) => `${fmtDate(t.entryDate)} — ${fmtPeso(t.amount)} (${t.categoryLabel})`)
    const total = txs.reduce((s, t) => s + t.amount, 0)
    return `Purchase history for ${customer.name}:\n${bulletList(lines)}\n\nTotal: ${fmtPeso(total)}`
  }

  const customers = await listCustomerSummaries()

  if (intent.subtype === 'top') {
    const withTx = customers.filter((c) => c.lastTransactionAmount !== null)
    const top = topN(withTx.sort((a, b) => (b.lastTransactionAmount ?? 0) - (a.lastTransactionAmount ?? 0)))
    if (!top.length) return noData('top customers')
    const lines = top.map((c) => `${c.name}${c.phone ? ` (${c.phone})` : ''}${c.lastTransactionAmount ? ` — last: ${fmtPeso(c.lastTransactionAmount)}` : ''}`)
    return `Top customers:\n${bulletList(lines)}`
  }

  if (intent.subtype === 'frequent') {
    const withTx = customers.filter((c) => c.lastTransactionDate)
    const sorted = topN([...withTx].sort((a, b) => {
      const ad = a.lastTransactionDate ?? ''
      const bd = b.lastTransactionDate ?? ''
      return bd.localeCompare(ad)
    }))
    if (!sorted.length) return noData('frequent customers')
    const lines = sorted.map((c) => `${c.name}${c.lastTransactionDate ? ` — last visit: ${fmtDate(c.lastTransactionDate)}` : ''}`)
    return `Frequent customers:\n${bulletList(lines)}`
  }

  if (intent.subtype === 'recent') {
    const recent = topN(
      [...customers]
        .filter((c) => c.createdAt >= range.from)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    )
    if (!recent.length) return noData('recent customers')
    const lines = recent.map((c) => `${c.name}${c.phone ? ` (${c.phone})` : ''} — added ${fmtDate(c.createdAt.slice(0, 10))}`)
    return `New customers (${rangeLabel}):\n${bulletList(lines)}`
  }

  // Default list
  const all = topN(customers, 10)
  if (!all.length) return 'No customers found.'
  const lines = all.map((c) => `${c.name}${c.phone ? ` (${c.phone})` : ''}`)
  return `Customers (${all.length} of ${customers.length}):\n${bulletList(lines)}`
}

// ─── Inventory ────────────────────────────────────────────────────────────────

async function handleInventory(intent: InventoryQueryIntent): Promise<string> {
  const range = defaultRange(intent)
  const rangeLabel = fmtDateRange(range)

  if (intent.subtype === 'low_stock') {
    const items = await listInventoryItems()
    const low = items.filter((i) => i.isLowStock && i.isActive)
    if (!low.length) return 'No items are low on stock.'
    const lines = low.map((i) => `${i.name} — ${i.currentStock} ${i.unitLabel} left (min: ${i.lowStockThreshold})`)
    return `Items needing restock (${low.length}):\n${bulletList(lines)}`
  }

  if (intent.subtype === 'fast_moving' || intent.subtype === 'most_sold') {
    const monthKey = range.from.slice(0, 7)
    const summaries = await getInventoryItemSummaries(monthKey)
    const top = topN([...summaries].sort((a, b) => b.totalOut - a.totalOut))
    if (!top.length) return noData('item sales data')
    const lines = top.map((s, i) => `${i + 1}. ${s.name} — ${s.totalOut} ${s.unitLabel} sold`)
    return `Fast-moving items (${rangeLabel}):\n${lines.join('\n')}`
  }

  if (intent.subtype === 'movement_history') {
    const movements = await listInventoryMovements({ dateFrom: range.from, dateTo: range.to })
    if (!movements.length) return noData('inventory movements')
    const lines = topN(movements, 10).map((m) => `${fmtDate(m.movementDate)} — ${m.itemName}: ${m.movementType === 'IN' ? '+' : '-'}${m.quantity} ${m.unitLabel}`)
    return `Inventory movements (${rangeLabel}):\n${bulletList(lines)}`
  }

  if (intent.subtype === 'current_stock') {
    const allItems2 = await listInventoryItems()
    const filtered = intent.itemName
      ? allItems2.filter((i) => i.name.toLowerCase().includes(intent.itemName!.toLowerCase()))
      : allItems2
    const activeFiltered = topN(filtered.filter((i) => i.isActive), 15)
    if (!activeFiltered.length) return noData('inventory items')
    const stockLines = activeFiltered.map((i) => `${i.name}: ${i.currentStock} ${i.unitLabel}${i.isLowStock ? ' ⚠ low' : ''}`)
    return `Current stock:\n${bulletList(stockLines)}`
  }

  // List all
  const allItemsList = await listInventoryItems()
  const active = allItemsList.filter((i) => i.isActive)
  if (!active.length) return 'No inventory items found.'
  const listLines = topN(active, 15).map((i) => `${i.name} — ${i.currentStock} ${i.unitLabel} @ ${fmtPeso(i.sellingPrice)}`)
  return `Inventory (${active.length} items):\n${bulletList(listLines)}`
}

// ─── Staff / Attendance ───────────────────────────────────────────────────────

async function handleStaff(intent: StaffQueryIntent): Promise<string> {
  const range = defaultRange(intent)
  const rangeLabel = fmtDateRange(range)

  if (intent.subtype === 'present' || intent.subtype === 'absent') {
    const status = intent.subtype
    // Use a single date if from===to, else summary
    if (range.from === range.to) {
      const entries = await listAttendanceForDate(range.from)
      const filtered = entries.filter((e) => {
        if (status === 'present') return ['present', 'half', 'overtime', 'holiday'].includes(e.status)
        return e.status === 'absent'
      })
      if (!filtered.length) return `No staff ${status} on ${fmtDate(range.from)}.`
      const lines = filtered.map((e) => `${e.staffDisplayName}${e.rateOverride ? ` — rate override ${fmtPeso(e.rateOverride)}` : ''} (${e.status})`)
      return `Staff ${status} on ${fmtDate(range.from)}:\n${bulletList(lines)}`
    }
    // Range: use summaries
    const summaries = await listAttendanceDaySummaries(range.from, range.to)
    if (!summaries.length) return noData('attendance records')
    const lines = summaries.map((s) => `${fmtDate(s.date)} — present: ${s.presentCount}, absent: ${s.absentCount}`)
    return `Attendance summary (${rangeLabel}):\n${bulletList(lines)}`
  }

  if (intent.subtype === 'attendance_summary') {
    const summaries = await listAttendanceDaySummaries(range.from, range.to)
    if (!summaries.length) return noData('attendance records')
    const lines = summaries.map((s) => `${fmtDate(s.date)} — ${s.presentCount} present, ${s.absentCount} absent`)
    return `Attendance summary (${rangeLabel}):\n${bulletList(lines)}`
  }

  if (intent.subtype === 'daily_rate') {
    const staff = await listStaff()
    const active = staff.filter((s) => !s.isArchived)
    if (!active.length) return 'No staff found.'
    const lines = active.map((s) => `${s.displayName}: ${fmtPeso(s.defaultRate)}/day`)
    return `Staff daily rates:\n${bulletList(lines)}`
  }

  // List
  const staff = await listStaff()
  const active = staff.filter((s) => !s.isArchived)
  if (!active.length) return 'No staff members found.'
  const lines = active.map((s) => `${s.displayName} — ${fmtPeso(s.defaultRate)}/day`)
  return `Staff (${active.length}):\n${bulletList(lines)}`
}

// ─── Payroll ──────────────────────────────────────────────────────────────────

async function handlePayroll(intent: PayrollQueryIntent): Promise<string> {
  const range = defaultRange(intent)
  const rangeLabel = fmtDateRange(range)

  if (intent.subtype === 'by_employee' && intent.staffName) {
    const staffList = await listStaff()
    const found = staffList.find((s) => s.displayName.toLowerCase().includes(intent.staffName!.toLowerCase()))
    if (!found) return `No staff found matching "${intent.staffName}".`
    const payrolls = await listPayrolls(found.id)
    if (!payrolls.length) return `No payroll records found for ${found.displayName}.`
    const lines = topN(payrolls, 5).map((p) => `${fmtDate(p.payDate)} — Net: ${fmtPeso(p.netPay)} (${fmtDate(p.periodStart)} – ${fmtDate(p.periodEnd)})`)
    return `Payroll for ${found.displayName}:\n${bulletList(lines)}`
  }

  // Summary by date range
  const summaries = await listPayrollPayDateSummaries(range.from, range.to)
  if (!summaries.length) return noData('payroll records')
  const totalPaid = summaries.reduce((s, p) => s + p.totalNet, 0)
  const lines = summaries.map((s) => `${fmtDate(s.payDate)} — ${s.count} staff, ${fmtPeso(s.totalNet)} total`)
  return `Payroll summary (${rangeLabel}):\n${bulletList(lines)}\n\nTotal paid out: **${fmtPeso(totalPaid)}**`
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runQuery(intent: QueryIntent): Promise<string> {
  try {
    switch (intent.category) {
      case 'sales': return await handleSales(intent)
      case 'expense': return await handleExpense(intent)
      case 'customer': return await handleCustomer(intent)
      case 'inventory': return await handleInventory(intent)
      case 'staff': return await handleStaff(intent)
      case 'payroll': return await handlePayroll(intent)
    }
  } catch (err) {
    console.error('[query-engine]', err)
    return `Sorry, I couldn't retrieve that data. ${err instanceof Error ? err.message : 'Please try again.'}`
  }
}
