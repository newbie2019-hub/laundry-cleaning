import ExcelJS from 'exceljs'
import { toastBrowserExportFailed, toastBrowserExportSuccess } from '../../lib/export-toast'
import { saveBytesAsDownload } from '../../lib/save-file-download'
import type { DashboardData, IncidentReport, LedgerTransaction } from '../../lib/db/repository'

/** Header row background (blue-600) */
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF2563EB' },
}
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
  name: 'Calibri',
}
const HEADER_ROW_HEIGHT = 36
const HEADER_MIN_COL_WIDTH = 12

const BORDER_THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFE2E8F0' } }
const BORDER_ALL: Partial<ExcelJS.Borders> = {
  top: BORDER_THIN,
  left: BORDER_THIN,
  bottom: BORDER_THIN,
  right: BORDER_THIN,
}
const ROW_ALT_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF9FAFB' },
}

const CURRENCY_FMT = '"₱"#,##0.00'
const DATE_FMT = 'yyyy-mm-dd'
const STAFF_COUNT_FMT = '0'
const MAX_COL_WIDTH = 40

function cellTextLength(value: ExcelJS.CellValue): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'string' || typeof value === 'number') return String(value).length
  if (typeof value === 'boolean') return value ? 4 : 5
  if (value instanceof Date) return 10
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((r) => r.text).join('').length
  }
  if (typeof value === 'object' && 'text' in value && typeof (value as { text: string }).text === 'string') {
    return (value as { text: string }).text.length
  }
  if (typeof value === 'object' && 'formula' in value) return String((value as { result?: unknown }).result ?? '').length
  return String(value).length
}

function styleHeaderRow(worksheet: ExcelJS.Worksheet) {
  const headerRow = worksheet.getRow(1)
  headerRow.height = HEADER_ROW_HEIGHT
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT as ExcelJS.Font
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    }
    cell.border = BORDER_ALL as ExcelJS.Borders
  })
}

/** After auto-fit, ensure each column is at least wide enough for the header text. */
function ensureHeaderColumnMinWidths(worksheet: ExcelJS.Worksheet) {
  const columns = worksheet.columns
  if (!columns) return

  columns.forEach((column) => {
    if (!column) return
    const headerText = column.header != null ? String(column.header) : ''
    const fromHeader = Math.max(HEADER_MIN_COL_WIDTH, Math.min(headerText.length + 4, MAX_COL_WIDTH))
    column.width = Math.max(column.width ?? fromHeader, fromHeader)
  })
}

function autoFitColumns(worksheet: ExcelJS.Worksheet) {
  const columns = worksheet.columns
  if (!columns) return

  columns.forEach((column, colIndex) => {
    if (!column) return
    const headerLen = column.header != null ? String(column.header).length : 0
    let maxLen = headerLen

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return
      const cell = row.getCell(colIndex + 1)
      maxLen = Math.max(maxLen, cellTextLength(cell.value))
    })

    column.width = Math.min(Math.max(maxLen + 2, HEADER_MIN_COL_WIDTH), MAX_COL_WIDTH)
  })
}

function applyFrozenHeaderAndFilter(worksheet: ExcelJS.Worksheet, columnCount: number) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columnCount },
  }
}

function applyAlternatingRowFills(worksheet: ExcelJS.Worksheet) {
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    if (rowNumber % 2 === 0) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = ROW_ALT_FILL
      })
    }
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        bottom: BORDER_THIN,
      } as ExcelJS.Borders
    })
  })
}

async function saveWorkbook(workbook: ExcelJS.Workbook, filename: string) {
  try {
    const buffer = await workbook.xlsx.writeBuffer()
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    await saveBytesAsDownload(
      filename,
      bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    toastBrowserExportSuccess()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not create the spreadsheet.'
    toastBrowserExportFailed(message)
    throw error
  }
}

export async function exportFilteredTransactions(
  transactions: LedgerTransaction[],
  filename: string,
) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Transactions')

  worksheet.columns = [
    { header: 'Date', key: 'entryDate', width: 14 },
    { header: 'Type', key: 'transactionType', width: 14 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Description', key: 'description', width: 28 },
    { header: 'Number of Staff', key: 'staffCount', width: 18 },
    { header: 'Amount', key: 'amount', width: 16 },
  ]

  for (const transaction of transactions) {
    const description = transaction.description.trim()
      ? transaction.description
      : transaction.categoryLabel

    worksheet.addRow({
      entryDate: new Date(`${transaction.entryDate}T00:00:00`),
      transactionType: transaction.transactionTypeCode,
      category: transaction.categoryLabel,
      description,
      staffCount: transaction.staffCount ?? '',
      amount: transaction.amount,
    })
  }

  styleHeaderRow(worksheet)
  applyFrozenHeaderAndFilter(worksheet, worksheet.columns?.length ?? 6)

  const dateCol = 1
  const staffCol = 5
  const amountCol = 6
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.getCell(dateCol).numFmt = DATE_FMT
    const staffCell = row.getCell(staffCol)
    if (staffCell.value !== '' && staffCell.value != null) {
      staffCell.numFmt = STAFF_COUNT_FMT
      staffCell.alignment = { horizontal: 'center', vertical: 'middle' }
    }
    row.getCell(amountCol).numFmt = CURRENCY_FMT
    row.getCell(amountCol).alignment = { horizontal: 'right', vertical: 'middle' }
  })

  autoFitColumns(worksheet)
  ensureHeaderColumnMinWidths(worksheet)
  applyAlternatingRowFills(worksheet)

  await saveWorkbook(workbook, filename)
}

