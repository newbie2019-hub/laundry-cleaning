import { format } from 'date-fns'
import ExcelJS from 'exceljs'
import { toast } from 'sonner'
import { getActiveBusiness } from '../../../lib/db/business'
import {
  getDashboardData,
  listAttendanceDaySummaries,
  listCustomerSummaries,
  listIncidentReports,
  listInventoryItems,
  listInventoryMovements,
  listMaintenanceRecords,
  listPayrollPayDateSummaries,
  listPurchaseOrders,
  listStaff,
  listSuppliers,
  listTransactions,
} from '../../../lib/db/repository'
import { buildCustomersWorkbook, CUSTOMER_COLUMNS } from '../customer-exports'
import {
  buildIncidentReportsWorkbook,
  buildMonthlySummaryWorkbook,
  buildTransactionsWorkbook,
  getTransactionColumns,
  INCIDENT_COLUMNS,
} from '../export-service'
import {
  buildInventoryItemsWorkbook,
  buildInventoryMovementsWorkbook,
  buildMaintenanceWorkbook,
  buildPurchaseOrdersWorkbook,
  buildSuppliersWorkbook,
  INVENTORY_ITEM_COLUMNS,
  INVENTORY_MOVEMENT_COLUMNS,
  MAINTENANCE_COLUMNS,
  PURCHASE_ORDER_COLUMNS,
  SUPPLIER_COLUMNS,
} from '../inventory-exports'
import {
  ATTENDANCE_COLUMNS,
  buildAttendanceWorkbook,
  buildPayrollWorkbook,
  buildStaffWorkbook,
  PAYROLL_COLUMNS,
  STAFF_COLUMNS,
} from '../staff-exports'
import { saveWorkbookWithDialog, type ColumnSpec } from './xlsx'

export type FilterKind = 'dateRange' | 'month' | 'includeArchived'

export type ExportGroup = 'Financial' | 'Staff' | 'Inventory' | 'Other'

export interface ExportFilters {
  dateFrom?: string
  dateTo?: string
  monthKey?: string
  includeArchived?: boolean
}

export interface ExportDescriptor {
  key: string
  label: string
  description: string
  group: ExportGroup
  filter: FilterKind
  /**
   * Available columns for this dataset, used to render the column picker. Omitted
   * for non-tabular exports (e.g. the income statement) which are not selectable.
   * A function so business-dependent columns are resolved at render time.
   */
  columns?: () => ColumnSpec[]
  /** Fetches data, builds the styled workbook, and saves it via the Save As dialog. */
  run: (filters: ExportFilters, columnKeys?: string[]) => Promise<void>
}

/** Suffix describing the applied filter, used to build the default filename. */
function filterSlug(filter: FilterKind, filters: ExportFilters): string {
  if (filter === 'month') return filters.monthKey ?? 'all'
  if (filter === 'dateRange') {
    if (filters.dateFrom && filters.dateTo) return `${filters.dateFrom}_to_${filters.dateTo}`
    if (filters.dateFrom) return `from_${filters.dateFrom}`
    if (filters.dateTo) return `to_${filters.dateTo}`
    return 'all'
  }
  return filters.includeArchived ? 'all' : 'active'
}

function defaultFilename(key: string, filter: FilterKind, filters: ExportFilters): string {
  const business = getActiveBusiness().shortName.toLowerCase()
  const today = format(new Date(), 'yyyy-MM-dd')
  return `${business}-${key}-${filterSlug(filter, filters)}-${today}.xlsx`
}

/**
 * Runs a dataset export: skips (with a warning) when there are no rows, otherwise
 * saves the workbook through the native Save As dialog.
 */
async function finish(
  key: string,
  filter: FilterKind,
  filters: ExportFilters,
  rowCount: number,
  workbook: ExcelJS.Workbook,
) {
  if (rowCount === 0) {
    toast.warning('No records match the selected filter.')
    return
  }
  await saveWorkbookWithDialog(workbook, defaultFilename(key, filter, filters))
}

