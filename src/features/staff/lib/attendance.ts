import { addDays, format, getDay, parseISO, isValid } from 'date-fns'

export type AttendanceStatus = 'present' | 'half' | 'overtime' | 'absent' | 'holiday'

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'present',
  'half',
  'overtime',
  'absent',
  'holiday',
]

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  half: 'Half-day',
  overtime: 'Overtime',
  absent: 'Absent',
  holiday: 'Holiday',
}

/** JS weekday: 0 Sun … 6 Sat — matches payroll_settings.cutoff_day */
export function defaultMultiplierForStatus(
  status: AttendanceStatus,
  holidayDefaultMultiplier: number,
  overtimeMultiplier = 1.25,
): number {
  switch (status) {
    case 'present':
      return 1
    case 'half':
      return 0.5
    case 'overtime':
      return overtimeMultiplier
    case 'absent':
      return 0
    case 'holiday':
      return holidayDefaultMultiplier
    default:
      return 1
  }
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeDayPay(
  defaultRate: number,
  multiplier: number,
  rateOverride: number | null,
): number {
  const rate = rateOverride ?? defaultRate
  return roundMoney(rate * multiplier)
}

// ─── Flexible payroll line items ─────────────────────────────────────────────

export type AdjustmentKind = 'earning' | 'deduction'
export type AdjustmentSource = 'manual' | 'recurring' | 'cash_advance' | 'overtime'

export type CategoryOption = { label: string; value: string }

export const EARNING_CATEGORIES: CategoryOption[] = [
  { label: 'Bonus', value: 'bonus' },
  { label: 'Allowance', value: 'allowance' },
  { label: 'Overtime', value: 'overtime' },
  { label: 'Other earning', value: 'other' },
]

export const DEDUCTION_CATEGORIES: CategoryOption[] = [
  { label: 'SSS', value: 'sss' },
  { label: 'PhilHealth', value: 'philhealth' },
  { label: 'Pag-IBIG', value: 'pagibig' },
  { label: 'Loan', value: 'loan' },
  { label: 'Cash advance', value: 'cash_advance' },
  { label: 'Other deduction', value: 'other' },
]

export function categoriesForKind(kind: AdjustmentKind): CategoryOption[] {
  return kind === 'earning' ? EARNING_CATEGORIES : DEDUCTION_CATEGORIES
}

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  [...EARNING_CATEGORIES, ...DEDUCTION_CATEGORIES].map((c) => [c.value, c.label]),
)

export function categoryLabel(value: string): string {
  return CATEGORY_LABELS[value] ?? value
}

/** Hourly rate derived from a day rate and the configured standard workday length. */
export function hourlyRateFromDayRate(dayRate: number, standardDayHours: number): number {
  const hours = standardDayHours > 0 ? standardDayHours : 8
  return roundMoney(dayRate / hours)
}

/** Default per-hour overtime rate = hourly rate × overtime multiplier. */
export function overtimeHourlyRate(
  dayRate: number,
  standardDayHours: number,
  overtimeMultiplier: number,
): number {
  return roundMoney(hourlyRateFromDayRate(dayRate, standardDayHours) * overtimeMultiplier)
}

export function periodStartForWeekEnding(periodEndIso: string): string {
  const end = parseISO(periodEndIso)
  if (!isValid(end)) return periodEndIso
  return format(addDays(end, -6), 'yyyy-MM-dd')
}

export function isCutoffDay(isoDate: string, cutoffDow: number): boolean {
  const d = parseISO(isoDate)
  if (!isValid(d)) return false
  return getDay(d) === cutoffDow
}

export function nextCutoffOnOrAfter(from: Date, cutoffDow: number): Date {
  let d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let i = 0; i < 8; i += 1) {
    if (getDay(d) === cutoffDow) return d
    d = addDays(d, 1)
  }
  return d
}

/** Week that contains `containedDate` and ends on cutoff weekday (7-day inclusive window). */
export function weekEndingOnOrAfter(containedIso: string, cutoffDow: number): string {
  const u = parseISO(containedIso)
  if (!isValid(u)) {
    return format(nextCutoffOnOrAfter(new Date(), cutoffDow), 'yyyy-MM-dd')
  }
  let end = new Date(u.getFullYear(), u.getMonth(), u.getDate())
  while (getDay(end) !== cutoffDow) {
    end = addDays(end, 1)
  }
  const start = addDays(end, -6)
  const uNorm = new Date(u.getFullYear(), u.getMonth(), u.getDate())
  if (start > uNorm) {
    end = addDays(end, 7)
  }
  return format(end, 'yyyy-MM-dd')
}

export function suggestPeriodEnd(
  unpaidDatesIso: string[],
  cutoffDow: number,
  reference: Date = new Date(),
): string {
  const valid = unpaidDatesIso.filter((s) => {
    const p = parseISO(s)
    return isValid(p)
  })
  if (valid.length === 0) {
    return format(nextCutoffOnOrAfter(reference, cutoffDow), 'yyyy-MM-dd')
  }
  const min = valid.reduce((a, b) => (a < b ? a : b))
  return weekEndingOnOrAfter(min, cutoffDow)
}

export function attendanceCellClass(status: AttendanceStatus | '' | string): string {
  switch (status) {
    case 'present':
      return 'bg-emerald-700 text-white border-emerald-800 hover:bg-emerald-800'
    case 'half':
      return 'bg-amber-600 text-white border-amber-700 hover:bg-amber-700'
    case 'overtime':
      return 'bg-violet-500/25 text-violet-200 border-violet-500/40'
    case 'absent':
      return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/35'
    case 'holiday':
      return 'bg-sky-500/25 text-sky-200 border-sky-500/40'
    default:
      return 'bg-[var(--background)]/80 text-[var(--muted)] border-[var(--border)]'
  }
}