export async function exportMonthlySummary(dashboard: DashboardData, filename: string) {
  const workbook = new ExcelJS.Workbook()

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.columns = [
    { header: 'Total Sales', key: 'totalSales', width: 14 },
    { header: 'Gross Income', key: 'grossIncome', width: 14 },
    { header: 'Expense', key: 'expense', width: 14 },
    { header: 'Operating Expense', key: 'operatingExpense', width: 18 },
    { header: 'Total Expenses', key: 'totalExpenses', width: 14 },
    { header: 'Net Income', key: 'netIncome', width: 14 },
    { header: 'Income Share Allocation Base', key: 'incomeShareAllocationBase', width: 28 },
  ]

  summarySheet.addRow({
    totalSales: dashboard.kpis.totalSales,
    grossIncome: dashboard.kpis.grossIncome,
    expense: dashboard.kpis.expense,
    operatingExpense: dashboard.kpis.operatingExpense,
    totalExpenses: dashboard.kpis.totalExpenses,
    netIncome: dashboard.kpis.netIncome,
    incomeShareAllocationBase: dashboard.kpis.incomeShareAllocationBase,
  })

  styleHeaderRow(summarySheet)
  applyFrozenHeaderAndFilter(summarySheet, summarySheet.columns?.length ?? 7)
  summarySheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.eachCell((cell, colNumber) => {
      if (colNumber >= 1 && colNumber <= 7) {
        cell.numFmt = CURRENCY_FMT
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
      }
    })
  })
  autoFitColumns(summarySheet)
  ensureHeaderColumnMinWidths(summarySheet)
  applyAlternatingRowFills(summarySheet)

  const sharesSheet = workbook.addWorksheet('Income Shares')
  sharesSheet.columns = [
    { header: 'Rule', key: 'ruleName', width: 24 },
    { header: 'Percentage', key: 'percentage', width: 12 },
    { header: 'Allocated Amount', key: 'allocatedAmount', width: 18 },
  ]
  for (const share of dashboard.incomeShares) {
    sharesSheet.addRow({
      ruleName: share.ruleName,
      percentage: share.percentage,
      allocatedAmount: share.allocatedAmount,
    })
  }
  styleHeaderRow(sharesSheet)
  applyFrozenHeaderAndFilter(sharesSheet, 3)
  sharesSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.getCell(2).numFmt = '0.00"%"'
    row.getCell(3).numFmt = CURRENCY_FMT
    row.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' }
  })
  autoFitColumns(sharesSheet)
  ensureHeaderColumnMinWidths(sharesSheet)
  applyAlternatingRowFills(sharesSheet)

  const categoriesSheet = workbook.addWorksheet('Category Breakdown')
  categoriesSheet.columns = [
    { header: 'Transaction Type', key: 'transactionTypeCode', width: 20 },
    { header: 'Category', key: 'categoryLabel', width: 24 },
    { header: 'Total Amount', key: 'totalAmount', width: 16 },
  ]
  for (const row of dashboard.categoryBreakdown) {
    categoriesSheet.addRow({
      transactionTypeCode: row.transactionTypeCode,
      categoryLabel: row.categoryLabel,
      totalAmount: row.totalAmount,
    })
  }
  styleHeaderRow(categoriesSheet)
  applyFrozenHeaderAndFilter(categoriesSheet, 3)
  categoriesSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.getCell(3).numFmt = CURRENCY_FMT
    row.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' }
  })
  autoFitColumns(categoriesSheet)
  ensureHeaderColumnMinWidths(categoriesSheet)
  applyAlternatingRowFills(categoriesSheet)

  await saveWorkbook(workbook, filename)
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

export async function exportFilteredIncidentReports(
  reports: IncidentReport[],
  filename: string,
) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Incident Reports')

  worksheet.columns = [
    { header: 'Date', key: 'incidentDate', width: 14 },
    { header: 'Time', key: 'incidentTime', width: 12 },
    { header: 'Type', key: 'incidentType', width: 20 },
    { header: 'Description', key: 'whatHappened', width: 40 },
    { header: 'Customer', key: 'customerName', width: 22 },
    { header: 'Contact Number', key: 'contactNumber', width: 18 },
    { header: 'Action Taken', key: 'actionTaken', width: 30 },
    { header: 'Handled By', key: 'handledBy', width: 20 },
    { header: 'Staff On Duty', key: 'staffOnDuty', width: 20 },
    { header: 'Items Involved', key: 'itemsInvolved', width: 24 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Estimated Loss', key: 'estimatedLoss', width: 18 },
    { header: 'Remarks', key: 'remarks', width: 28 },
  ]

  for (const report of reports) {
    worksheet.addRow({
      incidentDate: report.incidentDate
        ? new Date(`${report.incidentDate}T00:00:00`)
        : '',
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
    })
  }

  styleHeaderRow(worksheet)
  applyFrozenHeaderAndFilter(worksheet, worksheet.columns?.length ?? 13)

  const dateCol = 1
  const quantityCol = 11
  const lossCol = 12
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.getCell(dateCol).numFmt = DATE_FMT
    const qtyCell = row.getCell(quantityCol)
    if (qtyCell.value !== '' && qtyCell.value != null) {
      qtyCell.numFmt = STAFF_COUNT_FMT
      qtyCell.alignment = { horizontal: 'center', vertical: 'middle' }
    }
    row.getCell(lossCol).numFmt = CURRENCY_FMT
    row.getCell(lossCol).alignment = { horizontal: 'right', vertical: 'middle' }
  })

  autoFitColumns(worksheet)
  ensureHeaderColumnMinWidths(worksheet)
  applyAlternatingRowFills(worksheet)

  await saveWorkbook(workbook, filename)
}
