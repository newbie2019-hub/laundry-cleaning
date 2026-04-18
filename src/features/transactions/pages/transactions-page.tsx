import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { endOfMonth, format, subDays } from 'date-fns'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Banknote,
  Building2,
  CreditCard,
  Download,
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
import { exportFilteredTransactions } from '../../exports/export-service'
import { MonthPicker } from '../../../components/month-picker'
import { formatCurrency } from '../../../lib/format'
import {
  deleteTransaction,
  listAvailableMonthKeys,
  listCategories,
  listCustomers,
  listTransactionTypes,
  listTransactions,
  saveTransaction,
  type Category,
  type Customer,
  type LedgerTransaction,
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
  months: string[]
  previousDaySummary: DaySummary | null
  transactions: LedgerTransaction[]
  transactionTypes: TransactionType[]
}

const emptyState: LoadState = {
  categories: [],
  customers: [],
  months: [],
  previousDaySummary: null,
  transactions: [],
  transactionTypes: [],
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

type TableSortKey = 'amount' | 'category' | 'customer' | 'date' | 'staff' | 'type'

function compareTransactionsForSort(
  a: LedgerTransaction,
  b: LedgerTransaction,
  key: TableSortKey,
  dir: 'asc' | 'desc',
): number {
  const sign = dir === 'asc' ? 1 : -1
  let cmp = 0
  switch (key) {
    case 'date':
      cmp = a.entryDate.localeCompare(b.entryDate)
      break
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
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}


const modalInputClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition placeholder:text-gray-400'

const modalSelectClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition'

type FilterPeriodMode = 'dateRange' | 'month'

export function TransactionsPage() {
  const { hasPermission, user } = useAuth()
  const today = format(new Date(), 'yyyy-MM-dd')
  const currentMonthKey = format(new Date(), 'yyyy-MM')
  const [filterPeriodMode, setFilterPeriodMode] = useState<FilterPeriodMode>('dateRange')
  const [filterMonthKey, setFilterMonthKey] = useState(currentMonthKey)
  const [filterDateFrom, setFilterDateFrom] = useState(today)
  const [filterDateTo, setFilterDateTo] = useState(today)
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
  const [state, setState] = useState<LoadState>(emptyState)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>('date')
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc')

  const canCreate = hasPermission('manage_transactions')
  const canEdit = hasPermission('edit_transaction')
  const canDelete = hasPermission('delete_transaction')
  const canExport = hasPermission('export_data')

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

  const periodCountsTowardBadge =
    filterPeriodMode === 'month'
      ? filterMonthKey !== currentMonthKey
      : filterDateFrom !== today || filterDateTo !== today || filterDateFrom !== filterDateTo
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
      setTableSortDir(key === 'date' || key === 'amount' ? 'desc' : 'asc')
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

    const [transactionTypes, categories, customers, transactions, previousDayTransactions] = await Promise.all([
      listTransactionTypes(),
      listCategories(),
      listCustomers({ includeArchived: true }),
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
      months: Array.from(new Set([monthToUse, ...months])).sort().reverse(),
      previousDaySummary,
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

  function resetForm() {
    setFormTransactionId(null)
    setFormEntryDate(format(new Date(), 'yyyy-MM-dd'))
    setFormTypeId('')
    setFormCategoryId('')
    setDescription('')
    setAmount('')
    setStaffCount('')
    setFormCustomerId('')
    setError(null)
  }

  function openNewModal() {
    resetForm()
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    resetForm()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const canSave = formTransactionId ? canEdit : canCreate

    if (!user || !canSave) {
      setError('You do not have permission to save transactions.')
      return
    }

    if (!formTypeId || !formCategoryId || !formEntryDate || !amount) {
      setError('Date, type, category, and amount are required.')
      return
    }

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

    try {
      await saveTransaction(
        {
          amount: Number(amount),
          categoryId: Number(formCategoryId),
          customerId: showCustomerField && formCustomerId ? Number(formCustomerId) : null,
          description: description.trim(),
          entryDate: formEntryDate,
          staffCount: showStaffCountField ? resolvedStaffCount : null,
          transactionTypeId: Number(formTypeId),
        },
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
    setIsModalOpen(true)
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
      const from = draftDateFrom || today
      let to = draftDateTo || from
      if (to < from) to = from
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
    setDraftDateFrom(today)
    setDraftDateTo(today)
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
        <div className="hidden sm:grid sm:grid-cols-[110px_120px_140px_minmax(0,120px)_minmax(0,1fr)_96px_128px_80px] sm:items-center sm:gap-3 sm:border-b sm:border-[var(--border)] sm:bg-[var(--background)]/40 sm:px-4 sm:py-2 sm:text-[10px] sm:font-semibold sm:uppercase sm:tracking-wider sm:text-[var(--muted)]">
          <SortableColumnHeader
            activeKey={tableSortKey}
            dir={tableSortDir}
            label="Date"
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
              return (
                <div key={transaction.id}>
                  {/* Mobile: stacked card */}
                  <div className="flex flex-col gap-2 px-4 py-3 transition hover:bg-[var(--background)]/50 sm:hidden">
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
                      <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                        {formatTransactionDisplayDate(transaction.entryDate)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={typeBadgeClass(transaction.transactionTypeCode)}>
                          {transaction.transactionTypeCode}
                        </span>
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
                            onClick={() => handleEdit(transaction)}
                            type="button"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            aria-label="Delete"
                            className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
                            disabled={!canDelete}
                            onClick={() => {
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
                  <div className="hidden sm:grid sm:grid-cols-[110px_120px_140px_minmax(0,120px)_minmax(0,1fr)_96px_128px_80px] sm:items-center sm:gap-3 sm:px-4 sm:py-3 sm:transition sm:hover:bg-[var(--background)]/50">
                    <span className="text-xs tabular-nums text-[var(--foreground)]">
                      {formatTransactionDisplayDate(transaction.entryDate)}
                    </span>
                    <div className="flex justify-center">
                      <span className={typeBadgeClass(transaction.transactionTypeCode)}>
                        {transaction.transactionTypeCode}
                      </span>
                    </div>
                    <span className="truncate text-sm text-[var(--foreground)]">{transaction.categoryLabel}</span>
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
                        onClick={() => handleEdit(transaction)}
                        type="button"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        aria-label="Delete"
                        className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
                        disabled={!canDelete}
                        onClick={() => {
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
          <div className="relative z-10 w-full max-w-sm rounded-xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
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
            <form className="divide-y divide-gray-100" onSubmit={handleSubmit}>
              <div className="space-y-4 p-5">
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

                <ModalField label="Amount" required>
                  <input
                    className={modalInputClass}
                    min="0"
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    type="number"
                    value={amount}
                  />
                </ModalField>

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
              <div className="flex items-center justify-between px-5 py-4">
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
