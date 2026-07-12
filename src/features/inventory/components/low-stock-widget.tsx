import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, isValid, parseISO } from 'date-fns'
import { AlertTriangle, ChevronDown, PackageCheck } from 'lucide-react'
import { listInventoryItems, type InventoryItem } from '../../../lib/db/repository'

function formatQty(qty: number) {
  return qty % 1 === 0 ? String(qty) : qty.toFixed(2)
}

function formatRestock(date: string | null) {
  if (!date) return 'Never restocked'
  const parsed = parseISO(date)
  if (!isValid(parsed)) return 'Never restocked'
  return `Restocked ${format(parsed, 'MMM d')}`
}

/**
 * Compact dashboard widget surfacing items that are low or out of stock, with a
 * jump into the filtered catalogue. Purely read-only; part of the in-app
 * low-stock alerting.
 */
export function LowStockWidget() {
  const navigate = useNavigate()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await listInventoryItems()
        if (!cancelled) setItems(data.filter((i) => i.categoryCode !== 'equipment'))
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const lowItems = useMemo(
    () =>
      items
        .filter((i) => i.isLowStock)
        .sort((a, b) => a.currentStock - b.currentStock)
        .slice(0, 5),
    [items],
  )
  const lowCount = useMemo(() => items.filter((i) => i.isLowStock).length, [items])

  if (loading) {
    return <div className="h-40 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--panel)]" />
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        type="button"
        aria-expanded={expanded}
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
            lowCount > 0 ? 'bg-amber-500/10' : 'bg-emerald-500/10'
          }`}
        >
          {lowCount > 0 ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          ) : (
            <PackageCheck className="h-3.5 w-3.5 text-emerald-500" />
          )}
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold">Low stock</p>
          <p className="text-xs text-[var(--muted)]">
            {lowCount > 0 ? `${lowCount} item${lowCount === 1 ? '' : 's'} need restocking` : 'Everything stocked'}
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && lowItems.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {lowItems.map((item) => (
            <li key={item.id}>
              <button
                className="flex w-full items-center justify-between gap-3 py-2 text-left transition hover:opacity-70"
                onClick={() => navigate(`/inventory/${item.id}`)}
                type="button"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{item.name}</p>
                  <p className="text-xs text-[var(--muted)]">{formatRestock(item.lastRestockedDate)}</p>
                </div>
                <span
                  className={[
                    'shrink-0 tabular-nums text-xs font-medium',
                    item.currentStock <= 0 ? 'text-red-500' : 'text-amber-500',
                  ].join(' ')}
                >
                  {formatQty(item.currentStock)} {item.unitLabel}
                  <span className="text-[var(--muted)]"> / {formatQty(item.lowStockThreshold)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
