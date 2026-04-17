import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subQuarters,
  subYears,
} from 'date-fns'

export type PeriodPreset = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

export type DateRange = {
  from: string
  to: string
}

const DATE_FMT = 'yyyy-MM-dd'

function toDateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00`)
}

function toRangeString(from: Date, to: Date): DateRange {
  return {
    from: format(from, DATE_FMT),
    to: format(to, DATE_FMT),
  }
}

export function resolveRange(preset: PeriodPreset, anchor: Date = new Date()): DateRange {
  switch (preset) {
    case 'day':
      return toRangeString(anchor, anchor)
    case 'week': {
      const start = startOfWeek(anchor, { weekStartsOn: 1 })
      const end = endOfWeek(anchor, { weekStartsOn: 1 })
      return toRangeString(start, end)
    }
    case 'month':
      return toRangeString(startOfMonth(anchor), endOfMonth(anchor))
    case 'quarter':
      return toRangeString(startOfQuarter(anchor), endOfQuarter(anchor))
    case 'year':
      return toRangeString(startOfYear(anchor), endOfYear(anchor))
    case 'custom':
    default:
      return toRangeString(anchor, anchor)
  }
}

function shiftByPreset(range: DateRange, preset: PeriodPreset): DateRange {
  const fromDate = toDateFromKey(range.from)
  const toDate = toDateFromKey(range.to)

  switch (preset) {
    case 'day': {
      const prev = subDays(fromDate, 1)
      return toRangeString(prev, prev)
    }
    case 'week': {
      const prevStart = subDays(fromDate, 7)
      const prevEnd = subDays(toDate, 7)
      return toRangeString(prevStart, prevEnd)
    }
    case 'month': {
      const prevAnchor = subMonths(fromDate, 1)
      return toRangeString(startOfMonth(prevAnchor), endOfMonth(prevAnchor))
    }
    case 'quarter': {
      const prevAnchor = subQuarters(fromDate, 1)
      return toRangeString(startOfQuarter(prevAnchor), endOfQuarter(prevAnchor))
    }
    case 'year': {
      const prevAnchor = subYears(fromDate, 1)
      return toRangeString(startOfYear(prevAnchor), endOfYear(prevAnchor))
    }
    case 'custom':
    default: {
      const days = Math.max(
        0,
        differenceInCalendarDays(toDate, fromDate),
      )
      const prevEnd = subDays(fromDate, 1)
      const prevStart = subDays(prevEnd, days)
      return toRangeString(prevStart, prevEnd)
    }
  }
}

export function autoComparisonRange(range: DateRange, preset: PeriodPreset = 'custom'): DateRange {
  return shiftByPreset(range, preset)
}

export type BucketGranularity = 'day' | 'week' | 'month'

export function bucketGranularity(range: DateRange): BucketGranularity {
  const days = Math.max(
    1,
    differenceInCalendarDays(toDateFromKey(range.to), toDateFromKey(range.from)) + 1,
  )
  if (days <= 62) return 'day'
  if (days <= 240) return 'week'
  return 'month'
}

export function rangeDayCount(range: DateRange): number {
  return Math.max(
    1,
    differenceInCalendarDays(toDateFromKey(range.to), toDateFromKey(range.from)) + 1,
  )
}

export function enumerateRangeDates(range: DateRange): string[] {
  const out: string[] = []
  let cursor = toDateFromKey(range.from)
  const end = toDateFromKey(range.to)
  while (cursor <= end) {
    out.push(format(cursor, DATE_FMT))
    cursor = addDays(cursor, 1)
  }
  return out
}

export function isValidRange(range: DateRange): boolean {
  if (!range.from || !range.to) return false
  return range.from <= range.to
}
