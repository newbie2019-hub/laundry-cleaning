import ExcelJS from 'exceljs'
import type {
  AttendanceDaySummary,
  PayrollPayDateSummary,
  Staff,
} from '../../lib/db/repository'
import { addStyledSheet, CURRENCY_FMT, DATE_FMT, INTEGER_FMT, type ColumnSpec } from './lib/xlsx'

export const STAFF_COLUMNS: ColumnSpec[] = [
  { header: 'Name', key: 'displayName', width: 24 },
  { header: 'First Name', key: 'firstName', width: 16 },
  { header: 'Middle Name', key: 'middleName', width: 16 },
  { header: 'Last Name', key: 'lastName', width: 16 },
  { header: 'Birthdate', key: 'birthdate', width: 14 },
  { header: 'Civil Status', key: 'civilStatus', width: 14 },
  { header: 'Address', key: 'address', width: 32 },
  { header: 'Spouse Name', key: 'spouseName', width: 20 },
  { header: 'Emergency Contact', key: 'emergencyContactName', width: 22 },
  { header: 'Emergency Number', key: 'emergencyContactNumber', width: 18 },
  { header: 'Default Rate', key: 'defaultRate', width: 14, numFmt: CURRENCY_FMT, align: 'right' },
  { header: 'Last Payroll Date', key: 'lastPayrollDate', width: 16 },
  { header: 'Status', key: 'status', width: 12 },
]

/** Styled Staff directory workbook. */
export function buildStaffWorkbook(staff: Staff[], columnKeys?: string[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const rows = staff.map((s) => ({
    displayName: s.displayName,
    firstName: s.firstName,
    middleName: s.middleName,
    lastName: s.lastName,
    birthdate: s.birthdate,
    civilStatus: s.civilStatus,
    address: s.address,
    spouseName: s.spouseName,
    emergencyContactName: s.emergencyContactName,
    emergencyContactNumber: s.emergencyContactNumber,
    defaultRate: s.defaultRate,
    lastPayrollDate: s.lastPayrollDate ?? '',
    status: s.isArchived ? 'Archived' : 'Active',
  }))

  addStyledSheet(workbook, 'Staff', STAFF_COLUMNS, rows, columnKeys)
  return workbook
}

export const ATTENDANCE_COLUMNS: ColumnSpec[] = [
  { header: 'Date', key: 'date', width: 14, numFmt: DATE_FMT },
  { header: 'Present', key: 'presentCount', width: 12, numFmt: INTEGER_FMT, align: 'center' },
  { header: 'Half Day', key: 'halfCount', width: 12, numFmt: INTEGER_FMT, align: 'center' },
  { header: 'Overtime', key: 'overtimeCount', width: 12, numFmt: INTEGER_FMT, align: 'center' },
  { header: 'Holiday', key: 'holidayCount', width: 12, numFmt: INTEGER_FMT, align: 'center' },
  { header: 'Absent', key: 'absentCount', width: 12, numFmt: INTEGER_FMT, align: 'center' },
  { header: 'Total Staff', key: 'totalCount', width: 12, numFmt: INTEGER_FMT, align: 'center' },
  { header: 'Total Pay', key: 'totalPay', width: 16, numFmt: CURRENCY_FMT, align: 'right' },
]

/** Styled Attendance day-summary workbook. */
export function buildAttendanceWorkbook(
  summaries: AttendanceDaySummary[],
  columnKeys?: string[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const rows = summaries.map((d) => ({
    date: new Date(`${d.date}T00:00:00`),
    presentCount: d.presentCount,
    halfCount: d.halfCount,
    overtimeCount: d.overtimeCount,
    holidayCount: d.holidayCount,
    absentCount: d.absentCount,
    totalCount: d.totalCount,
    totalPay: d.totalPay,
  }))

  addStyledSheet(workbook, 'Attendance', ATTENDANCE_COLUMNS, rows, columnKeys)
  return workbook
}

export const PAYROLL_COLUMNS: ColumnSpec[] = [
  { header: 'Pay Date', key: 'payDate', width: 14, numFmt: DATE_FMT },
  { header: 'Staff Count', key: 'count', width: 14, numFmt: INTEGER_FMT, align: 'center' },
  { header: 'Total Gross', key: 'totalGross', width: 16, numFmt: CURRENCY_FMT, align: 'right' },
  { header: 'Total Net', key: 'totalNet', width: 16, numFmt: CURRENCY_FMT, align: 'right' },
]

/** Styled Payroll pay-date summary workbook. */
export function buildPayrollWorkbook(
  summaries: PayrollPayDateSummary[],
  columnKeys?: string[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const rows = summaries.map((p) => ({
    payDate: new Date(`${p.payDate}T00:00:00`),
    count: p.count,
    totalGross: p.totalGross,
    totalNet: p.totalNet,
  }))

  addStyledSheet(workbook, 'Payroll', PAYROLL_COLUMNS, rows, columnKeys)
  return workbook
}
