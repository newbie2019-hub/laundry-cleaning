import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { CalendarClock, ClipboardList, Pencil, Plus, Trash2, Wrench, X } from 'lucide-react'
import { formatCurrency } from '../../../lib/format'
import {
  deleteMaintenanceRecord,
  listMaintenanceRecords,
  saveMaintenanceRecord,
  type MaintenanceRecord,
  type MaintenanceStatus,
} from '../../../lib/db/repository'

const SERVICE_TYPES = [
  { value: 'preventive', label: 'Preventive' },
  { value: 'repair', label: 'Repair' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'replacement', label: 'Parts Replacement' },
  { value: 'other', label: 'Other' },
] as const

const SERVICE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SERVICE_TYPES.map((t) => [t.value, t.label]),
)

const STATUS_OPTIONS: Array<{ label: string; value: MaintenanceStatus }> = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STATUS_COLORS: Record<MaintenanceStatus, string> = {
  cancelled: 'bg-gray-500/15 text-[var(--muted)]',
  completed: 'bg-emerald-500/15 text-emerald-600',
  in_progress: 'bg-amber-500/15 text-amber-600',
  scheduled: 'bg-blue-500/15 text-blue-600',
}

const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  cancelled: 'Cancelled',
  completed: 'Completed',
  in_progress: 'In Progress',
  scheduled: 'Scheduled',
}

const inputClass =
  'h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition placeholder:text-[var(--muted)]'
const selectClass =
  'h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition'
const textareaClass =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition resize-none placeholder:text-[var(--muted)]'

