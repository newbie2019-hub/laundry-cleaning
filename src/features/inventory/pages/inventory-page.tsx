import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  Box,
  Filter,
  Hammer,
  Package,
  Pencil,
  Plus,
  Search,
  Wrench,
  X,
} from 'lucide-react'
import { formatCurrency } from '../../../lib/format'
import {
  listInventoryItems,
  saveInventoryItem,
  saveInventoryMovement,
  type InventoryItem,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'
import { MaintenanceModal } from '../components/maintenance-modal'
import { QuickMovementModal } from '../components/quick-movement-modal'

const ITEM_CATEGORIES = [
  { value: 'consumable', label: 'Consumable' },
  { value: 'detergent_chemicals', label: 'Detergent & Chemicals' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'cleaning_materials', label: 'Cleaning Materials' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'other', label: 'Other' },
] as const

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  ITEM_CATEGORIES.map((c) => [c.value, c.label]),
)

const CATEGORY_COLORS: Record<string, string> = {
  consumable: 'bg-blue-500/15 text-blue-600',
  detergent_chemicals: 'bg-cyan-500/15 text-cyan-600',
  packaging: 'bg-amber-500/15 text-amber-600',
  cleaning_materials: 'bg-teal-500/15 text-teal-600',
  equipment: 'bg-purple-500/15 text-purple-600',
  other: 'bg-gray-500/15 text-gray-600',
}

const EQUIPMENT_STATUSES = [
  { value: 'operational', label: 'Operational' },
  { value: 'maintenance', label: 'Under Maintenance' },
  { value: 'out_of_service', label: 'Out of Service' },
  { value: 'retired', label: 'Retired' },
] as const

const STATUS_COLORS: Record<string, string> = {
  operational: 'bg-emerald-500/15 text-emerald-600',
  maintenance: 'bg-amber-500/15 text-amber-600',
  out_of_service: 'bg-red-500/15 text-red-500',
  retired: 'bg-gray-500/15 text-gray-500',
}

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  EQUIPMENT_STATUSES.map((s) => [s.value, s.label]),
)

const UNIT_TYPE_OPTIONS = [
  { label: 'Per piece', value: 'per_pc', defaultLabel: 'pcs' },
  { label: 'Liquid', value: 'liquid', defaultLabel: 'L' },
  { label: 'Weight', value: 'weight', defaultLabel: 'kg' },
  { label: 'Length', value: 'length', defaultLabel: 'm' },
  { label: 'Pack / Bundle', value: 'pack', defaultLabel: 'pack' },
  { label: 'Other', value: 'other', defaultLabel: 'unit' },
] as const

type StockStatus = 'all' | 'low' | 'out' | 'in'

function ModalField({ label, required, children }: { children: ReactNode; label: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition placeholder:text-gray-400'
const selectClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition'

function formatQty(qty: number, unitLabel?: string) {
  const formatted = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  return unitLabel ? `${formatted} ${unitLabel}` : formatted
}

function categoryBadge(category: string) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap',
        CATEGORY_COLORS[category] ?? 'bg-gray-500/15 text-gray-600',
      ].join(' ')}
    >
      {CATEGORY_LABELS[category] ?? category}
    </span>
  )
}

