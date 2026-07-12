import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '../../../lib/format'
import {
  buildReorderDraftsFromCoverage,
  listPurchaseOrders,
  listSuppliers,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type ReorderDraftGroup,
  type Supplier,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'
import { ModalShell, modalSecondaryButtonClass } from '../components/modal-shell'

const STATUS_FILTERS: { value: 'all' | PurchaseOrderStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STATUS_STYLES: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-gray-500/15 text-[var(--muted)]',
  ordered: 'bg-blue-500/15 text-blue-600',
  received: 'bg-emerald-500/15 text-emerald-600',
  cancelled: 'bg-red-500/15 text-red-500',
}

function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        STATUS_STYLES[status],
      ].join(' ')}
    >
      {status}
    </span>
  )
}

export function PurchaseOrdersPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_inventory')

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | PurchaseOrderStatus>('all')
  const [supplierFilter, setSupplierFilter] = useState<string>('')
  const [reorderGroups, setReorderGroups] = useState<ReorderDraftGroup[] | null>(null)
  const [buildingReorder, setBuildingReorder] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listPurchaseOrders({
        status: statusFilter === 'all' ? undefined : statusFilter,
        supplierId: supplierFilter ? Number(supplierFilter) : undefined,
      })
      setOrders(rows)
    } catch {
      toast.error('Unable to load purchase orders.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, supplierFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    listSuppliers()
      .then(setSuppliers)
      .catch(() => {
        /* ignore */
      })
  }, [])

  async function handleReorder() {
    if (!canManage) return
    setBuildingReorder(true)
    try {
      const groups = await buildReorderDraftsFromCoverage()
      if (groups.length === 0) {
        toast.info('No items currently need reordering.')
        return
      }
      if (groups.length === 1) {
        navigate('/purchase-orders/new', { state: { reorder: groups[0] } })
        return
      }
      setReorderGroups(groups)
    } catch {
      toast.error('Unable to build reorder suggestions.')
    } finally {
      setBuildingReorder(false)
    }
  }

  const filterableSuppliers = useMemo(() => suppliers.filter((s) => s.isActive || String(s.id) === supplierFilter), [
    suppliers,
    supplierFilter,
  ])

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Purchase Orders</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Order stock from suppliers and receive it into inventory.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3.5 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--background)] disabled:opacity-50"
              disabled={buildingReorder}
              onClick={() => void handleReorder()}
              type="button"
            >
              <Sparkles className="h-4 w-4" />
              {buildingReorder ? 'Building…' : 'Create from reorder suggestions'}
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90"
              onClick={() => navigate('/purchase-orders/new')}
              type="button"
            >
              <Plus className="h-4 w-4" />
              New PO
            </button>
          </div>
        ) : null}
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              className={[
                'rounded-full px-3 py-1 text-xs font-medium transition',
                statusFilter === f.value
                  ? 'bg-[var(--accent)] text-white'
                  : 'border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:bg-[var(--background)]',
              ].join(' ')}
              onClick={() => setStatusFilter(f.value)}
              type="button"
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none"
          onChange={(e) => setSupplierFilter(e.target.value)}
          value={supplierFilter}
        >
          <option value="">All suppliers</option>
          {filterableSuppliers.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-[var(--muted)]">
            <ClipboardList className="h-8 w-8 opacity-40" />
            <p className="text-sm">No purchase orders found.</p>
            {canManage ? (
              <button
                className="mt-1 text-sm text-[var(--accent)] hover:underline"
                onClick={() => navigate('/purchase-orders/new')}
                type="button"
              >
                Create your first purchase order
              </button>
            ) : null}
          </div>
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--background)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-3 text-left">Reference</th>
                <th className="px-4 py-3 text-left">Supplier</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-center">Lines</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-left">Order date</th>
                <th className="px-4 py-3 text-left">Expected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {orders.map((po) => (
                <tr
                  key={po.id}
                  className="cursor-pointer transition hover:bg-[var(--background)]"
                  onClick={() => navigate(`/purchase-orders/${po.id}`)}
                >
                  <td className="px-4 py-3 font-medium">{po.reference.trim() || `PO #${po.id}`}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{po.supplierName || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={po.status} />
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">{po.lineCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(po.totalCost)}</td>
                  <td className="px-4 py-3 text-[var(--muted)] whitespace-nowrap tabular-nums">
                    {po.orderDate || '—'}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)] whitespace-nowrap tabular-nums">
                    {po.expectedDate || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {reorderGroups ? (
        <ModalShell
          maxWidthClass="max-w-md"
          onClose={() => setReorderGroups(null)}
          title="Choose a supplier group"
          footer={
            <button className={modalSecondaryButtonClass} onClick={() => setReorderGroups(null)} type="button">
              Cancel
            </button>
          }
        >
          <p className="mb-3 text-sm text-[var(--muted)]">
            Items needing reorder are grouped by supplier. Pick a group to start a purchase order.
          </p>
          <div className="space-y-2">
            {reorderGroups.map((group, idx) => (
              <button
                key={group.supplierId ?? `none-${idx}`}
                className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-left transition hover:border-[var(--accent)]/50"
                onClick={() => {
                  setReorderGroups(null)
                  navigate('/purchase-orders/new', { state: { reorder: group } })
                }}
                type="button"
              >
                <span className="font-medium">{group.supplierName || 'No supplier'}</span>
                <span className="text-xs text-[var(--muted)]">
                  {group.lines.length} item{group.lines.length === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        </ModalShell>
      ) : null}
    </section>
  )
}
