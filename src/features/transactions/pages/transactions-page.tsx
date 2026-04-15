import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Banknote, Building2, CreditCard, Download, Pencil, Plus, Search, SlidersHorizontal, Trash2, TrendingUp, WalletCards, X } from 'lucide-react'
import { exportFilteredTransactions } from '../../exports/export-service'
import { formatCurrency, formatMonthLabel } from '../../../lib/format'
import {
  deleteTransaction,
  listAvailableMonthKeys,
  listCategories,
  listTransactionTypes,
  listTransactions,
  saveTransaction,
  type Category,
  type LedgerTransaction,
  type TransactionType,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

type LoadState = {
  categories: Category[]
  months: string[]
  transactions: LedgerTransaction[]
  transactionTypes: TransactionType[]
}

const emptyState: LoadState = {
  categories: [],
  months: [],
  transactions: [],
  transactionTypes: [],
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

export function TransactionsPage() {
  const { hasPermission, user } = useAuth()
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'))
  const today = format(new Date(), 'yyyy-MM-dd')
  const [filterDateFrom, setFilterDateFrom] = useState(today)
  const [filterDateTo, setFilterDateTo] = useState(today)
  const [filterTypeId, setFilterTypeId] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const [draftTypeId, setDraftTypeId] = useState('')
  const [draftCategoryId, setDraftCategoryId] = useState('')
  const [formTransactionId, setFormTransactionId] = useState<number | null>(null)
  const [formEntryDate, setFormEntryDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [formTypeId, setFormTypeId] = useState('')
  const [formCategoryId, setFormCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [staffCount, setStaffCount] = useState('')
  const [state, setState] = useState<LoadState>(emptyState)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  const hasDateRange = Boolean(filterDateFrom || filterDateTo)
  const activeFilterCount = [hasDateRange, Boolean(filterTypeId), Boolean(filterCategoryId)].filter(Boolean).length

  const draftFilterCategories = useMemo(
    () =>
      draftTypeId
        ? state.categories.filter((c) => String(c.transactionTypeId) === draftTypeId)
        : state.categories,
    [draftTypeId, state.categories],
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
    if (!searchQuery.trim()) return state.transactions
    const q = searchQuery.toLowerCase()
    return state.transactions.filter(
      (t) =>
        t.description.toLowerCase().includes(q) ||
        t.categoryLabel.toLowerCase().includes(q) ||
        t.transactionTypeCode.toLowerCase().includes(q) ||
        t.entryDate.includes(q),
    )
  }, [state.transactions, searchQuery])

  const loadTransactions = useCallback(
    async (monthOverride = selectedMonth) => {
      const months = await listAvailableMonthKeys()
      const monthToUse =
        months.length > 0 && !months.includes(monthOverride) ? months[0] : monthOverride
      const useDateRange = Boolean(filterDateFrom || filterDateTo)

      const [transactionTypes, categories, transactions] = await Promise.all([
        listTransactionTypes(),
        listCategories(),
        listTransactions({
          categoryId: filterCategoryId ? Number(filterCategoryId) : null,
          dateFrom: useDateRange ? (filterDateFrom || undefined) : undefined,
          dateTo: useDateRange ? (filterDateTo || undefined) : undefined,
          monthKey: useDateRange ? undefined : monthToUse,
          transactionTypeId: filterTypeId ? Number(filterTypeId) : null,
        }),
      ])

      if (monthToUse !== selectedMonth && !useDateRange) {
        setSelectedMonth(monthToUse)
      }

      setState({
        categories,
        months: Array.from(new Set([monthToUse, ...months])).sort().reverse(),
        transactions,
        transactionTypes,
      })
    },
    [filterCategoryId, filterDateFrom, filterDateTo, filterTypeId, selectedMonth],
  )

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

  function resetForm() {
    setFormTransactionId(null)
    setFormEntryDate(format(new Date(), 'yyyy-MM-dd'))
    setFormTypeId('')
    setFormCategoryId('')
    setDescription('')
    setAmount('')
    setStaffCount('')
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

    if (isSaleType && !staffCount) {
      setError('Staff count is required for SALE entries.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await saveTransaction(
        {
          amount: Number(amount),
          categoryId: Number(formCategoryId),
          description: description.trim(),
          entryDate: formEntryDate,
          staffCount: isSaleType ? Number(staffCount) : null,
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
    setIsModalOpen(true)
  }

  function openFilter() {
    setDraftDateFrom(filterDateFrom)
    setDraftDateTo(filterDateTo)
    setDraftTypeId(filterTypeId)
    setDraftCategoryId(filterCategoryId)
    setIsFilterOpen(true)
  }

  function applyFilter() {
    setFilterDateFrom(draftDateFrom)
    setFilterDateTo(draftDateTo)
    setFilterTypeId(draftTypeId)
    setFilterCategoryId(draftCategoryId)
    setIsFilterOpen(false)
  }

  function clearDraftFilters() {
    setDraftDateFrom(today)
    setDraftDateTo(today)
    setDraftTypeId('')
    setDraftCategoryId('')
  }

  async function handleExportTransactions() {
    if (!canExport) return
    const rangeSuffix = filterDateFrom && filterDateTo
      ? `${filterDateFrom}-to-${filterDateTo}`
      : filterDateFrom || filterDateTo || selectedMonth || 'all'
    exportFilteredTransactions(state.transactions, `transactions-${rangeSuffix}.xlsx`)
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
            icon: TrendingUp,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
          },
          {
            label: 'Expenses',
            value: summary.totalExpenses,
            icon: CreditCard,
            color: 'text-red-500',
            bg: 'bg-red-500/10',
          },
          {
            label: 'Operating Exp.',
            value: summary.totalOperating,
            icon: Building2,
            color: 'text-amber-500',
            bg: 'bg-amber-500/10',
          },
          {
            label: 'Net Income',
            value: summary.netIncome,
            icon: Banknote,
            color: summary.netIncome >= 0 ? 'text-indigo-500' : 'text-red-500',
            bg: summary.netIncome >= 0 ? 'bg-indigo-500/10' : 'bg-red-500/10',
          },
        ].map(({ label, value, icon: Icon, color, bg }) => (
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
            <p className={`mt-3 text-2xl font-semibold tabular-nums tracking-tight ${color}`}>
              {formatCurrency(value)}
            </p>
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
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_120px_auto_72px] items-center gap-4 border-b border-[var(--border)] bg-[var(--background)]/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          <span>Details</span>
          <span className="text-center">Type</span>
          <span className="text-right">Amount</span>
          <span />
        </div>

        {displayedTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-[var(--muted)]">
            <WalletCards className="mb-3 h-9 w-9 opacity-25" />
            <p className="text-sm">No transactions found</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {displayedTransactions.map((transaction) => (
              <div
                key={transaction.id}
                className="grid grid-cols-[1fr_120px_auto_72px] items-center gap-4 px-4 py-3 transition hover:bg-[var(--background)]/50"
              >
                {/* Details */}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium leading-tight">
                    {transaction.description || transaction.categoryLabel}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-xs text-[var(--muted)]">
                    <span>{transaction.entryDate}</span>
                    <span>·</span>
                    <span>{transaction.categoryLabel}</span>
                    {transaction.staffCount ? (
                      <>
                        <span>·</span>
                        <span>{transaction.staffCount} staff</span>
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Badge — centered column */}
                <div className="flex justify-center">
                  <span className={typeBadgeClass(transaction.transactionTypeCode)}>
                    {transaction.transactionTypeCode}
                  </span>
                </div>

                {/* Amount */}
                <p className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatCurrency(transaction.amount)}
                </p>

                {/* Actions */}
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
            ))}
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

                {isSaleType ? (
                  <ModalField label="Number of staff" required>
                    <input
                      className={modalInputClass}
                      min="1"
                      onChange={(event) => setStaffCount(event.target.value)}
                      placeholder="0"
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
