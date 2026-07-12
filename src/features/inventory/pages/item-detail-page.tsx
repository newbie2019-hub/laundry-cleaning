import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Banknote,
  Boxes,
  ListOrdered,
  Pencil,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { formatCurrency } from '../../../lib/format'
import {
  listInventoryItems,
  listInventoryMovements,
  listMaintenanceRecords,
  type InventoryItem,
  type InventoryMovement,
  type MaintenanceRecord,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'
import { MaintenanceModal } from '../components/maintenance-modal'
import { QuickMovementModal } from '../components/quick-movement-modal'

function formatQty(qty: number, unitLabel?: string) {
  const formatted = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  return unitLabel ? `${formatted} ${unitLabel}` : formatted
}

const MAINTENANCE_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-500/15 text-blue-600',
  in_progress: 'bg-amber-500/15 text-amber-600',
  completed: 'bg-emerald-500/15 text-emerald-600',
  cancelled: 'bg-gray-500/15 text-gray-500',
}

export function ItemDetailPage() {
  const { id } = useParams()
  const itemId = Number(id)
  const navigate = useNavigate()
  const { hasPermission, user } = useAuth()
  const canManage = hasPermission('manage_inventory')

  const [item, setItem] = useState<InventoryItem | null>(null)
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [quickType, setQuickType] = useState<'IN' | 'OUT' | null>(null)
  const [serviceOpen, setServiceOpen] = useState(false)

  const load = useCallback(async () => {
    if (!Number.isFinite(itemId)) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [items, movs] = await Promise.all([
        listInventoryItems({ includeInactive: true }),
        listInventoryMovements({ itemId, limit: 50 }),
      ])
      const found = items.find((i) => i.id === itemId) ?? null
      setItem(found)
      setMovements(movs)
      if (found?.categoryCode === 'equipment') {
        setMaintenance(await listMaintenanceRecords({ itemId }))
      } else {
        setMaintenance([])
      }
    } catch {
      setItem(null)
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => {
    void load()
  }, [load])

  const isEquipment = item?.categoryCode === 'equipment'

  const stats = useMemo(() => {
    if (!item) return []
    return [
      {
        label: 'On hand',
        value: `${formatQty(item.currentStock)} ${item.unitLabel}`,
        icon: Boxes,
        color: item.isLowStock ? 'text-red-500' : 'text-blue-500',
        bg: item.isLowStock ? 'bg-red-500/10' : 'bg-blue-500/10',
        sub: `min ${formatQty(item.lowStockThreshold)}`,
      },
      {
        label: 'Stock value',
        value: formatCurrency(item.stockValue),
        icon: Banknote,
        color: 'text-indigo-500',
        bg: 'bg-indigo-500/10',
        sub: `${formatCurrency(item.costPerUnit)}/${item.unitLabel}`,
      },
      {
        label: 'Selling price',
        value: item.sellingPrice > 0 ? formatCurrency(item.sellingPrice) : '—',
        icon: ListOrdered,
        color: 'text-emerald-500',
        bg: 'bg-emerald-500/10',
        sub: 'per unit',
      },
    ]
  }, [item])

  if (loading) {
    return (
      <section className="space-y-5">
        <div className="h-6 w-40 animate-pulse rounded bg-[var(--panel)]" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--panel)]" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--panel)]" />
      </section>
    )
  }

  if (!item) {
    return (
      <section className="space-y-4">
        <button
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
          onClick={() => navigate('/inventory')}
          type="button"
        >
          <ArrowLeft className="h-4 w-4" /> Back to inventory
        </button>
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-16 text-[var(--muted)]">
          <TriangleAlert className="h-8 w-8 opacity-40" />
          <p className="text-sm">Item not found.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <button
          className="inline-flex w-fit items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
          onClick={() => navigate('/inventory')}
          type="button"
        >
          <ArrowLeft className="h-4 w-4" /> Back to inventory
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{item.name}</h1>
              <span className="inline-flex items-center rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                {item.categoryLabel}
              </span>
              {!item.isActive && (
                <span className="inline-flex items-center rounded-md bg-gray-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Inactive
                </span>
              )}
            </div>
            {item.description && <p className="mt-1 text-sm text-[var(--muted)]">{item.description}</p>}
            {item.supplier && (
              <p className="mt-1 text-sm text-[var(--muted)]">
                Supplier: <span className="text-[var(--foreground)]">{item.supplier}</span>
              </p>
            )}
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {isEquipment ? (
                <button
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm font-medium text-purple-500 transition hover:bg-[var(--background)]"
                  onClick={() => setServiceOpen(true)}
                  type="button"
                >
                  <Wrench className="h-4 w-4" /> Service
                </button>
              ) : (
                <>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm font-medium text-emerald-500 transition hover:bg-[var(--background)]"
                    onClick={() => setQuickType('IN')}
                    type="button"
                  >
                    <ArrowDownToLine className="h-4 w-4" /> Stock in
                  </button>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm font-medium text-red-400 transition hover:bg-[var(--background)]"
                    onClick={() => setQuickType('OUT')}
                    type="button"
                  >
                    <ArrowUpFromLine className="h-4 w-4" /> Stock out
                  </button>
                </>
              )}
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--background)]"
                onClick={() => navigate(`/inventory?edit=${item.id}`)}
                type="button"
              >
                <Pencil className="h-4 w-4" /> Edit
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map(({ label, value, icon: Icon, color, bg, sub }) => (
          <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-3.5 w-3.5 ${color}`} />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
            <p className="mt-1.5 text-xs text-[var(--muted)]">{sub}</p>
          </div>
        ))}
      </div>

      {/* Alt units */}
      {item.altUnits.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <p className="text-sm font-semibold">Alternate units</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.altUnits.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs text-[var(--foreground)]"
              >
                <span className="font-medium">{u.unitLabel}</span>
                <span className="text-[var(--muted)]">
                  {formatQty(u.unitsPerBase)}/{item.unitLabel}
                  {u.unitPrice > 0 ? ` · ${formatCurrency(u.unitPrice)}` : ''}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Movement history */}
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-4 py-2.5">
          <p className="text-sm font-semibold">Recent movements</p>
          <button
            className="text-xs font-medium text-[var(--accent)] hover:underline"
            onClick={() => navigate(`/inventory-movements?itemId=${item.id}`)}
            type="button"
          >
            View all
          </button>
        </div>
        {movements.length === 0 ? (
          <div className="py-10 text-center text-sm text-[var(--muted)]">No stock movements yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Unit cost</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-left">Notes</th>
                  <th className="px-4 py-2 text-left">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{m.movementDate}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={[
                          'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          m.movementType === 'IN'
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : 'bg-red-500/15 text-red-500',
                        ].join(' ')}
                      >
                        {m.movementType}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatQty(m.quantity)} <span className="text-[var(--muted)]">{m.unitLabel}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(m.unitCost)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(m.unitCost * m.quantity)}</td>
                    <td className="px-4 py-2.5 text-[var(--muted)]">{m.notes || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--muted)]">{m.createdByName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Maintenance history (equipment) */}
      {isEquipment && (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="border-b border-[var(--border)] bg-[var(--panel)] px-4 py-2.5">
            <p className="text-sm font-semibold">Service history</p>
          </div>
          {maintenance.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--muted)]">No service records yet.</div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {maintenance.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">{r.serviceDate}</span>
                      <span className="text-xs text-[var(--muted)]">·</span>
                      <span className="text-xs font-medium capitalize text-[var(--foreground)]">{r.serviceType}</span>
                      <span
                        className={[
                          'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          MAINTENANCE_STATUS_COLORS[r.status] ?? 'bg-gray-500/15 text-gray-500',
                        ].join(' ')}
                      >
                        {r.status.replace('_', ' ')}
                      </span>
                    </div>
                    {r.description && <p className="mt-1 text-xs text-[var(--muted)]">{r.description}</p>}
                    {r.performedBy && (
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        By <span className="text-[var(--foreground)]">{r.performedBy}</span>
                      </p>
                    )}
                  </div>
                  {r.cost > 0 && <span className="shrink-0 text-sm font-medium tabular-nums">{formatCurrency(r.cost)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <QuickMovementModal
        initialType={quickType ?? 'IN'}
        item={quickType ? item : null}
        onClose={() => setQuickType(null)}
        onSaved={load}
        open={quickType !== null}
        userId={user?.id ?? null}
      />

      <MaintenanceModal
        item={
          serviceOpen
            ? {
                currentStatus: item.status,
                id: item.id,
                lastMaintenanceDate: item.lastMaintenanceDate,
                name: item.name,
              }
            : null
        }
        onClose={() => setServiceOpen(false)}
        onSaved={load}
        open={serviceOpen}
        userId={user?.id ?? null}
      />
    </section>
  )
}
