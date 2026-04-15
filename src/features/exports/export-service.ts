import * as XLSX from 'xlsx'
import type { DashboardData, LedgerTransaction } from '../../lib/db/repository'

function saveWorkbook(workbook: XLSX.WorkBook, filename: string) {
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function exportFilteredTransactions(
  transactions: LedgerTransaction[],
  filename: string,
) {
  const workbook = XLSX.utils.book_new()
  const transactionSheet = XLSX.utils.json_to_sheet(
    transactions.map((transaction) => ({
      Amount: transaction.amount,
      Category: transaction.categoryLabel,
      'Created By': transaction.createdByName ?? '',
      Date: transaction.entryDate,
      Description: transaction.description,
      'Staff Count': transaction.staffCount ?? '',
      'Transaction Type': transaction.transactionTypeCode,
      'Updated By': transaction.updatedByName ?? '',
    })),
  )

  XLSX.utils.book_append_sheet(workbook, transactionSheet, 'Transactions')
  saveWorkbook(workbook, filename)
}

export function exportMonthlySummary(dashboard: DashboardData, filename: string) {
  const workbook = XLSX.utils.book_new()
  const summarySheet = XLSX.utils.json_to_sheet([
    {
      Expense: dashboard.kpis.expense,
      'Gross Income': dashboard.kpis.grossIncome,
      'Income Share Allocation Base': dashboard.kpis.incomeShareAllocationBase,
      'Net Income': dashboard.kpis.netIncome,
      'Operating Expense': dashboard.kpis.operatingExpense,
      'Total Expenses': dashboard.kpis.totalExpenses,
      'Total Sales': dashboard.kpis.totalSales,
    },
  ])
  const sharesSheet = XLSX.utils.json_to_sheet(
    dashboard.incomeShares.map((share) => ({
      'Allocated Amount': share.allocatedAmount,
      Percentage: share.percentage,
      Rule: share.ruleName,
    })),
  )
  const categoriesSheet = XLSX.utils.json_to_sheet(
    dashboard.categoryBreakdown.map((row) => ({
      Category: row.categoryLabel,
      'Total Amount': row.totalAmount,
      'Transaction Type': row.transactionTypeCode,
    })),
  )

  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')
  XLSX.utils.book_append_sheet(workbook, sharesSheet, 'Income Shares')
  XLSX.utils.book_append_sheet(workbook, categoriesSheet, 'Category Breakdown')
  saveWorkbook(workbook, filename)
}
