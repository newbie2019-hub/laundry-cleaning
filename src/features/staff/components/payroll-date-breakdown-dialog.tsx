import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import {
  getPayrollDetail,
  listPayrollsByPayDate,
  type AllStaffPayrollItem,
  type PayrollDetail,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'
import { ManageAttendanceDialog } from './manage-attendance-dialog'

// ── Types ─────────────────────────────────────────────────────────────────────

type EnrichedPayrollRow = AllStaffPayrollItem & {
  detail: PayrollDetail | null
  basePay: number
  overtimePay: number
  loanDeductions: number
  otherDeductions: number
  bonuses: number
  daysWorked: number
  overtimeDays: number
}

type Props = {
  onClose: () => void
  open: boolean
  payDate: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeFormatDate(iso: string) {
  try {
    return format(parseISO(iso), 'EEEE, MMMM d, yyyy')
  } catch {
    return iso
  }
}

function safeFormatShort(iso: string) {
  try {
    return format(parseISO(iso), 'MMM d')
  } catch {
    return iso
  }
}

function enrichRow(item: AllStaffPayrollItem, detail: PayrollDetail | null): EnrichedPayrollRow {
  if (!detail) {
    return {
      ...item,
      detail: null,
      basePay: item.grossPay,
      overtimePay: 0,
      loanDeductions: 0,
      otherDeductions: Math.max(0, -item.totalAdjustments),
      bonuses: 0,
      daysWorked: 0,
      overtimeDays: 0,
    }
  }

  // Compute overtime pay from items with status='overtime'
  let overtimePay = 0
  let basePay = 0
  let overtimeDays = 0
  for (const it of detail.items) {
    if (it.status === 'overtime') {
      overtimePay += it.payAmount
      overtimeDays++
    } else {
      basePay += it.payAmount
    }
  }

  // Separate loan (cash advance) from other deductions
  let loanDeductions = 0
  let otherDeductions = 0
  let bonuses = 0
  for (const adj of detail.adjustments) {
    if (adj.kind === 'bonus') {
      bonuses += adj.amount
    } else {
      // Cash advances are labeled "Cash advance · {date}"
      if (adj.label.toLowerCase().startsWith('cash advance')) {
        loanDeductions += adj.amount
      } else {
        otherDeductions += adj.amount
      }
    }
  }

  return {
    ...item,
    detail,
    basePay,
    overtimePay,
    loanDeductions,
    otherDeductions,
    bonuses,
    daysWorked: detail.items.length,
    overtimeDays,
  }
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)]/60 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className={['mt-1 text-lg font-bold tabular-nums', color ?? 'text-[var(--foreground)]'].join(' ')}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-[var(--muted)]">{sub}</p>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PayrollDateBreakdownDialog({ onClose, open, payDate }: Props) {
  const [rows, setRows] = useState<EnrichedPayrollRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attendanceOpen, setAttendanceOpen] = useState(false)

  useEffect(() => {
    if (!open || !payDate) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setRows([])

    void (async () => {
      try {
        const payrolls = await listPayrollsByPayDate(payDate)

        // Load payroll detail for every employee in parallel
        const details = await Promise.allSettled(
          payrolls.map((p) => getPayrollDetail(p.id)),
        )

        if (cancelled) return

        const enriched = payrolls.map((p, i) => {
          const res = details[i]
          const detail = res?.status === 'fulfilled' ? res.value : null
          return enrichRow(p, detail)
        })

        setRows(enriched)
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

  // ── Aggregates ──────────────────────────────────────────────────────────────

  const totalStaff = rows.length
  const totalPresent = rows.filter((r) => r.daysWorked > 0).length
  const totalGross = rows.reduce((s, r) => s + r.grossPay, 0)
  const totalDeductions = rows.reduce((s, r) => s + r.loanDeductions + r.otherDeductions, 0)
  const totalNet = rows.reduce((s, r) => s + r.netPay, 0)
  const paidCount = rows.filter((r) => r.status === 'paid').length
  const pendingCount = rows.filter((r) => r.status !== 'paid').length

  // Period reference from first row (all rows share same payDate; use first period)
  const firstRow = rows[0]
  const periodStart = firstRow?.periodStart ?? payDate
  const periodEnd = firstRow?.periodEnd ?? payDate
  const periodLabel =
    periodStart && periodEnd
      ? `${safeFormatShort(periodStart)} – ${safeFormatShort(periodEnd)}`
      : undefined

  return (
    <>
      <div
        aria-modal="true"
        className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 pt-8"
        role="dialog"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative z-10 mb-10 w-full max-w-5xl rounded-xl bg-[var(--panel)] shadow-2xl">

          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b border-[var(--border)] bg-[var(--panel)] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-blue-500/15 p-2 text-blue-400">
                <Wallet className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">Payroll Summary</h2>
                <p className="text-xs text-[var(--muted)]">
                  Processed on {safeFormatDate(payDate)}
                  {periodLabel && (
                    <span className="ml-1.5 rounded bg-[var(--background)] px-1.5 py-0.5 font-mono text-[10px]">
                      {periodLabel}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!loading && rows.length > 0 && (
                <button
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                  onClick={() => setAttendanceOpen(true)}
                  type="button"
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Manage Attendance
                </button>
              )}
              <button
                className="rounded-md p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={onClose}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-5 p-5">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading payroll details…
              </div>
            ) : error ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                {error}
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center text-sm text-[var(--muted)]">
                No payrolls processed on this date.
              </div>
            ) : (
              <>
                {/* ── Summary cards ── */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <SummaryCard
                    label="Total Staff"
                    value={totalStaff}
                    sub={`${totalPresent} present`}
                    color="text-[var(--foreground)]"
                  />
                  <SummaryCard
                    label="Total Payroll"
                    value={formatCurrency(totalGross)}
                    sub="gross amount"
                  />
                  <SummaryCard
                    label="Total Deductions"
                    value={totalDeductions > 0 ? `−${formatCurrency(totalDeductions)}` : '—'}
                    color="text-red-400"
                  />
                  <SummaryCard
                    label="Net Released"
                    value={formatCurrency(totalNet)}
                    color="text-blue-400"
                  />
                </div>

                {/* Payment status row */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">{paidCount} Paid</span>
                  </div>
                  {pendingCount > 0 && (
                    <div className="flex items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm">
                      <Clock className="h-4 w-4 text-amber-400" />
                      <span className="text-amber-400 font-medium">{pendingCount} Pending</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)]/50 px-3 py-2 text-sm">
                    <Users className="h-4 w-4 text-[var(--muted)]" />
                    <span className="text-[var(--muted)]">
                      {totalPresent} of {totalStaff} present
                    </span>
                  </div>
                </div>

                {/* ── Per-employee table ── */}
                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="border-b border-[var(--border)] bg-[var(--background)]/50 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      <tr>
                        <th className="px-4 py-3">Employee</th>
                        <th className="px-4 py-3 text-center">Attendance</th>
                        <th className="px-4 py-3 text-right">Daily Rate</th>
                        <th className="px-4 py-3 text-right">Base Pay</th>
                        <th className="px-4 py-3 text-right">Overtime Pay</th>
                        <th className="px-4 py-3 text-right">Gross Pay</th>
                        <th className="px-4 py-3 text-right">Loan Ded.</th>
                        <th className="px-4 py-3 text-right">Other Ded.</th>
                        <th className="px-4 py-3 text-right">Net Pay</th>
                        <th className="px-4 py-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {rows.map((r) => {
                        const isPresent = r.daysWorked > 0
                        const totalDed = r.loanDeductions + r.otherDeductions

                        return (
                          <tr
                            key={r.id}
                            className="transition hover:bg-[var(--background)]/40"
                          >
                            {/* Employee */}
                            <td className="px-4 py-3">
                              <p className="font-medium text-[var(--foreground)]">{r.staffDisplayName}</p>
                              {r.detail && r.daysWorked > 0 && (
                                <p className="text-[10px] text-[var(--muted)]">
                                  {r.daysWorked} day{r.daysWorked !== 1 ? 's' : ''} worked
                                  {r.overtimeDays > 0 && ` · ${r.overtimeDays} OT`}
                                </p>
                              )}
                            </td>

                            {/* Attendance status */}
                            <td className="px-4 py-3 text-center">
                              <span
                                className={[
                                  'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                                  isPresent
                                    ? 'bg-emerald-500/15 text-emerald-400'
                                    : 'bg-red-500/15 text-red-400',
                                ].join(' ')}
                              >
                                {isPresent ? 'Present' : 'Absent'}
                              </span>
                            </td>

                            {/* Daily Rate */}
                            <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                              {r.detail?.payroll
                                ? formatCurrency(
                                    r.detail.items[0]?.rateUsed ?? 0,
                                  )
                                : '—'}
                            </td>

                            {/* Base Pay */}
                            <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                              {formatCurrency(r.basePay)}
                            </td>

                            {/* Overtime Pay */}
                            <td className="px-4 py-3 text-right tabular-nums">
                              {r.overtimePay > 0 ? (
                                <span className="text-violet-400">+{formatCurrency(r.overtimePay)}</span>
                              ) : (
                                <span className="text-[var(--muted)]">—</span>
                              )}
                            </td>

                            {/* Gross Pay */}
                            <td className="px-4 py-3 text-right tabular-nums font-medium text-[var(--foreground)]">
                              {formatCurrency(r.grossPay)}
                            </td>

                            {/* Loan Deductions */}
                            <td className="px-4 py-3 text-right tabular-nums text-red-400">
                              {r.loanDeductions > 0 ? `−${formatCurrency(r.loanDeductions)}` : '—'}
                            </td>

                            {/* Other Deductions */}
                            <td className="px-4 py-3 text-right tabular-nums text-amber-500">
                              {r.otherDeductions > 0 ? `−${formatCurrency(r.otherDeductions)}` : '—'}
                            </td>

                            {/* Net Pay */}
                            <td className="px-4 py-3 text-right">
                              <p className="font-semibold tabular-nums text-blue-400">
                                {formatCurrency(r.netPay)}
                              </p>
                              {totalDed > 0 && (
                                <p className="text-[10px] text-[var(--muted)]">
                                  −{formatCurrency(totalDed)} ded.
                                </p>
                              )}
                            </td>

                            {/* Status */}
                            <td className="px-4 py-3 text-center">
                              {r.status === 'paid' ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Paid
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                                  <Clock className="h-3 w-3" />
                                  Pending
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>

                    {/* Totals footer */}
                    <tfoot className="border-t-2 border-[var(--border)] bg-[var(--background)]/50 text-sm font-semibold">
                      <tr>
                        <td className="px-4 py-3 text-[var(--muted)]" colSpan={3}>
                          Totals
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                          {formatCurrency(rows.reduce((s, r) => s + r.basePay, 0))}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-violet-400">
                          {rows.reduce((s, r) => s + r.overtimePay, 0) > 0
                            ? `+${formatCurrency(rows.reduce((s, r) => s + r.overtimePay, 0))}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                          {formatCurrency(totalGross)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-red-400">
                          {rows.reduce((s, r) => s + r.loanDeductions, 0) > 0
                            ? `−${formatCurrency(rows.reduce((s, r) => s + r.loanDeductions, 0))}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-500">
                          {rows.reduce((s, r) => s + r.otherDeductions, 0) > 0
                            ? `−${formatCurrency(rows.reduce((s, r) => s + r.otherDeductions, 0))}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-blue-400">
                          {formatCurrency(totalNet)}
                        </td>
                        <td className="px-4 py-3" />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* ── Legend ── */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[var(--muted)]">
                  <span>
                    <span className="mr-1 inline-block h-2 w-2 rounded-full bg-violet-400/70" />
                    Overtime Pay — extra pay from overtime attendance days
                  </span>
                  <span>
                    <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-400/70" />
                    Loan Deductions — cash advances settled this payroll
                  </span>
                  <span>
                    <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400/70" />
                    Other Deductions — manual adjustments (SSS, etc.)
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
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

      {/* Manage Attendance sub-dialog */}
      <ManageAttendanceDialog
        open={attendanceOpen}
        onClose={() => setAttendanceOpen(false)}
        onSaved={() => setAttendanceOpen(false)}
        date={periodEnd}
        periodLabel={
          periodStart && periodEnd
            ? `${safeFormatShort(periodStart)} – ${safeFormatShort(periodEnd)}`
            : undefined
        }
      />
    </>
  )
}
