import ExcelJS from 'exceljs'
import type { CustomerSummary } from '../../lib/db/repository'
import { addStyledSheet, CURRENCY_FMT, DATE_FMT, INTEGER_FMT, type ColumnSpec } from './lib/xlsx'

export const CUSTOMER_COLUMNS: ColumnSpec[] = [
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Company', key: 'company', width: 22 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'Phone', key: 'phone', width: 16 },
  { header: 'Loyalty Enabled', key: 'loyaltyEnabled', width: 16, align: 'center' },
  { header: 'Loads Since Reward', key: 'paidLoadsSinceLastReward', width: 18, numFmt: INTEGER_FMT, align: 'center' },
  { header: 'Reward Eligible', key: 'rewardEligible', width: 16, align: 'center' },
  { header: 'Last Transaction', key: 'lastTransactionDate', width: 16, numFmt: DATE_FMT },
  { header: 'Last Amount', key: 'lastTransactionAmount', width: 14, numFmt: CURRENCY_FMT, align: 'right' },
  { header: 'Status', key: 'status', width: 12 },
]

/** Styled Customers workbook. */
export function buildCustomersWorkbook(
  customers: CustomerSummary[],
  columnKeys?: string[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const rows = customers.map((c) => ({
    name: c.name,
    company: c.company,
    email: c.email,
    phone: c.phone,
    loyaltyEnabled: c.isLoyaltyEnabled ? 'Yes' : 'No',
    paidLoadsSinceLastReward: c.paidLoadsSinceLastReward,
    rewardEligible: c.isEligibleForReward ? 'Yes' : 'No',
    lastTransactionDate: c.lastTransactionDate ? new Date(`${c.lastTransactionDate}T00:00:00`) : '',
    lastTransactionAmount: c.lastTransactionAmount ?? '',
    status: c.isArchived ? 'Archived' : 'Active',
  }))

  addStyledSheet(workbook, 'Customers', CUSTOMER_COLUMNS, rows, columnKeys)
  return workbook
}
