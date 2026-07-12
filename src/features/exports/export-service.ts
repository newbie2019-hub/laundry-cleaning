import { format } from 'date-fns'
import ExcelJS from 'exceljs'
import { getActiveBusiness, getActiveBusinessId } from '../../lib/db/business'
import type { DashboardData, IncidentReport, LedgerTransaction } from '../../lib/db/repository'
import {
  addStyledSheet,
  BORDER_THIN,
  CURRENCY_FMT,
  DATE_FMT,
  INTEGER_FMT,
  PERCENT_FMT,
  saveWorkbookToDownloads,
  type ColumnSpec,
} from './lib/xlsx'

/** Columns available for a Transactions export (Loads/Kg/Loyalty are laundry-only). */
export function getTransactionColumns(): ColumnSpec[] {
  const includeLoadColumns = getActiveBusinessId() !== 'cleaning'
  return [
    { header: 'Date', key: 'entryDate', width: 14, numFmt: DATE_FMT },
    { header: 'Type', key: 'transactionType', width: 14 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Customer', key: 'customerName', width: 20 },
    { header: 'Description', key: 'description', width: 28 },
    ...(includeLoadColumns
      ? [
          { header: 'Loads', key: 'loads', width: 12 },
          { header: 'Kg', key: 'kg', width: 10 },
          { header: 'Loyalty reward', key: 'loyaltyReward', width: 14 },
        ]
      : []),
    { header: 'Number of Staff', key: 'staffCount', width: 18, numFmt: INTEGER_FMT, align: 'center' },
    { header: 'Amount', key: 'amount', width: 16, numFmt: CURRENCY_FMT, align: 'right' },
  ]
}

/** Builds the styled Transactions workbook (no save). */
export function buildTransactionsWorkbook(
  transactions: LedgerTransaction[],
  columnKeys?: string[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const rows = transactions.map((transaction) => {
    const description = transaction.description.trim()
      ? transaction.description
      : transaction.categoryLabel

    return {
      entryDate: new Date(`${transaction.entryDate}T00:00:00`),
      transactionType: transaction.transactionTypeCode,
      category: transaction.categoryLabel,
      customerName: transaction.customerName ?? '',
      description,
      loads: transaction.loads ?? '',
      kg: transaction.kg ?? '',
      loyaltyReward: transaction.isLoyaltyReward ? 'Yes' : '',
      staffCount: transaction.staffCount ?? '',
      amount: transaction.amount,
    }
  })

  addStyledSheet(workbook, 'Transactions', getTransactionColumns(), rows, columnKeys)
  return workbook
}

export async function exportFilteredTransactions(
  transactions: LedgerTransaction[],
  filename: string,
) {
  await saveWorkbookToDownloads(buildTransactionsWorkbook(transactions), filename)
}

const STATEMENT_TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 16, name: 'Calibri' }
const STATEMENT_SUBTITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 12, name: 'Calibri' }
const MUTED_FONT: Partial<ExcelJS.Font> = { italic: true, size: 10, color: { argb: 'FF64748B' } }
const SECTION_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
const NET_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } }
const DOUBLE_BORDER: Partial<ExcelJS.Border> = { style: 'double', color: { argb: 'FF2563EB' } }

