import { format } from 'date-fns'
import { formatCurrency } from '../../../lib/format'
import type { AssistantDateRange } from '../types'

export function fmtPeso(n: number): string {
  return formatCurrency(n)
}

export function fmtDate(d: string): string {
  try {
    return format(new Date(`${d}T00:00:00`), 'MMM d, yyyy')
  } catch {
    return d
  }
}

export function fmtDateRange(range: AssistantDateRange): string {
  if (range.from === range.to) return fmtDate(range.from)
  return `${fmtDate(range.from)} – ${fmtDate(range.to)}`
}

export function bulletList(items: string[]): string {
  return items.map((i) => `• ${i}`).join('\n')
}

export function noData(label: string): string {
  return `No ${label} found for that period.`
}

export function topN<T>(arr: T[], n = 5): T[] {
  return arr.slice(0, n)
}
