import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Gift,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Trophy,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  archiveCustomer,
  listCustomerSummaries,
  saveCustomer,
  setCustomerLoyaltyEnabled,
  type CustomerSummary,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'
import { useAuth } from '../../auth/use-auth'

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CUST_STORAGE_PREFIX = 'business-ledger.customers'

function custPerPageKey(business: string) {
  return `${CUST_STORAGE_PREFIX}.perPage.${business}`
}

function custFiltersKey(business: string) {
  return `${CUST_STORAGE_PREFIX}.filters.${business}`
}

type CustFilters = {
  addedFrom: string
  addedTo: string
  lastTxFrom: string
  lastTxTo: string
  loyaltyMin: number
}

const DEFAULT_CUST_FILTERS: CustFilters = {
  addedFrom: '',
  addedTo: '',
  lastTxFrom: '',
  lastTxTo: '',
  loyaltyMin: 0,
}

const PER_PAGE_OPTIONS = [10, 25, 50, 100]

function readCustPerPage(business: string): number {
  try {
    const raw = window.localStorage.getItem(custPerPageKey(business))
    if (!raw) return 25
    const n = Number(raw)
    return PER_PAGE_OPTIONS.includes(n) ? n : 25
  } catch {
    return 25
  }
}

function readCustFilters(business: string): CustFilters {
  try {
    const raw = window.localStorage.getItem(custFiltersKey(business))
    if (!raw) return { ...DEFAULT_CUST_FILTERS }
    const parsed = JSON.parse(raw) as Partial<CustFilters>
    return { ...DEFAULT_CUST_FILTERS, ...parsed }
  } catch {
    return { ...DEFAULT_CUST_FILTERS }
  }
}

function formatShortDate(dateStr: string) {
  if (!dateStr) return '—'
  try {
    const datePart = dateStr.slice(0, 10)
    return format(new Date(`${datePart}T00:00:00`), 'MMM d, yyyy')
  } catch {
    return dateStr
  }
}

function LoyaltyCell({
  customer,
  canManage,
  onToggle,
}: {
  customer: CustomerSummary
  canManage: boolean
  onToggle: (customer: CustomerSummary, next: boolean) => void
}) {
  if (!customer.isLoyaltyEnabled) {
    if (!canManage) {
      return <span className="text-xs text-[var(--muted)]">Not enrolled</span>
    }
    return (
      <button
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
        onClick={(e) => {
          e.stopPropagation()
          onToggle(customer, true)
        }}
        type="button"
      >
        Enable loyalty
      </button>
    )
  }

  const progress = Math.min(customer.paidLoadsSinceLastReward, customer.freeAfterLoads)
  const pct = customer.freeAfterLoads > 0
    ? Math.min(100, (progress / customer.freeAfterLoads) * 100)
    : 0
  const eligible = customer.isEligibleForReward

  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[var(--background)]">
        <div
          className={`h-full rounded-full transition-all ${eligible ? 'bg-violet-500' : 'bg-[var(--accent)]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="whitespace-nowrap text-xs tabular-nums text-[var(--muted)]">
        {progress.toFixed(progress % 1 === 0 ? 0 : 2)} / {customer.freeAfterLoads}
      </span>
      {eligible ? (
        <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
          Free ready
        </span>
      ) : null}
      {canManage ? (
        <button
          className="text-[11px] text-[var(--muted)] transition hover:text-red-400"
          onClick={(e) => {
            e.stopPropagation()
            onToggle(customer, false)
          }}
          title="Disable loyalty for this customer"
          type="button"
        >
          Disable
        </button>
      ) : null}
    </div>
  )
}

function StatCard({
  icon,
  iconClass,
  label,
  value,
  sub,
}: {
  icon: ReactNode
  iconClass: string
  label: string
  value: string
  sub?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${iconClass}`}>
          {icon}
        </span>
        <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
      </div>
      <p className="mt-2.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-[var(--muted)]">{sub}</p> : null}
    </div>
  )
}