function statusBadge(status: string) {
  if (!status) return null
  return (
    <span
      className={[
        'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap',
        STATUS_COLORS[status] ?? 'bg-gray-500/15 text-gray-600',
      ].join(' ')}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function InventoryPage() {
  const { hasPermission, user } = useAuth()
  const canManage = hasPermission('manage_inventory')

  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [stockFilter, setStockFilter] = useState<StockStatus>('all')
  const [showInactive, setShowInactive] = useState(false)

  // Item modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formCategory, setFormCategory] = useState('consumable')
  const [formUnitType, setFormUnitType] = useState('per_pc')
  const [formUnitLabel, setFormUnitLabel] = useState('pcs')
  const [formCostPerUnit, setFormCostPerUnit] = useState('')
  const [formLowStockThreshold, setFormLowStockThreshold] = useState('10')
  const [formSupplier, setFormSupplier] = useState('')
  const [formStatus, setFormStatus] = useState('operational')
  const [formLastMaintenance, setFormLastMaintenance] = useState('')
  const [formIsActive, setFormIsActive] = useState(true)
  const [formInitialStock, setFormInitialStock] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [quickMov, setQuickMov] = useState<{ item: InventoryItem; type: 'IN' | 'OUT' } | null>(null)
  const [serviceItem, setServiceItem] = useState<InventoryItem | null>(null)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listInventoryItems({
        category: categoryFilter || undefined,
        includeInactive: showInactive,
        stockStatus: stockFilter === 'all' ? undefined : stockFilter,
      })
      setItems(data)
    } catch {
      /* silently ignore */
    } finally {
      setLoading(false)
    }
  }, [categoryFilter, showInactive, stockFilter])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.supplier.toLowerCase().includes(q),
    )
  }, [items, search])

  const totalItems = items.length
  const lowStockCount = useMemo(() => items.filter((i) => i.isLowStock).length, [items])
  const totalValue = useMemo(() => items.reduce((s, i) => s + i.stockValue, 0), [items])
  const equipmentItems = useMemo(() => items.filter((i) => i.category === 'equipment'), [items])
  const equipmentOperationalCount = useMemo(
    () => equipmentItems.filter((i) => i.status === 'operational' || !i.status).length,
    [equipmentItems],
  )
  const equipmentNeedsAttention = equipmentItems.length - equipmentOperationalCount
  const isEquipmentCategory = formCategory === 'equipment'

  // ── Item modal ──

  function openAdd() {
    setEditingId(null)
    setFormName('')
    setFormDescription('')
    setFormCategory('consumable')
    setFormUnitType('per_pc')
    setFormUnitLabel('pcs')
    setFormCostPerUnit('')
    setFormLowStockThreshold('10')
    setFormSupplier('')
    setFormStatus('operational')
    setFormLastMaintenance('')
    setFormIsActive(true)
    setFormInitialStock('')
    setFormError(null)
    setIsModalOpen(true)
  }

  function openEdit(item: InventoryItem) {
    setEditingId(item.id)
    setFormName(item.name)
    setFormDescription(item.description)
    setFormCategory(item.category)
    setFormUnitType(item.unitType)
    setFormUnitLabel(item.unitLabel)
    setFormCostPerUnit(String(item.costPerUnit))
    setFormLowStockThreshold(String(item.lowStockThreshold))
    setFormSupplier(item.supplier)
    setFormStatus(item.status || 'operational')
    setFormLastMaintenance(item.lastMaintenanceDate)
    setFormIsActive(item.isActive)
    setFormError(null)
    setIsModalOpen(true)
  }

  function handleUnitTypeChange(value: string) {
    setFormUnitType(value)
    const option = UNIT_TYPE_OPTIONS.find((o) => o.value === value)
    if (option) setFormUnitLabel(option.defaultLabel)
  }

  function handleCategoryChange(value: string) {
    setFormCategory(value)
    if (value === 'equipment') {
      setFormUnitType('per_pc')
      setFormUnitLabel('pcs')
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!formName.trim()) { setFormError('Item name is required.'); return }
    const cost = parseFloat(formCostPerUnit || '0')
    if (isNaN(cost) || cost < 0) { setFormError('Cost must be a valid non-negative number.'); return }
    const threshold = parseFloat(formLowStockThreshold || '0')
    if (isNaN(threshold) || threshold < 0) { setFormError('Threshold must be non-negative.'); return }
    const initialQty = formInitialStock ? parseFloat(formInitialStock) : 0
    if (formInitialStock && (isNaN(initialQty) || initialQty < 0)) { setFormError('Initial stock must be non-negative.'); return }

    setIsSubmitting(true)
    setFormError(null)
    try {
      const itemId = await saveInventoryItem(
        {
          category: formCategory,
          costPerUnit: cost,
          description: formDescription.trim(),
          isActive: formIsActive,
          lastMaintenanceDate: isEquipmentCategory ? formLastMaintenance : '',
          lowStockThreshold: threshold,
          name: formName.trim(),
          status: isEquipmentCategory ? formStatus : '',
          supplier: formSupplier.trim(),
          unitLabel: formUnitLabel.trim() || 'unit',
          unitType: formUnitType,
        },
        editingId ?? undefined,
      )
      if (!editingId && initialQty > 0 && user) {
        await saveInventoryMovement(
          {
            itemId,
            movementDate: format(new Date(), 'yyyy-MM-dd'),
            movementType: 'IN',
            notes: 'Initial stock',
            quantity: initialQty,
            unitCost: cost,
          },
          user.id,
        )
      }
      setIsModalOpen(false)
      await loadItems()
    } catch {
      setFormError('Failed to save item. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function openQuickMov(item: InventoryItem, type: 'IN' | 'OUT') {
    setQuickMov({ item, type })
  }

  const hasActiveFilters = categoryFilter || stockFilter !== 'all' || showInactive

  return (
    <section className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Inventory</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Track supplies and equipment for daily operations.
        </p>
      </div>

      {/* Low stock alert */}
      {lowStockCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800 dark:text-amber-400">
            <strong>{lowStockCount}</strong> item{lowStockCount !== 1 ? 's' : ''} running low on stock.
          </p>
          <button
            className="ml-auto text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
            onClick={() => setStockFilter('low')}
            type="button"
          >
            View
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: 'Total Items',
            value: String(totalItems),
            icon: Package,
            color: 'text-blue-500',
            bg: 'bg-blue-500/10',
            sub: `${items.filter((i) => i.isActive).length} active`,
          },
          {
            label: 'Low Stock',
            value: String(lowStockCount),
            icon: AlertTriangle,
            color: lowStockCount > 0 ? 'text-amber-500' : 'text-emerald-500',
            bg: lowStockCount > 0 ? 'bg-amber-500/10' : 'bg-emerald-500/10',
            sub: lowStockCount > 0 ? 'need restocking' : 'all stocked',
          },
          {
            label: 'Equipment',
            value: String(equipmentItems.length),
            icon: Hammer,
            color: equipmentNeedsAttention > 0 ? 'text-purple-500' : 'text-emerald-500',
            bg: equipmentNeedsAttention > 0 ? 'bg-purple-500/10' : 'bg-emerald-500/10',
            sub:
              equipmentItems.length === 0
                ? 'none registered'
                : equipmentNeedsAttention > 0
                  ? `${equipmentNeedsAttention} need${equipmentNeedsAttention === 1 ? 's' : ''} attention`
                  : 'all operational',
          },
          {
            label: 'Total Value',
            value: formatCurrency(totalValue),
            icon: Banknote,
            color: 'text-indigo-500',
            bg: 'bg-indigo-500/10',
            sub: `across ${totalItems} item${totalItems !== 1 ? 's' : ''}`,
          },
        ].map(({ label, value, icon: Icon, color, bg, sub }) => (
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

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="h-9 w-56 rounded-md border border-[var(--border)] bg-[var(--panel)] pl-9 pr-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              type="search"
              value={search}
            />
          </div>
          <select
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none"
            onChange={(e) => setCategoryFilter(e.target.value)}
            value={categoryFilter}
          >
            <option value="">All Categories</option>
            {ITEM_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none"
            onChange={(e) => setStockFilter(e.target.value as StockStatus)}
            value={stockFilter}
          >
            <option value="all">All Stock</option>
            <option value="in">In Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-[var(--muted)]">
            <input checked={showInactive} className="rounded" onChange={(e) => setShowInactive(e.target.checked)} type="checkbox" />
            Inactive
          </label>
          {hasActiveFilters && (
            <button
              className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
              onClick={() => { setCategoryFilter(''); setStockFilter('all'); setShowInactive(false) }}
              type="button"
            >
              <Filter className="h-3 w-3" /> Clear filters
            </button>
          )}
        </div>
        {canManage && (
          <button
            className="flex items-center gap-2 rounded-md bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 transition"
            onClick={openAdd}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </button>
        )}
      </div>

      {/* Items table */}
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading…</div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-[var(--muted)]">
            <Box className="h-8 w-8 opacity-40" />
            <p className="text-sm">No items found.</p>
            {canManage && !search && (
              <button className="mt-1 text-sm text-[var(--accent)] hover:underline" onClick={openAdd} type="button">
                Add your first item
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-2.5 text-left font-semibold">Item</th>
                <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                <th className="px-4 py-2.5 text-right font-semibold">Stock Level</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cost / Unit</th>
                <th className="hidden px-4 py-2.5 text-left font-semibold md:table-cell">Supplier</th>
                <th className="hidden px-4 py-2.5 text-left font-semibold lg:table-cell">Last Restocked</th>
                <th className="px-4 py-2.5 font-semibold w-0" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {displayed.map((item) => (
                <tr
                  key={item.id}
                  className={!item.isActive ? 'opacity-50' : ''}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      {item.category === 'equipment' && item.status && statusBadge(item.status)}
                    </div>
                    {item.description && (
                      <p className="mt-0.5 text-xs text-[var(--muted)] truncate max-w-xs">{item.description}</p>
                    )}
                    {!item.isActive && (
                      <span className="mt-0.5 inline-block text-[10px] text-[var(--muted)]">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{categoryBadge(item.category)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className={['tabular-nums font-medium whitespace-nowrap', item.isLowStock ? 'text-red-500' : ''].join(' ')}>
                      {formatQty(item.currentStock)} <span className="font-normal text-[var(--muted)]">{item.unitLabel}</span>
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      min: {formatQty(item.lowStockThreshold)}
                    </div>
                    {item.isLowStock && (
                      <span className="inline-flex items-center rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-500 mt-0.5">
                        LOW
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                    {formatCurrency(item.costPerUnit)}
                    <span className="text-xs text-[var(--muted)]">/{item.unitLabel}</span>
                  </td>
                  <td className="hidden px-4 py-3 text-[var(--muted)] md:table-cell">
                    {item.supplier || '—'}
                  </td>
                  <td className="hidden px-4 py-3 text-[var(--muted)] tabular-nums lg:table-cell">
                    {item.category === 'equipment'
                      ? item.lastMaintenanceDate || '—'
                      : item.lastRestockedDate || '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1 justify-end">
                      {canManage && (
                        <>
                          {item.category === 'equipment' ? (
                            <button
                              aria-label="Service"
                              className="rounded p-1.5 text-purple-500 transition hover:bg-purple-500/10"
                              onClick={() => setServiceItem(item)}
                              title="Service / maintenance"
                              type="button"
                            >
                              <Wrench className="h-4 w-4" />
                            </button>
                          ) : (
                            <>
                              <button
                                aria-label="Stock In"
                                className="rounded p-1.5 text-emerald-500 transition hover:bg-emerald-500/10"
                                onClick={() => openQuickMov(item, 'IN')}
                                title="Restock"
                                type="button"
                              >
                                <ArrowDownToLine className="h-4 w-4" />
                              </button>
                              <button
                                aria-label="Stock Out"
                                className="rounded p-1.5 text-red-400 transition hover:bg-red-500/10"
                                onClick={() => openQuickMov(item, 'OUT')}
                                title="Use / Remove"
                                type="button"
                              >
                                <ArrowUpFromLine className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          <button
                            aria-label="Edit"
                            className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                            onClick={() => openEdit(item)}
                            type="button"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="border-t border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-xs text-[var(--muted)]" colSpan={7}>
                  {displayed.length} item{displayed.length !== 1 ? 's' : ''}
                  {displayed.length !== items.length && ` (${items.length} total)`}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* ── ADD / EDIT ITEM MODAL ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">
                {editingId ? 'Edit Item' : 'Add Item'}
              </h2>
              <button className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" onClick={() => setIsModalOpen(false)} type="button">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="space-y-4 p-5" onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-3">
                <ModalField label="Item Name" required>
                  <input autoFocus className={inputClass} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Detergent Powder" type="text" value={formName} />
                </ModalField>
                <ModalField label="Category" required>
                  <select className={selectClass} onChange={(e) => handleCategoryChange(e.target.value)} value={formCategory}>
                    {ITEM_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </ModalField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <ModalField label="Unit Type" required>
                  <select className={selectClass} onChange={(e) => handleUnitTypeChange(e.target.value)} value={formUnitType}>
                    {UNIT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </ModalField>
                <ModalField label="Unit Label" required>
                  <input className={inputClass} onChange={(e) => setFormUnitLabel(e.target.value)} placeholder="pcs, L, kg…" type="text" value={formUnitLabel} />
                </ModalField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <ModalField label="Cost per Unit">
                  <input className={inputClass} min="0" onChange={(e) => setFormCostPerUnit(e.target.value)} placeholder="0.00" step="0.01" type="number" value={formCostPerUnit} />
                </ModalField>
                <ModalField label="Min. Stock Threshold">
                  <input className={inputClass} min="0" onChange={(e) => setFormLowStockThreshold(e.target.value)} placeholder="10" step="any" type="number" value={formLowStockThreshold} />
                </ModalField>
              </div>

              <ModalField label="Supplier">
                <input className={inputClass} onChange={(e) => setFormSupplier(e.target.value)} placeholder="Optional supplier name" type="text" value={formSupplier} />
              </ModalField>

              {isEquipmentCategory && (
                <div className="grid grid-cols-2 gap-3">
                  <ModalField label="Status">
                    <select className={selectClass} onChange={(e) => setFormStatus(e.target.value)} value={formStatus}>
                      {EQUIPMENT_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </ModalField>
                  <ModalField label="Last Maintenance">
                    <input className={inputClass} onChange={(e) => setFormLastMaintenance(e.target.value)} type="date" value={formLastMaintenance} />
                  </ModalField>
                </div>
              )}

              <ModalField label="Notes">
                <input className={inputClass} onChange={(e) => setFormDescription(e.target.value)} placeholder="Optional notes" type="text" value={formDescription} />
              </ModalField>

              {!editingId && (
                <ModalField label="Initial Stock">
                  <input className={inputClass} min="0" onChange={(e) => setFormInitialStock(e.target.value)} placeholder="0" step="any" type="number" value={formInitialStock} />
                </ModalField>
              )}

              {editingId && (
                <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700">
                  <input checked={formIsActive} className="rounded" onChange={(e) => setFormIsActive(e.target.checked)} type="checkbox" />
                  Active
                </label>
              )}

              {formError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" onClick={() => setIsModalOpen(false)} type="button">
                  Cancel
                </button>
                <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" disabled={isSubmitting} type="submit">
                  {isSubmitting ? 'Saving…' : editingId ? 'Save Changes' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <QuickMovementModal
        initialType={quickMov?.type ?? 'IN'}
        item={quickMov?.item ?? null}
        onClose={() => setQuickMov(null)}
        onSaved={loadItems}
        open={quickMov !== null}
        userId={user?.id ?? null}
      />

      <MaintenanceModal
        item={
          serviceItem
            ? {
                currentStatus: serviceItem.status,
                id: serviceItem.id,
                lastMaintenanceDate: serviceItem.lastMaintenanceDate,
                name: serviceItem.name,
              }
            : null
        }
        onClose={() => setServiceItem(null)}
        onSaved={loadItems}
        open={serviceItem !== null}
        userId={user?.id ?? null}
      />
    </section>
  )
}
