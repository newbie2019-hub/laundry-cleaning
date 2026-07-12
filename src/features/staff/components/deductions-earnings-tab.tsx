import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteStaffRecurringAdjustment,
  listStaffAdjustmentHistory,
  listStaffRecurringAdjustments,
  setRecurringAdjustmentActive,
  type RecurringAdjustment,
  type StaffAdjustmentHistoryEntry,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'
import { categoryLabel } from '../lib/attendance'
import { RecurringAdjustmentDialog } from './recurring-adjustment-dialog'

type Props = {
  canEdit: boolean
  staffDisplayName: string
  staffId: number
  userId: number | null
}

/** A group of applied adjustment lines that share one payroll run. */
type HistoryGroup = {
  entries: StaffAdjustmentHistoryEntry[]
  payDate: string
  payrollId: number
  periodEnd: string
  periodStart: string
}

function KindBadge({ kind }: { kind: 'earning' | 'deduction' }) {
  return kind === 'earning' ? (
    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
      Earning
    </span>
  ) : (
    <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
      Deduction
    </span>
  )
}

export function DeductionsEarningsTab({ canEdit, staffDisplayName, staffId, userId }: Props) {
  const [recurring, setRecurring] = useState<RecurringAdjustment[]>([])
  const [history, setHistory] = useState<StaffAdjustmentHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<RecurringAdjustment | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!Number.isFinite(staffId) || staffId <= 0) return
    setLoading(true)
    try {
      const [rec, hist] = await Promise.all([
        listStaffRecurringAdjustments(staffId),
        listStaffAdjustmentHistory(staffId),
      ])
      setRecurring(rec)
      setHistory(hist)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to load deductions & earnings.')
    } finally {
      setLoading(false)
    }
  }, [staffId])

  useEffect(() => {
    void load()
  }, [load])

  const earnings = useMemo(() => recurring.filter((r) => r.kind === 'earning'), [recurring])
  const deductions = useMemo(() => recurring.filter((r) => r.kind === 'deduction'), [recurring])

  const historyGroups = useMemo<HistoryGroup[]>(() => {
    const groups: HistoryGroup[] = []
    const byId = new Map<number, HistoryGroup>()
    for (const entry of history) {
      let group = byId.get(entry.payrollId)
      if (!group) {
        group = {
          entries: [],
          payDate: entry.payDate,
          payrollId: entry.payrollId,
          periodEnd: entry.periodEnd,
          periodStart: entry.periodStart,
        }
        byId.set(entry.payrollId, group)
        groups.push(group)
      }
      group.entries.push(entry)
    }
    return groups
  }, [history])

  function openAdd() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(item: RecurringAdjustment) {
    setEditing(item)
    setDialogOpen(true)
  }

  async function handleToggleActive(item: RecurringAdjustment) {
    if (!userId) return
    setBusyId(item.id)
    try {
      await setRecurringAdjustmentActive(item.id, !item.isActive, userId)
      toast.success(item.isActive ? 'Item deactivated.' : 'Item activated.')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update item.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(item: RecurringAdjustment) {
    setBusyId(item.id)
    try {
      await deleteStaffRecurringAdjustment(item.id)
      toast.success('Recurring item deleted.')
      setDeletingId(null)
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to delete item.')
    } finally {
      setBusyId(null)
    }
  }

  function renderRecurringRow(item: RecurringAdjustment) {
    const inactive = !item.isActive
    return (
      <div
        className={[
          'flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5',
          inactive ? 'opacity-60' : '',
        ].join(' ')}
        key={item.id}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--foreground)]">{item.label}</span>
            {inactive ? (
              <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Inactive
              </span>
            ) : null}
            {item.oneTime ? (
              <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-400">
                One-time
              </span>
            ) : null}
            {item.taxable ? (
              <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-strong)]">
                Taxable
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--muted)]">
            <span>{categoryLabel(item.category)}</span>
            {item.hasBalance && item.remainingBalance != null ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">
                  {formatCurrency(item.remainingBalance)} of {formatCurrency(item.originalBalance ?? 0)} left
                </span>
              </>
            ) : null}
            {item.startDate || item.endDate ? (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono">
                  {item.startDate || '…'} → {item.endDate || '…'}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="tabular-nums text-sm font-semibold text-[var(--foreground)]">
            {formatCurrency(item.amount)}
          </span>
          {canEdit ? (
            deletingId === item.id ? (
              <span className="flex items-center gap-1">
                <button
                  className="rounded bg-red-500 px-2 py-1 text-xs text-white disabled:opacity-60"
                  disabled={busyId === item.id}
                  onClick={() => {
                    void handleDelete(item)
                  }}
                  type="button"
                >
                  Delete
                </button>
                <button
                  className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)]"
                  onClick={() => setDeletingId(null)}
                  type="button"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <button
                  aria-label={item.isActive ? 'Deactivate' : 'Activate'}
                  className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-50"
                  disabled={busyId === item.id}
                  onClick={() => {
                    void handleToggleActive(item)
                  }}
                  title={item.isActive ? 'Deactivate' : 'Activate'}
                  type="button"
                >
                  <Power className="h-4 w-4" />
                </button>
                <button
                  aria-label="Edit"
                  className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                  onClick={() => openEdit(item)}
                  title="Edit"
                  type="button"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  aria-label="Delete"
                  className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                  onClick={() => setDeletingId(item.id)}
                  title="Delete"
                  type="button"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            )
          ) : null}
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-[var(--muted)]">Loading…</div>
  }

  return (
    <div className="space-y-8">
      {/* ── Recurring items management ─────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Scheduled items</h2>
            <p className="text-xs text-[var(--muted)]">
              Deductions and earnings applied automatically to payroll — recurring every run, or
              one-time for the next run only.
            </p>
          </div>
          {canEdit ? (
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
              onClick={openAdd}
              type="button"
            >
              <Plus className="h-4 w-4" />
              Add item
            </button>
          ) : null}
        </div>

        {recurring.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel)] py-8 text-center text-sm text-[var(--muted)]">
            No scheduled deductions or earnings yet.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                Earnings
              </h3>
              {earnings.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">None.</p>
              ) : (
                earnings.map(renderRecurringRow)
              )}
            </div>
            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                Deductions
              </h3>
              {deductions.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">None.</p>
              ) : (
                deductions.map(renderRecurringRow)
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Applied history ────────────────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Applied history</h2>
          <p className="text-xs text-[var(--muted)]">
            Every deduction and earning actually applied across paid payroll runs.
          </p>
        </div>

        {historyGroups.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-8 text-center text-sm text-[var(--muted)]">
            No applied deductions or earnings yet.
          </div>
        ) : (
          <div className="space-y-4">
            {historyGroups.map((group) => (
              <div
                className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)]"
                key={group.payrollId}
              >
                <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--background)]/40 px-4 py-2.5">
                  <span className="text-sm font-medium text-[var(--foreground)]">
                    Paid {group.payDate}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--muted)]">
                    {group.periodStart} → {group.periodEnd}
                  </span>
                </div>
                <ul className="divide-y divide-[var(--border)]">
                  {group.entries.map((entry) => (
                    <li className="flex items-center justify-between gap-3 px-4 py-2.5" key={entry.id}>
                      <div className="flex min-w-0 items-center gap-2">
                        <KindBadge kind={entry.kind} />
                        <span className="truncate text-sm text-[var(--foreground)]">{entry.label}</span>
                        <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:inline">
                          {categoryLabel(entry.category)}
                        </span>
                        {entry.source === 'overtime' && entry.quantity != null && entry.rate != null ? (
                          <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">
                            {entry.quantity}h × {formatCurrency(entry.rate)}
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={[
                          'shrink-0 tabular-nums text-sm font-medium',
                          entry.kind === 'earning' ? 'text-emerald-400' : 'text-red-400',
                        ].join(' ')}
                      >
                        {entry.kind === 'earning' ? '+' : '−'}
                        {formatCurrency(entry.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {userId != null ? (
        <RecurringAdjustmentDialog
          editing={editing}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            void load()
          }}
          open={dialogOpen}
          staffDisplayName={staffDisplayName}
          staffId={staffId}
          userId={userId}
        />
      ) : null}
    </div>
  )
}