export const EXPORT_DESCRIPTORS: ExportDescriptor[] = [
  {
    key: 'transactions',
    label: 'Transactions',
    description: 'Ledger sales, expenses and operating expenses.',
    group: 'Financial',
    filter: 'dateRange',
    columns: getTransactionColumns,
    run: async (filters, columnKeys) => {
      const rows = await listTransactions({ dateFrom: filters.dateFrom, dateTo: filters.dateTo })
      await finish('transactions', 'dateRange', filters, rows.length, buildTransactionsWorkbook(rows, columnKeys))
    },
  },
  {
    key: 'financial-summary',
    label: 'Income Statement',
    description: 'Formatted income statement with income-share and category detail.',
    group: 'Financial',
    filter: 'month',
    run: async (filters) => {
      const monthKey = filters.monthKey ?? format(new Date(), 'yyyy-MM')
      const dashboard = await getDashboardData(monthKey)
      await finish('income-statement', 'month', filters, 1, buildMonthlySummaryWorkbook(dashboard))
    },
  },
  {
    key: 'staff',
    label: 'Staff Directory',
    description: 'Staff records, contact details and default rates.',
    group: 'Staff',
    filter: 'includeArchived',
    columns: () => STAFF_COLUMNS,
    run: async (filters, columnKeys) => {
      const rows = await listStaff({ includeArchived: filters.includeArchived })
      await finish('staff', 'includeArchived', filters, rows.length, buildStaffWorkbook(rows, columnKeys))
    },
  },
  {
    key: 'attendance',
    label: 'Attendance',
    description: 'Daily attendance summary and computed pay.',
    group: 'Staff',
    filter: 'dateRange',
    columns: () => ATTENDANCE_COLUMNS,
    run: async (filters, columnKeys) => {
      if (!filters.dateFrom || !filters.dateTo) {
        toast.warning('Please choose a date range.')
        return
      }
      const rows = await listAttendanceDaySummaries(filters.dateFrom, filters.dateTo)
      await finish('attendance', 'dateRange', filters, rows.length, buildAttendanceWorkbook(rows, columnKeys))
    },
  },
  {
    key: 'payroll',
    label: 'Payroll',
    description: 'Payroll runs summarised by pay date.',
    group: 'Staff',
    filter: 'dateRange',
    columns: () => PAYROLL_COLUMNS,
    run: async (filters, columnKeys) => {
      if (!filters.dateFrom || !filters.dateTo) {
        toast.warning('Please choose a date range.')
        return
      }
      const rows = await listPayrollPayDateSummaries(filters.dateFrom, filters.dateTo)
      await finish('payroll', 'dateRange', filters, rows.length, buildPayrollWorkbook(rows, columnKeys))
    },
  },
  {
    key: 'inventory-items',
    label: 'Inventory Items',
    description: 'Item catalogue with stock levels, cost and value.',
    group: 'Inventory',
    filter: 'includeArchived',
    columns: () => INVENTORY_ITEM_COLUMNS,
    run: async (filters, columnKeys) => {
      const rows = await listInventoryItems({ includeInactive: filters.includeArchived })
      await finish('inventory-items', 'includeArchived', filters, rows.length, buildInventoryItemsWorkbook(rows, columnKeys))
    },
  },
  {
    key: 'inventory-movements',
    label: 'Inventory Movements',
    description: 'Stock in/out movements with unit and total cost.',
    group: 'Inventory',
    filter: 'dateRange',
    columns: () => INVENTORY_MOVEMENT_COLUMNS,
    run: async (filters, columnKeys) => {
      const rows = await listInventoryMovements({ dateFrom: filters.dateFrom, dateTo: filters.dateTo })
      await finish('inventory-movements', 'dateRange', filters, rows.length, buildInventoryMovementsWorkbook(rows, columnKeys))
    },
  },
  {
    key: 'maintenance',
    label: 'Maintenance Records',
    description: 'Equipment maintenance and servicing history.',
    group: 'Inventory',
    filter: 'dateRange',
    columns: () => MAINTENANCE_COLUMNS,
    run: async (filters, columnKeys) => {
      const all = await listMaintenanceRecords()
      const rows = all.filter((r) => {
        if (!r.serviceDate) return false
        if (filters.dateFrom && r.serviceDate < filters.dateFrom) return false
        if (filters.dateTo && r.serviceDate > filters.dateTo) return false
        return true
      })
      await finish('maintenance', 'dateRange', filters, rows.length, buildMaintenanceWorkbook(rows, columnKeys))
    },
  },
  {
    key: 'suppliers',
    label: 'Suppliers',
    description: 'Supplier directory with item and open-PO counts.',
    group: 'Inventory',
    filter: 'includeArchived',
    columns: () => SUPPLIER_COLUMNS,
    run: async (filters, columnKeys) => {
      const rows = await listSuppliers(filters.includeArchived)
      await finish('suppliers', 'includeArchived', filters, rows.length, buildSuppliersWorkbook(rows, columnKeys))
    },
  },
  {
    key: 'purchase-orders',
    label: 'Purchase Orders',
    description: 'Purchase orders with supplier, status, totals and dates.',
    group: 'Inventory',
    filter: 'includeArchived',
    columns: () => PURCHASE_ORDER_COLUMNS,
    run: async (filters, columnKeys) => {
      const all = await listPurchaseOrders()
      // includeArchived shows closed POs (received/cancelled) too; otherwise only open ones.
      const rows = filters.includeArchived
        ? all
        : all.filter((p) => p.status === 'draft' || p.status === 'ordered')
      await finish('purchase-orders', 'includeArchived', filters, rows.length, buildPurchaseOrdersWorkbook(rows, columnKeys))
    },
  },
  {
    key: 'incident-reports',
    label: 'Incident Reports',
    description: 'Logged incidents, actions taken and estimated loss.',
    group: 'Other',
    filter: 'dateRange',
    columns: () => INCIDENT_COLUMNS,
    run: async (filters, columnKeys) => {
      const rows = await listIncidentReports({ dateFrom: filters.dateFrom, dateTo: filters.dateTo })
      await finish('incident-reports', 'dateRange', filters, rows.length, buildIncidentReportsWorkbook(rows, columnKeys))
    },
  },
  {
    key: 'customers',
    label: 'Customers',
    description: 'Customer directory with loyalty status.',
    group: 'Other',
    filter: 'includeArchived',
    columns: () => CUSTOMER_COLUMNS,
    run: async (filters, columnKeys) => {
      const rows = await listCustomerSummaries({ includeArchived: filters.includeArchived })
      await finish('customers', 'includeArchived', filters, rows.length, buildCustomersWorkbook(rows, columnKeys))
    },
  },
]

export const EXPORT_GROUPS: ExportGroup[] = ['Financial', 'Staff', 'Inventory', 'Other']