function ModalField({ label, required, children }: { children: ReactNode; label: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-[var(--foreground)]">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

export type MaintenanceTarget = {
  currentStatus: string
  id: number
  lastMaintenanceDate: string
  name: string
}

type Mode = 'list' | 'form'

export function MaintenanceModal({
  item,
  onClose,
  onSaved,
  open,
  userId,
}: {
  item: MaintenanceTarget | null
  onClose: () => void
  onSaved: () => void | Promise<void>
  open: boolean
  userId: number | null
}) {
  const [mode, setMode] = useState<Mode>('list')
  const [records, setRecords] = useState<MaintenanceRecord[]>([])
  const [loading, setLoading] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [serviceDate, setServiceDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [serviceType, setServiceType] = useState<string>('preventive')
  const [status, setStatus] = useState<MaintenanceStatus>('completed')
  const [performedBy, setPerformedBy] = useState('')
  const [cost, setCost] = useState('')
  const [description, setDescription] = useState('')
  const [nextServiceDate, setNextServiceDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const loadRecords = useCallback(async () => {
    if (!item) return
    setLoading(true)
    try {
      const data = await listMaintenanceRecords({ itemId: item.id })
      setRecords(data)
    } catch {
      /* silently ignore */
    } finally {
      setLoading(false)
    }
  }, [item])

  useEffect(() => {
    if (open && item) {
      setMode('list')
      setEditingId(null)
      setError(null)
      void loadRecords()
    }
  }, [open, item, loadRecords])

  function resetForm() {
    setEditingId(null)
    setServiceDate(format(new Date(), 'yyyy-MM-dd'))
    setServiceType('preventive')
    setStatus('completed')
    setPerformedBy('')
    setCost('')
    setDescription('')
    setNextServiceDate('')
    setError(null)
  }

  function openAddForm() {
    resetForm()
    setMode('form')
  }

  function openEditForm(record: MaintenanceRecord) {
    setEditingId(record.id)
    setServiceDate(record.serviceDate)
    setServiceType(record.serviceType)
    setStatus(record.status)
    setPerformedBy(record.performedBy)
    setCost(String(record.cost || ''))
    setDescription(record.description)
    setNextServiceDate(record.nextServiceDate)
    setError(null)
    setMode('form')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!item || !userId) return
    if (!serviceDate) { setError('Service date is required.'); return }
    const costValue = parseFloat(cost || '0')
    if (isNaN(costValue) || costValue < 0) { setError('Cost must be non-negative.'); return }

    setSubmitting(true)
    setError(null)
    try {
      await saveMaintenanceRecord(
        {
          cost: costValue,
          description: description.trim(),
          itemId: item.id,
          nextServiceDate: nextServiceDate || '',
          performedBy: performedBy.trim(),
          serviceDate,
          serviceType,
          status,
        },
        userId,
        editingId ?? undefined,
      )
      await loadRecords()
      await onSaved()
      setMode('list')
      resetForm()
    } catch {
      setError('Failed to save record.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(recordId: number) {
    if (!window.confirm('Delete this service record? This cannot be undone.')) return
    try {
      await deleteMaintenanceRecord(recordId)
      await loadRecords()
      await onSaved()
    } catch {
      /* ignore */
    }
  }

  if (!open || !item) return null

  const completedCount = records.filter((r) => r.status === 'completed').length
  const openCount = records.filter((r) => r.status === 'scheduled' || r.status === 'in_progress').length
  const totalCost = records.filter((r) => r.status === 'completed').reduce((s, r) => s + r.cost, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600">
              <Wrench className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                {mode === 'form' ? (editingId ? 'Edit Service Record' : 'New Service Record') : 'Service & Maintenance'}
              </h2>
              <p className="text-xs text-[var(--muted)] mt-0.5">{item.name}</p>
            </div>
          </div>
          <button
            className="rounded p-1 text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--muted)]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === 'list' ? (
          <div className="p-5 space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Completed</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--foreground)]">{completedCount}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Open</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--foreground)]">{openCount}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Total Spent</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--foreground)]">{formatCurrency(totalCost)}</p>
              </div>
            </div>

            {/* Current status banner */}
            {item.currentStatus && (
              <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--muted)]">
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Current status: <strong className="capitalize">{item.currentStatus.replace('_', ' ')}</strong>
                </span>
                {item.lastMaintenanceDate && (
                  <span className="ml-auto">
                    Last serviced: <strong>{item.lastMaintenanceDate}</strong>
                  </span>
                )}
              </div>
            )}

            {/* Action row */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Service History</h3>
              <button
                className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                onClick={openAddForm}
                type="button"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Record
              </button>
            </div>

            {/* Records list */}
            {loading ? (
              <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border)] py-10 text-[var(--muted)]">
                <ClipboardList className="h-8 w-8 opacity-50" />
                <p className="text-sm">No service records yet.</p>
                <button
                  className="mt-1 text-xs font-medium text-blue-600 hover:underline"
                  onClick={openAddForm}
                  type="button"
                >
                  Log the first service
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {records.map((record) => (
                  <div
                    key={record.id}
                    className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 transition hover:border-[var(--border)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[var(--foreground)] tabular-nums">
                            {record.serviceDate}
                          </span>
                          <span className="text-xs text-[var(--muted)]">·</span>
                          <span className="text-xs font-medium text-[var(--foreground)]">
                            {SERVICE_TYPE_LABELS[record.serviceType] ?? record.serviceType}
                          </span>
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_COLORS[record.status]}`}>
                            {STATUS_LABELS[record.status]}
                          </span>
                          {record.cost > 0 && (
                            <span className="text-xs font-semibold tabular-nums text-[var(--foreground)]">
                              {formatCurrency(record.cost)}
                            </span>
                          )}
                        </div>
                        {record.performedBy && (
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            By <strong className="text-[var(--foreground)]">{record.performedBy}</strong>
                          </p>
                        )}
                        {record.description && (
                          <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
                            {record.description}
                          </p>
                        )}
                        {record.nextServiceDate && (
                          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-600">
                            <CalendarClock className="h-3 w-3" />
                            Next due: {record.nextServiceDate}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          aria-label="Edit"
                          className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                          onClick={() => openEditForm(record)}
                          type="button"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          aria-label="Delete"
                          className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500"
                          onClick={() => handleDelete(record.id)}
                          type="button"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <form className="space-y-4 p-5" onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-3">
              <ModalField label="Service Date" required>
                <input
                  autoFocus
                  className={inputClass}
                  onChange={(e) => setServiceDate(e.target.value)}
                  type="date"
                  value={serviceDate}
                />
              </ModalField>
              <ModalField label="Service Type" required>
                <select className={selectClass} onChange={(e) => setServiceType(e.target.value)} value={serviceType}>
                  {SERVICE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </ModalField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ModalField label="Status" required>
                <select
                  className={selectClass}
                  onChange={(e) => setStatus(e.target.value as MaintenanceStatus)}
                  value={status}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </ModalField>
              <ModalField label="Cost">
                <input
                  className={inputClass}
                  min="0"
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  type="number"
                  value={cost}
                />
              </ModalField>
            </div>

            <ModalField label="Performed By">
              <input
                className={inputClass}
                onChange={(e) => setPerformedBy(e.target.value)}
                placeholder="Technician / service company"
                type="text"
                value={performedBy}
              />
            </ModalField>

            <ModalField label="Description / Work Done">
              <textarea
                className={textareaClass}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the issue, parts replaced, or service performed…"
                rows={3}
                value={description}
              />
            </ModalField>

            <ModalField label="Next Service Date">
              <input
                className={inputClass}
                onChange={(e) => setNextServiceDate(e.target.value)}
                type="date"
                value={nextServiceDate}
              />
            </ModalField>

            <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
              <strong>Auto-sync:</strong> Saving as <em>scheduled</em> or <em>in progress</em> sets the item to
              <em> Under Maintenance</em>. Saving as <em>completed</em> marks it <em>Operational</em> and
              updates the last service date.
            </div>

            {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--background)]"
                onClick={() => { setMode('list'); resetForm() }}
                type="button"
              >
                Back
              </button>
              <button
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                disabled={submitting}
                type="submit"
              >
                {submitting ? 'Saving…' : editingId ? 'Save Changes' : 'Add Record'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
