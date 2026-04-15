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
