// ─── Shared date range ───────────────────────────────────────────────────────

export type AssistantDateRange = {
  from: string // yyyy-MM-dd
  to: string
}

// ─── Query intents (Phase 1 – read-only) ─────────────────────────────────────

export type SalesQueryIntent = {
  kind: 'query'
  category: 'sales'
  subtype:
    | 'total'
    | 'by_customer'
    | 'by_item'
    | 'top_selling'
    | 'recent'
    | 'average_daily'
  dateRange: AssistantDateRange | null
  customerName: string | null
  itemName: string | null
}

export type ExpenseQueryIntent = {
  kind: 'query'
  category: 'expense'
  subtype: 'total' | 'by_category' | 'operating' | 'largest' | 'recent'
  dateRange: AssistantDateRange | null
  categoryName: string | null
}

export type CustomerQueryIntent = {
  kind: 'query'
  category: 'customer'
  subtype: 'recent' | 'top' | 'frequent' | 'purchase_history' | 'list'
  dateRange: AssistantDateRange | null
  customerName: string | null
}

export type InventoryQueryIntent = {
  kind: 'query'
  category: 'inventory'
  subtype: 'low_stock' | 'current_stock' | 'fast_moving' | 'most_sold' | 'movement_history' | 'list'
  dateRange: AssistantDateRange | null
  itemName: string | null
}

export type StaffQueryIntent = {
  kind: 'query'
  category: 'staff'
  subtype: 'present' | 'absent' | 'attendance_summary' | 'daily_rate' | 'list'
  dateRange: AssistantDateRange | null
  staffName: string | null
}

export type PayrollQueryIntent = {
  kind: 'query'
  category: 'payroll'
  subtype: 'summary' | 'by_employee' | 'overtime' | 'deductions' | 'history'
  dateRange: AssistantDateRange | null
  staffName: string | null
}

export type QueryIntent =
  | SalesQueryIntent
  | ExpenseQueryIntent
  | CustomerQueryIntent
  | InventoryQueryIntent
  | StaffQueryIntent
  | PayrollQueryIntent

// ─── Create intents (Phase 2 – record creation) ───────────────────────────────

export type CreateCustomerIntent = {
  kind: 'create'
  entity: 'customer'
  fields: {
    name: string
    phone: string
    email: string
    company: string
  }
}

export type CreateInventoryIntent = {
  kind: 'create'
  entity: 'inventory'
  fields: {
    name: string
    category: string
    unitType: string
    unitLabel: string
    costPerUnit: number | null
    sellingPrice: number | null
    initialStock: number | null
    lowStockThreshold: number | null
    supplier: string
    description: string
  }
}

export type SaleLineItem = {
  itemName: string
  quantity: number
}

export type CreateSaleIntent = {
  kind: 'create'
  entity: 'sale'
  fields: {
    customerName: string
    items: SaleLineItem[]
    amount: number | null
    date: string | null
    description: string
    categoryName: string
  }
}

export type CreateExpenseIntent = {
  kind: 'create'
  entity: 'expense'
  fields: {
    amount: number | null
    categoryName: string
    description: string
    date: string | null
  }
}

export type CreateStaffIntent = {
  kind: 'create'
  entity: 'staff'
  fields: {
    firstName: string
    middleName: string
    lastName: string
    defaultRate: number | null
    civilStatus: string
    birthdate: string
    address: string
    emergencyContactName: string
    emergencyContactNumber: string
  }
}

export type CreateAttendanceIntent = {
  kind: 'create'
  entity: 'attendance'
  fields: {
    staffName: string
    date: string | null
    status: 'present' | 'absent' | 'half' | 'overtime' | 'holiday'
    multiplier: number | null
    rateOverride: number | null
    notes: string
  }
}

export type CreateIntent =
  | CreateCustomerIntent
  | CreateInventoryIntent
  | CreateSaleIntent
  | CreateExpenseIntent
  | CreateStaffIntent
  | CreateAttendanceIntent

// ─── Top-level intent union ───────────────────────────────────────────────────

export type UnknownIntent = {
  kind: 'unknown'
  raw: string
}

export type AssistantIntent = QueryIntent | CreateIntent | UnknownIntent

// ─── Message types ────────────────────────────────────────────────────────────

export type AssistantMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: Date
  preview?: CreatePreview
  parserUsed?: 'cloud' | 'local'
}

// ─── Preview / confirmation (Phase 2) ────────────────────────────────────────

export type ValidationIssue = {
  field: string
  message: string
  severity: 'error' | 'warning'
}

export type CreatePreview =
  | CustomerPreview
  | InventoryPreview
  | SalePreview
  | ExpensePreview
  | StaffPreview
  | AttendancePreview

export type CustomerPreview = {
  type: 'customer'
  draft: {
    name: string
    phone: string
    email: string
    company: string
  }
  issues: ValidationIssue[]
  duplicate: boolean
}

export type InventoryPreview = {
  type: 'inventory'
  draft: {
    name: string
    category: string
    unitLabel: string
    costPerUnit: number
    sellingPrice: number
    initialStock: number
    lowStockThreshold: number
    supplier: string
  }
  issues: ValidationIssue[]
  duplicate: boolean
}

export type SalePreviewLine = {
  itemName: string
  itemId: number
  quantity: number
  unitPrice: number
  currentStock: number
  stockSufficient: boolean
}

export type SalePreview = {
  type: 'sale'
  draft: {
    customerName: string
    customerId: number | null
    categoryId: number
    categoryName: string
    transactionTypeId: number
    amount: number
    date: string
    description: string
    items: SalePreviewLine[]
  }
  issues: ValidationIssue[]
}

export type ExpensePreview = {
  type: 'expense'
  draft: {
    amount: number
    categoryId: number
    categoryName: string
    transactionTypeId: number
    date: string
    description: string
  }
  issues: ValidationIssue[]
}

export type StaffPreview = {
  type: 'staff'
  draft: {
    firstName: string
    middleName: string
    lastName: string
    defaultRate: number
    civilStatus: string
    birthdate: string
    address: string
    emergencyContactName: string
    emergencyContactNumber: string
  }
  issues: ValidationIssue[]
  duplicate: boolean
}

export type AttendancePreview = {
  type: 'attendance'
  draft: {
    staffId: number
    staffName: string
    date: string
    status: string
    multiplier: number
    rateOverride: number | null
    notes: string
    computedPay: number
  }
  issues: ValidationIssue[]
  existingRecord: boolean
}
