import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { endOfMonth, format, subDays } from 'date-fns'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Banknote,
  Building2,
  CreditCard,
  Download,
  Minus,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  TrendingDown,
  TrendingUp,
  WalletCards,
  X,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exportFilteredTransactions } from '../../exports/export-service'
import { MonthPicker } from '../../../components/month-picker'
import { formatCurrency, formatDateTime } from '../../../lib/format'
import {
  deleteTransaction,
  getCashAdvanceByTransactionId,
  getCustomerLoyaltyStatus,
  getLoyaltySettings,
  listAvailableMonthKeys,
  listCategories,
  listCustomers,
  listInventoryItems,
  listInventoryMovementsByTransaction,
  listStaff,
  listTransactionLineItems,
  listTransactionTemplates,
  listTransactionTypes,
  listTransactions,
  saveTransaction,
  type Category,
  type Customer,
  type CustomerLoyaltyStatus,
  type InventoryItem,
  type LedgerTransaction,
  type LoyaltySettings,
  type Staff,
  type TransactionTemplateSummary,
  type TransactionType,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

type DaySummary = {
  netIncome: number
  totalExpenses: number
  totalOperating: number
  totalSales: number
}

type LoadState = {
  categories: Category[]
  customers: Customer[]
  loyaltySettings: LoyaltySettings
  months: string[]
  previousDaySummary: DaySummary | null
  staff: Staff[]
  transactions: LedgerTransaction[]
  transactionTypes: TransactionType[]
}

const emptyState: LoadState = {
  categories: [],
  customers: [],
  loyaltySettings: { freeAfterLoads: 9, kgPerLoad: 8 },
  months: [],
  previousDaySummary: null,
  staff: [],
  transactions: [],
  transactionTypes: [],
}

const TX_TABLE_GRID_WITH_LOADS =
  'sm:grid sm:grid-cols-[150px_120px_140px_72px_minmax(0,120px)_minmax(0,1fr)_96px_128px_80px] sm:items-center sm:gap-3'
const TX_TABLE_GRID_NO_LOADS =
  'sm:grid sm:grid-cols-[150px_120px_140px_minmax(0,120px)_minmax(0,1fr)_96px_128px_80px] sm:items-center sm:gap-3'

function formatLoadsCell(transaction: LedgerTransaction) {
  if (transaction.isLoyaltyReward) {
    return (
      <span className="inline-flex rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
        Free
      </span>
    )
  }
  if (transaction.loads == null) return '—'
  const kgPart = transaction.kg != null ? ` (${transaction.kg} kg)` : ''
  return (
    <span className="tabular-nums text-xs">
      {transaction.loads}
      {kgPart ? <span className="text-[var(--muted)]">{kgPart}</span> : null}
    </span>
  )
}

function kpiDelta(current: number, previous: number | undefined) {
  if (previous === undefined || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

const TYPE_COLORS: Record<string, string> = {
  SALE: 'bg-emerald-500/15 text-emerald-500',
  EXPENSE: 'bg-red-500/15 text-red-500',
  'OPERATING EXPENSE': 'bg-amber-500/15 text-amber-600',
}

function typeBadgeClass(code: string) {
  return [
    'inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap',
    TYPE_COLORS[code] ?? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]',
  ].join(' ')
}

function formatTransactionDisplayDate(entryDate: string) {
  return format(new Date(`${entryDate}T00:00:00`), 'MMM d, yyyy')
}

type TableSortKey = 'amount' | 'category' | 'customer' | 'date' | 'loads' | 'staff' | 'type'

function compareTransactionsForSort(
  a: LedgerTransaction,
  b: LedgerTransaction,
  key: TableSortKey,
  dir: 'asc' | 'desc',
): number {
  const sign = dir === 'asc' ? 1 : -1
  let cmp = 0
  switch (key) {
    case 'date': {
      const aKey = a.createdAt || a.entryDate
      const bKey = b.createdAt || b.entryDate
      cmp = aKey.localeCompare(bKey)
      break
    }
    case 'type':
      cmp = a.transactionTypeCode.localeCompare(b.transactionTypeCode)
      break
    case 'category':
      cmp = a.categoryLabel.localeCompare(b.categoryLabel, undefined, { sensitivity: 'base' })
      break
    case 'customer':
      cmp = (a.customerName ?? '').localeCompare(b.customerName ?? '', undefined, {
        sensitivity: 'base',
      })
      break
    case 'staff': {
      const av = a.staffCount ?? -1
      const bv = b.staffCount ?? -1
      cmp = av - bv
      break
    }
    case 'amount':
      cmp = a.amount - b.amount
      break
    case 'loads': {
      const av = a.loads ?? -1
      const bv = b.loads ?? -1
      cmp = av - bv
      break
    }
    default:
      break
  }
  if (cmp !== 0) return sign * cmp
  return b.id - a.id
}

function SortableColumnHeader({
  activeKey,
  align = 'left',
  dir,
  label,
  onSort,
  sortKey,
}: {
  activeKey: TableSortKey
  align?: 'center' | 'left' | 'right'
  dir: 'asc' | 'desc'
  label: string
  onSort: (key: TableSortKey) => void
  sortKey: TableSortKey
}) {
  const isActive = activeKey === sortKey
  const justify =
    align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end text-right' : 'justify-start text-left'
  const Icon = isActive ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <button
      aria-label={`Sort by ${label}${isActive ? `, ${dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
      className={`group flex w-full min-w-0 items-center gap-0.5 rounded px-0.5 py-0.5 -mx-0.5 transition hover:bg-[var(--background)] hover:text-[var(--foreground)] ${justify}`}
      onClick={() => onSort(sortKey)}
      type="button"
    >
      <span className="truncate">{label}</span>
      <Icon
        aria-hidden
        className={`h-3 w-3 shrink-0 ${isActive ? 'text-[var(--accent-strong)]' : 'text-[var(--muted)] opacity-50 group-hover:opacity-80'}`}
      />
    </button>
  )
}


function ModalField({
  label,
  required,
  children,
  help,
}: {
  label: string
  required?: boolean
  children: ReactNode
  help?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {help ? <p className="text-[11px] text-gray-500">{help}</p> : null}
    </div>
  )
}


const modalInputClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition placeholder:text-gray-400'

const modalSelectClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition'

// Inventory unit types that are intrinsically fractional (e.g. 1.5 kg, 0.25 L).
// Other unit types still allow decimals — the only difference is whether the
// browser stepper buttons increment by 0.01 or by 1.
const MEASURABLE_UNIT_TYPES = new Set(['liquid', 'weight', 'length'])

function lineItemQtyInputProps(unitType: string | undefined) {
  const measurable = unitType ? MEASURABLE_UNIT_TYPES.has(unitType) : false
  // `step="any"` lets the user type any decimal (no browser validation error)
  // while keeping the up/down arrow keys at sensible whole-number increments
  // for piece-style units. Measurable units get fine 0.01 steps.
  return measurable
    ? { step: '0.01', min: '0.01' }
    : { step: 'any', min: '0.01' }
}

type FilterPeriodMode = 'dateRange' | 'month'

export function TransactionsPage() {
  const { activeBusiness, hasPermission, user } = useAuth()
  const isCleaningBusiness = activeBusiness === 'cleaning'
  const TX_TABLE_GRID = isCleaningBusiness ? TX_TABLE_GRID_NO_LOADS : TX_TABLE_GRID_WITH_LOADS
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const customerPrefillConsumed = useRef<string | null>(null)
  const currentMonthKey = format(new Date(), 'yyyy-MM')
  const [filterPeriodMode, setFilterPeriodMode] = useState<FilterPeriodMode>('dateRange')
  const [filterMonthKey, setFilterMonthKey] = useState(currentMonthKey)
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterTypeId, setFilterTypeId] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [filterCustomerId, setFilterCustomerId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [draftPeriodMode, setDraftPeriodMode] = useState<FilterPeriodMode>('dateRange')
  const [draftMonthKey, setDraftMonthKey] = useState(currentMonthKey)
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const [draftTypeId, setDraftTypeId] = useState('')
  const [draftCategoryId, setDraftCategoryId] = useState('')
  const [draftCustomerId, setDraftCustomerId] = useState('')
  const [formTransactionId, setFormTransactionId] = useState<number | null>(null)
  const [formEntryDate, setFormEntryDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [formTypeId, setFormTypeId] = useState('')
  const [formCategoryId, setFormCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [staffCount, setStaffCount] = useState('')
  const [formCustomerId, setFormCustomerId] = useState('')
  const [formKg, setFormKg] = useState('')
  const [formLoads, setFormLoads] = useState('')
  const [showKgInput, setShowKgInput] = useState(false)
  const [formRedeemReward, setFormRedeemReward] = useState(false)
  const [formCashAdvanceStaffId, setFormCashAdvanceStaffId] = useState('')
  const [loyaltyStatus, setLoyaltyStatus] = useState<CustomerLoyaltyStatus | null>(null)
  const [state, setState] = useState<LoadState>(emptyState)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>('date')
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc')

  const canCreate = hasPermission('manage_transactions')
  const canEdit = hasPermission('edit_transaction')
  const canDelete = hasPermission('delete_transaction')
  const canExport = hasPermission('export_data')
  const canManageInventory = hasPermission('manage_inventory')

  const templateLoadGenRef = useRef(0)
  const [formTransactionTemplates, setFormTransactionTemplates] = useState<TransactionTemplateSummary[]>([])
  const [formInventoryForTemplates, setFormInventoryForTemplates] = useState<InventoryItem[]>([])
  const [formInventoryOptions, setFormInventoryOptions] = useState<InventoryItem[]>([])
  const [formTemplatePickerId, setFormTemplatePickerId] = useState('')
  const [formLineItems, setFormLineItems] = useState<
    Array<{
      key: string
      inventoryItemId: number | null
      label: string
      quantityStr: string
      /** Per-unit price (line total = qty × unit price). */
      priceStr: string
      /** Empty string = base unit; otherwise the alt unit's label. */
      saleUnitLabel: string
      /** Conversion factor stored on the line (1 = base unit). */
      saleUnitFactor: number
      /** FK to inventory_item_units row, when an alt unit is chosen. */
      saleUnitId: number | null
    }>
  >([])
  const lineItemListId = useId()
  const [formTemplatePreviewLines, setFormTemplatePreviewLines] = useState<
    Array<{
      inventoryItemId: number
      isItemActive: boolean
      itemName: string
      key: string
      lowStockThreshold: number
      missingItem?: boolean
      quantityStr: string
      unitLabel: string
      unitPrice: number
      currentStock: number
      /** Sale-unit snapshot from the template; '' = base unit. */
      saleUnitLabel: string
      saleUnitFactor: number
      saleUnitId: number | null
    }>
  >([])

  const templatesForPicker = useMemo(() => {
    const pick = formTemplatePickerId ? Number(formTemplatePickerId) : Number.NaN
    return formTransactionTemplates.filter((t) => t.isActive || t.id === pick)
  }, [formTransactionTemplates, formTemplatePickerId])

  const filteredCategories = useMemo(
    () =>
      formTypeId
        ? state.categories.filter((category) => String(category.transactionTypeId) === formTypeId)
        : [],
    [formTypeId, state.categories],
  )


  const selectedFormType = state.transactionTypes.find((type) => String(type.id) === formTypeId)
  const isSaleType = selectedFormType?.code === 'SALE'
  const isExpenseType = selectedFormType?.code === 'EXPENSE'
  const showStaffCountField = isSaleType || isExpenseType
  const showCustomerField = isSaleType

  const selectedFormCategory = useMemo(
    () => state.categories.find((c) => String(c.id) === formCategoryId),
    [formCategoryId, state.categories],
  )
  const showLoadFields = Boolean(
    !isCleaningBusiness && isSaleType && selectedFormCategory?.isLoadable,
  )
  const isCashAdvanceCategory = Boolean(
    isExpenseType &&
      selectedFormCategory &&
      selectedFormCategory.label.trim().toLowerCase() === 'cash advance',
  )
  const activeStaffForForm = useMemo(
    () => state.staff.filter((s) => !s.isArchived),
    [state.staff],
  )

  useEffect(() => {
    if (!showCustomerField || !formCustomerId) {
      setLoyaltyStatus(null)
      return
    }
    let cancelled = false
    void getCustomerLoyaltyStatus(Number(formCustomerId)).then((s) => {
      if (!cancelled) setLoyaltyStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [formCustomerId, showCustomerField])

  useEffect(() => {
    const cid = searchParams.get('customerId')
    if (!cid || !/^\d+$/.test(cid)) return
    if (customerPrefillConsumed.current === cid) return
    customerPrefillConsumed.current = cid
    setSearchParams({}, { replace: true })
    setFormCustomerId(cid)
    setFilterCustomerId(cid)
    setIsModalOpen(true)
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!showLoadFields) {
      setFormRedeemReward(false)
      setFormKg('')
      setFormLoads('')
      setShowKgInput(false)
      return
    }
    setFormLoads((prev) => (prev.trim() === '' ? '1' : prev))
  }, [showLoadFields])

  function handleKgChange(value: string) {
    setFormKg(value)
    if (!showLoadFields || formRedeemReward) return
    const k = Number(value)
    if (Number.isFinite(k) && k > 0) {
      const kgPer = state.loyaltySettings.kgPerLoad
      const next = Math.round((k / kgPer) * 100) / 100
      setFormLoads(String(next))
    }
  }

  const periodCountsTowardBadge =
    filterPeriodMode === 'month'
      ? filterMonthKey !== currentMonthKey
      : Boolean(filterDateFrom || filterDateTo)
  const activeFilterCount = [
    periodCountsTowardBadge,
    Boolean(filterTypeId),
    Boolean(filterCategoryId),
    Boolean(filterCustomerId),
  ].filter(Boolean).length

  const draftFilterCategories = useMemo(
    () =>
      draftTypeId
        ? state.categories.filter((c) => String(c.transactionTypeId) === draftTypeId)
        : state.categories,
    [draftTypeId, state.categories],
  )

  const activeCustomersForForm = useMemo(
    () => state.customers.filter((c) => !c.isArchived),
    [state.customers],
  )

  const summary = useMemo(() => {
    let totalSales = 0
    let totalExpenses = 0
    let totalOperating = 0

    for (const t of state.transactions) {
      if (t.transactionTypeCode === 'SALE') totalSales += t.amount
      else if (t.transactionTypeCode === 'EXPENSE') totalExpenses += t.amount
      else if (t.transactionTypeCode === 'OPERATING EXPENSE') totalOperating += t.amount
    }

    return {
      netIncome: totalSales - totalExpenses - totalOperating,
      totalExpenses,
      totalOperating,
      totalSales,
    }
  }, [state.transactions])

  const displayedTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = !q
      ? state.transactions
      : state.transactions.filter(
          (t) =>
            t.description.toLowerCase().includes(q) ||
            t.categoryLabel.toLowerCase().includes(q) ||
            t.transactionTypeCode.toLowerCase().includes(q) ||
            t.entryDate.includes(q) ||
            (t.customerName?.toLowerCase().includes(q) ?? false),
        )
    return [...filtered].sort((a, b) => compareTransactionsForSort(a, b, tableSortKey, tableSortDir))
  }, [state.transactions, searchQuery, tableSortDir, tableSortKey])

  function handleColumnSort(key: TableSortKey) {
    if (key === tableSortKey) {
      setTableSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setTableSortKey(key)
      setTableSortDir(key === 'date' || key === 'amount' || key === 'loads' ? 'desc' : 'asc')
    }
  }

  const loadTransactions = useCallback(async () => {
    const months = await listAvailableMonthKeys()
    const useDateRange = filterPeriodMode === 'dateRange'
    const useMonth = filterPeriodMode === 'month'

    let effectiveMonthKey = filterMonthKey
    if (useMonth && months.length > 0 && !months.includes(effectiveMonthKey)) {
      effectiveMonthKey = months[0]!
    }

    const seedMonthForList =
      filterDateFrom && filterDateFrom.length >= 7 ? filterDateFrom.slice(0, 7) : currentMonthKey
    const monthKeyForStateMerge = useMonth ? effectiveMonthKey : seedMonthForList
    const monthToUse =
      months.length > 0 && !months.includes(monthKeyForStateMerge) ? months[0]! : monthKeyForStateMerge

    const isSingleDay =
      useDateRange && filterDateFrom && filterDateTo && filterDateFrom === filterDateTo

    const [transactionTypes, categories, customers, loyaltySettings, staff, transactions, previousDayTransactions] =
      await Promise.all([
      listTransactionTypes(),
      listCategories(),
      listCustomers({ includeArchived: true }),
      getLoyaltySettings(),
      listStaff({ includeArchived: true }),
      listTransactions({
        categoryId: filterCategoryId ? Number(filterCategoryId) : null,
        customerId: filterCustomerId ? Number(filterCustomerId) : null,
        dateFrom: useDateRange ? (filterDateFrom || undefined) : undefined,
        dateTo: useDateRange ? (filterDateTo || undefined) : undefined,
        monthKey: useMonth ? effectiveMonthKey : undefined,
        transactionTypeId: filterTypeId ? Number(filterTypeId) : null,
      }),
      isSingleDay
        ? listTransactions({
            categoryId: filterCategoryId ? Number(filterCategoryId) : null,
            customerId: filterCustomerId ? Number(filterCustomerId) : null,
            entryDate: format(subDays(new Date(filterDateFrom + 'T00:00:00'), 1), 'yyyy-MM-dd'),
            transactionTypeId: filterTypeId ? Number(filterTypeId) : null,
          })
        : Promise.resolve(null),
    ])

    let previousDaySummary: DaySummary | null = null
    if (previousDayTransactions && previousDayTransactions.length > 0) {
      let totalSales = 0
      let totalExpenses = 0
      let totalOperating = 0
      for (const t of previousDayTransactions) {
        if (t.transactionTypeCode === 'SALE') totalSales += t.amount
        else if (t.transactionTypeCode === 'EXPENSE') totalExpenses += t.amount
        else if (t.transactionTypeCode === 'OPERATING EXPENSE') totalOperating += t.amount
      }
      previousDaySummary = {
        netIncome: totalSales - totalExpenses - totalOperating,
        totalExpenses,
        totalOperating,
        totalSales,
      }
    }

    if (useMonth && effectiveMonthKey !== filterMonthKey) {
      setFilterMonthKey(effectiveMonthKey)
    }

    setState({
      categories,
      customers,
      loyaltySettings,
      months: Array.from(new Set([monthToUse, ...months])).sort().reverse(),
      previousDaySummary,
      staff,
      transactions,
      transactionTypes,
    })
  }, [
    currentMonthKey,
    filterCategoryId,
    filterCustomerId,
    filterDateFrom,
    filterDateTo,
    filterMonthKey,
    filterPeriodMode,
    filterTypeId,
  ])

  useEffect(() => {
    let isMounted = true

    loadTransactions().catch((loadError: unknown) => {
      if (!isMounted) return
      setError(loadError instanceof Error ? loadError.message : 'Unable to load transactions.')
    })

    return () => {
      isMounted = false
    }
  }, [loadTransactions])

  useEffect(() => {
    if (!formTypeId) return

    const stillValid = filteredCategories.some((category) => String(category.id) === formCategoryId)

    if (!stillValid) {
      setFormCategoryId(filteredCategories[0] ? String(filteredCategories[0].id) : '')
    }
  }, [filteredCategories, formCategoryId, formTypeId])

  useEffect(() => {
    if (!showCustomerField) {
      setFormCustomerId('')
    }
  }, [showCustomerField])

  useEffect(() => {
    if (!isCashAdvanceCategory) {
      setFormCashAdvanceStaffId('')
    }
  }, [isCashAdvanceCategory])

  const clearTemplateSection = useCallback(() => {
    setFormTemplatePickerId('')
    setFormTemplatePreviewLines([])
  }, [])

  const makeLineItemKey = useCallback(
    () => `li-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    [],
  )

  const addLineItem = useCallback(() => {
    setFormLineItems((prev) => [
      ...prev,
      {
        key: makeLineItemKey(),
        inventoryItemId: null,
        label: '',
        quantityStr: '1',
        priceStr: '',
        saleUnitLabel: '',
        saleUnitFactor: 1,
        saleUnitId: null,
      },
    ])
  }, [makeLineItemKey])

  const removeLineItem = useCallback((key: string) => {
    setFormLineItems((prev) => prev.filter((l) => l.key !== key))
  }, [])

  const updateLineItemLabel = useCallback(
    (key: string, label: string) => {
      setFormLineItems((prev) =>
        prev.map((l) => {
          if (l.key !== key) return l
          const match = formInventoryOptions.find(
            (inv) => inv.name.toLowerCase() === label.trim().toLowerCase(),
          )
          // Re-link inventory: when the link changes, reset the alt-unit
          // selection because the new item has a different alt-unit set.
          const isNewLink = match ? l.inventoryItemId !== match.id : false
          let nextPriceStr = l.priceStr
          if (match && (l.priceStr.trim() === '' || isNewLink)) {
            const autoFill =
              Number.isFinite(match.sellingPrice) && match.sellingPrice > 0
                ? match.sellingPrice
                : Number.isFinite(match.costPerUnit) && match.costPerUnit > 0
                  ? match.costPerUnit
                  : null
            if (autoFill != null) nextPriceStr = String(autoFill)
          }
          return {
            ...l,
            label,
            inventoryItemId: match ? match.id : null,
            priceStr: nextPriceStr,
            // Reset the sale unit when the inventory link changes (or is removed).
            saleUnitLabel: isNewLink || match == null ? '' : l.saleUnitLabel,
            saleUnitFactor: isNewLink || match == null ? 1 : l.saleUnitFactor,
            saleUnitId: isNewLink || match == null ? null : l.saleUnitId,
          }
        }),
      )
    },
    [formInventoryOptions],
  )

  const updateLineItemQuantity = useCallback((key: string, quantityStr: string) => {
    setFormLineItems((prev) => prev.map((l) => (l.key === key ? { ...l, quantityStr } : l)))
  }, [])

  const updateLineItemPrice = useCallback((key: string, priceStr: string) => {
    setFormLineItems((prev) => prev.map((l) => (l.key === key ? { ...l, priceStr } : l)))
  }, [])

  /**
   * Switch the sale unit for a line. Pass an empty `unitId` (or '') to revert
   * to the inventory item's base unit. We reset the unit price to the chosen
   * unit's default (alt-unit's `unitPrice`, or `sellingPrice / factor` when
   * the alt has no explicit price).
   */
  const updateLineItemUnit = useCallback(
    (key: string, unitId: string) => {
      setFormLineItems((prev) =>
        prev.map((l) => {
          if (l.key !== key) return l
          const inv =
            l.inventoryItemId != null
              ? formInventoryOptions.find((i) => i.id === l.inventoryItemId)
              : undefined
          if (unitId === '') {
            // Revert to base unit; auto-fill price from inventory selling/cost.
            const basePrice =
              inv && Number.isFinite(inv.sellingPrice) && inv.sellingPrice > 0
                ? inv.sellingPrice
                : inv && Number.isFinite(inv.costPerUnit) && inv.costPerUnit > 0
                  ? inv.costPerUnit
                  : null
            return {
              ...l,
              priceStr: basePrice != null ? String(basePrice) : l.priceStr,
              saleUnitLabel: '',
              saleUnitFactor: 1,
              saleUnitId: null,
            }
          }
          if (!inv) return l
          const altId = Number(unitId)
          const alt = inv.altUnits.find((u) => u.id === altId)
          if (!alt) return l
          const altDefaultPrice =
            alt.unitPrice > 0
              ? alt.unitPrice
              : inv.sellingPrice > 0
                ? inv.sellingPrice / alt.unitsPerBase
                : inv.costPerUnit > 0
                  ? inv.costPerUnit / alt.unitsPerBase
                  : null
          return {
            ...l,
            priceStr:
              altDefaultPrice != null
                ? String(Math.round(altDefaultPrice * 100) / 100)
                : l.priceStr,
            saleUnitLabel: alt.unitLabel,
            saleUnitFactor: alt.unitsPerBase,
            saleUnitId: alt.id,
          }
        }),
      )
    },
    [formInventoryOptions],
  )

  const lineItemsTotal = useMemo(() => {
    return formLineItems.reduce((sum, li) => {
      const qty = Number(li.quantityStr)
      const unit = Number(li.priceStr)
      const valid =
        li.label.trim() !== '' &&
        Number.isFinite(qty) && qty > 0 &&
        Number.isFinite(unit) && unit >= 0
      return sum + (valid ? qty * unit : 0)
    }, 0)
  }, [formLineItems])

  const templatePreviewComboTotal = useMemo(() => {
    return formTemplatePreviewLines.reduce((sum, line) => {
      if (line.missingItem) return sum
      const qty = Number(line.quantityStr)
      if (!Number.isFinite(qty) || qty <= 0) return sum
      if (!Number.isFinite(line.unitPrice) || line.unitPrice <= 0) return sum
      return sum + qty * line.unitPrice
    }, 0)
  }, [formTemplatePreviewLines])

  const baseAmountNum = useMemo(() => {
    const n = Number(amount)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }, [amount])

  const grandTotal = useMemo(
    () => baseAmountNum + lineItemsTotal,
    [baseAmountNum, lineItemsTotal],
  )

  useEffect(() => {
    if (!isModalOpen) return
    let cancelled = false
    void (async () => {
      try {
        const items = await listInventoryItems()
        if (!cancelled) setFormInventoryOptions(items)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isModalOpen])

  useEffect(() => {
    if (!isModalOpen || !canManageInventory) return
    let cancelled = false
    void (async () => {
      try {
        const [tpls, inv] = await Promise.all([
          listTransactionTemplates(),
          listInventoryItems({ includeInactive: true }),
        ])
        if (!cancelled) {
          setFormTransactionTemplates(tpls)
          setFormInventoryForTemplates(inv)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canManageInventory, isModalOpen])

  useEffect(() => {
    if (!isSaleType) {
      clearTemplateSection()
    }
  }, [clearTemplateSection, isSaleType])

  function resetForm() {
    setFormTransactionId(null)
    setFormEntryDate(format(new Date(), 'yyyy-MM-dd'))
    setFormTypeId('')
    setFormCategoryId('')
    setDescription('')
    setAmount('')
    setStaffCount('')
    setFormCustomerId('')
    setFormKg('')
    setFormLoads('')
    setShowKgInput(false)
    setFormRedeemReward(false)
    setFormCashAdvanceStaffId('')
    setLoyaltyStatus(null)
    setError(null)
    setFormLineItems([])
    clearTemplateSection()
  }

  function openNewModal() {
    templateLoadGenRef.current += 1
    resetForm()
    setIsModalOpen(true)
  }

  function closeModal() {
    templateLoadGenRef.current += 1
    setIsModalOpen(false)
    resetForm()
  }

  function handleTemplatePickerChange(value: string) {
    setFormTemplatePickerId(value)
    if (!value) {
      setFormTemplatePreviewLines([])
      return
    }
    const tid = Number(value)
    const tpl = formTransactionTemplates.find((t) => t.id === tid)
    if (!tpl) return
    const stockById = new Map(formInventoryForTemplates.map((i) => [i.id, i]))
    const lines: Array<{
      inventoryItemId: number
      isItemActive: boolean
      itemName: string
      key: string
      lowStockThreshold: number
      missingItem?: boolean
      quantityStr: string
      unitLabel: string
      unitPrice: number
      currentStock: number
      saleUnitLabel: string
      saleUnitFactor: number
      saleUnitId: number | null
    }> = []
    for (const it of tpl.items) {
      const inv = stockById.get(it.inventoryItemId)
      const key = `${tpl.id}-${it.inventoryItemId}-${Math.random().toString(36).slice(2, 9)}`
      // Resolve the per-line unit price: prefer the template's stored value,
      // then the inventory item's selling price, finally fall back to cost.
      const tplUnit = Number.isFinite(it.unitPrice) && it.unitPrice > 0 ? it.unitPrice : 0
      // The template's snapshot defines its sale unit; honor it if still valid.
      const altFactor =
        Number.isFinite(it.saleUnitFactor) && it.saleUnitFactor > 0
          ? it.saleUnitFactor
          : 1
      const usingAlt = it.saleUnitLabel !== '' && altFactor !== 1
      const baseInvPrice =
        inv && Number.isFinite(inv.sellingPrice) && inv.sellingPrice > 0
          ? inv.sellingPrice
          : inv && Number.isFinite(inv.costPerUnit) && inv.costPerUnit > 0
            ? inv.costPerUnit
            : 0
      // When falling back from the template's stored price, scale the
      // inventory's base price by the alt unit's factor so a per-cup line
      // doesn't accidentally take the per-gallon price.
      const invFallback = usingAlt && altFactor > 0 ? baseInvPrice / altFactor : baseInvPrice
      const unitPrice = tplUnit > 0 ? tplUnit : invFallback
      const displayUnitLabel = usingAlt ? it.saleUnitLabel : (inv?.unitLabel ?? it.unitLabel)
      if (!inv) {
        lines.push({
          currentStock: 0,
          inventoryItemId: it.inventoryItemId,
          isItemActive: false,
          itemName: it.itemName,
          key,
          lowStockThreshold: 0,
          missingItem: true,
          quantityStr: String(it.quantity),
          saleUnitFactor: altFactor,
          saleUnitId: it.saleUnitId,
          saleUnitLabel: it.saleUnitLabel,
          unitLabel: displayUnitLabel,
          unitPrice,
        })
        continue
      }
      lines.push({
        currentStock: inv.currentStock,
        inventoryItemId: it.inventoryItemId,
        isItemActive: inv.isActive,
        itemName: inv.name,
        key,
        lowStockThreshold: inv.lowStockThreshold,
        missingItem: false,
        quantityStr: String(it.quantity),
        saleUnitFactor: altFactor,
        saleUnitId: it.saleUnitId,
        saleUnitLabel: it.saleUnitLabel,
        unitLabel: displayUnitLabel,
        unitPrice,
      })
    }
    setFormTemplatePreviewLines(lines)

    // Auto-fill the transaction Amount with the template's combo total when
    // the template lines have unit prices. Only applied lines (non-missing,
    // active items) count. The user can still edit Amount afterwards.
    const comboTotal = lines.reduce((sum, l) => {
      if (l.missingItem) return sum
      const q = Number(l.quantityStr)
      if (!Number.isFinite(q) || q <= 0) return sum
      if (!Number.isFinite(l.unitPrice) || l.unitPrice <= 0) return sum
      return sum + q * l.unitPrice
    }, 0)
    if (comboTotal > 0) {
      setAmount(String(Math.round(comboTotal * 100) / 100))
    }
  }

  function updateTemplatePreviewQuantity(key: string, quantityStr: string) {
    setFormTemplatePreviewLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantityStr } : l)),
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const canSave = formTransactionId ? canEdit : canCreate

    if (!user || !canSave) {
      setError('You do not have permission to save transactions.')
      return
    }

    const redeem = showLoadFields && formRedeemReward

    if (!formTypeId || !formCategoryId || !formEntryDate) {
      setError('Date, type, and category are required.')
      return
    }

    if (!redeem && (amount === '' || amount.trim() === '')) {
      setError('Date, type, category, and amount are required.')
      return
    }

    if (showLoadFields && redeem && !formCustomerId) {
      setError('Customer is required to redeem a loyalty reward.')
      return
    }

    if (isCashAdvanceCategory && !formCashAdvanceStaffId) {
      setError('Select the staff member who received this cash advance.')
      return
    }

    if (showLoadFields && !redeem) {
      const loadsNum = Number(formLoads.trim())
      if (!Number.isFinite(loadsNum) || loadsNum <= 0) {
        setError('Enter a positive number of loads (or enter kg to calculate loads).')
        return
      }
    }

    const baseAmount = redeem ? 0 : Number(amount)
    if (!redeem && (!Number.isFinite(baseAmount) || baseAmount < 0)) {
      setError('Amount must be a valid non-negative number.')
      return
    }

    const normalizedLineItems: Array<{
      inventoryItemId: number | null
      label: string
      price: number
      quantity: number
      unitPrice: number
      saleUnitLabel: string
      saleUnitFactor: number
      saleUnitId: number | null
    }> = []
    for (const li of formLineItems) {
      const label = li.label.trim()
      const priceTrim = li.priceStr.trim()
      const qtyTrim = li.quantityStr.trim()
      if (label === '' && priceTrim === '' && (qtyTrim === '' || qtyTrim === '1')) continue
      if (label === '') {
        setError('Additional item name is required.')
        return
      }
      const quantity = qtyTrim === '' ? 1 : Number(qtyTrim)
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(`Enter a quantity greater than 0 for "${label}".`)
        return
      }
      const unitPrice = Number(priceTrim)
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        setError(`Enter a valid unit price for "${label}".`)
        return
      }
      const price = quantity * unitPrice
      normalizedLineItems.push({
        inventoryItemId: li.inventoryItemId,
        label,
        price,
        quantity,
        saleUnitFactor: li.saleUnitFactor > 0 ? li.saleUnitFactor : 1,
        saleUnitId: li.saleUnitId,
        saleUnitLabel: li.saleUnitLabel,
        unitPrice,
      })
    }

    const lineItemsSum = normalizedLineItems.reduce((acc, li) => acc + li.price, 0)
    const amountNum = redeem ? 0 : baseAmount + lineItemsSum

    let resolvedStaffCount: number | null = null
    if (showStaffCountField) {
      const trimmed = staffCount.trim()
      if (trimmed !== '') {
        const n = Number(trimmed)
        if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
          setError('Number of staff must be a whole number of at least 1, or leave blank.')
          return
        }
        resolvedStaffCount = n
      }
    }

    setIsSubmitting(true)
    setError(null)

    let resolvedKg: number | null = null
    if (showLoadFields) {
      const kgTrim = formKg.trim()
      if (kgTrim !== '') {
        const kgNum = Number(kgTrim)
        resolvedKg = Number.isFinite(kgNum) && kgNum >= 0 ? kgNum : null
      }
    }

    let resolvedLoads: number | null = null
    if (showLoadFields) {
      if (redeem) {
        const n = Number(formLoads.trim())
        resolvedLoads = Number.isFinite(n) && n > 0 ? n : 1
      } else {
        const n = Number(formLoads.trim())
        resolvedLoads = Number.isFinite(n) && n > 0 ? n : null
      }
    }

    try {
      const baseDraft = {
        amount: amountNum,
        cashAdvanceStaffId: isCashAdvanceCategory && formCashAdvanceStaffId
          ? Number(formCashAdvanceStaffId)
          : null,
        categoryId: Number(formCategoryId),
        customerId: showCustomerField && formCustomerId ? Number(formCustomerId) : null,
        description: description.trim(),
        entryDate: formEntryDate,
        isLoyaltyReward: redeem,
        kg: showLoadFields ? resolvedKg : null,
        lineItems: redeem ? [] : normalizedLineItems,
        loads: showLoadFields ? resolvedLoads : null,
        staffCount: showStaffCountField ? resolvedStaffCount : null,
        transactionTypeId: Number(formTypeId),
      }

      let templatePatch: {
        templateId?: number | null
        templateItems?: Array<{
          inventoryItemId: number
          quantity: number
          saleUnitLabel?: string
          saleUnitFactor?: number
          saleUnitId?: number | null
        }> | null
      } = {}
      if (canManageInventory) {
        if (isSaleType) {
          const templateItems = formTemplatePreviewLines
            .filter((l) => !l.missingItem)
            .map((l) => {
              const q = Number(l.quantityStr.trim())
              return {
                inventoryItemId: l.inventoryItemId,
                quantity: q,
                saleUnitFactor: l.saleUnitFactor > 0 ? l.saleUnitFactor : 1,
                saleUnitId: l.saleUnitId,
                saleUnitLabel: l.saleUnitLabel,
              }
            })
            .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0)

          templatePatch = {
            templateId:
              templateItems.length > 0 && formTemplatePickerId
                ? Number(formTemplatePickerId)
                : templateItems.length > 0
                  ? null
                  : null,
            templateItems: templateItems.length > 0 ? templateItems : null,
          }
        } else {
          templatePatch = { templateId: null, templateItems: null }
        }
      }

      await saveTransaction(
        canManageInventory ? { ...baseDraft, ...templatePatch } : baseDraft,
        user.id,
        formTransactionId ?? undefined,
      )

      await loadTransactions()
      closeModal()
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save transaction.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(transactionId: number) {
    if (!canDelete) return
    await deleteTransaction(transactionId)
    await loadTransactions()
  }

  function handleEdit(transaction: LedgerTransaction) {
    if (!canEdit) return
    templateLoadGenRef.current += 1
    const gen = templateLoadGenRef.current
    clearTemplateSection()
    setFormLineItems([])
    setFormTransactionId(transaction.id)
    setFormEntryDate(transaction.entryDate)
    setFormTypeId(String(transaction.transactionTypeId))
    setFormCategoryId(String(transaction.categoryId))
    setDescription(transaction.description)
    setAmount(String(transaction.amount))
    setStaffCount(transaction.staffCount ? String(transaction.staffCount) : '')
    setFormCustomerId(
      transaction.customerId != null ? String(transaction.customerId) : '',
    )
    setFormKg(transaction.kg != null ? String(transaction.kg) : '')
    setFormLoads(transaction.loads != null ? String(transaction.loads) : '')
    setShowKgInput(transaction.kg != null)
    setFormRedeemReward(transaction.isLoyaltyReward)
    setFormCashAdvanceStaffId('')
    setIsModalOpen(true)

    if (
      transaction.transactionTypeCode === 'EXPENSE' &&
      transaction.categoryLabel.trim().toLowerCase() === 'cash advance'
    ) {
      void (async () => {
        try {
          const advance = await getCashAdvanceByTransactionId(transaction.id)
          if (gen !== templateLoadGenRef.current) return
          if (advance && advance.status !== 'void') {
            setFormCashAdvanceStaffId(String(advance.staffId))
          }
        } catch {
          /* ignore */
        }
      })()
    }

    void (async () => {
      try {
        const isSale = transaction.transactionTypeCode === 'SALE'
        const [items, tmplResult] = await Promise.all([
          listTransactionLineItems(transaction.id),
          isSale && canManageInventory
            ? Promise.all([
                listInventoryMovementsByTransaction(transaction.id),
                listInventoryItems({ includeInactive: true }),
              ])
            : Promise.resolve(null as null | [Awaited<ReturnType<typeof listInventoryMovementsByTransaction>>, InventoryItem[]]),
        ])
        if (gen !== templateLoadGenRef.current) return

        if (items.length > 0) {
          const sum = items.reduce(
            (acc, li) => acc + (Number.isFinite(li.price) ? li.price : 0),
            0,
          )
          const base = Math.max(0, transaction.amount - sum)
          setAmount(String(Math.round(base * 100) / 100))
          setFormLineItems(
            items.map((li) => ({
              key: `edit-li-${li.id}-${Math.random().toString(36).slice(2, 7)}`,
              inventoryItemId: li.inventoryItemId,
              label: li.label,
              quantityStr: String(li.quantity),
              priceStr: String(li.unitPrice),
              saleUnitFactor: li.saleUnitFactor > 0 ? li.saleUnitFactor : 1,
              saleUnitId: li.saleUnitId,
              saleUnitLabel: li.saleUnitLabel,
            })),
          )
        }

        if (tmplResult) {
          const [movs, invItems] = tmplResult
          const tmplMovs = movs.filter((m) => m.movementType === 'OUT' && m.templateId != null)
          if (tmplMovs.length > 0) {
            const tid = tmplMovs[0]!.templateId ?? null
            if (tid != null) setFormTemplatePickerId(String(tid))
            const itemById = new Map(invItems.map((i) => [i.id, i]))
            // Pull the template's stored unit prices so the preview matches
            // what was saved on the template (not just the live inventory).
            const tpl = tid != null
              ? formTransactionTemplates.find((t) => t.id === tid)
              : undefined
            const tplPriceByItemId = new Map<number, number>()
            // Snapshot lookup keyed by inventory item id — used to recover the
            // sale-unit info on edit even though `inventory_movements` only
            // stores base-unit quantities.
            const tplSnapshotByItemId = new Map<
              number,
              { saleUnitLabel: string; saleUnitFactor: number; saleUnitId: number | null }
            >()
            if (tpl) {
              for (const it of tpl.items) {
                if (Number.isFinite(it.unitPrice) && it.unitPrice > 0) {
                  tplPriceByItemId.set(it.inventoryItemId, it.unitPrice)
                }
                tplSnapshotByItemId.set(it.inventoryItemId, {
                  saleUnitFactor: it.saleUnitFactor > 0 ? it.saleUnitFactor : 1,
                  saleUnitId: it.saleUnitId,
                  saleUnitLabel: it.saleUnitLabel,
                })
              }
            }
            setFormTemplatePreviewLines(
              tmplMovs.map((m) => {
                const inv = itemById.get(m.itemId)
                const tplPrice = tplPriceByItemId.get(m.itemId) ?? 0
                const invPrice =
                  inv && Number.isFinite(inv.sellingPrice) && inv.sellingPrice > 0
                    ? inv.sellingPrice
                    : inv && Number.isFinite(inv.costPerUnit) && inv.costPerUnit > 0
                      ? inv.costPerUnit
                      : 0
                const price = tplPrice > 0 ? tplPrice : invPrice
                const snap = tplSnapshotByItemId.get(m.itemId) ?? {
                  saleUnitFactor: 1,
                  saleUnitId: null,
                  saleUnitLabel: '',
                }
                // Movement quantity is in base units; convert back to the
                // template's authored unit so the input matches what the user
                // typed when authoring the template.
                const altQty =
                  snap.saleUnitFactor > 0 ? m.quantity * snap.saleUnitFactor : m.quantity
                const displayUnitLabel =
                  snap.saleUnitLabel !== '' ? snap.saleUnitLabel : (inv?.unitLabel ?? m.unitLabel)
                return {
                  currentStock: inv?.currentStock ?? 0,
                  inventoryItemId: m.itemId,
                  isItemActive: inv?.isActive ?? false,
                  itemName: inv?.name ?? m.itemName,
                  key: `edit-${m.id}-${Math.random().toString(36).slice(2, 9)}`,
                  lowStockThreshold: inv?.lowStockThreshold ?? 0,
                  missingItem: inv == null,
                  quantityStr: String(altQty),
                  saleUnitFactor: snap.saleUnitFactor,
                  saleUnitId: snap.saleUnitId,
                  saleUnitLabel: snap.saleUnitLabel,
                  unitLabel: displayUnitLabel,
                  unitPrice: price,
                }
              }),
            )
          }
        }
      } catch {
        /* ignore */
      }
    })()
  }

  function openFilter() {
    setDraftPeriodMode(filterPeriodMode)
    setDraftMonthKey(filterMonthKey)
    setDraftDateFrom(filterDateFrom)
    setDraftDateTo(filterDateTo)
    setDraftTypeId(filterTypeId)
    setDraftCategoryId(filterCategoryId)
    setDraftCustomerId(filterCustomerId)
    setIsFilterOpen(true)
  }

  function applyFilter() {
    setFilterPeriodMode(draftPeriodMode)
    if (draftPeriodMode === 'dateRange') {
      let from = draftDateFrom
      let to = draftDateTo
      if (from && to && to < from) {
        to = from
      }
      setFilterDateFrom(from)
      setFilterDateTo(to)
    } else {
      setFilterMonthKey(draftMonthKey.length >= 7 ? draftMonthKey : currentMonthKey)
    }
    setFilterTypeId(draftTypeId)
    setFilterCategoryId(draftCategoryId)
    setFilterCustomerId(draftCustomerId)
    setIsFilterOpen(false)
  }

  function clearDraftFilters() {
    setDraftPeriodMode('dateRange')
    setDraftMonthKey(currentMonthKey)
    setDraftDateFrom('')
    setDraftDateTo('')
    setDraftTypeId('')
    setDraftCategoryId('')
    setDraftCustomerId('')
  }

  async function handleExportTransactions() {
    if (!canExport) return
    const rangeSuffix =
      filterPeriodMode === 'month'
        ? filterMonthKey
        : filterDateFrom && filterDateTo
          ? `${filterDateFrom}-to-${filterDateTo}`
          : filterDateFrom || filterDateTo || 'all'
    await exportFilteredTransactions(state.transactions, `transactions-${rangeSuffix}.xlsx`)
  }

  return (
    <section className="space-y-4">
      {/* Page header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Transactions</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Record and monitor daily income and expenses
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-40"
              onClick={() => { void handleExportTransactions() }}
              type="button"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
          )}
          {canCreate && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
              onClick={openNewModal}
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
              New transaction
            </button>
          )}
        </div>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: 'Total Sales',
            value: summary.totalSales,
            prevValue: state.previousDaySummary?.totalSales,
            icon: TrendingUp,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
            delta: kpiDelta(summary.totalSales, state.previousDaySummary?.totalSales),
          },
          {
            label: 'Expenses',
            value: summary.totalExpenses,
            prevValue: state.previousDaySummary?.totalExpenses,
            icon: CreditCard,
            color: 'text-red-500',
            bg: 'bg-red-500/10',
            delta: kpiDelta(summary.totalExpenses, state.previousDaySummary?.totalExpenses),
            invertDelta: true,
          },
          {
            label: 'Operating Exp.',
            value: summary.totalOperating,
            prevValue: state.previousDaySummary?.totalOperating,
            icon: Building2,
            color: 'text-amber-500',
            bg: 'bg-amber-500/10',
            delta: kpiDelta(summary.totalOperating, state.previousDaySummary?.totalOperating),
            invertDelta: true,
          },
          {
            label: 'Net Income',
            value: summary.netIncome,
            prevValue: state.previousDaySummary?.netIncome,
            icon: Banknote,
            color: summary.netIncome >= 0 ? 'text-indigo-500' : 'text-red-500',
            bg: summary.netIncome >= 0 ? 'bg-indigo-500/10' : 'bg-red-500/10',
            delta: kpiDelta(summary.netIncome, state.previousDaySummary?.netIncome),
          },
        ].map(({ label, value, prevValue, icon: Icon, color, bg, delta, invertDelta }) => (
          <div
            key={label}
            className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                {label}
              </p>
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-3.5 w-3.5 ${color}`} />
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <p className={`text-2xl font-semibold tabular-nums tracking-tight ${color}`}>
                {formatCurrency(value)}
              </p>
              {delta != null && prevValue != null && (
                <span
                  className={`inline-flex cursor-default items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold ${
                    (invertDelta ? delta <= 0 : delta >= 0)
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-rose-500/10 text-rose-500'
                  }`}
                  title={`Yesterday: ${formatCurrency(prevValue)} → Today: ${formatCurrency(value)}\nChange: ${delta >= 0 ? '+' : ''}${formatCurrency(value - prevValue)}`}
                >
                  {delta >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {delta >= 0 ? '+' : ''}
                  {delta.toFixed(1)}%
                </span>
              )}
            </div>
            {prevValue != null && (
              <p className="mt-1 text-xs text-[var(--muted)] tabular-nums">
                Yesterday: {formatCurrency(prevValue)}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Search + filter toolbar */}
      <div className="flex items-center justify-end gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
          <input
            className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] pl-8 pr-3 text-sm outline-none focus:border-[var(--accent)] transition"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search transactions…"
            type="search"
            value={searchQuery}
          />
        </div>
        <button
          aria-label="Open filters"
          className="relative inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
          onClick={openFilter}
          type="button"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent)] text-[9px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Transaction list */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        {/* Desktop column headers */}
        <div
          className={`hidden ${TX_TABLE_GRID} sm:border-b sm:border-[var(--border)] sm:bg-[var(--background)]/40 sm:px-4 sm:py-2 sm:text-[10px] sm:font-semibold sm:uppercase sm:tracking-wider sm:text-[var(--muted)]`}
        >
          <SortableColumnHeader
            activeKey={tableSortKey}
            dir={tableSortDir}
            label="Created At"
            onSort={handleColumnSort}
            sortKey="date"
          />
          <SortableColumnHeader
            activeKey={tableSortKey}
            align="center"
            dir={tableSortDir}
            label="Type"
            onSort={handleColumnSort}
            sortKey="type"
          />
          <SortableColumnHeader
            activeKey={tableSortKey}
            dir={tableSortDir}
            label="Category"
            onSort={handleColumnSort}
            sortKey="category"
          />
          {!isCleaningBusiness && (
            <SortableColumnHeader
              activeKey={tableSortKey}
              align="right"
              dir={tableSortDir}
              label="Loads"
              onSort={handleColumnSort}
              sortKey="loads"
            />
          )}
          <SortableColumnHeader
            activeKey={tableSortKey}
            dir={tableSortDir}
            label="Customer"
            onSort={handleColumnSort}
            sortKey="customer"
          />
          <span className="truncate">Description</span>
          <SortableColumnHeader
            activeKey={tableSortKey}
            align="right"
            dir={tableSortDir}
            label="Staff"
            onSort={handleColumnSort}
            sortKey="staff"
          />
          <SortableColumnHeader
            activeKey={tableSortKey}
            align="right"
            dir={tableSortDir}
            label="Amount"
            onSort={handleColumnSort}
            sortKey="amount"
          />
          <span className="sr-only">Actions</span>
        </div>

        {displayedTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-[var(--muted)]">
            <WalletCards className="mb-3 h-9 w-9 opacity-25" />
            <p className="text-sm">No transactions found</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {displayedTransactions.map((transaction) => {
              const displayDescription = transaction.description.trim()
                ? transaction.description
                : transaction.categoryLabel
              const goToDetail = () => {
                navigate(`/transactions/${transaction.id}`)
              }
              const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  goToDetail()
                }
              }
              return (
                <div key={transaction.id}>
                  {/* Mobile: stacked card */}
                  <div
                    className="flex cursor-pointer flex-col gap-2 px-4 py-3 transition hover:bg-[var(--background)]/50 sm:hidden"
                    onClick={goToDetail}
                    onKeyDown={handleRowKeyDown}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium leading-tight">{displayDescription}</p>
                        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{transaction.categoryLabel}</p>
                        {transaction.customerName ? (
                          <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                            Customer: {transaction.customerName}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
                        {transaction.createdAt
                          ? formatDateTime(transaction.createdAt)
                          : formatTransactionDisplayDate(transaction.entryDate)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={typeBadgeClass(transaction.transactionTypeCode)}>
                          {transaction.transactionTypeCode}
                        </span>
                        {!isCleaningBusiness && (
                          <span className="text-xs text-[var(--muted)] tabular-nums">
                            Loads: {formatLoadsCell(transaction)}
                          </span>
                        )}
                        <span className="text-xs text-[var(--muted)] tabular-nums">
                          Staff: {transaction.staffCount ?? '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold tabular-nums">{formatCurrency(transaction.amount)}</p>
                        <div className="flex shrink-0 items-center justify-end gap-0.5">
                          <button
                            aria-label="Edit"
                            className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] disabled:opacity-30"
                            disabled={!canEdit}
                            onClick={(event) => {
                              event.stopPropagation()
                              handleEdit(transaction)
                            }}
                            type="button"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            aria-label="Delete"
                            className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
                            disabled={!canDelete}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleDelete(transaction.id)
                            }}
                            type="button"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Desktop: table row */}
                  <div
                    className={`hidden ${TX_TABLE_GRID} sm:cursor-pointer sm:px-4 sm:py-3 sm:transition sm:hover:bg-[var(--background)]/50`}
                    onClick={goToDetail}
                    onKeyDown={handleRowKeyDown}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="whitespace-nowrap text-xs tabular-nums text-[var(--foreground)]">
                      {transaction.createdAt
                        ? formatDateTime(transaction.createdAt)
                        : formatTransactionDisplayDate(transaction.entryDate)}
                    </span>
                    <div className="flex justify-center">
                      <span className={typeBadgeClass(transaction.transactionTypeCode)}>
                        {transaction.transactionTypeCode}
                      </span>
                    </div>
                    <span className="truncate text-sm text-[var(--foreground)]">{transaction.categoryLabel}</span>
                    {!isCleaningBusiness && (
                      <span className="text-right text-xs">{formatLoadsCell(transaction)}</span>
                    )}
                    <span className="truncate text-sm text-[var(--muted)]" title={transaction.customerName ?? undefined}>
                      {transaction.customerName ?? '—'}
                    </span>
                    <span className="truncate text-sm text-[var(--muted)]">{displayDescription}</span>
                    <span className="whitespace-nowrap text-right text-sm tabular-nums text-[var(--muted)]">
                      {transaction.staffCount ?? '—'}
                    </span>
                    <p className="whitespace-nowrap text-right text-sm font-semibold tabular-nums">
                      {formatCurrency(transaction.amount)}
                    </p>
                    <div className="flex shrink-0 items-center justify-end gap-0.5">
                      <button
                        aria-label="Edit"
                        className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] disabled:opacity-30"
                        disabled={!canEdit}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleEdit(transaction)
                        }}
                        type="button"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        aria-label="Delete"
                        className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
                        disabled={!canDelete}
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleDelete(transaction.id)
                        }}
                        type="button"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Footer count */}
        {displayedTransactions.length > 0 && (
          <div className="border-t border-[var(--border)] bg-[var(--background)]/40 px-4 py-2 text-xs text-[var(--muted)]">
            {displayedTransactions.length} transaction{displayedTransactions.length !== 1 ? 's' : ''}
            {searchQuery && ` matching "${searchQuery}"`}
          </div>
        )}
      </div>

      {/* Filter dialog */}
      {isFilterOpen && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsFilterOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">Filters</h2>
              <button
                className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                onClick={() => setIsFilterOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <ModalField label="Period">
                <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                  <button
                    className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition ${
                      draftPeriodMode === 'dateRange'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                    onClick={() => {
                      setDraftPeriodMode('dateRange')
                      const from = `${draftMonthKey}-01`
                      const to = format(endOfMonth(new Date(`${draftMonthKey}-01T12:00:00`)), 'yyyy-MM-dd')
                      setDraftDateFrom(from)
                      setDraftDateTo(to)
                    }}
                    type="button"
                  >
                    Date range
                  </button>
                  <button
                    className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition ${
                      draftPeriodMode === 'month'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                    onClick={() => {
                      setDraftPeriodMode('month')
                      if (draftDateFrom && draftDateFrom.length >= 7) {
                        setDraftMonthKey(draftDateFrom.slice(0, 7))
                      }
                    }}
                    type="button"
                  >
                    Month
                  </button>
                </div>
              </ModalField>

              {draftPeriodMode === 'dateRange' ? (
                <div className="grid grid-cols-2 gap-3">
                  <ModalField label="From">
                    <input
                      className={modalInputClass}
                      max={draftDateTo || undefined}
                      onChange={(e) => setDraftDateFrom(e.target.value)}
                      type="date"
                      value={draftDateFrom}
                    />
                  </ModalField>
                  <ModalField label="To">
                    <input
                      className={modalInputClass}
                      min={draftDateFrom || undefined}
                      onChange={(e) => setDraftDateTo(e.target.value)}
                      type="date"
                      value={draftDateTo}
                    />
                  </ModalField>
                </div>
              ) : (
                <ModalField label="Calendar month">
                  <MonthPicker onChange={setDraftMonthKey} value={draftMonthKey} />
                </ModalField>
              )}

              <ModalField label="Transaction type">
                <select
                  className={modalSelectClass}
                  onChange={(e) => { setDraftTypeId(e.target.value); setDraftCategoryId('') }}
                  value={draftTypeId}
                >
                  <option value="">All types</option>
                  {state.transactionTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.code}
                    </option>
                  ))}
                </select>
              </ModalField>

              <ModalField label="Category">
                <select
                  className={modalSelectClass}
                  onChange={(e) => setDraftCategoryId(e.target.value)}
                  value={draftCategoryId}
                >
                  <option value="">All categories</option>
                  {draftFilterCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.transactionTypeCode}: {category.label}
                    </option>
                  ))}
                </select>
              </ModalField>

              <ModalField label="Customer">
                <select
                  className={modalSelectClass}
                  onChange={(e) => setDraftCustomerId(e.target.value)}
                  value={draftCustomerId}
                >
                  <option value="">All customers</option>
                  {state.customers.map((c) => {
                    const base = c.company ? `${c.name} (${c.company})` : c.name
                    const label = c.isArchived ? `${base} (archived)` : base
                    return (
                      <option key={c.id} value={c.id}>
                        {label}
                      </option>
                    )
                  })}
                </select>
              </ModalField>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-4">
              <button
                className="text-sm text-gray-400 transition hover:text-gray-600"
                onClick={clearDraftFilters}
                type="button"
              >
                Clear all
              </button>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
                  onClick={() => setIsFilterOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                  onClick={applyFilter}
                  type="button"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction modal */}
      {isModalOpen && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
          />

          {/* Modal panel — always white */}
          <div
            className={`relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ${isSaleType && canManageInventory ? 'max-w-xl' : 'max-w-lg'}`}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">
                {formTransactionId ? 'Edit transaction' : 'New transaction'}
              </h2>
              <button
                className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                onClick={closeModal}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <form className="flex min-h-0 flex-1 flex-col overflow-hidden" onSubmit={handleSubmit}>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                <ModalField label="Date" required>
                  <input
                    className={modalInputClass}
                    onChange={(event) => setFormEntryDate(event.target.value)}
                    type="date"
                    value={formEntryDate}
                  />
                </ModalField>

                <ModalField label="Transaction type" required>
                  <select
                    className={modalSelectClass}
                    onChange={(event) => setFormTypeId(event.target.value)}
                    value={formTypeId}
                  >
                    <option value="">Select a type</option>
                    {state.transactionTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.code}
                      </option>
                    ))}
                  </select>
                </ModalField>

                <ModalField label="Category" required>
                  <select
                    className={modalSelectClass}
                    disabled={!formTypeId}
                    onChange={(event) => setFormCategoryId(event.target.value)}
                    value={formCategoryId}
                  >
                    <option value="">{formTypeId ? 'Select a category' : 'Select a type first'}</option>
                    {filteredCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </ModalField>

                {isCashAdvanceCategory ? (
                  <ModalField
                    label="Staff (cash advance)"
                    required
                    help="The expense will be linked to this staff member as an outstanding cash advance, so it can be deducted from their next payroll."
                  >
                    <select
                      className={modalSelectClass}
                      onChange={(event) => setFormCashAdvanceStaffId(event.target.value)}
                      value={formCashAdvanceStaffId}
                    >
                      <option value="">Select a staff member</option>
                      {formCashAdvanceStaffId &&
                      !activeStaffForForm.some((s) => String(s.id) === formCashAdvanceStaffId)
                        ? state.staff
                            .filter((s) => String(s.id) === formCashAdvanceStaffId)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.displayName}
                                {s.isArchived ? ' (archived)' : ''}
                              </option>
                            ))
                        : null}
                      {activeStaffForForm.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.displayName}
                        </option>
                      ))}
                    </select>
                  </ModalField>
                ) : null}

                {isSaleType && canManageInventory ? (
                  <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/80 p-3">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <ModalField label="Sale template (optional)">
                        <select
                          className={modalSelectClass}
                          onChange={(event) => handleTemplatePickerChange(event.target.value)}
                          value={formTemplatePickerId}
                        >
                          <option value="">None</option>
                          {templatesForPicker.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {!t.isActive ? ' (inactive)' : ''}
                            </option>
                          ))}
                        </select>
                      </ModalField>
                      {formTemplatePreviewLines.length > 0 ? (
                        <button
                          className="mb-0.5 shrink-0 text-xs font-medium text-gray-600 underline decoration-gray-400 hover:text-gray-900"
                          onClick={() => {
                            clearTemplateSection()
                          }}
                          type="button"
                        >
                          Clear template
                        </button>
                      ) : null}
                    </div>
                    <p className="text-xs text-gray-500">
                      Applies stock-out movements when you save and auto-fills the Amount with the template's
                      combo total. Manage templates under{' '}
                      <span className="font-medium text-gray-700">Inventory → Sale templates</span>.
                    </p>
                    {formTemplatePreviewLines.length > 0 ? (
                      <div className="mt-2 overflow-x-auto rounded-md border border-gray-200 bg-white">
                        <table className="w-full min-w-[320px] text-xs">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                              <th className="px-2 py-1.5">Item</th>
                              <th className="px-2 py-1.5 text-right">Stock</th>
                              <th className="px-2 py-1.5 text-right">Qty out</th>
                              <th className="px-2 py-1.5 text-right">Unit price</th>
                              <th className="px-2 py-1.5 text-right">Line total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {formTemplatePreviewLines.map((line) => {
                              const q = Number(line.quantityStr.trim())
                              // Convert qty to base units for the stock check
                              // when the template line is authored in an alt unit.
                              const baseQ = line.saleUnitFactor > 0 ? q / line.saleUnitFactor : q
                              const projected = Number.isFinite(baseQ) ? line.currentStock - baseQ : line.currentStock
                              const lowWarn =
                                !line.missingItem &&
                                Number.isFinite(q) &&
                                q > 0 &&
                                (projected < 0 || projected <= line.lowStockThreshold)
                              const lineTotal =
                                Number.isFinite(q) && q > 0 &&
                                Number.isFinite(line.unitPrice) && line.unitPrice >= 0
                                  ? q * line.unitPrice
                                  : null
                              return (
                                <tr key={line.key}>
                                  <td className="px-2 py-1.5">
                                    <div className="font-medium text-gray-900">{line.itemName}</div>
                                    <div className="text-[10px] text-gray-500">{line.unitLabel}</div>
                                    {line.missingItem ? (
                                      <div className="mt-0.5 flex items-center gap-1 text-amber-700">
                                        <AlertTriangle className="h-3 w-3 shrink-0" />
                                        Item missing — skipped on save
                                      </div>
                                    ) : !line.isItemActive ? (
                                      <div className="mt-0.5 flex items-center gap-1 text-amber-700">
                                        <AlertTriangle className="h-3 w-3 shrink-0" />
                                        Inactive item
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">
                                    {line.missingItem ? '—' : line.currentStock}
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    <input
                                      className="w-20 rounded border border-gray-300 bg-white px-1.5 py-1 text-right tabular-nums text-gray-900 outline-none focus:border-blue-500"
                                      disabled={line.missingItem}
                                      min="0"
                                      onChange={(e) => updateTemplatePreviewQuantity(line.key, e.target.value)}
                                      step="any"
                                      type="number"
                                      value={line.quantityStr}
                                    />
                                    {lowWarn ? (
                                      <div className="mt-0.5 text-[10px] font-medium text-amber-700">Low / over stock</div>
                                    ) : null}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">
                                    {line.unitPrice > 0 ? formatCurrency(line.unitPrice) : '—'}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-900">
                                    {lineTotal != null && lineTotal > 0 ? formatCurrency(lineTotal) : '—'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                          {templatePreviewComboTotal > 0 ? (
                            <tfoot>
                              <tr className="border-t border-gray-200 bg-gray-50 text-[11px]">
                                <td className="px-2 py-1.5 font-medium text-gray-700" colSpan={4}>
                                  Combo total
                                </td>
                                <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-gray-900">
                                  {formatCurrency(templatePreviewComboTotal)}
                                </td>
                              </tr>
                            </tfoot>
                          ) : null}
                        </table>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {showCustomerField ? (
                  <ModalField label="Customer">
                    <select
                      className={modalSelectClass}
                      onChange={(event) => setFormCustomerId(event.target.value)}
                      value={formCustomerId}
                    >
                      <option value="">No customer</option>
                      {formCustomerId &&
                      !activeCustomersForForm.some((c) => String(c.id) === formCustomerId)
                        ? state.customers
                            .filter((c) => String(c.id) === formCustomerId)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.company ? `${c.name} (${c.company})` : c.name}
                                {c.isArchived ? ' (archived)' : ''}
                              </option>
                            ))
                        : null}
                      {activeCustomersForForm.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.company ? `${c.name} (${c.company})` : c.name}
                        </option>
                      ))}
                    </select>
                  </ModalField>
                ) : null}

                {showLoadFields ? (
                  <div className="space-y-2">
                    <div className={showKgInput ? 'grid grid-cols-2 gap-3' : ''}>
                      <ModalField label="Loads" required={!formRedeemReward}>
                        <input
                          className={modalInputClass}
                          min="0"
                          onChange={(event) => setFormLoads(event.target.value)}
                          placeholder="e.g. 1"
                          step="0.01"
                          type="number"
                          value={formLoads}
                        />
                      </ModalField>
                      {showKgInput ? (
                        <ModalField label="Kilograms (optional)">
                          <input
                            className={modalInputClass}
                            min="0"
                            onChange={(event) => handleKgChange(event.target.value)}
                            placeholder={`e.g. ${state.loyaltySettings.kgPerLoad}`}
                            step="0.01"
                            type="number"
                            value={formKg}
                          />
                        </ModalField>
                      ) : null}
                    </div>
                    <button
                      className="text-xs font-medium text-[var(--accent)] underline decoration-[var(--accent)]/40 hover:decoration-[var(--accent)]"
                      onClick={() => {
                        setShowKgInput((prev) => {
                          const next = !prev
                          if (!next) setFormKg('')
                          return next
                        })
                      }}
                      type="button"
                    >
                      {showKgInput ? 'Hide kilograms' : 'Specify kilograms'}
                    </button>
                  </div>
                ) : null}

                {loyaltyStatus && formCustomerId && showCustomerField ? (
                  <p className="text-xs text-gray-600">
                    {loyaltyStatus.isEligibleForReward ? (
                      <span className="font-medium text-violet-600">
                        Free load available — check &quot;Redeem loyalty reward&quot; below.
                      </span>
                    ) : (
                      <>
                        {loyaltyStatus.paidLoadsSinceLastReward.toFixed(2)} /{' '}
                        {loyaltyStatus.freeAfterLoads} paid loads toward next reward.
                      </>
                    )}
                  </p>
                ) : null}

                {showLoadFields &&
                formCustomerId &&
                (loyaltyStatus?.isEligibleForReward || formRedeemReward) ? (
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800">
                    <input
                      checked={formRedeemReward}
                      className="mt-1 rounded border-gray-300"
                      onChange={(event) => {
                        const checked = event.target.checked
                        setFormRedeemReward(checked)
                        if (checked) {
                          setAmount('0')
                          setFormLoads((prev) => (prev.trim() === '' ? '1' : prev))
                        }
                      }}
                      type="checkbox"
                    />
                    <span>Redeem loyalty reward (free load — amount will be 0)</span>
                  </label>
                ) : null}

                <ModalField label="Amount" required>
                  <input
                    className={modalInputClass}
                    disabled={showLoadFields && formRedeemReward}
                    min="0"
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    type="number"
                    value={amount}
                  />
                </ModalField>

                {!(showLoadFields && formRedeemReward) ? (
                  <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/80 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-700">Additional items (optional)</p>
                        <p className="text-xs text-gray-500">
                          Pick from inventory or type a custom name. Enter quantity and unit price — line totals add to the amount.
                        </p>
                      </div>
                      <button
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50"
                        onClick={addLineItem}
                        type="button"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add item
                      </button>
                    </div>

                    {formLineItems.length > 0 ? (
                      <>
                        <datalist id={lineItemListId}>
                          {formInventoryOptions.map((inv) => (
                            <option key={inv.id} value={inv.name} />
                          ))}
                        </datalist>
                        <div className="hidden gap-2 px-1 text-[10px] font-medium uppercase tracking-wider text-gray-400 sm:flex">
                          <span className="flex-1">Item</span>
                          <span className="shrink-0 text-center" style={{ width: '11rem' }}>Qty &amp; unit</span>
                          <span className="w-4 shrink-0" />
                          <span className="w-24 shrink-0 text-right">Unit price</span>
                          <span className="w-7 shrink-0" />
                        </div>
                        <div className="space-y-2">
                          {formLineItems.map((li) => {
                            const linkedInv = li.inventoryItemId != null
                              ? formInventoryOptions.find((inv) => inv.id === li.inventoryItemId)
                              : undefined
                            // When the line is selling in an alt unit, the qty
                            // is being entered in that unit, not the inventory's
                            // base unit type. Treat alt units as freely fractional.
                            const usingAlt = li.saleUnitLabel !== '' && li.saleUnitFactor !== 1
                            const qtyProps = usingAlt
                              ? { step: 'any', min: '0.01' }
                              : lineItemQtyInputProps(linkedInv?.unitType)
                            const baseUnitLabel = linkedInv?.unitLabel?.trim() || ''
                            const activeUnitLabel = usingAlt
                              ? li.saleUnitLabel
                              : baseUnitLabel || ''
                            const qtyNum = Number(li.quantityStr)
                            const unitNum = Number(li.priceStr)
                            const lineTotal =
                              Number.isFinite(qtyNum) && qtyNum > 0 &&
                              Number.isFinite(unitNum) && unitNum >= 0
                                ? qtyNum * unitNum
                                : null
                            const activeAltUnits = (linkedInv?.altUnits ?? []).filter(
                              (u) => u.isActive && u.unitsPerBase > 0,
                            )
                            const showUnitPicker = activeAltUnits.length > 0
                            // When alt unit changes the stock impact, surface it.
                            const baseQtyForStock =
                              usingAlt && Number.isFinite(qtyNum) && qtyNum > 0 && li.saleUnitFactor > 0
                                ? qtyNum / li.saleUnitFactor
                                : null
                            return (
                              <div className="space-y-1" key={li.key}>
                                <div className="flex items-start gap-2">
                                  <div className="flex-1 min-w-0">
                                    <input
                                      className={modalInputClass}
                                      list={lineItemListId}
                                      onChange={(event) => updateLineItemLabel(li.key, event.target.value)}
                                      placeholder="Item name"
                                      type="text"
                                      value={li.label}
                                    />
                                  </div>
                                  {showUnitPicker ? (
                                    <div
                                      aria-label="Quantity and sale unit"
                                      className="flex h-10 shrink-0 items-stretch overflow-hidden rounded-md border border-gray-300 bg-white focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200"
                                      style={{ width: '11rem' }}
                                    >
                                      <button
                                        aria-label="Decrease quantity"
                                        className="flex w-7 shrink-0 items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-300"
                                        disabled={
                                          !Number.isFinite(qtyNum) || qtyNum <= Number(qtyProps.min)
                                        }
                                        onClick={() => {
                                          const stepNum =
                                            qtyProps.step === '0.01' ? 0.01 : 1
                                          const current = Number.isFinite(qtyNum) ? qtyNum : 0
                                          const minNum = Number(qtyProps.min) || 0
                                          const next = Math.max(minNum, current - stepNum)
                                          const rounded =
                                            stepNum < 1
                                              ? Math.round(next * 100) / 100
                                              : Math.round(next)
                                          updateLineItemQuantity(li.key, String(rounded))
                                        }}
                                        type="button"
                                      >
                                        <Minus className="h-3.5 w-3.5" />
                                      </button>
                                      <input
                                        aria-label="Quantity"
                                        className="w-12 shrink-0 border-0 bg-transparent px-1 text-center text-sm focus:outline-none focus:ring-0"
                                        min={qtyProps.min}
                                        onChange={(event) =>
                                          updateLineItemQuantity(li.key, event.target.value)
                                        }
                                        placeholder="1"
                                        step={qtyProps.step}
                                        type="number"
                                        value={li.quantityStr}
                                      />
                                      <select
                                        aria-label="Sale unit"
                                        className="min-w-0 flex-1 border-0 border-l border-gray-200 bg-transparent px-2 text-xs focus:outline-none focus:ring-0"
                                        onChange={(event) =>
                                          updateLineItemUnit(li.key, event.target.value)
                                        }
                                        value={li.saleUnitId != null ? String(li.saleUnitId) : ''}
                                      >
                                        <option value="">{baseUnitLabel || 'unit'}</option>
                                        {activeAltUnits.map((u) => (
                                          <option key={u.id} value={u.id}>
                                            {u.unitLabel}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        aria-label="Increase quantity"
                                        className="flex w-7 shrink-0 items-center justify-center border-l border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                                        onClick={() => {
                                          const stepNum =
                                            qtyProps.step === '0.01' ? 0.01 : 1
                                          const current = Number.isFinite(qtyNum) ? qtyNum : 0
                                          const next = current + stepNum
                                          const rounded =
                                            stepNum < 1
                                              ? Math.round(next * 100) / 100
                                              : Math.round(next)
                                          updateLineItemQuantity(li.key, String(rounded))
                                        }}
                                        type="button"
                                      >
                                        <Plus className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <div
                                      className="flex h-10 shrink-0 items-stretch gap-2"
                                      style={{ width: '11rem' }}
                                    >
                                      <div className="w-16 shrink-0">
                                        <input
                                          aria-label="Quantity"
                                          className={`${modalInputClass} px-2 text-center`}
                                          min={qtyProps.min}
                                          onChange={(event) =>
                                            updateLineItemQuantity(li.key, event.target.value)
                                          }
                                          placeholder="1"
                                          step={qtyProps.step}
                                          type="number"
                                          value={li.quantityStr}
                                        />
                                      </div>
                                      <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
                                        {baseUnitLabel || '—'}
                                      </div>
                                    </div>
                                  )}
                                  <span className="w-4 shrink-0 self-center text-center text-xs text-gray-400">
                                    ×
                                  </span>
                                  <div className="w-24 shrink-0">
                                    <input
                                      aria-label="Unit price"
                                      className={`${modalInputClass} text-right`}
                                      min="0"
                                      onChange={(event) => updateLineItemPrice(li.key, event.target.value)}
                                      placeholder="0.00"
                                      step="0.01"
                                      type="number"
                                      value={li.priceStr}
                                    />
                                  </div>
                                  <button
                                    aria-label="Remove item"
                                    className="mt-1 shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                                    onClick={() => removeLineItem(li.key)}
                                    type="button"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                                <div className="flex items-center justify-between gap-2 pl-1 pr-9 text-[11px] text-gray-500">
                                  <span className="truncate">
                                    {activeUnitLabel
                                      ? `Priced per ${activeUnitLabel}`
                                      : 'Price is per unit'}
                                    {baseQtyForStock != null && baseUnitLabel
                                      ? ` · stock −${baseQtyForStock.toFixed(3).replace(/\.?0+$/, '')} ${baseUnitLabel}`
                                      : ''}
                                  </span>
                                  <span className="tabular-nums text-gray-700">
                                    {lineTotal != null ? `= ${formatCurrency(lineTotal)}` : '—'}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    ) : null}

                    {formLineItems.length > 0 ? (
                      <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-xs">
                        <span className="text-gray-600">
                          Base {formatCurrency(baseAmountNum)} + Items {formatCurrency(lineItemsTotal)}
                        </span>
                        <span className="font-semibold text-gray-900">
                          Total: {formatCurrency(grandTotal)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <ModalField label="Description">
                  <textarea
                    className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition resize-none placeholder:text-gray-400"
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Optional note…"
                    rows={2}
                    value={description}
                  />
                </ModalField>

                {showStaffCountField ? (
                  <ModalField label="Number of staff">
                    <input
                      className={modalInputClass}
                      min="1"
                      onChange={(event) => setStaffCount(event.target.value)}
                      placeholder="Optional"
                      type="number"
                      value={staffCount}
                    />
                  </ModalField>
                ) : null}

                {error ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
                    {error}
                  </div>
                ) : null}
              </div>

              {/* Footer */}
              <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-5 py-4">
                <p className="text-xs text-gray-400">
                  <span className="text-red-500">*</span> Required fields
                </p>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
                    onClick={closeModal}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                    disabled={!(formTransactionId ? canEdit : canCreate) || isSubmitting}
                    type="submit"
                  >
                    {isSubmitting ? 'Saving…' : formTransactionId ? 'Update' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
