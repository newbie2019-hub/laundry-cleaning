export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-PH', {
    currency: 'PHP',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(value)
}

export function formatMonthLabel(monthKey: string) {
  const date = new Date(`${monthKey}-01T00:00:00`)
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  // SQLite CURRENT_TIMESTAMP values are stored as "YYYY-MM-DD HH:MM:SS" in UTC.
  // Normalize to ISO with a trailing Z so the browser parses them as UTC,
  // then render in the user's local timezone.
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const iso = normalized.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    hour12: true,
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function formatTimeOfDay(value: string | null | undefined) {
  if (!value) return '—'
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const iso = normalized.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: true,
    minute: '2-digit',
  }).format(date)
}

export function formatDateRangeLabel(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00`)
  const toDate = new Date(`${to}T00:00:00`)
  const sameYear = fromDate.getFullYear() === toDate.getFullYear()
  const sameMonth =
    sameYear && fromDate.getMonth() === toDate.getMonth()

  const fromFormatter = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  const toFormatter = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: sameMonth ? undefined : 'short',
    year: 'numeric',
  })

  return `${fromFormatter.format(fromDate)} – ${toFormatter.format(toDate)}`
}
