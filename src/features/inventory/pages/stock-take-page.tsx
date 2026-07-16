import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowLeft, ClipboardCheck, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  listInventoryItems,
  saveInventoryMovement,
  type InventoryItem,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'
import { modalInputClass, modalPrimaryButtonClass } from '../components/modal-shell'

function formatQty(qty: number) {
  return qty % 1 === 0 ? String(qty) : qty.toFixed(2)
}

/**
 * Physical stock-take / audit. Lists restockable items with their system
 * quantity beside a "counted" input, shows the variance, and on submit records
 * one reconciling movement per item whose count differs (IN for surplus, OUT
 * for shortage) tagged "Stock take adjustment". The movement ledger is the
 * audit trail — no separate stock-take table.
 */
export function StockTakePage() {
  const navigate = useNavigate()
  const { hasPermission, user } = useAuth()
  const canManage = hasPermission('manage_inventory')

  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listInventoryItems()
      setItems(data.filter((i) => i.categoryCode !== 'equipment'))
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.supplier.toLowerCase().includes(q),
    )
  }, [items, search])

  const adjustments = useMemo(() => {
    const out: Array<{ item: InventoryItem; counted: number; variance: number }> = []
    for (const item of items) {
      const raw = counts[item.id]
      if (raw == null || raw.trim() === '') continue
      const counted = Number(raw)
      if (!Number.isFinite(counted) || counted < 0) continue
      const variance = counted - item.currentStock
      if (variance === 0) continue
      out.push({ item, counted, variance })
    }
    return out
  }, [items, counts])

  async function handleSubmit() {
    if (!user) return
    if (adjustments.length === 0) {
      toast.info('No differences to record.')
      return
    }
    setSubmitting(true)
    try {
      for (const { item, variance } of adjustments) {
        await saveInventoryMovement(
          {
            itemId: item.id,
            movementDate: date,
            movementType: variance > 0 ? 'IN' : 'OUT',
            notes: 'Stock take adjustment',
            quantity: Math.abs(variance),
            unitCost: item.costPerUnit,
          },
          user.id,
        )
      }
      toast.success(
        `Recorded ${adjustments.length} adjustment${adjustments.length === 1 ? '' : 's'}.`,
      )
      setCounts({})
      await load()
    } catch {
      toast.error('Failed to record stock take. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3">
        <button
          className="inline-flex w-fit items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
          onClick={() => navigate('/inventory')}
          type="button"
        >
          <ArrowLeft className="h-4 w-4" /> Back to inventory
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Stock take</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Enter counted quantities. Differences post as reconciling stock movements.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-[var(--muted)]">Date</label>
            <input
              className={`${modalInputClass} w-40`}
              onChange={(e) => setDate(e.target.value)}
              type="date"
              value={date}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] pl-9 pr-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            type="search"
            value={search}
          />
        </div>
        {canManage && (
          <button
            className={`${modalPrimaryButtonClass} inline-flex items-center gap-2`}
            disabled={submitting || adjustments.length === 0}
            onClick={handleSubmit}
            type="button"
          >
            <ClipboardCheck className="h-4 w-4" />
            {submitting
              ? 'Recording…'
              : `Record ${adjustments.length || ''} adjustment${adjustments.length === 1 ? '' : 's'}`.trim()}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="divide-y divide-[var(--border)]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <div className="h-4 flex-1 animate-pulse rounded bg-[var(--panel)]" />
                <div className="h-4 w-20 animate-pulse rounded bg-[var(--panel)]" />
                <div className="h-4 w-24 animate-pulse rounded bg-[var(--panel)]" />
              </div>
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="py-16 text-center text-sm text-[var(--muted)]">No items to count.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--panel)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-2.5 text-left">Item</th>
                  <th className="px-4 py-2.5 text-right">System qty</th>
                  <th className="px-4 py-2.5 text-right">Counted</th>
                  <th className="px-4 py-2.5 text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {displayed.map((item) => {
                  const raw = counts[item.id] ?? ''
                  const counted = raw.trim() === '' ? null : Number(raw)
                  const variance =
                    counted != null && Number.isFinite(counted) ? counted - item.currentStock : null
                  return (
                    <tr key={item.id}>
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{item.name}</span>
                        <span className="ml-1 text-xs text-[var(--muted)]">{item.unitLabel}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(item.currentStock)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <input
                          className={`${modalInputClass} ml-auto h-9 w-24 text-right`}
                          disabled={!canManage}
                          min="0"
                          onChange={(e) =>
                            setCounts((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                          placeholder="—"
                          step="any"
                          type="number"
                          value={raw}
                        />
                      </td>
                      <td
                        className={[
                          'px-4 py-2.5 text-right tabular-nums font-medium',
                          variance == null || variance === 0
                            ? 'text-[var(--muted)]'
                            : variance > 0
                              ? 'text-emerald-500'
                              : 'text-red-500',
                        ].join(' ')}
                      >
                        {variance == null ? '—' : variance > 0 ? `+${formatQty(variance)}` : formatQty(variance)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
