import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CheckSquare, ChevronDown, ChevronUp, Loader2, Plus, Square, Trash2, Wallet, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  buildPayrollPreview,
  finalizePayroll,
  getPayrollSettings,
  listCashAdvances,
  listStaff,
  type CashAdvance,
  type PayrollAdjustmentDraft,
  type PayrollPreview,
  type Staff,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'
import { useAuth } from '../../auth/use-auth'
import { periodStartForWeekEnding, roundMoney, suggestPeriodEnd } from '../lib/attendance'

// ── Types ──────────────────────────────────────────────────────────────────

type AdjRow = PayrollAdjustmentDraft & { key: string }

function newAdjRow(): AdjRow {
  return { amount: 0, key: `${Date.now()}-${Math.random()}`, kind: 'deduction', label: '' }
}

type StaffPreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; advances: CashAdvance[]; advanceTotal: number; preview: PayrollPreview }
  | { kind: 'error'; message: string }

type ProcessResult = { kind: 'ok' } | { kind: 'failed'; message: string }

type StaffRow = {
  adjustments: AdjRow[]
  expandedAdjust: boolean
  previewState: StaffPreviewState
  processResult: ProcessResult | null
  selectedAdvanceIds: Set<number>
  staff: Staff
}

// ── Helpers ────────────────────────────────────────────────────────────────

function computeRowNet(row: StaffRow): number {
  if (row.previewState.kind !== 'ok') return 0
  const advances = row.previewState.advances
    .filter((a) => row.selectedAdvanceIds.has(a.id))
    .reduce((s, a) => s + a.amount, 0)
  let bonus = 0
  let deduction = 0
  for (const a of row.adjustments) {
    if (!a.label.trim()) continue
    if (a.kind === 'bonus') bonus += a.amount
    else deduction += a.amount
  }
  return roundMoney(row.previewState.preview.grossPay + bonus - deduction - advances)
}

// ── Styles ─────────────────────────────────────────────────────────────────

const inputClass =
  'h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition placeholder:text-[var(--muted)]'

const adjInputClass =
  'h-9 rounded-md border border-[var(--border)] bg-[var(--background)]/80 px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition placeholder:text-[var(--muted)]'

