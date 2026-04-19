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
} from "date-fns"
import { ChevronLeft, ChevronRight, Lock, Wallet } from "lucide-react"
import type {
  AttendanceEntry,
  PayrollListItem,
} from "../../../lib/db/repository"
import {
  ATTENDANCE_STATUS_LABELS,
  attendanceCellClass,
  type AttendanceStatus,
} from "../lib/attendance"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

type Props = {
  entriesByDate: Map<string, AttendanceEntry>
  monthKey: string
  onMonthChange: (monthKey: string) => void
  onPickDay: (isoDate: string) => void
  onPickPayroll?: (payrollId: number) => void
  payrollsByPayDate?: Map<string, PayrollListItem>
}

export function AttendanceCalendar({
  entriesByDate,
  monthKey,
  onMonthChange,
  onPickDay,
  onPickPayroll,
  payrollsByPayDate,
}: Props) {
  const monthStart = startOfMonth(parseISO(`${monthKey}-01`))
  const monthEnd = endOfMonth(monthStart)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
  const days = eachDayOfInterval({ end: gridEnd, start: gridStart })

  function prevMonth() {
    onMonthChange(format(addMonths(monthStart, -1), "yyyy-MM"))
  }

  function nextMonth() {
    onMonthChange(format(addMonths(monthStart, 1), "yyyy-MM"))
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <button
          className="rounded-md border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--background)]"
          onClick={prevMonth}
          type="button"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h3 className="text-sm font-semibold tabular-nums">
          {format(monthStart, "MMMM yyyy")}
        </h3>
        <button
          className="rounded-md border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--background)]"
          onClick={nextMonth}
          type="button"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="py-1"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((day) => {
          const iso = format(day, "yyyy-MM-dd")
          const inMonth = isSameMonth(day, monthStart)
          const entry = entriesByDate.get(iso)
          const status = (entry?.status ?? "") as AttendanceStatus | ""
          const cellClass = attendanceCellClass(status)
          const payroll = payrollsByPayDate?.get(iso) ?? null
          const isVoid = payroll?.status === "void"
          return (
            <div
              key={iso}
              className={[
                "relative min-h-[4.25rem]",
                inMonth ? "opacity-100" : "opacity-35",
              ].join(" ")}
            >
              <button
                className={[
                  "flex h-full w-full flex-col rounded-md border p-1.5 text-left text-xs transition",
                  cellClass,
                ].join(" ")}
                onClick={() => onPickDay(iso)}
                type="button"
              >
                <span className="font-semibold tabular-nums">
                  {format(day, "d")}
                </span>
                {entry ? (
                  <>
                    <span className="mt-0.5 line-clamp-2 text-[10px] font-medium leading-tight">
                      {ATTENDANCE_STATUS_LABELS[entry.status]}
                    </span>
                    <span className="mt-auto text-[10px] font-medium tabular-nums">
                      ₱{entry.computedPay.toFixed(0)}
                    </span>
                    {entry.isPaid ? (
                      <Lock className="absolute right-1 top-1 h-3 w-3 opacity-70" />
                    ) : null}
                  </>
                ) : (
                  <span className="mt-0.5 text-[10px] text-[var(--muted)]">
                    Tap
                  </span>
                )}
              </button>
              {payroll && onPickPayroll ? (
                <button
                  aria-label={`View payroll processed on ${iso}`}
                  className={[
                    "absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs! font-semibold uppercase tracking-wider shadow-sm transition",
                    isVoid
                      ? "bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
                      : "bg-blue-600 text-white hover:bg-blue-700",
                  ].join(" ")}
                  onClick={(e) => {
                    e.stopPropagation()
                    onPickPayroll(payroll.id)
                  }}
                  title={
                    isVoid
                      ? `Voided payroll · ${payroll.periodStart} → ${payroll.periodEnd}`
                      : `Payroll · ${payroll.periodStart} → ${payroll.periodEnd}`
                  }
                  type="button"
                >
                  <Wallet className="h-2.5 w-2.5 mr-0.5" />
                  {isVoid ? "Void" : "Paid"}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      {payrollsByPayDate && payrollsByPayDate.size > 0 ? (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
          <span className="inline-flex items-center gap-0.5 rounded bg-blue-600 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
            <Wallet className="h-2.5 w-2.5" />
            Paid
          </span>
          Click the badge on a pay date to view the payroll details.
        </div>
      ) : null}
    </div>
  )
}