export function CustomersPage() {
  const { activeBusiness, hasPermission, user } = useAuth()
  const isCleaningBusiness = activeBusiness === 'cleaning'
  const navigate = useNavigate()
  const canManage = hasPermission('manage_master_data')

  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [loading, setLoading] = useState(true)
  // Full (unfiltered) base used for summary cards + top customers, so they
  // reflect the whole customer base rather than the current search results.
  const [summaryCustomers, setSummaryCustomers] = useState<CustomerSummary[]>([])
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Pagination
  const [custPage, setCustPage] = useState(0)
  const [custPerPage, setCustPerPage] = useState(() => readCustPerPage(activeBusiness))

  // Filters
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [appliedFilters, setAppliedFilters] = useState<CustFilters>(() => readCustFilters(activeBusiness))
  const [draftFilters, setDraftFilters] = useState<CustFilters>({ ...DEFAULT_CUST_FILTERS })

  // Add / edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formCompany, setFormCompany] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formLoyaltyEnabled, setFormLoyaltyEnabled] = useState(false)
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [confirmArchiveId, setConfirmArchiveId] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listCustomerSummaries({
        includeArchived: false,
        search: debouncedSearch.trim() || undefined,
      })
      setCustomers(rows)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch])

  useEffect(() => {
    void load()
  }, [load])

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const rows = await listCustomerSummaries({ includeArchived: false })
      setSummaryCustomers(rows)
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  // Reload both the table and the summary after a mutation.
  const refresh = useCallback(async () => {
    await Promise.all([load(), loadSummary()])
  }, [load, loadSummary])

  // Persist per-page setting
  useEffect(() => {
    try {
      window.localStorage.setItem(custPerPageKey(activeBusiness), String(custPerPage))
    } catch {
      // ignore storage errors
    }
  }, [activeBusiness, custPerPage])

  // Persist applied filters
  useEffect(() => {
    try {
      window.localStorage.setItem(custFiltersKey(activeBusiness), JSON.stringify(appliedFilters))
    } catch {
      // ignore storage errors
    }
  }, [activeBusiness, appliedFilters])

  // Derive freeAfterLoads for the loyalty slider max value
  const freeAfterLoads = useMemo(() => {
    const found = customers.find((c) => c.freeAfterLoads > 0)
    return found?.freeAfterLoads ?? 9
  }, [customers])

  // Apply client-side filters on top of server-side search results
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      if (appliedFilters.addedFrom) {
        const added = c.createdAt.slice(0, 10)
        if (added < appliedFilters.addedFrom) return false
      }
      if (appliedFilters.addedTo) {
        const added = c.createdAt.slice(0, 10)
        if (added > appliedFilters.addedTo) return false
      }
      if (appliedFilters.lastTxFrom || appliedFilters.lastTxTo) {
        if (!c.lastTransactionDate) return false
        if (appliedFilters.lastTxFrom && c.lastTransactionDate < appliedFilters.lastTxFrom) return false
        if (appliedFilters.lastTxTo && c.lastTransactionDate > appliedFilters.lastTxTo) return false
      }
      if (appliedFilters.loyaltyMin > 0) {
        if (!c.isLoyaltyEnabled) return false
        if (c.paidLoadsSinceLastReward < appliedFilters.loyaltyMin) return false
      }
      return true
    })
  }, [customers, appliedFilters])

  // Reset to page 0 when filtered set or page size changes
  useEffect(() => {
    setCustPage(0)
  }, [filteredCustomers, custPerPage])

  const totalCustPages = Math.max(1, Math.ceil(filteredCustomers.length / custPerPage))
  const pagedCustomers = useMemo(() => {
    const start = custPage * custPerPage
    return filteredCustomers.slice(start, start + custPerPage)
  }, [filteredCustomers, custPage, custPerPage])

  const activeFilterCount = useMemo(() => {
    let n = 0
    if (appliedFilters.addedFrom || appliedFilters.addedTo) n++
    if (appliedFilters.lastTxFrom || appliedFilters.lastTxTo) n++
    if (appliedFilters.loyaltyMin > 0) n++
    return n
  }, [appliedFilters])

  // Summary metrics over the whole customer base (independent of search).
  const stats = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthStartStr = format(monthStart, 'yyyy-MM-dd')
    const cutoff30 = new Date(now)
    cutoff30.setDate(cutoff30.getDate() - 30)
    const cutoff30Str = format(cutoff30, 'yyyy-MM-dd')

    let newThisMonth = 0
    let active30 = 0
    let loyaltyEnrolled = 0
    let rewardsReady = 0
    let totalRevenue = 0

    for (const c of summaryCustomers) {
      if (c.createdAt && c.createdAt.slice(0, 10) >= monthStartStr) newThisMonth++
      if (c.lastTransactionDate && c.lastTransactionDate.slice(0, 10) >= cutoff30Str) active30++
      if (c.isLoyaltyEnabled) loyaltyEnrolled++
      if (c.isEligibleForReward) rewardsReady++
      totalRevenue += c.totalSpent
    }

    const total = summaryCustomers.length
    return {
      active30,
      dormant: total - active30,
      loyaltyEnrolled,
      newThisMonth,
      rewardsReady,
      total,
      totalRevenue,
    }
  }, [summaryCustomers])

  const topCustomers = useMemo(() => {
    return [...summaryCustomers]
      .filter((c) => c.totalSpent > 0)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 5)
  }, [summaryCustomers])

  function openFilter() {
    setDraftFilters({ ...appliedFilters })
    setIsFilterOpen(true)
  }

  function applyFilter() {
    setAppliedFilters({ ...draftFilters })
    setIsFilterOpen(false)
  }

  function clearDraftFilters() {
    setDraftFilters({ ...DEFAULT_CUST_FILTERS })
  }

  function openNew() {
    setEditingId(null)
    setFormName('')
    setFormCompany('')
    setFormEmail('')
    setFormPhone('')
    setFormLoyaltyEnabled(false)
    setModalOpen(true)
  }

  function openEdit(c: CustomerSummary) {
    setEditingId(c.id)
    setFormName(c.name)
    setFormCompany(c.company)
    setFormEmail(c.email)
    setFormPhone(c.phone)
    setFormLoyaltyEnabled(c.isLoyaltyEnabled)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!user || !canManage) return
    if (!formName.trim()) {
      toast.error('Name is required.')
      return
    }
    if (formEmail.trim() && !emailRegex.test(formEmail.trim())) {
      toast.error('Please enter a valid email address.')
      return
    }
    setFormSubmitting(true)
    try {
      await saveCustomer(
        {
          company: formCompany,
          email: formEmail,
          isLoyaltyEnabled: formLoyaltyEnabled,
          name: formName,
          phone: formPhone,
        },
        user.id,
        editingId ?? undefined,
      )
      toast.success(editingId ? 'Customer updated.' : 'Customer added.')
      closeModal()
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to save customer.')
    } finally {
      setFormSubmitting(false)
    }
  }

  async function handleArchive(id: number) {
    if (!user || !canManage) return
    try {
      await archiveCustomer(id, user.id)
      setConfirmArchiveId(null)
      toast.success('Customer archived.')
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to archive customer.')
    }
  }

  async function handleToggleLoyalty(customer: CustomerSummary, next: boolean) {
    if (!user || !canManage) return
    try {
      await setCustomerLoyaltyEnabled(customer.id, next, user.id)
      toast.success(next ? 'Loyalty enabled.' : 'Loyalty disabled.')
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update loyalty.')
    }
  }

  function handleRowClick(id: number) {
    navigate(`/customers/${id}`)
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Manage customer details for sales transactions
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="h-9 w-56 rounded-md border border-[var(--border)] bg-[var(--panel)] pl-8 pr-3 text-sm outline-none focus:border-[var(--accent)] transition"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers…"
              type="search"
              value={search}
            />
          </div>

          {/* Filter button */}
          <button
            className={`relative inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition ${
              activeFilterCount > 0
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                : 'border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] hover:bg-[var(--background)]'
            }`}
            onClick={openFilter}
            type="button"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filter
            {activeFilterCount > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {canManage && (
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-sm font-medium text-white transition hover:opacity-90"
              onClick={openNew}
              type="button"
            >
              <Plus className="h-4 w-4" />
              Add customer
            </button>
          )}
        </div>
      </header>

      {/* Summary cards */}
      {summaryLoading ? (
        <div className={`grid gap-3 sm:grid-cols-2 ${isCleaningBusiness ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
          {Array.from({ length: isCleaningBusiness ? 3 : 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[92px] animate-pulse rounded-lg border border-[var(--border)] bg-[var(--panel)]"
            />
          ))}
        </div>
      ) : (
        <div className={`grid gap-3 sm:grid-cols-2 ${isCleaningBusiness ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
          <StatCard
            icon={<Users className="h-4 w-4 text-[var(--accent-strong)]" />}
            iconClass="bg-[var(--accent-soft)]"
            label="Total customers"
            sub={`${stats.newThisMonth} added this month`}
            value={stats.total.toLocaleString()}
          />
          <StatCard
            icon={<UserPlus className="h-4 w-4 text-sky-600" />}
            iconClass="bg-sky-500/10"
            label="New this month"
            sub="Since the 1st"
            value={stats.newThisMonth.toLocaleString()}
          />
          <StatCard
            icon={<Activity className="h-4 w-4 text-emerald-600" />}
            iconClass="bg-emerald-500/10"
            label="Active (30 days)"
            sub={`${stats.dormant.toLocaleString()} dormant`}
            value={stats.active30.toLocaleString()}
          />
          {!isCleaningBusiness && (
            <StatCard
              icon={<Gift className="h-4 w-4 text-violet-600" />}
              iconClass="bg-violet-500/10"
              label="Loyalty enrolled"
              sub={
                stats.rewardsReady > 0 ? (
                  <span className="font-medium text-violet-600">
                    {stats.rewardsReady} reward{stats.rewardsReady !== 1 ? 's' : ''} ready
                  </span>
                ) : (
                  'No rewards ready'
                )
              }
              value={stats.loyaltyEnrolled.toLocaleString()}
            />
          )}
        </div>
      )}

      {/* Top customers */}
      {!summaryLoading && topCustomers.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Top customers</h2>
            <span className="text-xs text-[var(--muted)]">by total spend</span>
          </div>
          <ul className="mt-4 space-y-2">
            {topCustomers.map((c, i) => {
              const rankClass =
                i === 0
                  ? 'bg-amber-500/15 text-amber-600'
                  : i === 1
                    ? 'bg-slate-400/15 text-slate-500'
                    : i === 2
                      ? 'bg-orange-500/15 text-orange-600'
                      : 'bg-[var(--background)] text-[var(--muted)]'
              return (
                <li key={c.id}>
                  <button
                    className="flex w-full items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-left transition hover:border-[var(--accent)]"
                    onClick={() => handleRowClick(c.id)}
                    type="button"
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${rankClass}`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                        {c.name}
                      </span>
                      <span className="block truncate text-xs text-[var(--muted)]">
                        {c.company || `${c.transactionCount} transaction${c.transactionCount !== 1 ? 's' : ''}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums">
                        {formatCurrency(c.totalSpent)}
                      </span>
                      <span className="block text-xs text-[var(--muted)]">
                        {c.lastTransactionDate
                          ? `Last ${formatShortDate(c.lastTransactionDate)}`
                          : '—'}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading…</div>
      ) : filteredCustomers.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-14 text-center text-sm text-[var(--muted)]">
          {customers.length === 0 ? 'No customers found.' : 'No customers match the current filters.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--background)]/50 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Last Transaction</th>
                  {!isCleaningBusiness && <th className="px-4 py-3">Loyalty</th>}
                  <th className="w-32 px-4 py-3 text-right">Actions</th>
                  <th className="px-4 py-3">Date Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {pagedCustomers.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer transition hover:bg-[var(--background)]/40"
                    onClick={() => handleRowClick(c.id)}
                  >
                    <td className="px-4 py-3 font-medium">
                      <span className="text-[var(--accent-strong)]">{c.name}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">{c.company || '—'}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{c.email || '—'}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{c.phone || '—'}</td>
                    <td className="px-4 py-3">
                      {c.lastTransactionDate ? (
                        <div className="flex flex-col leading-tight">
                          <span className="text-[var(--foreground)]">
                            {formatShortDate(c.lastTransactionDate)}
                          </span>
                          <span className="text-xs tabular-nums text-[var(--muted)]">
                            {c.lastTransactionAmount != null
                              ? formatCurrency(c.lastTransactionAmount)
                              : '—'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">No transactions</span>
                      )}
                    </td>
                    {!isCleaningBusiness && (
                      <td className="px-4 py-3">
                        <LoyaltyCell
                          canManage={canManage}
                          customer={c}
                          onToggle={(customer, next) => {
                            void handleToggleLoyalty(customer, next)
                          }}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {canManage ? (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <button
                            aria-label="Edit"
                            className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
                            onClick={() => openEdit(c)}
                            type="button"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {confirmArchiveId === c.id ? (
                            <span className="flex items-center gap-1">
                              <button
                                className="rounded bg-red-500 px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
                                onClick={() => { void handleArchive(c.id) }}
                                type="button"
                              >
                                Confirm
                              </button>
                              <button
                                className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                                onClick={() => setConfirmArchiveId(null)}
                                type="button"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              aria-label="Archive"
                              className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                              onClick={() => setConfirmArchiveId(c.id)}
                              type="button"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {c.createdAt ? formatShortDate(c.createdAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div className="border-t border-[var(--border)] bg-[var(--background)]/40 px-4 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-[var(--muted)]">
                {filteredCustomers.length === 0
                  ? 'No customers'
                  : `Showing ${custPage * custPerPage + 1}–${Math.min((custPage + 1) * custPerPage, filteredCustomers.length)} of ${filteredCustomers.length} customer${filteredCustomers.length !== 1 ? 's' : ''}`}
                {activeFilterCount > 0 ? ' (filtered)' : ''}
              </span>

              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5 text-[var(--muted)]">
                  Rows per page
                  <select
                    className="h-7 rounded border border-[var(--border)] bg-[var(--panel)] px-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                    onChange={(e) => {
                      setCustPerPage(Number(e.target.value))
                    }}
                    value={custPerPage}
                  >
                    {PER_PAGE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>

                {filteredCustomers.length > custPerPage && (
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--muted)]">
                      Page {custPage + 1} of {totalCustPages}
                    </span>
                    <button
                      className="rounded-md border border-[var(--border)] px-2.5 py-1 font-medium text-[var(--foreground)] transition hover:bg-[var(--background)] disabled:opacity-40"
                      disabled={custPage <= 0}
                      onClick={() => setCustPage((p) => Math.max(0, p - 1))}
                      type="button"
                    >
                      Previous
                    </button>
                    <button
                      className="rounded-md border border-[var(--border)] px-2.5 py-1 font-medium text-[var(--foreground)] transition hover:bg-[var(--background)] disabled:opacity-40"
                      disabled={custPage >= totalCustPages - 1}
                      onClick={() => setCustPage((p) => Math.min(totalCustPages - 1, p + 1))}
                      type="button"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter modal */}
      {isFilterOpen && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsFilterOpen(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-base font-semibold">Filter Customers</h2>
              <button
                className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={() => setIsFilterOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 p-5">
              {/* Date Added range */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Date Added
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-[var(--muted)]">From</label>
                    <input
                      className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none"
                      onChange={(e) => setDraftFilters((f) => ({ ...f, addedFrom: e.target.value }))}
                      type="date"
                      value={draftFilters.addedFrom}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-[var(--muted)]">To</label>
                    <input
                      className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none"
                      onChange={(e) => setDraftFilters((f) => ({ ...f, addedTo: e.target.value }))}
                      type="date"
                      value={draftFilters.addedTo}
                    />
                  </div>
                </div>
              </div>

              {/* Last Transaction range */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Last Transaction
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-[var(--muted)]">From</label>
                    <input
                      className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none"
                      onChange={(e) => setDraftFilters((f) => ({ ...f, lastTxFrom: e.target.value }))}
                      type="date"
                      value={draftFilters.lastTxFrom}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-[var(--muted)]">To</label>
                    <input
                      className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none"
                      onChange={(e) => setDraftFilters((f) => ({ ...f, lastTxTo: e.target.value }))}
                      type="date"
                      value={draftFilters.lastTxTo}
                    />
                  </div>
                </div>
              </div>

              {/* Loyalty slider (hidden for cleaning business) */}
              {!isCleaningBusiness && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                      Min. Loyalty Progress
                    </p>
                    <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-strong)]">
                      {draftFilters.loyaltyMin === 0
                        ? 'Any'
                        : `≥ ${draftFilters.loyaltyMin} load${draftFilters.loyaltyMin !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                  <input
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--border)] accent-[var(--accent)]"
                    max={freeAfterLoads}
                    min={0}
                    onChange={(e) =>
                      setDraftFilters((f) => ({ ...f, loyaltyMin: Number(e.target.value) }))
                    }
                    step={1}
                    type="range"
                    value={draftFilters.loyaltyMin}
                  />
                  <div className="flex justify-between text-[10px] text-[var(--muted)]">
                    <span>0</span>
                    <span>{freeAfterLoads} (max)</span>
                  </div>
                  <p className="text-[11px] text-[var(--muted)]">
                    Only shows customers enrolled in loyalty. Set to 0 to include all.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-4">
              <button
                className="text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
                onClick={clearDraftFilters}
                type="button"
              >
                Clear all
              </button>
              <div className="flex gap-2">
                <button
                  className="h-9 rounded-md border border-[var(--border)] px-4 text-sm font-medium transition hover:bg-[var(--background)]"
                  onClick={() => setIsFilterOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90"
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

      {/* Add / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-base font-semibold">
                {editingId ? 'Edit customer' : 'Add customer'}
              </h2>
              <button
                className="rounded p-1 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={closeModal}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="space-y-4 p-5" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  autoFocus
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Customer name"
                  value={formName}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Company</label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormCompany(e.target.value)}
                  placeholder="Optional"
                  value={formCompany}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Email</label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="Optional"
                  type="email"
                  value={formEmail}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Phone</label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="Optional"
                  value={formPhone}
                />
              </div>

              {!isCleaningBusiness && (
                <label className="flex items-start gap-2.5 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
                  <input
                    checked={formLoyaltyEnabled}
                    className="mt-0.5 h-4 w-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    onChange={(e) => setFormLoyaltyEnabled(e.target.checked)}
                    type="checkbox"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">Enable loyalty card</span>
                    <span className="block text-xs text-[var(--muted)]">
                      Loyalty is not given to first-time customers. Turn this on once they qualify.
                    </span>
                  </span>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="h-9 rounded-md border border-[var(--border)] px-4 text-sm font-medium transition hover:bg-[var(--background)]"
                  onClick={closeModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  disabled={!formName.trim() || formSubmitting || !canManage}
                  type="submit"
                >
                  {formSubmitting ? 'Saving…' : editingId ? 'Update' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
