import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ArrowDown, ArrowUp, ArrowUpDown, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  buildPayrollPreview,
  finalizePayroll,
  getPayrollSettings,
  listCashAdvances,
  listStaffRecurringAdjustments,
  listUnpaidAttendanceDates,
  type CashAdvance,
  type PayrollPreview,
  type PayrollPreviewItem,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'
import { periodStartForWeekEnding, roundMoney, suggestPeriodEnd } from '../lib/attendance'
import {
  type AdjRow,
  firstInvalidRow,
  rowsFromRecurring,
  rowsToDrafts,
  rowsTotals,
} from '../lib/payroll-lines'
import { AdjustmentLinesEditor } from './adjustment-lines-editor'

type Props = {
  onClose: () => void
  onSuccess: () => void
  open: boolean
  staffDisplayName: string
  staffId: number
  userId: number
}

type SortField = 'entryDate' | 'rateUsed'
type SortDir = 'asc' | 'desc'

const modalInputClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition placeholder:text-gray-400'

function ModalField({
  label,
  required,
  error,
  help,
  children,
}: {
  label: string
  required?: boolean
  error?: string | null
  help?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      {!error && help ? <p className="text-[11px] text-gray-500">{help}</p> : null}
    </div>
  )
}

function SortHeaderButton({
  active,
  direction,
  label,
  align = 'left',
  onClick,
}: {
  active: boolean
  direction: SortDir
  label: string
  align?: 'left' | 'right'
  onClick: () => void
}) {
  const justify = align === 'right' ? 'justify-end' : 'justify-start'
  return (
    <button
      className={`group flex w-full items-center gap-1 rounded px-0.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 ${justify}`}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <span className="text-gray-400">
        {active ? (
          direction === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-60 group-hover:opacity-100" />
        )}
      </span>
    </button>
  )
}

