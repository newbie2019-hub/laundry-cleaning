import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { AlertTriangle, Download, Pencil, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { formatCurrency } from '../../../lib/format'
import {
  deleteIncidentReport,
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

const filterInputClass =
  'h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--accent)] transition'

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

function exportToCsv(reports: IncidentReport[]) {
  const headers = [
    'Date', 'Time', 'Type', 'Description', 'Customer', 'Contact',
    'Action Taken', 'Handled By', 'Staff On Duty', 'Items Involved',
    'Quantity', 'Estimated Loss', 'Remarks',
  ]

  const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`

  const rows = reports.map((r) => [
    r.incidentDate, r.incidentTime, r.incidentType, r.whatHappened,
    r.customerName, r.contactNumber, r.actionTaken, r.handledBy,
    r.staffOnDuty, r.itemsInvolved, r.quantity, r.estimatedLoss, r.remarks,
  ].map((v) => escape(String(v))).join(','))

  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `incident-reports-${format(new Date(), 'yyyy-MM-dd')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function IncidentReportsPage() {
  const { user } = useAuth()
  const [reports, setReports] = useState<IncidentReport[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const loadReports = useCallback(async () => {
    const data = await listIncidentReports({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      incidentType: filterType || undefined,
      search: searchQuery.trim() || undefined,
    })
    setReports(data)
  }, [dateFrom, dateTo, filterType, searchQuery])

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
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilters(false)
      }
    }
    if (showFilters) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showFilters])

  const activeFilterCount = [dateFrom, dateTo, filterType].filter(Boolean).length

  function set<K extends keyof ReturnType<typeof emptyDraft>>(
    key: K,
    value: string,
  ) {
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!user) {
      setError('You must be logged in.')
      return
    }

    if (!draft.incidentDate || !draft.incidentType || !draft.whatHappened || !draft.handledBy) {
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
      await loadReports()
      closeModal()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save incident report.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(id: number) {
    await deleteIncidentReport(id)
    await loadReports()
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
            disabled={reports.length === 0}
            onClick={() => exportToCsv(reports)}
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
            className="h-9 w-56 rounded-md border border-[var(--border)] bg-[var(--background)] pl-8 pr-3 text-sm outline-none focus:border-[var(--accent)] transition"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Customer, description, items…"
            type="search"
            value={searchQuery}
          />
        </div>

        <div className="relative" ref={filterRef}>
          <button
            className={[
              'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition',
              showFilters || activeFilterCount > 0
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                : 'border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--accent)]/50',
            ].join(' ')}
            onClick={() => setShowFilters((p) => !p)}
            type="button"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {showFilters && (
            <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 shadow-lg">
              <div className="space-y-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    From
                  </span>
                  <input
                    className={filterInputClass}
                    onChange={(e) => setDateFrom(e.target.value)}
                    type="date"
                    value={dateFrom}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    To
                  </span>
                  <input
                    className={filterInputClass}
                    onChange={(e) => setDateTo(e.target.value)}
                    type="date"
                    value={dateTo}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Type
                  </span>
                  <select
                    className={filterInputClass}
                    onChange={(e) => setFilterType(e.target.value)}
                    value={filterType}
                  >
                    <option value="">All types</option>
                    {INCIDENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                {activeFilterCount > 0 && (
                  <button
                    className="w-full rounded-md border border-[var(--border)] py-1.5 text-xs font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
                    onClick={() => { setDateFrom(''); setDateTo(''); setFilterType('') }}
                    type="button"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {error && !isModalOpen ? (
        <div className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      ) : null}

      {/* Report list */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-[90px_130px_minmax(0,1.5fr)_minmax(0,1fr)_100px_64px] items-center gap-3 border-b border-[var(--border)] bg-[var(--background)]/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          <span>Date</span>
          <span>Type</span>
          <span>Description</span>
          <span>Handled by</span>
          <span className="text-right">Est. Loss</span>
          <span />
        </div>

        {reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-[var(--muted)]">
            <AlertTriangle className="mb-3 h-9 w-9 opacity-25" />
            <p className="text-sm">No incident reports found</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {reports.map((report) => (
              <div
                key={report.id}
                className="grid grid-cols-[90px_130px_minmax(0,1.5fr)_minmax(0,1fr)_100px_64px] items-center gap-3 px-4 py-3 transition hover:bg-[var(--background)]/50"
              >
                {/* Date + time */}
                <div>
                  <p className="text-sm font-medium tabular-nums">{report.incidentDate}</p>
                  {report.incidentTime ? (
                    <p className="text-xs text-[var(--muted)]">{report.incidentTime}</p>
                  ) : null}
                </div>

                {/* Type badge */}
                <div>
                  <span className={typeBadgeClass(report.incidentType)}>
                    {report.incidentType || '—'}
                  </span>
                </div>

                {/* Description */}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium leading-tight">
                    {report.whatHappened || '—'}
                  </p>
                  {report.customerName ? (
                    <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                      Customer: {report.customerName}
                    </p>
                  ) : null}
                </div>

                {/* Handled by */}
                <p className="truncate text-sm text-[var(--muted)]">{report.handledBy || '—'}</p>

                {/* Estimated loss */}
                <p className="text-right text-sm font-semibold tabular-nums">
                  {report.estimatedLoss > 0 ? formatCurrency(report.estimatedLoss) : '—'}
                </p>

                {/* Actions */}
                <div className="flex items-center justify-end gap-0.5">
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

        {reports.length > 0 && (
          <div className="border-t border-[var(--border)] bg-[var(--background)]/40 px-4 py-2 text-xs text-[var(--muted)]">
            {reports.length} report{reports.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

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
