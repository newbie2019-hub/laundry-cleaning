import ExcelJS from 'exceljs'
import type {
  InventoryItem,
  InventoryMovement,
  MaintenanceRecord,
  PurchaseOrder,
  Supplier,
} from '../../lib/db/repository'
import { addStyledSheet, CURRENCY_FMT, DATE_FMT, type ColumnSpec } from './lib/xlsx'

export const INVENTORY_ITEM_COLUMNS: ColumnSpec[] = [
  { header: 'Name', key: 'name', width: 28 },
  { header: 'Category', key: 'categoryLabel', width: 20 },
  { header: 'Unit', key: 'unitLabel', width: 12 },
  { header: 'Current Stock', key: 'currentStock', width: 14, align: 'right' },
  { header: 'Low Stock Threshold', key: 'lowStockThreshold', width: 18, align: 'right' },
  { header: 'Cost / Unit', key: 'costPerUnit', width: 14, numFmt: CURRENCY_FMT, align: 'right' },
  { header: 'Selling Price', key: 'sellingPrice', width: 14, numFmt: CURRENCY_FMT, align: 'right' },
  { header: 'Stock Value', key: 'stockValue', width: 14, numFmt: CURRENCY_FMT, align: 'right' },
  { header: 'Supplier', key: 'supplier', width: 22 },
  { header: 'Status', key: 'status', width: 14 },
]

/** Styled Inventory items workbook. */
export function buildInventoryItemsWorkbook(
  items: InventoryItem[],
  columnKeys?: string[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const rows = items.map((i) => ({
    name: i.name,
    categoryLabel: i.categoryLabel,
    unitLabel: i.unitLabel,
    currentStock: i.currentStock,
    lowStockThreshold: i.lowStockThreshold,
    costPerUnit: i.costPerUnit,
    sellingPrice: i.sellingPrice,
    stockValue: i.stockValue,
    supplier: i.supplier,
    status: i.isActive ? i.status || 'Active' : 'Inactive',
  }))

  addStyledSheet(workbook, 'Inventory Items', INVENTORY_ITEM_COLUMNS, rows, columnKeys)
  return workbook
}

export const INVENTORY_MOVEMENT_COLUMNS: ColumnSpec[] = [
  { header: 'Date', key: 'movementDate', width: 14, numFmt: DATE_FMT },
  { header: 'Item', key: 'itemName', width: 28 },
  { header: 'Type', key: 'movementType', width: 10, align: 'center' },
  { header: 'Quantity', key: 'quantity', width: 12, align: 'right' },
  { header: 'Unit', key: 'unitLabel', width: 12 },
  { header: 'Unit Cost', key: 'unitCost', width: 14, numFmt: CURRENCY_FMT, align: 'right' },
  { header: 'Total Cost', key: 'totalCost', width: 14, numFmt: CURRENCY_FMT, align: 'right' },
  { header: 'Recorded By', key: 'createdByName', width: 20 },
  { header: 'Notes', key: 'notes', width: 30 },
]

/** Styled Inventory movements workbook. */
export function buildInventoryMovementsWorkbook(
  movements: InventoryMovement[],
  columnKeys?: string[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const rows = movements.map((m) => ({
    movementDate: new Date(`${m.movementDate}T00:00:00`),
    itemName: m.itemName,
    movementType: m.movementType,
    quantity: m.quantity,
    unitLabel: m.unitLabel,
    unitCost: m.unitCost,
    totalCost: m.unitCost * m.quantity,
    createdByName: m.createdByName ?? '',
    notes: m.notes,
  }))

  addStyledSheet(workbook, 'Inventory Movements', INVENTORY_MOVEMENT_COLUMNS, rows, columnKeys)
  return workbook
}

export const MAINTENANCE_COLUMNS: ColumnSpec[] = [
  { header: 'Service Date', key: 'serviceDate', width: 14, numFmt: DATE_FMT },
  { header: 'Item', key: 'itemName', width: 28 },
  { header: 'Service Type', key: 'serviceType', width: 20 },
  { header: 'Description', key: 'description', width: 36 },
  { header: 'Performed By', key: 'performedBy', width: 20 },
  { header: 'Cost', key: 'cost', width: 14, numFmt: CURRENCY_FMT, align: 'right' },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Next Service', key: 'nextServiceDate', width: 14 },
]

/** Styled Maintenance records workbook. */
export function buildMaintenanceWorkbook(
  records: MaintenanceRecord[],
  columnKeys?: string[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const rows = records.map((r) => ({
    serviceDate: r.serviceDate ? new Date(`${r.serviceDate}T00:00:00`) : '',
    itemName: r.itemName,
    serviceType: r.serviceType,
    description: r.description,
    performedBy: r.performedBy,
    cost: r.cost,
    status: r.status,
    nextServiceDate: r.nextServiceDate ?? '',
  }))

  addStyledSheet(workbook, 'Maintenance', MAINTENANCE_COLUMNS, rows, columnKeys)
  return workbook
}

export const SUPPLIER_COLUMNS: ColumnSpec[] = [
  { header: 'Name', key: 'name', width: 28 },
  { header: 'Contact', key: 'contactName', width: 22 },
  { header: 'Phone', key: 'phone', width: 18 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'Items', key: 'itemCount', width: 10, align: 'right' },
  { header: 'Open POs', key: 'openPoCount', width: 12, align: 'right' },
  { header: 'Status', key: 'status', width: 12 },
]

/** Styled Suppliers workbook. */
export function buildSuppliersWorkbook(
  suppliers: Supplier[],
  columnKeys?: string[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const rows = suppliers.map((s) => ({
    name: s.name,
    contactName: s.contactName,
    phone: s.phone,
    email: s.email,
    itemCount: s.itemCount,
    openPoCount: s.openPoCount,
    status: s.isActive ? 'Active' : 'Inactive',
  }))

  addStyledSheet(workbook, 'Suppliers', SUPPLIER_COLUMNS, rows, columnKeys)
  return workbook
}

export const PURCHASE_ORDER_COLUMNS: ColumnSpec[] = [
  { header: 'Reference', key: 'reference', width: 20 },
  { header: 'Supplier', key: 'supplierName', width: 26 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Lines', key: 'lineCount', width: 8, align: 'right' },
  { header: 'Total Cost', key: 'totalCost', width: 14, numFmt: CURRENCY_FMT, align: 'right' },
  { header: 'Order Date', key: 'orderDate', width: 14 },
  { header: 'Expected Date', key: 'expectedDate', width: 14 },
  { header: 'Received Date', key: 'receivedDate', width: 14 },
  { header: 'Created By', key: 'createdByName', width: 20 },
]

/** Styled Purchase Orders workbook (header rows only). */
export function buildPurchaseOrdersWorkbook(
  orders: PurchaseOrder[],
  columnKeys?: string[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const rows = orders.map((p) => ({
    reference: p.reference || `PO #${p.id}`,
    supplierName: p.supplierName ?? '',
    status: p.status,
    lineCount: p.lineCount,
    totalCost: p.totalCost,
    orderDate: p.orderDate,
    expectedDate: p.expectedDate,
    receivedDate: p.receivedDate,
    createdByName: p.createdByName ?? '',
  }))

  addStyledSheet(workbook, 'Purchase Orders', PURCHASE_ORDER_COLUMNS, rows, columnKeys)
  return workbook
}
