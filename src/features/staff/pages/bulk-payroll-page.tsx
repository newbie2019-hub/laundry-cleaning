import { useEffect, useMemo, useState } from "react"
import { endOfMonth, format, parseISO, startOfMonth } from "date-fns"
import { Loader2, Plus, Wallet } from "lucide-react"
import { useNavigate } from "react-router-dom"
import {
  listAttendanceDaySummaries,
  listPayrollPayDateSummaries,
  type AttendanceDaySummary,
  type PayrollPayDateSummary,
} from "../../../lib/db/repository"
import { formatCurrency } from "../../../lib/format"
import { useAuth } from "../../auth/use-auth"
import { AttendanceDaySummaryDialog } from "../components/attendance-day-summary-dialog"
import { PayrollCalendar } from "../components/payroll-calendar"
import { ProcessPayrollDialog } from "../components/process-payroll-dialog"

export function BulkPayrollPage() {
  const { hasPermission } = useAuth()
  const canProcess = hasPermission("process_payroll")
  const navigate = useNavigate()

  const [monthKey, setMonthKey] = useState(() => format(new Date(), "yyyy-MM"))
  const [daySummaries, setDaySummaries] = useState<
    Map<string, AttendanceDaySummary>
  >(new Map())
  const [payDateSummaries, setPayDateSummaries] = useState<
    Map<string, PayrollPayDateSummary>
  >(new Map())
  const [loadingCalendar, setLoadingCalendar] = useState(false)

  const [processDialogOpen, setProcessDialogOpen] = useState(false)
  const [daySummaryDate, setDaySummaryDate] = useState<string | null>(null)

  // Derived month range
  const { from, to } = useMemo(() => {
    const start = startOfMonth(parseISO(`${monthKey}-01`))
    const end = endOfMonth(start)
    return {
      from: format(start, "yyyy-MM-dd"),
      to: format(end, "yyyy-MM-dd"),
    }
  }, [monthKey])

  // Load calendar data whenever month changes
  useEffect(() => {
    let cancelled = false
    setLoadingCalendar(true)
    void (async () => {
      try {
        const [dayRows, payDateRows] = await Promise.all([
          listAttendanceDaySummaries(from, to),
          listPayrollPayDateSummaries(from, to),
        ])
        if (cancelled) return

        const dayMap = new Map<string, AttendanceDaySummary>()
        for (const r of dayRows) dayMap.set(r.date, r)

        const pdMap = new Map<string, PayrollPayDateSummary>()
        for (const r of payDateRows) pdMap.set(r.payDate, r)

        setDaySummaries(dayMap)
        setPayDateSummaries(pdMap)
      } finally {
        if (!cancelled) setLoadingCalendar(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [from, to])

  function handleProcessed() {
    // Refresh calendar after a successful payroll run
    void (async () => {
      const [dayRows, payDateRows] = await Promise.all([
        listAttendanceDaySummaries(from, to),
        listPayrollPayDateSummaries(from, to),
      ])
      const dayMap = new Map<string, AttendanceDaySummary>()
      for (const r of dayRows) dayMap.set(r.date, r)
      const pdMap = new Map<string, PayrollPayDateSummary>()
      for (const r of payDateRows) pdMap.set(r.payDate, r)
      setDaySummaries(dayMap)
      setPayDateSummaries(pdMap)
    })()
  }

  if (!canProcess) {
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Payroll</h1>
        <p className="text-sm text-[var(--muted)]">
          You do not have permission to process payroll.
        </p>
      </section>
    )
  }

  // Sorted pay dates for the history table
  const payDateList = useMemo(
    () =>
      [...payDateSummaries.values()].sort((a, b) =>
        b.payDate.localeCompare(a.payDate),
      ),
    [payDateSummaries],
  )

  return (
    <>
      <section className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Payroll</h1>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              View attendance and payroll history by month. Click a payroll
              badge to see the breakdown.
            </p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            onClick={() => setProcessDialogOpen(true)}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Process Payroll
          </button>
        </header>

        {/* Calendar */}
        <div className="relative">
          {loadingCalendar && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[var(--panel)]/70 backdrop-blur-sm">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted)]" />
            </div>
          )}
          <PayrollCalendar
            daySummaries={daySummaries}
            monthKey={monthKey}
            onMonthChange={setMonthKey}
            onPickDay={(d) => setDaySummaryDate(d)}
            onPickPayDate={(d) => navigate(`/payroll/${d}`)}
            payDateSummaries={payDateSummaries}
          />
        </div>

        {/* Payroll history table for this month */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            Processed this month
          </h2>
          {loadingCalendar ? (
            <div className="flex items-center justify-center py-10 text-sm text-[var(--muted)] mt-4">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : payDateList.length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-10 text-center text-sm text-[var(--muted)]">
              No payrolls processed in this month.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] mt-3">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--background)]/50 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3">Pay date</th>
                    <th className="px-4 py-3 text-right">Employees</th>
                    <th className="px-4 py-3 text-right">Total gross</th>
                    <th className="px-4 py-3 text-right">Total net</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {payDateList.map((pd) => (
                    <tr
                      key={pd.payDate}
                      className="cursor-pointer transition hover:bg-[var(--background)]/40"
                      onClick={() => navigate(`/payroll/${pd.payDate}`)}
                    >
                      <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                        {format(parseISO(pd.payDate), "MMM d, yyyy")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                        {pd.count}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                        {formatCurrency(pd.totalGross)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-blue-400">
                        {formatCurrency(pd.totalNet)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1 rounded bg-blue-600/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                          <Wallet className="h-2.5 w-2.5" />
                          View
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Dialogs */}
      <ProcessPayrollDialog
        onClose={() => setProcessDialogOpen(false)}
        onProcessed={handleProcessed}
        open={processDialogOpen}
      />
      <AttendanceDaySummaryDialog
        date={daySummaryDate}
        onClose={() => setDaySummaryDate(null)}
        open={daySummaryDate !== null}
      />
    </>
  )
}
