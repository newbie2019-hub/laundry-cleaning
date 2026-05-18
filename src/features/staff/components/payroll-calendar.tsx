import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Wallet } from 'lucide-react'
import type { AttendanceDaySummary, PayrollPayDateSummary } from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Props = {
  daySummaries: Map<string, AttendanceDaySummary>
  monthKey: string
  onMonthChange: (monthKey: string) => void
  onPickPayDate: (payDate: string) => void
  payDateSummaries: Map<string, PayrollPayDateSummary>
}

export function PayrollCalendar({
  daySummaries,
  monthKey,
  onMonthChange,
  onPickPayDate,
  payDateSummaries,
}: Props) {
  const monthStart = startOfMonth(parseISO(`${monthKey}-01`))
  const monthEnd = endOfMonth(monthStart)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
  const days = eachDayOfInterval({ end: gridEnd, start: gridStart })

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <button
          className="rounded-md border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--background)]"
          onClick={() => onMonthChange(format(addMonths(monthStart, -1), 'yyyy-MM'))}
          type="button"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h3 className="text-sm font-semibold tabular-nums">
          {format(monthStart, 'MMMM yyyy')}
        </h3>
        <button
          className="rounded-md border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--background)]"
          onClick={() => onMonthChange(format(addMonths(monthStart, 1), 'yyyy-MM'))}
          type="button"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((day) => {
          const iso = format(day, 'yyyy-MM-dd')
          const inMonth = isSameMonth(day, monthStart)
          const summary = daySummaries.get(iso)
          const payroll = payDateSummaries.get(iso)

          return (
            <div
              key={iso}
              className={[
                'relative min-h-[5.5rem] rounded-md border border-[var(--border)] p-1.5',
                inMonth ? 'bg-[var(--background)]/60' : 'bg-transparent opacity-35',
              ].join(' ')}
            >
              <span className="text-xs font-semibold tabular-nums text-[var(--foreground)]">
                {format(day, 'd')}
              </span>

              {summary ? (
                <div className="mt-1 space-y-0.5">
                  {summary.presentCount > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                      <span className="text-[10px] tabular-nums text-emerald-400">
                        {summary.presentCount} present
                      </span>
                    </div>
                  )}
                  {summary.halfCount > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                      <span className="text-[10px] tabular-nums text-amber-400">
                        {summary.halfCount} half
                      </span>
                    </div>
                  )}
                  {summary.overtimeCount > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-400" />
                      <span className="text-[10px] tabular-nums text-violet-300">
                        {summary.overtimeCount} OT
                      </span>
                    </div>
                  )}
                  {summary.absentCount > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zinc-500" />
                      <span className="text-[10px] tabular-nums text-[var(--muted)]">
                        {summary.absentCount} absent
                      </span>
                    </div>
                  )}
                  {summary.holidayCount > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-400" />
                      <span className="text-[10px] tabular-nums text-sky-300">
                        {summary.holidayCount} holiday
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                inMonth && (
                  <p className="mt-1 text-[10px] text-[var(--muted)]">No records</p>
                )
              )}

              {payroll && (
                <button
                  aria-label={`View payroll processed on ${iso}`}
                  className="absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  onClick={() => onPickPayDate(iso)}
                  title={`${payroll.count} payroll${payroll.count !== 1 ? 's' : ''} · ${formatCurrency(payroll.totalNet)} net`}
                  type="button"
                >
                  <Wallet className="h-2.5 w-2.5" />
                  {payroll.count}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-[var(--muted)]">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Present
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Half-day
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-violet-400" />
          Overtime
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-zinc-500" />
          Absent
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-sky-400" />
          Holiday
        </span>
        <span className="flex items-center gap-1.5 ml-2">
          <span className="inline-flex items-center gap-0.5 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            <Wallet className="h-2.5 w-2.5" />
            N
          </span>
          Payroll processed (N employees) — click to view breakdown
        </span>
      </div>
    </div>
  )
}
