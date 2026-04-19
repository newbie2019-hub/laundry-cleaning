import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Lock, Wallet, X } from 'lucide-react'
import { getPayrollDetail, type PayrollDetail } from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'

type Props = {
  onClose: () => void
  open: boolean
  payrollId: number | null
  staffDisplayName: string
}

function safeFormatDate(iso: string) {
  try {
    return format(parseISO(iso), 'EEE, MMM d, yyyy')
  } catch {
    return iso
  }
}

export function PayrollDetailDialog({ onClose, open, payrollId, staffDisplayName }: Props) {
  const [detail, setDetail] = useState<PayrollDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || payrollId == null) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    ;(async () => {
      try {
        const result = await getPayrollDetail(payrollId)
        if (cancelled) return
        if (!result) {
          setError('Payroll record not found.')
        } else {
          setDetail(result)
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unable to load payroll detail.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, payrollId])

  if (!open) return null

  const bonuses = detail?.adjustments.filter((a) => a.kind === 'bonus') ?? []
  const deductions = detail?.adjustments.filter((a) => a.kind === 'deduction') ?? []
  const bonusTotal = bonuses.reduce((sum, a) => sum + a.amount, 0)
  const deductionTotal = deductions.reduce((sum, a) => sum + a.amount, 0)

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-blue-50 p-2 text-blue-600">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Payroll details</h2>
              <p className="text-xs text-gray-500">{staffDisplayName}</p>
            </div>
          </div>
          <button
            className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-500">Loading payroll…</div>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">
              {error}
            </div>
          ) : detail ? (
            <>
              <div className="grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Pay date
                  </p>
                  <p className="mt-0.5 font-medium text-gray-900">
                    {safeFormatDate(detail.payroll.payDate)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Period
                  </p>
                  <p className="mt-0.5 font-mono text-xs tabular-nums text-gray-900">
                    {detail.payroll.periodStart} → {detail.payroll.periodEnd}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Status
                  </p>
                  <p className="mt-0.5">
                    {detail.payroll.status === 'paid' ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        <Lock className="h-3 w-3" />
                        Paid
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                        Void
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-[480px] text-left text-xs">
                  <thead className="border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">×</th>
                      <th className="px-3 py-2 text-right">Pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-800">
                    {detail.items.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                          No attendance entries in this payroll.
                        </td>
                      </tr>
                    ) : (
                      detail.items.map((row) => (
                        <tr key={row.attendanceId} className="hover:bg-gray-50">
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

              {detail.adjustments.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Adjustments
                  </h3>
                  <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                    {detail.adjustments.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={
                              a.kind === 'bonus'
                                ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700'
                                : 'rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700'
                            }
                          >
                            {a.kind}
                          </span>
                          <span className="text-gray-800">{a.label}</span>
                        </span>
                        <span
                          className={`font-medium tabular-nums ${
                            a.kind === 'bonus' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {a.kind === 'bonus' ? '+' : '−'}
                          {formatCurrency(a.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Gross
                  </p>
                  <p className="mt-0.5 font-medium tabular-nums text-gray-900">
                    {formatCurrency(detail.payroll.grossPay)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Bonuses
                  </p>
                  <p className="mt-0.5 font-medium tabular-nums text-emerald-700">
                    +{formatCurrency(bonusTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Deductions
                  </p>
                  <p className="mt-0.5 font-medium tabular-nums text-red-700">
                    −{formatCurrency(deductionTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Net pay
                  </p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums text-blue-600">
                    {formatCurrency(detail.payroll.netPay)}
                  </p>
                </div>
              </div>

              {(detail.payroll.notes || detail.payroll.transactionId != null) && (
                <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
                  {detail.payroll.transactionId != null ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        Ledger entry
                      </p>
                      <p className="mt-0.5 font-mono text-gray-800">
                        Transaction #{detail.payroll.transactionId}
                      </p>
                    </div>
                  ) : null}
                  {detail.payroll.notes ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        Notes
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-gray-800">
                        {detail.payroll.notes}
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