/** Renders a vertical, professional income-statement sheet. */
function addIncomeStatementSheet(workbook: ExcelJS.Workbook, dashboard: DashboardData) {
  const ws = workbook.addWorksheet('Income Statement')
  ws.columns = [
    { key: 'label', width: 44 },
    { key: 'amount', width: 22 },
  ]

  const k = dashboard.kpis
  const business = getActiveBusiness()
  const [year, month] = dashboard.monthKey.split('-').map(Number)
  const periodLabel = format(new Date(year, (month || 1) - 1, 1), 'MMMM yyyy')

  // Title block, centered across both columns.
  ;['A1:B1', 'A2:B2', 'A3:B3'].forEach((range) => ws.mergeCells(range))
  const nameCell = ws.getCell('A1')
  nameCell.value = business.name
  nameCell.font = STATEMENT_TITLE_FONT
  nameCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 26
  const titleCell = ws.getCell('A2')
  titleCell.value = 'Income Statement'
  titleCell.font = STATEMENT_SUBTITLE_FONT
  titleCell.alignment = { horizontal: 'center' }
  const periodCell = ws.getCell('A3')
  periodCell.value = `For the period ended ${periodLabel}`
  periodCell.font = MUTED_FONT
  periodCell.alignment = { horizontal: 'center' }

  let r = 5
  const sectionHeader = (text: string) => {
    const row = ws.getRow(r)
    row.getCell(1).value = text
    row.getCell(1).font = { bold: true, size: 11 }
    row.getCell(1).fill = SECTION_FILL
    row.getCell(2).fill = SECTION_FILL
    r += 1
  }
  const lineItem = (label: string, amount: number) => {
    const row = ws.getRow(r)
    row.getCell(1).value = label
    row.getCell(1).alignment = { indent: 2 }
    const cell = row.getCell(2)
    cell.value = amount
    cell.numFmt = CURRENCY_FMT
    cell.alignment = { horizontal: 'right' }
    r += 1
  }
  const subtotal = (label: string, amount: number) => {
    const row = ws.getRow(r)
    row.getCell(1).value = label
    row.getCell(1).font = { bold: true }
    row.getCell(1).border = { top: BORDER_THIN }
    const cell = row.getCell(2)
    cell.value = amount
    cell.numFmt = CURRENCY_FMT
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'right' }
    cell.border = { top: BORDER_THIN }
    r += 1
  }

  sectionHeader('Revenue')
  lineItem('Total Sales', k.totalSales)
  subtotal('Gross Income', k.grossIncome)
  r += 1
  sectionHeader('Expenses')
  lineItem('Cost & Direct Expenses', k.expense)
  lineItem('Operating Expenses', k.operatingExpense)
  subtotal('Total Expenses', k.totalExpenses)
  r += 1

  // Net income — highlighted with a double top/bottom border.
  const netRow = ws.getRow(r)
  netRow.getCell(1).value = 'Net Income'
  netRow.getCell(1).font = { bold: true, size: 12 }
  netRow.getCell(1).fill = NET_FILL
  netRow.getCell(1).border = { top: DOUBLE_BORDER, bottom: DOUBLE_BORDER }
  const netCell = netRow.getCell(2)
  netCell.value = k.netIncome
  netCell.numFmt = CURRENCY_FMT
  netCell.font = { bold: true, size: 12, color: { argb: k.netIncome < 0 ? 'FFDC2626' : 'FF047857' } }
  netCell.alignment = { horizontal: 'right' }
  netCell.fill = NET_FILL
  netCell.border = { top: DOUBLE_BORDER, bottom: DOUBLE_BORDER }
  r += 2

  // Memo line for the income-share allocation base.
  const memoRow = ws.getRow(r)
  memoRow.getCell(1).value = 'Income Share Allocation Base'
  memoRow.getCell(1).font = MUTED_FONT
  const memoCell = memoRow.getCell(2)
  memoCell.value = k.incomeShareAllocationBase
  memoCell.numFmt = CURRENCY_FMT
  memoCell.font = MUTED_FONT
  memoCell.alignment = { horizontal: 'right' }
}

