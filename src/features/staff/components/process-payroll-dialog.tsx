import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CheckSquare, Loader2, Square, Wallet, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  buildPayrollPreview,
  finalizePayroll,
  getPayrollSettings,
  listCashAdvances,
  listStaff,
  type PayrollPreview,
  type Staff,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'
import { useAuth } from '../../auth/use-auth'
import { periodStartForWeekEnding, suggestPeriodEnd } from '../lib/attendance'

type StaffPreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; advanceTotal: number; preview: PayrollPreview }
  | { kind: 'error'; message: string }

type ProcessResult = { kind: 'ok' } | { kind: 'failed'; message: string }

type StaffRow = {
  previewState: StaffPreviewState
  processResult: ProcessResult | null
  staff: Staff
}

const inputClass =
  'h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition placeholder:text-[var(--muted)]'

type Props = {
  onClose: () => void
  onProcessed: () => void
  open: boolean
}

export function ProcessPayrollDialog({ onClose, onProcessed, open }: Props) {
  const { hasPermission, user } = useAuth()
  const canProcess = hasPermission('process_payroll')

  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [payDate, setPayDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<StaffRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [processing, setProcessing] = useState(false)
  const [autoDeduct, setAutoDeduct] = useState(true)
  const [loadingStaff, setLoadingStaff] = useState(true)

  useEffect(() => {
    if (!open) return
    void (async () => {
      setLoadingStaff(true)
      try {
        const [staffList, settings] = await Promise.all([
          listStaff({ includeArchived: false }),
          getPayrollSettings(),
        ])
        setAutoDeduct(settings.autoDeductCashAdvances)
        const suggested = suggestPeriodEnd([], settings.cutoffDay)
        const suggestedStart = periodStartForWeekEnding(suggested)
        setPeriodStart(suggestedStart)
        setPeriodEnd(suggested)
        setPayDate(format(new Date(), 'yyyy-MM-dd'))
        setNotes('')
        setSelected(new Set())
        setRows(staffList.map((s) => ({ previewState: { kind: 'idle' }, processResult: null, staff: s })))
      } finally {
        setLoadingStaff(false)
      }
    })()
  }, [open])

  useEffect(() => {
    if (!open || !periodStart || !periodEnd || periodStart > periodEnd) return

    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        previewState: { kind: 'loading' },
        processResult: r.processResult?.kind === 'ok' ? r.processResult : null,
      })),
    )

    const t = setTimeout(() => {
      void (async () => {
        const settings = await getPayrollSettings()
        const results = await Promise.allSettled(
          rows.map(async (r) => {
            const preview = await buildPayrollPreview(r.staff.id, periodStart, periodEnd)
            let advanceTotal = 0
            if (settings.autoDeductCashAdvances) {
              const advances = await listCashAdvances(r.staff.id, { status: 'outstanding' })
              advanceTotal = advances.reduce((sum, a) => sum + a.amount, 0)
            }
            return { advanceTotal, preview, staffId: r.staff.id }
          }),
        )
        setRows((prev) =>
          prev.map((r, i) => {
            const res = results[i]
            if (!res) return r
            if (res.status === 'fulfilled') {
              return {
                ...r,
                previewState: { advanceTotal: res.value.advanceTotal, kind: 'ok', preview: res.value.preview },
              }
            }
            return {
              ...r,
              previewState: {
                kind: 'error',
                message: res.reason instanceof Error ? res.reason.message : 'Preview failed.',
              },
            }
          }),
        )

        setSelected((prev) => {
          const next = new Set(prev)
          results.forEach((res, i) => {
            const staffId = rows[i]?.staff.id
            if (!staffId) return
            if (res.status === 'fulfilled' && res.value.preview.items.length > 0) {
              next.add(staffId)
            } else {
              next.delete(staffId)
            }
          })
          return next
        })
      })()
    }, 300)

    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, periodStart, periodEnd])

  const allSelectable = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.previewState.kind === 'ok' &&
            r.previewState.preview.items.length > 0 &&
            r.processResult?.kind !== 'ok',
        )
        .map((r) => r.staff.id),
    [rows],
  )

  const allSelected = allSelectable.length > 0 && allSelectable.every((id) => selected.has(id))

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allSelectable))
    }
  }

  function toggleRow(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const summary = useMemo(() => {
    let count = 0
    let totalNet = 0
    for (const r of rows) {
      if (!selected.has(r.staff.id)) continue
      if (r.previewState.kind !== 'ok') continue
      count++
      totalNet += r.previewState.preview.grossPay - r.previewState.advanceTotal
    }
    return { count, totalNet }
  }, [rows, selected])

  const handleProcessSelected = useCallback(async () => {
    if (!user || !canProcess) return
    const toProcess = rows.filter(
      (r) =>
        selected.has(r.staff.id) &&
        r.previewState.kind === 'ok' &&
        r.previewState.preview.items.length > 0,
    )
    if (toProcess.length === 0) return

    setProcessing(true)

    let okCount = 0
    let failCount = 0

    for (const r of toProcess) {
      const preview = r.previewState.kind === 'ok' ? r.previewState.preview : null
      if (!preview) continue

      try {
        let cashAdvanceIds: number[] = []
        if (autoDeduct) {
          const advances = await listCashAdvances(r.staff.id, { status: 'outstanding' })
          cashAdvanceIds = advances.map((a) => a.id)
        }

        await finalizePayroll(
          {
            adjustments: [],
            cashAdvanceIds,
            notes: notes.trim(),
            payDate,
            periodEnd: preview.periodEnd,
            periodStart: preview.periodStart,
            staffId: r.staff.id,
          },
          user.id,
        )

        okCount++
        setRows((prev) =>
          prev.map((row) =>
            row.staff.id === r.staff.id ? { ...row, processResult: { kind: 'ok' } } : row,
          ),
        )
      } catch (err) {
        failCount++
        const message = err instanceof Error ? err.message : 'Failed.'
        setRows((prev) =>
          prev.map((row) =>
            row.staff.id === r.staff.id
              ? { ...row, processResult: { kind: 'failed', message } }
              : row,
          ),
        )
      }
    }

    setProcessing(false)

    if (failCount === 0) {
      toast.success(`Processed ${okCount} payroll${okCount !== 1 ? 's' : ''} successfully.`)
      onProcessed()
    } else {
      toast.warning(`Processed ${okCount} — ${failCount} failed. See inline errors.`)
    }

    const reloadIds = new Set(
      rows
        .filter((r) => selected.has(r.staff.id) && r.processResult?.kind !== 'failed')
        .map((r) => r.staff.id),
    )

    if (reloadIds.size > 0 && periodStart && periodEnd) {
      const settings = await getPayrollSettings()
      const reloadResults = await Promise.allSettled(
        rows
          .filter((r) => reloadIds.has(r.staff.id))
          .map(async (r) => {
            const preview = await buildPayrollPreview(r.staff.id, periodStart, periodEnd)
            let advanceTotal = 0
            if (settings.autoDeductCashAdvances) {
              const advances = await listCashAdvances(r.staff.id, { status: 'outstanding' })
              advanceTotal = advances.reduce((sum, a) => sum + a.amount, 0)
            }
            return { advanceTotal, preview, staffId: r.staff.id }
          }),
      )

      setRows((prev) => {
        const updates = new Map<number, StaffPreviewState>()
        const reloadRows = prev.filter((r) => reloadIds.has(r.staff.id))
        reloadResults.forEach((res, i) => {
          const staffId = reloadRows[i]?.staff.id
          if (!staffId) return
          if (res.status === 'fulfilled') {
            updates.set(staffId, {
              advanceTotal: res.value.advanceTotal,
              kind: 'ok',
              preview: res.value.preview,
            })
          }
        })
        return prev.map((r) => {
          const state = updates.get(r.staff.id)
          if (!state) return r
          return { ...r, previewState: state }
        })
      })

      setSelected((prev) => {
        const next = new Set(prev)
        reloadIds.forEach((id) => next.delete(id))
        return next
      })
    }
  }, [rows, selected, user, canProcess, autoDeduct, notes, payDate, periodStart, periodEnd, onProcessed])

  if (!open) return null

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 pt-10"
      role="dialog"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-5xl rounded-xl bg-[var(--panel)] shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b border-[var(--border)] bg-[var(--panel)] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-[var(--accent)]/15 p-2 text-[var(--accent)]">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">Process Payroll</h2>
              <p className="text-xs text-[var(--muted)]">
                Select a period and process payroll for multiple staff at once.
              </p>
            </div>
          </div>
          <button
            className="rounded-md p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Period inputs */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)]/50 p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Period start
                </label>
                <input
                  className={inputClass}
                  max={periodEnd || undefined}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  type="date"
                  value={periodStart}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Period end
                  <span className="ml-1 font-normal normal-case text-[var(--muted)]">
                    (must be cutoff weekday)
                  </span>
                </label>
                <input
                  className={inputClass}
                  min={periodStart || undefined}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  type="date"
                  value={periodEnd}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Pay date (ledger)
                </label>
                <input
                  className={inputClass}
                  onChange={(e) => setPayDate(e.target.value)}
                  type="date"
                  value={payDate}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                Notes (optional, applied to all)
              </label>
              <textarea
                className="min-h-[44px] w-full resize-none rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition placeholder:text-[var(--muted)]"
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional memo…"
                value={notes}
              />
            </div>
          </div>

          {/* Staff table */}
          {loadingStaff ? (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--muted)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading staff…
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] py-12 text-center text-sm text-[var(--muted)]">
              No active staff found.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--background)]/50 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <button
                        aria-label={allSelected ? 'Deselect all' : 'Select all'}
                        className="text-[var(--muted)] transition hover:text-[var(--foreground)]"
                        disabled={allSelectable.length === 0}
                        onClick={toggleAll}
                        type="button"
                      >
                        {allSelected ? (
                          <CheckSquare className="h-4 w-4 text-[var(--accent)]" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                    </th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3 text-right">Rate</th>
                    <th className="px-4 py-3 text-right">Unpaid days</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                    <th className="px-4 py-3 text-right">Cash adv.</th>
                    <th className="px-4 py-3 text-right">Net</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {rows.map((r) => {
                    const isOk = r.previewState.kind === 'ok'
                    const hasItems = isOk && r.previewState.preview.items.length > 0
                    const isSelectable = hasItems && r.processResult?.kind !== 'ok'
                    const isChecked = selected.has(r.staff.id)
                    const isDimmed =
                      !hasItems && r.previewState.kind !== 'loading' && r.previewState.kind !== 'idle'
                    const processedOk = r.processResult?.kind === 'ok'
                    const processedFail = r.processResult?.kind === 'failed'

                    return (
                      <tr
                        key={r.staff.id}
                        className={[
                          'transition',
                          isDimmed || processedOk ? 'opacity-50' : '',
                          isSelectable ? 'cursor-pointer hover:bg-[var(--background)]/40' : '',
                        ].join(' ')}
                        onClick={() => {
                          if (isSelectable) toggleRow(r.staff.id)
                        }}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            aria-label={isChecked ? 'Deselect' : 'Select'}
                            className="text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-30"
                            disabled={!isSelectable}
                            onClick={() => {
                              if (isSelectable) toggleRow(r.staff.id)
                            }}
                            type="button"
                          >
                            {isChecked ? (
                              <CheckSquare className="h-4 w-4 text-[var(--accent)]" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium">{r.staff.displayName}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                          {formatCurrency(r.staff.defaultRate)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.previewState.kind === 'loading' ? (
                            <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-[var(--muted)]" />
                          ) : r.previewState.kind === 'ok' ? (
                            r.previewState.preview.items.length
                          ) : r.previewState.kind === 'error' ? (
                            <span className="text-xs text-red-400">—</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.previewState.kind === 'ok'
                            ? formatCurrency(r.previewState.preview.grossPay)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-600">
                          {r.previewState.kind === 'ok' && r.previewState.advanceTotal > 0
                            ? `−${formatCurrency(r.previewState.advanceTotal)}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">
                          {r.previewState.kind === 'ok'
                            ? formatCurrency(
                                Math.max(0, r.previewState.preview.grossPay - r.previewState.advanceTotal),
                              )
                            : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {processedOk ? (
                            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                              Processed
                            </span>
                          ) : processedFail ? (
                            <span
                              className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400"
                              title={(r.processResult as { kind: 'failed'; message: string }).message}
                            >
                              Failed
                            </span>
                          ) : r.previewState.kind === 'error' ? (
                            <span
                              className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-500"
                              title={r.previewState.message}
                            >
                              Preview error
                            </span>
                          ) : !hasItems && r.previewState.kind === 'ok' ? (
                            <span className="text-xs text-[var(--muted)]">No unpaid days</span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-[var(--border)] bg-[var(--background)]/30 px-5 py-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-[var(--muted)]">
              Selected:{' '}
              <span className="font-semibold text-[var(--foreground)]">{summary.count}</span>
            </span>
            {summary.count > 0 && (
              <span className="text-[var(--muted)]">
                Total net:{' '}
                <span className="font-semibold tabular-nums text-[var(--foreground)]">
                  {formatCurrency(summary.totalNet)}
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--background)]"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              disabled={processing || summary.count === 0 || !periodStart || !periodEnd || !payDate}
              onClick={() => {
                void handleProcessSelected()
              }}
              type="button"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                `Process ${summary.count > 0 ? summary.count : ''} selected`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
