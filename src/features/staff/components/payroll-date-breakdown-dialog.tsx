import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, Wallet, X } from 'lucide-react'
import {
  listPayrollsByPayDate,
  type AllStaffPayrollItem,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'

type Props = {
  onClose: () => void
  open: boolean
  payDate: string | null
}

function safeFormatDate(iso: string) {
  try {
    return format(parseISO(iso), 'EEEE, MMMM d, yyyy')
  } catch {
    return iso
  }
}

export function PayrollDateBreakdownDialog({ onClose, open, payDate }: Props) {
  const [payrolls, setPayrolls] = useState<AllStaffPayrollItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !payDate) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPayrolls([])
    ;(async () => {
      try {
        const result = await listPayrollsByPayDate(payDate)
        if (!cancelled) setPayrolls(result)
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Unable to load payroll breakdown.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, payDate])

  if (!open || !payDate) return null

  const totalGross = payrolls.reduce((s, p) => s + p.grossPay, 0)
  const totalDeductions = payrolls.reduce((s, p) => s + Math.abs(p.totalAdjustments), 0)
  const totalNet = payrolls.reduce((s, p) => s + p.netPay, 0)

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-[var(--panel)] shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b border-[var(--border)] bg-[var(--panel)] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-blue-500/15 p-2 text-blue-400">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">Payroll Breakdown</h2>
              <p className="text-xs text-[var(--muted)]">Processed on {safeFormatDate(payDate)}</p>
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
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--muted)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
              {error}
            </div>
          ) : payrolls.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted)]">
              No payrolls processed on this date.
            </div>
          ) : (
            <>
              {/* Summary row */}
              <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)]/60 p-4 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Employees
                  </p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-[var(--foreground)]">
                    {payrolls.length}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Total gross
                  </p>
                  <p className="mt-0.5 font-semibold tabular-nums text-[var(--foreground)]">
                    {formatCurrency(totalGross)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Total deductions
                  </p>
                  <p className="mt-0.5 font-semibold tabular-nums text-red-400">
                    {totalDeductions > 0 ? `−${formatCurrency(totalDeductions)}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Total net pay
                  </p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-blue-400">
                    {formatCurrency(totalNet)}
                  </p>
                </div>
              </div>

              {/* Per-employee breakdown table */}
              <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-[var(--border)] bg-[var(--background)]/50 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3">Period</th>
                      <th className="px-4 py-3 text-right">Gross</th>
                      <th className="px-4 py-3 text-right">Deductions</th>
                      <th className="px-4 py-3 text-right">Net pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {payrolls.map((p) => {
                      const deductions = p.totalAdjustments < 0 ? Math.abs(p.totalAdjustments) : 0
                      return (
                        <tr key={p.id} className="transition hover:bg-[var(--background)]/40">
                          <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                            {p.staffDisplayName}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs tabular-nums text-[var(--muted)]">
                            {p.periodStart}
                            <span className="mx-1 text-[var(--border)]">→</span>
                            {p.periodEnd}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                            {formatCurrency(p.grossPay)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-red-400">
                            {deductions > 0 ? `−${formatCurrency(deductions)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-blue-400">
                            {formatCurrency(p.netPay)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-[var(--border)] bg-[var(--background)]/50 text-sm font-semibold">
                    <tr>
                      <td className="px-4 py-3 text-[var(--muted)]" colSpan={2}>
                        Total
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                        {formatCurrency(totalGross)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-red-400">
                        {totalDeductions > 0 ? `−${formatCurrency(totalDeductions)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-blue-400">
                        {formatCurrency(totalNet)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--border)] px-5 py-4">
          <button
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--background)]"
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