/** Builds the income-statement workbook: statement sheet + supporting detail sheets. */
export function buildMonthlySummaryWorkbook(dashboard: DashboardData): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  addIncomeStatementSheet(workbook, dashboard)

  const sharesColumns: ColumnSpec[] = [
    { header: 'Rule', key: 'ruleName', width: 24 },
    { header: 'Percentage', key: 'percentage', width: 12, numFmt: PERCENT_FMT, align: 'right' },
    { header: 'Allocated Amount', key: 'allocatedAmount', width: 18, numFmt: CURRENCY_FMT, align: 'right' },
  ]
  addStyledSheet(
    workbook,
    'Income Shares',
    sharesColumns,
    dashboard.incomeShares.map((share) => ({
      ruleName: share.ruleName,
      percentage: share.percentage,
      allocatedAmount: share.allocatedAmount,
    })),
  )

  const categoriesColumns: ColumnSpec[] = [
    { header: 'Transaction Type', key: 'transactionTypeCode', width: 20 },
    { header: 'Category', key: 'categoryLabel', width: 24 },
    { header: 'Total Amount', key: 'totalAmount', width: 16, numFmt: CURRENCY_FMT, align: 'right' },
  ]
  addStyledSheet(
    workbook,
    'Category Breakdown',
    categoriesColumns,
    dashboard.categoryBreakdown.map((row) => ({
      transactionTypeCode: row.transactionTypeCode,
      categoryLabel: row.categoryLabel,
      totalAmount: row.totalAmount,
    })),
  )

  return workbook
}

export async function exportMonthlySummary(dashboard: DashboardData, filename: string) {
  await saveWorkbookToDownloads(buildMonthlySummaryWorkbook(dashboard), filename)
}

function formatTimeTo12Hour(time: string): string {
  if (!time) return ''
  const [hStr, mStr = '00'] = time.split(':')
  const h = Number(hStr)
  if (!Number.isFinite(h)) return time
  const period = h >= 12 ? 'PM' : 'AM'
  const display = ((h + 11) % 12) + 1
  return `${display}:${mStr.padStart(2, '0')} ${period}`
}

export const INCIDENT_COLUMNS: ColumnSpec[] = [
  { header: 'Date', key: 'incidentDate', width: 14, numFmt: DATE_FMT },
  { header: 'Time', key: 'incidentTime', width: 12 },
  { header: 'Type', key: 'incidentType', width: 20 },
  { header: 'Description', key: 'whatHappened', width: 40 },
  { header: 'Customer', key: 'customerName', width: 22 },
  { header: 'Contact Number', key: 'contactNumber', width: 18 },
  { header: 'Action Taken', key: 'actionTaken', width: 30 },
  { header: 'Handled By', key: 'handledBy', width: 20 },
  { header: 'Staff On Duty', key: 'staffOnDuty', width: 20 },
  { header: 'Items Involved', key: 'itemsInvolved', width: 24 },
  { header: 'Quantity', key: 'quantity', width: 12, numFmt: INTEGER_FMT, align: 'center' },
  { header: 'Estimated Loss', key: 'estimatedLoss', width: 18, numFmt: CURRENCY_FMT, align: 'right' },
  { header: 'Remarks', key: 'remarks', width: 28 },
]

/** Builds the styled Incident Reports workbook (no save). */
export function buildIncidentReportsWorkbook(
  reports: IncidentReport[],
  columnKeys?: string[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const rows = reports.map((report) => ({
    incidentDate: report.incidentDate ? new Date(`${report.incidentDate}T00:00:00`) : '',
    incidentTime: formatTimeTo12Hour(report.incidentTime),
    incidentType: report.incidentType,
    whatHappened: report.whatHappened,
    customerName: report.customerName,
    contactNumber: report.contactNumber,
    actionTaken: report.actionTaken,
    handledBy: report.handledBy,
    staffOnDuty: report.staffOnDuty,
    itemsInvolved: report.itemsInvolved,
    quantity: report.quantity || '',
    estimatedLoss: report.estimatedLoss || 0,
    remarks: report.remarks,
  }))

  addStyledSheet(workbook, 'Incident Reports', INCIDENT_COLUMNS, rows, columnKeys)
  return workbook
}

export async function exportFilteredIncidentReports(reports: IncidentReport[], filename: string) {
  await saveWorkbookToDownloads(buildIncidentReportsWorkbook(reports), filename)
}
