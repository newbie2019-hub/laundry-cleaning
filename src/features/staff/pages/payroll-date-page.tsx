import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  Users,
  Wallet,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import {
  getPayrollDetail,
  listPayrollsByPayDate,
  type AllStaffPayrollItem,
  type PayrollDetail,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'
import { useAuth } from '../../auth/use-auth'
import { ManageAttendanceDialog } from '../components/manage-attendance-dialog'

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeFormat(iso: string, fmt: string) {
  try {
    return format(parseISO(iso), fmt)
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

  let loanDeductions = 0
  let otherDeductions = 0
  let bonuses = 0
  for (const adj of detail.adjustments) {
    if (adj.kind === 'bonus') {
      bonuses += adj.amount
    } else if (adj.label.toLowerCase().startsWith('cash advance')) {
      loanDeductions += adj.amount
    } else {
      otherDeductions += adj.amount
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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className={['mt-1.5 text-2xl font-bold tabular-nums', color ?? 'text-[var(--foreground)]'].join(' ')}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function PayrollDatePage() {
  const { date } = useParams<{ date: string }>()
  const { hasPermission } = useAuth()
  const canProcess = hasPermission('process_payroll')

  const [rows, setRows] = useState<EnrichedPayrollRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attendanceOpen, setAttendanceOpen] = useState(false)

  useEffect(() => {
    if (!date) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setRows([])

    void (async () => {
      try {
        const payrolls = await listPayrollsByPayDate(date)
        const details = await Promise.allSettled(payrolls.map((p) => getPayrollDetail(p.id)))
        if (cancelled) return

        const enriched = payrolls.map((p, i) => {
          const res = details[i]
          const detail = res?.status === 'fulfilled' ? res.value : null
          return enrichRow(p, detail)
        })
        setRows(enriched)
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Unable to load payroll details.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [date])

  if (!canProcess) {
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Payroll</h1>
        <p className="text-sm text-[var(--muted)]">You do not have permission to view payroll.</p>
      </section>
    )
  }

  if (!date) return null

  // ── Aggregates ──────────────────────────────────────────────────────────────

  const totalStaff = rows.length
  const totalPresent = rows.filter((r) => r.daysWorked > 0).length
  const totalGross = rows.reduce((s, r) => s + r.grossPay, 0)
  const totalLoan = rows.reduce((s, r) => s + r.loanDeductions, 0)
  const totalOther = rows.reduce((s, r) => s + r.otherDeductions, 0)
  const totalDeductions = totalLoan + totalOther
  const totalNet = rows.reduce((s, r) => s + r.netPay, 0)
  const totalOvertime = rows.reduce((s, r) => s + r.overtimePay, 0)
  const paidCount = rows.filter((r) => r.status === 'paid').length
  const pendingCount = rows.filter((r) => r.status !== 'paid').length

  const firstRow = rows[0]
  const periodStart = firstRow?.periodStart ?? date
  const periodEnd = firstRow?.periodEnd ?? date
  const periodLabel =
    periodStart && periodEnd
      ? `${safeFormat(periodStart, 'MMM d')} – ${safeFormat(periodEnd, 'MMM d, yyyy')}`
      : undefined

  return (
    <>
      <section className="space-y-6">
        {/* ── Page header ── */}
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Link
              className="mt-0.5 rounded-md border border-[var(--border)] p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
              to="/payroll"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-blue-500/15 p-2 text-blue-400">
                  <Wallet className="h-4 w-4" />
                </div>
                <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
                  Payroll Summary
                </h1>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Processed on{' '}
                <span className="font-medium text-[var(--foreground)]">
                  {safeFormat(date, 'EEEE, MMMM d, yyyy')}
                </span>
                {periodLabel && (
                  <span className="ml-2 rounded bg-[var(--panel)] border border-[var(--border)] px-2 py-0.5 font-mono text-xs">
                    Period: {periodLabel}
                  </span>
                )}
              </p>
            </div>
          </div>

          {!loading && rows.length > 0 && (
            <button
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
              onClick={() => setAttendanceOpen(true)}
              type="button"
            >
              <CalendarDays className="h-4 w-4" />
              Manage Attendance
            </button>
          )}
        </header>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-[var(--muted)]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading payroll details…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-16 text-center text-sm text-[var(--muted)]">
            No payrolls processed on this date.
          </div>
        ) : (
          <>
            {/* ── Summary cards ── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard
                label="Total Staff"
                value={totalStaff}
                sub={`${totalPresent} present · ${totalStaff - totalPresent} absent`}
              />
              <SummaryCard
                label="Total Gross"
                value={formatCurrency(totalGross)}
                sub={totalOvertime > 0 ? `incl. ${formatCurrency(totalOvertime)} OT` : 'base pay only'}
              />
              <SummaryCard
                label="Total Deductions"
                value={totalDeductions > 0 ? `−${formatCurrency(totalDeductions)}` : '—'}
                sub={totalDeductions > 0 ? `${formatCurrency(totalLoan)} loan · ${formatCurrency(totalOther)} other` : 'no deductions'}
                color="text-red-400"
              />
              <SummaryCard
                label="Net Released"
                value={formatCurrency(totalNet)}
                sub={`${paidCount} paid${pendingCount > 0 ? ` · ${pendingCount} pending` : ''}`}
                color="text-blue-400"
              />
            </div>

            {/* Status chips */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="font-medium text-emerald-400">{paidCount} Paid</span>
              </div>
              {pendingCount > 0 && (
                <div className="flex items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm">
                  <Clock className="h-4 w-4 text-amber-400" />
                  <span className="font-medium text-amber-400">{pendingCount} Pending</span>
                </div>
              )}
              <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm">
                <Users className="h-4 w-4 text-[var(--muted)]" />
                <span className="text-[var(--muted)]">
                  {totalPresent} of {totalStaff} present
                </span>
              </div>
            </div>

            {/* ── Per-employee table ── */}
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
                Employee Breakdown
              </h2>
              <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--panel)]">
                <table className="w-full min-w-[960px] text-left text-sm">
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
                      const dailyRate = r.detail?.items[0]?.rateUsed ?? 0

                      return (
                        <tr key={r.id} className="transition hover:bg-[var(--background)]/40">
                          {/* Employee */}
                          <td className="px-4 py-3">
                            <p className="font-medium text-[var(--foreground)]">{r.staffDisplayName}</p>
                            {r.daysWorked > 0 && (
                              <p className="text-[10px] text-[var(--muted)]">
                                {r.daysWorked} day{r.daysWorked !== 1 ? 's' : ''} worked
                                {r.overtimeDays > 0 && ` · ${r.overtimeDays} OT`}
                              </p>
                            )}
                          </td>

                          {/* Attendance */}
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
                            {dailyRate > 0 ? formatCurrency(dailyRate) : '—'}
                          </td>

                          {/* Base Pay */}
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                            {formatCurrency(r.basePay)}
                          </td>

                          {/* Overtime Pay */}
                          <td className="px-4 py-3 text-right tabular-nums">
                            {r.overtimePay > 0 ? (
                              <span className="font-medium text-violet-400">
                                +{formatCurrency(r.overtimePay)}
                              </span>
                            ) : (
                              <span className="text-[var(--muted)]">—</span>
                            )}
                          </td>

                          {/* Gross Pay */}
                          <td className="px-4 py-3 text-right tabular-nums font-semibold text-[var(--foreground)]">
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
                            <p className="font-bold tabular-nums text-blue-400">
                              {formatCurrency(r.netPay)}
                            </p>
                            {totalDed > 0 && (
                              <p className="text-[10px] text-[var(--muted)]">
                                −{formatCurrency(totalDed)} total ded.
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
                        {totalOvertime > 0 ? `+${formatCurrency(totalOvertime)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                        {formatCurrency(totalGross)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-red-400">
                        {totalLoan > 0 ? `−${formatCurrency(totalLoan)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-500">
                        {totalOther > 0 ? `−${formatCurrency(totalOther)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-blue-400">
                        {formatCurrency(totalNet)}
                      </td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-xs text-[var(--muted)]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-violet-400" />
                Overtime Pay — pay from overtime attendance days (×1.25)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                Loan Deductions — cash advances settled this payroll
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Other Deductions — manual adjustments (SSS, etc.)
              </span>
            </div>
          </>
        )}
      </section>

      {/* Manage Attendance dialog */}
      <ManageAttendanceDialog
        open={attendanceOpen}
        onClose={() => setAttendanceOpen(false)}
        onSaved={() => setAttendanceOpen(false)}
        date={periodEnd}
        periodLabel={periodLabel}
      />
    </>
  )
}