// ── Component ──────────────────────────────────────────────────────────────

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

  // ── Load staff on open ───────────────────────────────────────────────────

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
        setRows(
          staffList.map((s) => ({
            adjustments: [],
            expandedAdjust: false,
            previewState: { kind: 'idle' },
            processResult: null,
            selectedAdvanceIds: new Set(),
            staff: s,
          })),
        )
      } finally {
        setLoadingStaff(false)
      }
    })()
  }, [open])

  // ── Re-build previews when period changes ────────────────────────────────

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
            const advances = await listCashAdvances(r.staff.id, { status: 'outstanding' })
            const advanceTotal = settings.autoDeductCashAdvances
              ? advances.reduce((s, a) => s + a.amount, 0)
              : 0
            return { advances, advanceTotal, preview, staffId: r.staff.id }
          }),
        )

        setRows((prev) =>
          prev.map((r, i) => {
            const res = results[i]
            if (!res) return r
            if (res.status === 'fulfilled') {
              const { advances, advanceTotal, preview } = res.value
              const selectedAdvanceIds = settings.autoDeductCashAdvances
                ? new Set(advances.map((a) => a.id))
                : new Set<number>()
              return {
                ...r,
                previewState: { advances, advanceTotal, kind: 'ok', preview },
                selectedAdvanceIds,
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

  // ── Selection helpers ────────────────────────────────────────────────────

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
    setSelected(allSelected ? new Set() : new Set(allSelectable))
  }

  function toggleRow(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAdjustPanel(staffId: number) {
    setRows((prev) =>
      prev.map((r) =>
        r.staff.id === staffId ? { ...r, expandedAdjust: !r.expandedAdjust } : r,
      ),
    )
  }

  // ── Per-row adjustment helpers ───────────────────────────────────────────

  function toggleAdvance(staffId: number, advanceId: number) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.staff.id !== staffId) return r
        const next = new Set(r.selectedAdvanceIds)
        if (next.has(advanceId)) next.delete(advanceId)
        else next.add(advanceId)
        return { ...r, selectedAdvanceIds: next }
      }),
    )
  }

  function addAdjustment(staffId: number) {
    setRows((prev) =>
      prev.map((r) =>
        r.staff.id === staffId
          ? { ...r, adjustments: [...r.adjustments, newAdjRow()] }
          : r,
      ),
    )
  }

  function updateAdjustment(
    staffId: number,
    key: string,
    patch: Partial<Omit<AdjRow, 'key'>>,
  ) {
    setRows((prev) =>
      prev.map((r) =>
        r.staff.id === staffId
          ? {
              ...r,
              adjustments: r.adjustments.map((a) =>
                a.key === key ? { ...a, ...patch } : a,
              ),
            }
          : r,
      ),
    )
  }

  function removeAdjustment(staffId: number, key: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.staff.id === staffId
          ? { ...r, adjustments: r.adjustments.filter((a) => a.key !== key) }
          : r,
      ),
    )
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  const summary = useMemo(() => {
    let count = 0
    let totalNet = 0
    for (const r of rows) {
      if (!selected.has(r.staff.id)) continue
      if (r.previewState.kind !== 'ok') continue
      count++
      totalNet += computeRowNet(r)
    }
    return { count, totalNet }
  }, [rows, selected])

  // ── Process ──────────────────────────────────────────────────────────────

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
        const adjDrafts: PayrollAdjustmentDraft[] = r.adjustments
          .filter((a) => a.label.trim())
          .map(({ amount, kind, label }) => ({ amount, kind, label: label.trim() }))

        await finalizePayroll(
          {
            adjustments: adjDrafts,
            cashAdvanceIds: Array.from(r.selectedAdvanceIds),
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

    // Reload previews for successfully processed staff
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
            const advances = await listCashAdvances(r.staff.id, { status: 'outstanding' })
            const advanceTotal = settings.autoDeductCashAdvances
              ? advances.reduce((s, a) => s + a.amount, 0)
              : 0
            return { advances, advanceTotal, preview, staffId: r.staff.id }
          }),
      )

      setRows((prev) => {
        const reloadRows = prev.filter((r) => reloadIds.has(r.staff.id))
        const updates = new Map<number, Partial<StaffRow>>()
        reloadResults.forEach((res, i) => {
          const staffId = reloadRows[i]?.staff.id
          if (!staffId) return
          if (res.status === 'fulfilled') {
            const { advances, advanceTotal, preview } = res.value
            updates.set(staffId, {
              adjustments: [],
              expandedAdjust: false,
              previewState: { advances, advanceTotal, kind: 'ok', preview },
              selectedAdvanceIds: settings.autoDeductCashAdvances
                ? new Set(advances.map((a) => a.id))
                : new Set(),
            })
          }
        })
        return prev.map((r) => {
          const patch = updates.get(r.staff.id)
          return patch ? { ...r, ...patch } : r
        })
      })

      setSelected((prev) => {
        const next = new Set(prev)
        reloadIds.forEach((id) => next.delete(id))
        return next
      })
    }
  }, [rows, selected, user, canProcess, notes, payDate, periodStart, periodEnd, onProcessed])

  if (!open) return null

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 pt-10"
      role="dialog"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 mb-10 w-full max-w-5xl rounded-xl bg-[var(--panel)] shadow-2xl">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b border-[var(--border)] bg-[var(--panel)] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-[var(--accent)]/15 p-2 text-[var(--accent)]">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">Process Payroll</h2>
              <p className="text-xs text-[var(--muted)]">
                Select a period, adjust per-employee deductions/bonuses, then process.
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
              <table className="w-full min-w-[780px] text-left text-sm">
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
                    <th className="px-4 py-3 text-right">Days</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                    <th className="px-4 py-3 text-right">Deductions</th>
                    <th className="px-4 py-3 text-right">Net</th>
                    <th className="px-4 py-3 text-center">Adjust</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isOk = r.previewState.kind === 'ok'
                    const hasItems = isOk && r.previewState.preview.items.length > 0
                    const isSelectable = hasItems && r.processResult?.kind !== 'ok'
                    const isChecked = selected.has(r.staff.id)
                    const isDimmed =
                      !hasItems &&
                      r.previewState.kind !== 'loading' &&
                      r.previewState.kind !== 'idle'
                    const processedOk = r.processResult?.kind === 'ok'
                    const processedFail = r.processResult?.kind === 'failed'

                    // Compute per-row values
                    const selectedAdvTotal =
                      isOk
                        ? r.previewState.advances
                            .filter((a) => r.selectedAdvanceIds.has(a.id))
                            .reduce((s, a) => s + a.amount, 0)
                        : 0
                    const adjBonus = r.adjustments
                      .filter((a) => a.label.trim() && a.kind === 'bonus')
                      .reduce((s, a) => s + a.amount, 0)
                    const adjDeduction = r.adjustments
                      .filter((a) => a.label.trim() && a.kind === 'deduction')
                      .reduce((s, a) => s + a.amount, 0)
                    const totalDeductions = selectedAdvTotal + adjDeduction
                    const netPay = isOk
                      ? roundMoney(r.previewState.preview.grossPay + adjBonus - totalDeductions)
                      : 0

                    const hasAdjustments =
                      r.adjustments.length > 0 ||
                      (isOk && r.previewState.advances.length > 0)

                    return (
                      <>
                        {/* Main row */}
                        <tr
                          key={`row-${r.staff.id}`}
                          className={[
                            'border-b border-[var(--border)] transition',
                            r.expandedAdjust ? 'bg-[var(--background)]/30' : '',
                            isDimmed || processedOk ? 'opacity-50' : '',
                            isSelectable ? 'cursor-pointer hover:bg-[var(--background)]/40' : '',
                          ].join(' ')}
                          onClick={() => {
                            if (isSelectable) toggleRow(r.staff.id)
                          }}
                        >
                          {/* Checkbox */}
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

                          {/* Name */}
                          <td className="px-4 py-3 font-medium">{r.staff.displayName}</td>

                          {/* Rate */}
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                            {formatCurrency(r.staff.defaultRate)}
                          </td>

                          {/* Days */}
                          <td className="px-4 py-3 text-right tabular-nums">
                            {r.previewState.kind === 'loading' ? (
                              <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-[var(--muted)]" />
                            ) : isOk ? (
                              r.previewState.preview.items.length
                            ) : r.previewState.kind === 'error' ? (
                              <span className="text-xs text-red-400">—</span>
                            ) : (
                              '—'
                            )}
                          </td>

                          {/* Gross */}
                          <td className="px-4 py-3 text-right tabular-nums">
                            {isOk ? formatCurrency(r.previewState.preview.grossPay) : '—'}
                          </td>

                          {/* Deductions */}
                          <td className="px-4 py-3 text-right tabular-nums text-amber-500">
                            {isOk && totalDeductions > 0
                              ? `−${formatCurrency(totalDeductions)}`
                              : '—'}
                          </td>

                          {/* Net */}
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {isOk ? formatCurrency(Math.max(0, netPay)) : '—'}
                          </td>

                          {/* Adjust toggle / Status */}
                          <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
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
                                Error
                              </span>
                            ) : !hasItems && isOk ? (
                              <span className="text-xs text-[var(--muted)]">No unpaid</span>
                            ) : isOk ? (
                              <button
                                aria-label={r.expandedAdjust ? 'Collapse adjustments' : 'Expand adjustments'}
                                className={[
                                  'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition',
                                  r.expandedAdjust
                                    ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                                    : hasAdjustments
                                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                                    : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]',
                                ].join(' ')}
                                onClick={() => toggleAdjustPanel(r.staff.id)}
                                type="button"
                              >
                                {r.expandedAdjust ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                                Adjust
                              </button>
                            ) : null}
                          </td>
                        </tr>

                        {/* Expanded adjustment panel */}
                        {r.expandedAdjust && isOk && (
                          <tr key={`adj-${r.staff.id}`} className="border-b border-[var(--border)]">
                            <td colSpan={8} className="bg-[var(--background)]/40 px-6 py-4">
                              <div className="space-y-4">

                                {/* Outstanding cash advances */}
                                {r.previewState.advances.length > 0 ? (
                                  <div className="space-y-2 rounded-md border border-amber-500/25 bg-amber-500/8 p-3">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-semibold text-amber-300">
                                          Outstanding cash advances
                                        </p>
                                        <p className="text-[11px] text-amber-400/80">
                                          Checked items will be deducted and marked settled.
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-2 text-xs">
                                        <button
                                          className="rounded border border-amber-500/30 px-2 py-1 text-amber-300 transition hover:bg-amber-500/15"
                                          onClick={() =>
                                            setRows((prev) =>
                                              prev.map((row) =>
                                                row.staff.id === r.staff.id
                                                  ? {
                                                      ...row,
                                                      selectedAdvanceIds: new Set(
                                                        r.previewState.kind === 'ok'
                                                          ? r.previewState.advances.map((a) => a.id)
                                                          : [],
                                                      ),
                                                    }
                                                  : row,
                                              ),
                                            )
                                          }
                                          type="button"
                                        >
                                          Select all
                                        </button>
                                        <button
                                          className="rounded border border-amber-500/30 px-2 py-1 text-amber-300 transition hover:bg-amber-500/15"
                                          onClick={() =>
                                            setRows((prev) =>
                                              prev.map((row) =>
                                                row.staff.id === r.staff.id
                                                  ? { ...row, selectedAdvanceIds: new Set() }
                                                  : row,
                                              ),
                                            )
                                          }
                                          type="button"
                                        >
                                          Clear
                                        </button>
                                      </div>
                                    </div>
                                    <ul className="divide-y divide-amber-500/15 rounded border border-amber-500/20 bg-[var(--panel)]/60">
                                      {r.previewState.advances.map((adv) => (
                                        <li key={adv.id}>
                                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition hover:bg-amber-500/8">
                                            <input
                                              checked={r.selectedAdvanceIds.has(adv.id)}
                                              className="h-4 w-4 rounded border-amber-500/40 text-amber-500 focus:ring-amber-500/30"
                                              onChange={() => toggleAdvance(r.staff.id, adv.id)}
                                              type="checkbox"
                                            />
                                            <span className="font-mono text-xs tabular-nums text-[var(--muted)]">
                                              {adv.advanceDate}
                                            </span>
                                            <span className="flex-1 truncate text-xs text-[var(--muted)]">
                                              {adv.notes || '—'}
                                            </span>
                                            <span className="font-medium tabular-nums text-[var(--foreground)]">
                                              {formatCurrency(adv.amount)}
                                            </span>
                                          </label>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : (
                                  <p className="text-xs text-[var(--muted)]">
                                    No outstanding cash advances.
                                  </p>
                                )}

                                {/* Adjustment lines */}
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <p className="text-sm font-medium text-[var(--foreground)]">
                                      Adjustments
                                      <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">
                                        bonuses / deductions
                                      </span>
                                    </p>
                                    <button
                                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                                      onClick={() => addAdjustment(r.staff.id)}
                                      type="button"
                                    >
                                      <Plus className="h-3 w-3" />
                                      Add line
                                    </button>
                                  </div>
                                  {r.adjustments.length === 0 ? (
                                    <p className="text-xs text-[var(--muted)]">
                                      No adjustments added.
                                    </p>
                                  ) : (
                                    <div className="space-y-2">
                                      {r.adjustments.map((adj, idx) => (
                                        <div
                                          key={adj.key}
                                          className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)]/60 p-2"
                                        >
                                          <input
                                            className={`${adjInputClass} min-w-[10rem] flex-1`}
                                            onChange={(e) =>
                                              updateAdjustment(r.staff.id, adj.key, {
                                                label: e.target.value,
                                              })
                                            }
                                            placeholder="Label (e.g. Incentive, SSS)"
                                            value={adj.label}
                                          />
                                          <select
                                            className={`${adjInputClass} w-32`}
                                            onChange={(e) =>
                                              updateAdjustment(r.staff.id, adj.key, {
                                                kind: e.target.value as 'bonus' | 'deduction',
                                              })
                                            }
                                            value={adj.kind}
                                          >
                                            <option value="deduction">Deduction</option>
                                            <option value="bonus">Bonus</option>
                                          </select>
                                          <input
                                            className={`${adjInputClass} w-28 tabular-nums`}
                                            min={0}
                                            onChange={(e) =>
                                              updateAdjustment(r.staff.id, adj.key, {
                                                amount: Number(e.target.value) || 0,
                                              })
                                            }
                                            placeholder="0.00"
                                            step="0.01"
                                            type="number"
                                            value={adj.amount || ''}
                                          />
                                          <button
                                            aria-label={`Remove adjustment ${idx + 1}`}
                                            className="rounded-md p-2 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                                            onClick={() => removeAdjustment(r.staff.id, adj.key)}
                                            type="button"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {/* Per-employee net preview */}
                                <div className="flex flex-wrap items-center gap-4 rounded-md border border-[var(--border)] bg-[var(--background)]/50 px-3 py-2 text-xs">
                                  <span className="text-[var(--muted)]">
                                    Gross:{' '}
                                    <span className="font-semibold tabular-nums text-[var(--foreground)]">
                                      {formatCurrency(r.previewState.preview.grossPay)}
                                    </span>
                                  </span>
                                  {adjBonus > 0 && (
                                    <span className="text-[var(--muted)]">
                                      Bonus:{' '}
                                      <span className="font-semibold tabular-nums text-emerald-400">
                                        +{formatCurrency(adjBonus)}
                                      </span>
                                    </span>
                                  )}
                                  {totalDeductions > 0 && (
                                    <span className="text-[var(--muted)]">
                                      Deductions:{' '}
                                      <span className="font-semibold tabular-nums text-amber-400">
                                        −{formatCurrency(totalDeductions)}
                                      </span>
                                    </span>
                                  )}
                                  <span className="ml-auto text-[var(--muted)]">
                                    Net:{' '}
                                    <span
                                      className={[
                                        'text-sm font-bold tabular-nums',
                                        netPay < 0 ? 'text-red-400' : 'text-[var(--accent)]',
                                      ].join(' ')}
                                    >
                                      {formatCurrency(Math.max(0, netPay))}
                                    </span>
                                  </span>
                                </div>

                                {netPay < 0 && (
                                  <p className="text-xs font-medium text-red-400">
                                    Net pay is negative. Reduce deductions or add bonuses before processing.
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
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