export function PayrollDialog({ onClose, onSuccess, open, staffDisplayName, staffId, userId }: Props) {
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [payDate, setPayDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [notes, setNotes] = useState('')
  const [preview, setPreview] = useState<PayrollPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [adjustments, setAdjustments] = useState<AdjRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('entryDate')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [outstandingAdvances, setOutstandingAdvances] = useState<CashAdvance[]>([])
  const [selectedAdvanceIds, setSelectedAdvanceIds] = useState<Set<number>>(new Set())

  const loadPreview = useCallback(
    async (start: string, end: string) => {
      if (!start || !end) {
        setPreview(null)
        return
      }
      if (start > end) {
        setPreview(null)
        setPreviewError('Period start must be on or before period end.')
        return
      }
      setLoadingPreview(true)
      setPreviewError(null)
      try {
        const p = await buildPayrollPreview(staffId, start, end)
        setPreview(p)
      } catch (e: unknown) {
        setPreview(null)
        setPreviewError(e instanceof Error ? e.message : 'Unable to build preview.')
      } finally {
        setLoadingPreview(false)
      }
    },
    [staffId],
  )

  useEffect(() => {
    if (!open) return
    setNotes('')
    setAdjustments([])
    setFormError(null)
    setSortField('entryDate')
    setSortDir('asc')
    setPayDate(format(new Date(), 'yyyy-MM-dd'))
    void (async () => {
      const settings = await getPayrollSettings()
      const unpaid = await listUnpaidAttendanceDates(staffId)
      const suggested = suggestPeriodEnd(unpaid, settings.cutoffDay)
      const suggestedStart = periodStartForWeekEnding(suggested)
      setPeriodStart(suggestedStart)
      setPeriodEnd(suggested)
      const advances = await listCashAdvances(staffId, { status: 'outstanding' })
      setOutstandingAdvances(advances)
      setSelectedAdvanceIds(
        settings.autoDeductCashAdvances
          ? new Set(advances.map((a) => a.id))
          : new Set(),
      )
      // Pre-populate standing (recurring) earnings/deductions for this staff.
      const recurring = await listStaffRecurringAdjustments(staffId, { activeOnly: true })
      setAdjustments(rowsFromRecurring(recurring))
      await loadPreview(suggestedStart, suggested)
    })()
  }, [open, staffId, loadPreview])

  useEffect(() => {
    if (!open || !periodStart || !periodEnd) return
    const t = setTimeout(() => {
      void loadPreview(periodStart, periodEnd)
    }, 200)
    return () => clearTimeout(t)
  }, [periodStart, periodEnd, open, loadPreview])

  const sortedItems = useMemo<PayrollPreviewItem[]>(() => {
    if (!preview) return []
    const copy = [...preview.items]
    copy.sort((a, b) => {
      let diff = 0
      if (sortField === 'rateUsed') {
        diff = a.rateUsed - b.rateUsed
        if (diff === 0) diff = a.entryDate.localeCompare(b.entryDate)
      } else {
        diff = a.entryDate.localeCompare(b.entryDate)
      }
      return sortDir === 'asc' ? diff : -diff
    })
    return copy
  }, [preview, sortField, sortDir])

  const advanceDeductionTotal = useMemo(() => {
    let sum = 0
    for (const a of outstandingAdvances) {
      if (selectedAdvanceIds.has(a.id)) sum += a.amount
    }
    return roundMoney(sum)
  }, [outstandingAdvances, selectedAdvanceIds])

  const { earningTotal, deductionTotal } = useMemo(() => rowsTotals(adjustments), [adjustments])

  const grossPay = useMemo(
    () => (preview ? roundMoney(preview.basePay + earningTotal) : 0),
    [preview, earningTotal],
  )

  const netPay = useMemo(() => {
    if (!preview) return 0
    return roundMoney(grossPay - deductionTotal - advanceDeductionTotal)
  }, [preview, grossPay, deductionTotal, advanceDeductionTotal])

  function toggleAdvance(id: number) {
    setSelectedAdvanceIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!preview || previewError) return

    if (firstInvalidRow(adjustments)) {
      setFormError('Every earning/deduction line needs an amount of zero or more.')
      return
    }

    if (netPay < 0) {
      setFormError('Net pay cannot be negative. Reduce deductions or add earnings.')
      return
    }

    const adjDrafts = rowsToDrafts(adjustments)

    setSubmitting(true)
    try {
      const result = await finalizePayroll(
        {
          adjustments: adjDrafts,
          cashAdvanceIds: Array.from(selectedAdvanceIds),
          notes,
          payDate,
          periodEnd: preview.periodEnd,
          periodStart: preview.periodStart,
          staffId,
        },
        userId,
      )
      toast.success('Payroll finalized.', {
        description: `Transaction #${result.transactionId} created for ${formatCurrency(netPay)}.`,
      })
      onSuccess()
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to finalize payroll.'
      setFormError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Process payroll</h2>
            <p className="text-xs text-gray-500">{staffDisplayName}</p>
          </div>
          <button
            className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="divide-y divide-gray-100" onSubmit={handleSubmit}>
          <div className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <ModalField label="Period start" required>
                <input
                  className={modalInputClass}
                  max={periodEnd || undefined}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  type="date"
                  value={periodStart}
                />
              </ModalField>
              <ModalField
                label="Period end"
                required
                help="Must fall on the payroll cutoff weekday (configured in Settings)."
              >
                <input
                  className={modalInputClass}
                  min={periodStart || undefined}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  type="date"
                  value={periodEnd}
                />
              </ModalField>
              <ModalField label="Pay date (ledger)" required>
                <input
                  className={modalInputClass}
                  onChange={(e) => setPayDate(e.target.value)}
                  type="date"
                  value={payDate}
                />
              </ModalField>
            </div>

            {previewError ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
                {previewError}
              </div>
            ) : null}

            {loadingPreview ? (
              <div className="py-8 text-center text-sm text-gray-500">Loading preview…</div>
            ) : preview ? (
              <>
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  <span className="text-gray-500">Period:&nbsp;</span>
                  <span className="font-medium tabular-nums text-gray-900">
                    {preview.periodStart} → {preview.periodEnd}
                  </span>
                  <span className="ml-2 text-gray-500">
                    (cutoff weekday {preview.cutoffDay})
                  </span>
                </div>

                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full min-w-[520px] text-left text-xs">
                    <thead className="border-b border-gray-200 bg-gray-50">
                      <tr>
                        <th className="px-3 py-2">
                          <SortHeaderButton
                            active={sortField === 'entryDate'}
                            direction={sortDir}
                            label="Date"
                            onClick={() => toggleSort('entryDate')}
                          />
                        </th>
                        <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                          Status
                        </th>
                        <th className="px-3 py-2">
                          <SortHeaderButton
                            active={sortField === 'rateUsed'}
                            direction={sortDir}
                            label="Rate"
                            align="right"
                            onClick={() => toggleSort('rateUsed')}
                          />
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                          ×
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                          Pay
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-800">
                      {sortedItems.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                            No unpaid attendance in this period.
                          </td>
                        </tr>
                      ) : (
                        sortedItems.map((row) => (
                          <tr key={row.attendanceId} className="transition hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono tabular-nums">{row.entryDate}</td>
                            <td className="px-3 py-2 capitalize">{row.status}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatCurrency(row.rateUsed)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{row.multiplier}</td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">
                              {formatCurrency(row.payAmount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="text-gray-500">Base:&nbsp;</span>
                    <span className="font-semibold tabular-nums text-gray-900">
                      {formatCurrency(preview.basePay)}
                    </span>
                  </span>
                  {earningTotal > 0 ? (
                    <span>
                      <span className="text-gray-500">Earnings:&nbsp;</span>
                      <span className="font-semibold tabular-nums text-emerald-700">
                        +{formatCurrency(earningTotal)}
                      </span>
                    </span>
                  ) : null}
                  {deductionTotal + advanceDeductionTotal > 0 ? (
                    <span>
                      <span className="text-gray-500">Deductions:&nbsp;</span>
                      <span className="font-semibold tabular-nums text-amber-700">
                        −{formatCurrency(deductionTotal + advanceDeductionTotal)}
                      </span>
                    </span>
                  ) : null}
                  <span>
                    <span className="text-gray-500">Net:&nbsp;</span>
                    <span className="font-semibold tabular-nums text-blue-600">
                      {formatCurrency(netPay)}
                    </span>
                  </span>
                </div>
              </>
            ) : null}

            {outstandingAdvances.length > 0 ? (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-amber-900">
                      Outstanding cash advances
                    </p>
                    <p className="text-[11px] text-amber-700">
                      Checked items will be deducted from this payroll and marked settled.
                      Uncheck to defer to a later payroll.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      className="rounded border border-amber-300 bg-white px-2 py-1 font-medium text-amber-800 transition hover:bg-amber-100"
                      onClick={() =>
                        setSelectedAdvanceIds(new Set(outstandingAdvances.map((a) => a.id)))
                      }
                      type="button"
                    >
                      Select all
                    </button>
                    <button
                      className="rounded border border-amber-300 bg-white px-2 py-1 font-medium text-amber-800 transition hover:bg-amber-100"
                      onClick={() => setSelectedAdvanceIds(new Set())}
                      type="button"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <ul className="divide-y divide-amber-200 rounded border border-amber-200 bg-white">
                  {outstandingAdvances.map((a) => (
                    <li key={a.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition hover:bg-amber-50">
                        <input
                          checked={selectedAdvanceIds.has(a.id)}
                          className="h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                          onChange={() => toggleAdvance(a.id)}
                          type="checkbox"
                        />
                        <span className="font-mono text-xs tabular-nums text-gray-600">
                          {a.advanceDate}
                        </span>
                        <span className="flex-1 truncate text-xs text-gray-500">
                          {a.notes || '—'}
                        </span>
                        <span className="font-medium tabular-nums text-gray-900">
                          {formatCurrency(a.amount)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {preview ? (
              <AdjustmentLinesEditor
                overtimeMultiplier={preview.overtimeMultiplier}
                rows={adjustments}
                setRows={setAdjustments}
                staffDefaultRate={preview.staffDefaultRate}
                standardDayHours={preview.standardDayHours}
                theme="light"
              />
            ) : null}

            <ModalField label="Notes">
              <textarea
                className="min-h-[56px] w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition resize-none placeholder:text-gray-400"
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional memo that will appear on the expense transaction…"
                value={notes}
              />
            </ModalField>

            {formError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
                {formError}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4">
            <button
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              disabled={submitting || !preview || Boolean(previewError) || netPay < 0}
              type="submit"
            >
              {submitting ? 'Saving…' : 'Confirm & post payroll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
