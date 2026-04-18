import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { endOfMonth, format } from 'date-fns'
import { exportFilteredIncidentReports } from '../../exports/export-service'
import { MonthPicker } from '../../../components/month-picker'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Eye,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { formatCurrency } from '../../../lib/format'
import {
  deleteIncidentReport,
  listDistinctIncidentCustomerNames,
  listDistinctIncidentHandledBy,
  listIncidentReports,
  saveIncidentReport,
  type IncidentReport,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

const INCIDENT_TYPES = [
  'Theft',
  'Shoplifting',
  'Damage to Property',
  'Accident / Injury',
  'Customer Complaint',
  'Harassment',
  'Fire / Emergency',
  'Other',
]

const TYPE_COLORS: Record<string, string> = {
  Theft: 'bg-red-500/15 text-red-600',
  Shoplifting: 'bg-red-500/15 text-red-600',
  'Damage to Property': 'bg-orange-500/15 text-orange-600',
  'Accident / Injury': 'bg-amber-500/15 text-amber-600',
  'Customer Complaint': 'bg-blue-500/15 text-blue-600',
  Harassment: 'bg-purple-500/15 text-purple-600',
  'Fire / Emergency': 'bg-rose-600/15 text-rose-600',
  Other: 'bg-gray-500/15 text-gray-500',
}

function typeBadgeClass(type: string) {
  return [
    'inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap',
    TYPE_COLORS[type] ?? 'bg-gray-500/15 text-gray-500',
  ].join(' ')
}

function formatIncidentDisplayDate(incidentDate: string) {
  if (!incidentDate) return '—'
  return format(new Date(`${incidentDate}T00:00:00`), 'MMM d, yyyy')
}

function formatTimeTo12Hour(time: string): string {
  if (!time) return ''
  const [hStr, mStr = '00'] = time.split(':')
  const h = Number(hStr)
  if (!Number.isFinite(h)) return time
  const period = h >= 12 ? 'PM' : 'AM'
  const display = ((h + 11) % 12) + 1
  return `${display}:${mStr.padStart(2, '0')} ${period}`
}

type SortKey =
  | 'customer'
  | 'date'
  | 'handledBy'
  | 'loss'
  | 'remarks'
  | 'staff'
  | 'type'

function compareReportsForSort(
  a: IncidentReport,
  b: IncidentReport,
  key: SortKey,
  dir: 'asc' | 'desc',
): number {
  const sign = dir === 'asc' ? 1 : -1
  const cmpStr = (x: string, y: string) =>
    (x || '').localeCompare(y || '', undefined, { sensitivity: 'base' })
  let cmp = 0
  switch (key) {
    case 'date': {
      cmp = (a.incidentDate || '').localeCompare(b.incidentDate || '')
      if (cmp === 0) cmp = (a.incidentTime || '').localeCompare(b.incidentTime || '')
      break
    }
    case 'type':
      cmp = cmpStr(a.incidentType, b.incidentType)
      break
    case 'customer':
      cmp = cmpStr(a.customerName, b.customerName)
      break
    case 'staff':
      cmp = cmpStr(a.staffOnDuty, b.staffOnDuty)
      break
    case 'handledBy':
      cmp = cmpStr(a.handledBy, b.handledBy)
      break
    case 'remarks':
      cmp = cmpStr(a.remarks, b.remarks)
      break
    case 'loss':
      cmp = a.estimatedLoss - b.estimatedLoss
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
  activeKey: SortKey
  align?: 'center' | 'left' | 'right'
  dir: 'asc' | 'desc'
  label: string
  onSort: (key: SortKey) => void
  sortKey: SortKey
}) {
  const isActive = activeKey === sortKey
  const justify =
    align === 'center'
      ? 'justify-center'
      : align === 'right'
        ? 'justify-end text-right'
        : 'justify-start text-left'
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

const modalTextareaClass =
  'w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition resize-none placeholder:text-gray-400'

function emptyDraft() {
  return {
    incidentDate: format(new Date(), 'yyyy-MM-dd'),
    incidentTime: format(new Date(), 'HH:mm'),
    staffOnDuty: '',
    incidentType: '',
    whatHappened: '',
    customerName: '',
    contactNumber: '',
    actionTaken: '',
    handledBy: '',
    estimatedLoss: '',
    quantity: '',
    itemsInvolved: '',
    remarks: '',
  }
}

type FilterPeriodMode = 'dateRange' | 'month'

const TABLE_GRID =
  'grid-cols-[110px_120px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_110px_minmax(0,1fr)_96px]'

export function IncidentReportsPage() {
  const { user } = useAuth()
  const currentMonthKey = format(new Date(), 'yyyy-MM')

  const [reports, setReports] = useState<IncidentReport[]>([])
  const [customerOptions, setCustomerOptions] = useState<string[]>([])
  const [handledByOptions, setHandledByOptions] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  const [filterPeriodMode, setFilterPeriodMode] = useState<FilterPeriodMode>('month')
  const [filterMonthKey, setFilterMonthKey] = useState(currentMonthKey)
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCustomer, setFilterCustomer] = useState('')
  const [filterHandledBy, setFilterHandledBy] = useState('')

  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [draftPeriodMode, setDraftPeriodMode] = useState<FilterPeriodMode>('month')
  const [draftMonthKey, setDraftMonthKey] = useState(currentMonthKey)
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const [draftType, setDraftType] = useState('')
  const [draftCustomer, setDraftCustomer] = useState('')
  const [draftHandledBy, setDraftHandledBy] = useState('')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [detailsReport, setDetailsReport] = useState<IncidentReport | null>(null)

  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const activeFilterCount = [
    filterPeriodMode === 'month'
      ? filterMonthKey !== currentMonthKey
      : Boolean(filterDateFrom) || Boolean(filterDateTo),
    Boolean(filterType),
    Boolean(filterCustomer),
    Boolean(filterHandledBy),
  ].filter(Boolean).length

  const loadReports = useCallback(async () => {
    const data = await listIncidentReports({
      customerName: filterCustomer || undefined,
      dateFrom:
        filterPeriodMode === 'dateRange' && filterDateFrom ? filterDateFrom : undefined,
      dateTo: filterPeriodMode === 'dateRange' && filterDateTo ? filterDateTo : undefined,
      handledBy: filterHandledBy || undefined,
      incidentType: filterType || undefined,
      month: filterPeriodMode === 'month' ? filterMonthKey : undefined,
      search: searchQuery.trim() || undefined,
    })
    setReports(data)
  }, [
    filterCustomer,
    filterDateFrom,
    filterDateTo,
    filterHandledBy,
    filterMonthKey,
    filterPeriodMode,
    filterType,
    searchQuery,
  ])

  const loadOptions = useCallback(async () => {
    const [customers, handledBy] = await Promise.all([
      listDistinctIncidentCustomerNames(),
      listDistinctIncidentHandledBy(),
    ])
    setCustomerOptions(customers)
    setHandledByOptions(handledBy)
  }, [])

  useEffect(() => {
    let mounted = true

    loadReports().catch((err: unknown) => {
      if (mounted) {
        setError(err instanceof Error ? err.message : 'Unable to load incident reports.')
      }
    })

    return () => {
      mounted = false
    }
  }, [loadReports])

  useEffect(() => {
    let mounted = true
    loadOptions().catch(() => {
      if (!mounted) return
    })
    return () => {
      mounted = false
    }
  }, [loadOptions])

  const displayedReports = useMemo(() => {
    return [...reports].sort((a, b) => compareReportsForSort(a, b, sortKey, sortDir))
  }, [reports, sortDir, sortKey])

  function handleColumnSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'date' || key === 'loss' ? 'desc' : 'asc')
    }
  }

  function set<K extends keyof ReturnType<typeof emptyDraft>>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function openNew() {
    setEditingId(null)
    setDraft(emptyDraft())
    setError(null)
    setIsModalOpen(true)
  }

  function openEdit(report: IncidentReport) {
    setEditingId(report.id)
    setDraft({
      incidentDate: report.incidentDate,
      incidentTime: report.incidentTime,
      staffOnDuty: report.staffOnDuty,
      incidentType: report.incidentType,
      whatHappened: report.whatHappened,
      customerName: report.customerName,
      contactNumber: report.contactNumber,
      actionTaken: report.actionTaken,
      handledBy: report.handledBy,
      estimatedLoss: String(report.estimatedLoss),
      quantity: String(report.quantity),
      itemsInvolved: report.itemsInvolved,
      remarks: report.remarks,
    })
    setError(null)
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingId(null)
    setDraft(emptyDraft())
    setError(null)
  }

  function openFilter() {
    setDraftPeriodMode(filterPeriodMode)
    setDraftMonthKey(filterMonthKey)
    setDraftDateFrom(filterDateFrom)
    setDraftDateTo(filterDateTo)
    setDraftType(filterType)
    setDraftCustomer(filterCustomer)
    setDraftHandledBy(filterHandledBy)
    setIsFilterOpen(true)
  }

  function applyFilter() {
    setFilterPeriodMode(draftPeriodMode)
    if (draftPeriodMode === 'dateRange') {
      const from = draftDateFrom || ''
      let to = draftDateTo || from
      if (from && to && to < from) to = from
      setFilterDateFrom(from)
      setFilterDateTo(to)
    } else {
      setFilterMonthKey(
        draftMonthKey && draftMonthKey.length >= 7 ? draftMonthKey : currentMonthKey,
      )
    }
    setFilterType(draftType)
    setFilterCustomer(draftCustomer)
    setFilterHandledBy(draftHandledBy)
    setIsFilterOpen(false)
  }

  function clearDraftFilters() {
    setDraftPeriodMode('month')
    setDraftMonthKey(currentMonthKey)
    setDraftDateFrom('')
    setDraftDateTo('')
    setDraftType('')
    setDraftCustomer('')
    setDraftHandledBy('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!user) {
      setError('You must be logged in.')
      return
    }

    if (
      !draft.incidentDate ||
      !draft.incidentType ||
      !draft.whatHappened ||
      !draft.handledBy
    ) {
      setError('Date, type, description, and handled-by are required.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await saveIncidentReport(
        {
          incidentDate: draft.incidentDate,
          incidentTime: draft.incidentTime,
          staffOnDuty: draft.staffOnDuty,
          incidentType: draft.incidentType,
          whatHappened: draft.whatHappened,
          customerName: draft.customerName,
          contactNumber: draft.contactNumber,
          actionTaken: draft.actionTaken,
          handledBy: draft.handledBy,
          estimatedLoss: draft.estimatedLoss ? Number(draft.estimatedLoss) : 0,
          quantity: draft.quantity ? Number(draft.quantity) : 0,
          itemsInvolved: draft.itemsInvolved,
          remarks: draft.remarks,
        },
        user.id,
        editingId ?? undefined,
      )
      await Promise.all([loadReports(), loadOptions()])
      closeModal()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save incident report.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(id: number) {
    await deleteIncidentReport(id)
    await Promise.all([loadReports(), loadOptions()])
  }

  async function handleExport() {
    const rangeSuffix =
      filterPeriodMode === 'month'
        ? filterMonthKey
        : filterDateFrom && filterDateTo
          ? `${filterDateFrom}-to-${filterDateTo}`
          : filterDateFrom || filterDateTo || 'all'
    await exportFilteredIncidentReports(
      displayedReports,
      `incident-reports-${rangeSuffix}.xlsx`,
    )
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Incident Reports</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Log, track, and manage all on-site incidents
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)] disabled:opacity-50"
            disabled={displayedReports.length === 0}
            onClick={() => {
              void handleExport()
            }}
            type="button"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
            onClick={openNew}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
            New report
          </button>
        </div>
      </header>

      {/* Search + Filter */}
      <div className="flex items-center justify-end gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
          <input
            className="h-9 w-64 rounded-md border border-[var(--border)] bg-[var(--panel)] pl-8 pr-3 text-sm outline-none focus:border-[var(--accent)] transition"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Customer, description, items…"
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

      {error && !isModalOpen ? (
        <div className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      ) : null}

      {/* Report list */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[1200px]">
            <div
              className={`grid ${TABLE_GRID} items-center gap-3 border-b border-[var(--border)] bg-[var(--background)]/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]`}
            >
              <SortableColumnHeader
                activeKey={sortKey}
                dir={sortDir}
                label="Date"
                onSort={handleColumnSort}
                sortKey="date"
              />
              <SortableColumnHeader
                activeKey={sortKey}
                dir={sortDir}
                label="Type"
                onSort={handleColumnSort}
                sortKey="type"
              />
              <span className="truncate">Description</span>
              <SortableColumnHeader
                activeKey={sortKey}
                dir={sortDir}
                label="Customer"
                onSort={handleColumnSort}
                sortKey="customer"
              />
              <SortableColumnHeader
                activeKey={sortKey}
                dir={sortDir}
                label="Staff on duty"
                onSort={handleColumnSort}
                sortKey="staff"
              />
              <SortableColumnHeader
                activeKey={sortKey}
                dir={sortDir}
                label="Handled by"
                onSort={handleColumnSort}
                sortKey="handledBy"
              />
              <SortableColumnHeader
                activeKey={sortKey}
                align="right"
                dir={sortDir}
                label="Est. Loss"
                onSort={handleColumnSort}
                sortKey="loss"
              />
              <SortableColumnHeader
                activeKey={sortKey}
                dir={sortDir}
                label="Remarks"
                onSort={handleColumnSort}
                sortKey="remarks"
              />
              <span className="sr-only">Actions</span>
            </div>

            {displayedReports.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-[var(--muted)]">
                <AlertTriangle className="mb-3 h-9 w-9 opacity-25" />
                <p className="text-sm">No incident reports found</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {displayedReports.map((report) => (
                  <div
                    key={report.id}
                    className={`grid ${TABLE_GRID} items-center gap-3 px-4 py-3 transition hover:bg-[var(--background)]/50`}
                  >
                    {/* Date + time */}
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium tabular-nums">
                        {formatIncidentDisplayDate(report.incidentDate)}
                      </p>
                      {report.incidentTime ? (
                        <p className="truncate text-xs text-[var(--muted)]">
                          {formatTimeTo12Hour(report.incidentTime)}
                        </p>
                      ) : null}
                    </div>

                    {/* Type badge */}
                    <div className="min-w-0">
                      <span className={typeBadgeClass(report.incidentType)}>
                        {report.incidentType || '—'}
                      </span>
                    </div>

                    {/* Description */}
                    <p
                      className="truncate text-sm text-[var(--foreground)]"
                      title={report.whatHappened}
                    >
                      {report.whatHappened || '—'}
                    </p>

                    {/* Customer */}
                    <p
                      className="truncate text-sm text-[var(--muted)]"
                      title={report.customerName}
                    >
                      {report.customerName || '—'}
                    </p>

                    {/* Staff on duty */}
                    <p
                      className="truncate text-sm text-[var(--muted)]"
                      title={report.staffOnDuty}
                    >
                      {report.staffOnDuty || '—'}
                    </p>

                    {/* Handled by */}
                    <p
                      className="truncate text-sm text-[var(--muted)]"
                      title={report.handledBy}
                    >
                      {report.handledBy || '—'}
                    </p>

                    {/* Estimated loss */}
                    <p className="whitespace-nowrap text-right text-sm font-semibold tabular-nums">
                      {report.estimatedLoss > 0
                        ? formatCurrency(report.estimatedLoss)
                        : '—'}
                    </p>

                    {/* Remarks */}
                    <p
                      className="truncate text-sm text-[var(--muted)]"
                      title={report.remarks}
                    >
                      {report.remarks || '—'}
                    </p>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        aria-label="View details"
                        className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
                        onClick={() => setDetailsReport(report)}
                        type="button"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        aria-label="Edit"
                        className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
                        onClick={() => openEdit(report)}
                        type="button"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        aria-label="Delete"
                        className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500"
                        onClick={() => {
                          void handleDelete(report.id)
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
          </div>
        </div>

        {displayedReports.length > 0 && (
          <div className="border-t border-[var(--border)] bg-[var(--background)]/40 px-4 py-2 text-xs text-[var(--muted)]">
            {displayedReports.length} report{displayedReports.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Details dialog */}
      {detailsReport && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDetailsReport(null)}
          />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-gray-900">Incident details</h2>
                <span className={typeBadgeClass(detailsReport.incidentType)}>
                  {detailsReport.incidentType || '—'}
                </span>
              </div>
              <button
                className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                onClick={() => setDetailsReport(null)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 overflow-y-auto p-5 sm:grid-cols-2">
              <DetailRow
                label="Date"
                value={formatIncidentDisplayDate(detailsReport.incidentDate)}
              />
              <DetailRow
                label="Time"
                value={formatTimeTo12Hour(detailsReport.incidentTime) || '—'}
              />
              <DetailRow
                label="Customer"
                value={detailsReport.customerName || '—'}
              />
              <DetailRow
                label="Contact number"
                value={detailsReport.contactNumber || '—'}
              />
              <DetailRow
                label="Staff on duty"
                value={detailsReport.staffOnDuty || '—'}
              />
              <DetailRow
                label="Handled by"
                value={detailsReport.handledBy || '—'}
              />
              <DetailRow
                label="Items involved"
                value={detailsReport.itemsInvolved || '—'}
              />
              <DetailRow
                label="Quantity"
                value={
                  detailsReport.quantity ? String(detailsReport.quantity) : '—'
                }
              />
              <DetailRow
                label="Estimated loss"
                value={
                  detailsReport.estimatedLoss > 0
                    ? formatCurrency(detailsReport.estimatedLoss)
                    : '—'
                }
              />
              <DetailRow
                label="Logged by"
                value={detailsReport.createdByName || '—'}
              />
              <DetailRow
                className="sm:col-span-2"
                label="What happened"
                value={detailsReport.whatHappened || '—'}
              />
              <DetailRow
                className="sm:col-span-2"
                label="Action taken"
                value={detailsReport.actionTaken || '—'}
              />
              <DetailRow
                className="sm:col-span-2"
                label="Remarks"
                value={detailsReport.remarks || '—'}
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
                onClick={() => setDetailsReport(null)}
                type="button"
              >
                Close
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                onClick={() => {
                  const r = detailsReport
                  setDetailsReport(null)
                  openEdit(r)
                }}
                type="button"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter dialog */}
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
                      if (!draftDateFrom || !draftDateTo) {
                        const from = `${draftMonthKey}-01`
                        const to = format(
                          endOfMonth(new Date(`${draftMonthKey}-01T12:00:00`)),
                          'yyyy-MM-dd',
                        )
                        setDraftDateFrom(from)
                        setDraftDateTo(to)
                      }
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

              <ModalField label="Incident type">
                <select
                  className={modalSelectClass}
                  onChange={(e) => setDraftType(e.target.value)}
                  value={draftType}
                >
                  <option value="">All types</option>
                  {INCIDENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </ModalField>

              <ModalField label="Customer name">
                <select
                  className={modalSelectClass}
                  onChange={(e) => setDraftCustomer(e.target.value)}
                  value={draftCustomer}
                >
                  <option value="">All customers</option>
                  {customerOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </ModalField>

              <ModalField label="Handled by">
                <select
                  className={modalSelectClass}
                  onChange={(e) => setDraftHandledBy(e.target.value)}
                  value={draftHandledBy}
                >
                  <option value="">All staff</option>
                  {handledByOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
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

      {/* Side sheet */}
      {isModalOpen && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
            onClick={closeModal}
          />

          <div
            className="relative z-10 flex h-full w-full max-w-md flex-col bg-[var(--panel)] shadow-2xl transition-transform duration-200"
            style={{ animation: 'slide-in-right 0.2s ease-out' }}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-base font-semibold">
                {editingId ? 'Edit incident report' : 'New incident report'}
              </h2>
              <button
                className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={closeModal}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form body */}
            <form
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              onSubmit={handleSubmit}
            >
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                {/* Date + Time */}
                <div className="grid grid-cols-2 gap-3">
                  <ModalField label="Date" required>
                    <input
                      className={modalInputClass}
                      onChange={(e) => set('incidentDate', e.target.value)}
                      type="date"
                      value={draft.incidentDate}
                    />
                  </ModalField>
                  <ModalField label="Time">
                    <input
                      className={modalInputClass}
                      onChange={(e) => set('incidentTime', e.target.value)}
                      type="time"
                      value={draft.incidentTime}
                    />
                  </ModalField>
                </div>

                <ModalField label="Staff on duty">
                  <input
                    className={modalInputClass}
                    onChange={(e) => set('staffOnDuty', e.target.value)}
                    placeholder="Name of staff on duty"
                    type="text"
                    value={draft.staffOnDuty}
                  />
                </ModalField>

                <ModalField label="Type of incident" required>
                  <select
                    className={modalSelectClass}
                    onChange={(e) => set('incidentType', e.target.value)}
                    value={draft.incidentType}
                  >
                    <option value="">Select a type</option>
                    {INCIDENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </ModalField>

                <ModalField label="What happened" required>
                  <textarea
                    className={modalTextareaClass}
                    onChange={(e) => set('whatHappened', e.target.value)}
                    placeholder="Describe the incident in detail…"
                    rows={3}
                    value={draft.whatHappened}
                  />
                </ModalField>

                <div className="grid grid-cols-2 gap-3">
                  <ModalField label="Customer name">
                    <input
                      className={modalInputClass}
                      onChange={(e) => set('customerName', e.target.value)}
                      placeholder="Full name"
                      type="text"
                      value={draft.customerName}
                    />
                  </ModalField>
                  <ModalField label="Contact number">
                    <input
                      className={modalInputClass}
                      onChange={(e) => set('contactNumber', e.target.value)}
                      placeholder="e.g. 09XX XXX XXXX"
                      type="text"
                      value={draft.contactNumber}
                    />
                  </ModalField>
                </div>

                <ModalField label="Action taken">
                  <textarea
                    className={modalTextareaClass}
                    onChange={(e) => set('actionTaken', e.target.value)}
                    placeholder="What was done to resolve or address the incident…"
                    rows={2}
                    value={draft.actionTaken}
                  />
                </ModalField>

                <ModalField label="Handled by" required>
                  <input
                    className={modalInputClass}
                    onChange={(e) => set('handledBy', e.target.value)}
                    placeholder="Name of person who handled this"
                    type="text"
                    value={draft.handledBy}
                  />
                </ModalField>

                <ModalField label="Items involved">
                  <input
                    className={modalInputClass}
                    onChange={(e) => set('itemsInvolved', e.target.value)}
                    placeholder="e.g. 2× shirt, 1× bag"
                    type="text"
                    value={draft.itemsInvolved}
                  />
                </ModalField>

                <div className="grid grid-cols-2 gap-3">
                  <ModalField label="Quantity">
                    <input
                      className={modalInputClass}
                      min="0"
                      onChange={(e) => set('quantity', e.target.value)}
                      placeholder="0"
                      step="any"
                      type="number"
                      value={draft.quantity}
                    />
                  </ModalField>
                  <ModalField label="Estimated loss (₱)">
                    <input
                      className={modalInputClass}
                      min="0"
                      onChange={(e) => set('estimatedLoss', e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                      value={draft.estimatedLoss}
                    />
                  </ModalField>
                </div>

                <ModalField label="Remarks">
                  <textarea
                    className={modalTextareaClass}
                    onChange={(e) => set('remarks', e.target.value)}
                    placeholder="Any additional notes…"
                    rows={2}
                    value={draft.remarks}
                  />
                </ModalField>

                {error ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
                    {error}
                  </div>
                ) : null}
              </div>

              {/* Footer */}
              <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-5 py-4">
                <p className="text-xs text-[var(--muted)]">
                  <span className="text-red-500">*</span> Required fields
                </p>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--background)]"
                    onClick={closeModal}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                    disabled={isSubmitting}
                    type="submit"
                  >
                    {isSubmitting ? 'Saving…' : editingId ? 'Update' : 'Save'}
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

function DetailRow({
  className,
  label,
  value,
}: {
  className?: string
  label: string
  value: string
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <span className="whitespace-pre-wrap break-words text-sm text-gray-900">
        {value}
      </span>
    </div>
  )
}
