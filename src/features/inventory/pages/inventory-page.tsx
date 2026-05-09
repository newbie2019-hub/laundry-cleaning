import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpFromLine,
  Banknote,
  Box,
  Hammer,
  Package,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { formatCurrency } from '../../../lib/format'
import {
  calcUnitsPerBase,
  findLiquidUnit,
  isKnownLiquidUnit,
  LIQUID_UNITS,
} from '../../../lib/liquid-units'
import {
  listInventoryCategories,
  listInventoryItems,
  saveInventoryItem,
  saveInventoryMovement,
  type InventoryCategory,
  type InventoryItem,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'
import { FeatureTutorialProvider } from '../../tutorials/feature-tutorial-provider'
import { INVENTORY_TUTORIAL_STEPS } from '../../tutorials/inventory-tutorial-steps'
import { TutorialTriggerButton } from '../../tutorials/tutorial-trigger-button'
import { InventoryBackupDialog } from '../components/inventory-backup-dialog'
import { MaintenanceModal } from '../components/maintenance-modal'
import { QuickMovementModal } from '../components/quick-movement-modal'

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

type SortKey = 'name' | 'category' | 'currentStock' | 'costPerUnit' | 'supplier' | 'lastRestocked'
type SortDir = 'asc' | 'desc'

type ColumnKey = 'category' | 'stock' | 'cost' | 'supplier' | 'lastRestocked'

const COLUMN_DEFS: { key: ColumnKey; label: string }[] = [
  { key: 'category', label: 'Category' },
  { key: 'stock', label: 'Stock Level' },
  { key: 'cost', label: 'Cost / Unit' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'lastRestocked', label: 'Last Restocked' },
]

type ColumnVisibility = Record<ColumnKey, boolean>

const DEFAULT_COLUMNS: ColumnVisibility = {
  category: true,
  stock: true,
  cost: true,
  supplier: true,
  lastRestocked: true,
}

const COLUMNS_STORAGE_KEY = 'business-ledger.inventory.columns'

function loadColumnPrefs(): ColumnVisibility {
  try {
    const stored = localStorage.getItem(COLUMNS_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_COLUMNS }
    return { ...DEFAULT_COLUMNS, ...(JSON.parse(stored) as Partial<ColumnVisibility>) }
  } catch {
    return { ...DEFAULT_COLUMNS }
  }
}

function saveColumnPrefs(prefs: ColumnVisibility): void {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore storage errors */
  }
}

function ModalField({
  children,
  dataTutorial,
  label,
  required,
}: {
  children: ReactNode
  dataTutorial?: string
  label: string
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5" data-tutorial={dataTutorial}>
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

function categoryBadge(categoryCode: string, categoryLabel: string) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap',
        CATEGORY_COLORS[categoryCode] ?? 'bg-gray-500/15 text-gray-600',
      ].join(' ')}
    >
      {categoryLabel}
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
  return (
    <FeatureTutorialProvider
      featureKey="inventory"
      steps={INVENTORY_TUTORIAL_STEPS}
    >
      <InventoryPageContent />
    </FeatureTutorialProvider>
  )
}

function InventoryPageContent() {
  const { hasPermission, user } = useAuth()
  const canManage = hasPermission('manage_inventory')
  const navigate = useNavigate()

  const [items, setItems] = useState<InventoryItem[]>([])
  const [categories, setCategories] = useState<InventoryCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [stockFilter, setStockFilter] = useState<StockStatus>('all')
  const [showInactive, setShowInactive] = useState(false)

  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const [columns, setColumns] = useState<ColumnVisibility>(() => loadColumnPrefs())
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  // Item modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formCategoryId, setFormCategoryId] = useState<number | null>(null)
  const [formCategory, setFormCategory] = useState('consumable')
  const [formUnitType, setFormUnitType] = useState('per_pc')
  const [formUnitLabel, setFormUnitLabel] = useState('pcs')
  const [formCostPerUnit, setFormCostPerUnit] = useState('')
  const [formSellingPrice, setFormSellingPrice] = useState('')
  const [formAltUnits, setFormAltUnits] = useState<
    Array<{
      key: string
      id: number | null
      labelStr: string
      ratioStr: string
      priceStr: string
    }>
  >([])
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
  const [isBackupDialogOpen, setIsBackupDialogOpen] = useState(false)

  const loadCategories = useCallback(async () => {
    try {
      const data = await listInventoryCategories(true)
      setCategories(data)
    } catch {
      setCategories([])
    }
  }, [])

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
    void loadCategories()
  }, [loadCategories])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  const categoryByCode = useMemo(() => new Map(categories.map((category) => [category.code, category])), [categories])
  const activeCategories = useMemo(() => categories.filter((category) => category.isActive), [categories])
  const defaultCategory = activeCategories[0] ?? categoryByCode.get('other') ?? categories[0] ?? null

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? items.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            item.supplier.toLowerCase().includes(q),
        )
      : items

    const getSortValue = (item: InventoryItem): string | number => {
      switch (sortKey) {
        case 'name':
          return item.name.toLowerCase()
        case 'category':
          return item.categoryLabel.toLowerCase()
        case 'currentStock':
          return item.currentStock
        case 'costPerUnit':
          return item.costPerUnit
        case 'supplier':
          return (item.supplier || '').toLowerCase()
        case 'lastRestocked': {
          const raw = item.categoryCode === 'equipment' ? item.lastMaintenanceDate : item.lastRestockedDate
          return raw || ''
        }
        default:
          return ''
      }
    }

    const sorted = [...filtered].sort((a, b) => {
      const av = getSortValue(a)
      const bv = getSortValue(b)
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const as = String(av)
      const bs = String(bv)
      if (as === bs) return 0
      if (as === '') return 1
      if (bs === '') return -1
      const cmp = as.localeCompare(bs)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return sorted
  }, [items, search, sortKey, sortDir])

  const totalItems = items.length
  const lowStockCount = useMemo(() => items.filter((i) => i.isLowStock).length, [items])
  const totalValue = useMemo(() => items.reduce((s, i) => s + i.stockValue, 0), [items])
  const equipmentItems = useMemo(() => items.filter((i) => i.categoryCode === 'equipment'), [items])
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
    setFormCategory(defaultCategory?.code ?? 'other')
    setFormCategoryId(defaultCategory?.id ?? null)
    setFormUnitType('per_pc')
    setFormUnitLabel('pcs')
    setFormCostPerUnit('')
    setFormSellingPrice('')
    setFormAltUnits([])
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
    setFormCategory(item.categoryCode)
    setFormCategoryId(item.categoryId)
    setFormUnitType(item.unitType)
    setFormUnitLabel(item.unitLabel)
    setFormCostPerUnit(String(item.costPerUnit))
    setFormSellingPrice(item.sellingPrice > 0 ? String(item.sellingPrice) : '')
    setFormAltUnits(
      item.altUnits.map((u) => ({
        key: `alt-${u.id}-${Math.random().toString(36).slice(2, 7)}`,
        id: u.id,
        labelStr: u.unitLabel,
        ratioStr: String(u.unitsPerBase),
        priceStr: u.unitPrice > 0 ? String(u.unitPrice) : '',
      })),
    )
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
    setFormCategoryId(categoryByCode.get(value)?.id ?? null)
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
    const sellingPriceRaw = formSellingPrice.trim()
    const sellingPrice = sellingPriceRaw === '' ? 0 : parseFloat(sellingPriceRaw)
    if (isNaN(sellingPrice) || sellingPrice < 0) { setFormError('Selling price must be a valid non-negative number.'); return }

    // Validate + normalize alt units. Empty rows are dropped.
    const altUnitsDraft: Array<{
      id?: number
      unitLabel: string
      unitsPerBase: number
      unitPrice: number
      sortOrder: number
    }> = []
    const seenAltLabels = new Set<string>()
    for (let idx = 0; idx < formAltUnits.length; idx += 1) {
      const row = formAltUnits[idx]!
      const label = row.labelStr.trim()
      const ratioTrim = row.ratioStr.trim()
      const priceTrim = row.priceStr.trim()
      if (label === '' && ratioTrim === '' && priceTrim === '') continue
      if (label === '') { setFormError('Each smaller unit needs a label.'); return }
      if (label.toLowerCase() === formUnitLabel.trim().toLowerCase()) {
        setFormError(`"${label}" is the base unit. Use a different label for the smaller unit.`)
        return
      }
      const labelKey = label.toLowerCase()
      if (seenAltLabels.has(labelKey)) {
        setFormError(`Duplicate smaller unit label "${label}".`)
        return
      }
      seenAltLabels.add(labelKey)
      const ratio = parseFloat(ratioTrim)
      if (!Number.isFinite(ratio) || ratio <= 0) {
        setFormError(`Enter how many "${label}" fit in one ${formUnitLabel || 'base unit'}.`)
        return
      }
      const altPrice = priceTrim === '' ? 0 : parseFloat(priceTrim)
      if (!Number.isFinite(altPrice) || altPrice < 0) {
        setFormError(`Price for "${label}" must be a valid non-negative number.`)
        return
      }
      altUnitsDraft.push({
        id: row.id ?? undefined,
        unitLabel: label,
        unitsPerBase: ratio,
        unitPrice: altPrice,
        sortOrder: idx,
      })
    }

    const threshold = parseFloat(formLowStockThreshold || '0')
    if (isNaN(threshold) || threshold < 0) { setFormError('Threshold must be non-negative.'); return }
    const initialQty = formInitialStock ? parseFloat(formInitialStock) : 0
    if (formInitialStock && (isNaN(initialQty) || initialQty < 0)) { setFormError('Initial stock must be non-negative.'); return }

    setIsSubmitting(true)
    setFormError(null)
    try {
      const itemId = await saveInventoryItem(
        {
          altUnits: altUnitsDraft,
          category: formCategory,
          categoryId: formCategoryId,
          costPerUnit: cost,
          description: formDescription.trim(),
          isActive: formIsActive,
          lastMaintenanceDate: isEquipmentCategory ? formLastMaintenance : '',
          lowStockThreshold: threshold,
          name: formName.trim(),
          sellingPrice,
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

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function updateColumn(key: ColumnKey, visible: boolean) {
    setColumns((prev) => {
      const next = { ...prev, [key]: visible }
      saveColumnPrefs(next)
      return next
    })
  }

  function goToMovements(item: InventoryItem) {
    navigate(`/inventory-movements?itemId=${item.id}`)
  }

  const activeFilterCount =
    (categoryFilter ? 1 : 0) + (stockFilter !== 'all' ? 1 : 0) + (showInactive ? 1 : 0)
  const hasActiveFilters = activeFilterCount > 0

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inventory</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Track supplies and equipment for daily operations.
          </p>
        </div>
        <TutorialTriggerButton />
      </div>

      {/* Stats */}
      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        data-tutorial="tutorial-inventory-stats"
      >
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
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        data-tutorial="tutorial-inventory-toolbar"
      >
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="flex items-center gap-2 rounded-md bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 transition"
              data-tutorial="tutorial-add-item-btn"
              onClick={openAdd}
              type="button"
            >
              <Plus className="h-4 w-4" />
              Add Item
            </button>
            <button
              className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--background)] transition"
              onClick={() => setIsBackupDialogOpen(true)}
              title="Export or import inventory as a JSON file"
              type="button"
            >
              <ArrowLeftRight className="h-4 w-4" />
              Backup
            </button>
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
          <button
            className="relative flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--background)] transition"
            onClick={() => setIsFilterOpen(true)}
            type="button"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Items table */}
      <div
        className="rounded-xl border border-[var(--border)] overflow-hidden"
        data-tutorial="tutorial-inventory-table"
      >
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
          (() => {
            const visibleDataCols =
              1 /* item */ +
              (columns.category ? 1 : 0) +
              (columns.stock ? 1 : 0) +
              (columns.cost ? 1 : 0) +
              (columns.supplier ? 1 : 0) +
              (columns.lastRestocked ? 1 : 0)
            const colSpan = visibleDataCols + 1 /* actions */

            const renderSortHeader = (
              key: SortKey,
              label: string,
              align: 'left' | 'right',
              extraClass = '',
            ) => {
              const active = sortKey === key
              const alignClass = align === 'right' ? 'justify-end text-right' : 'justify-start text-left'
              return (
                <th className={['px-4 py-2.5 font-semibold', extraClass].join(' ')}>
                  <button
                    className={[
                      'inline-flex w-full items-center gap-1 font-semibold uppercase tracking-wide select-none hover:text-[var(--foreground)] transition',
                      alignClass,
                      active ? 'text-[var(--foreground)]' : '',
                    ].join(' ')}
                    onClick={() => toggleSort(key)}
                    type="button"
                  >
                    <span>{label}</span>
                    {active ? (
                      sortDir === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-50" />
                    )}
                  </button>
                </th>
              )
            }

            return (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--panel)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {renderSortHeader('name', 'Item', 'left')}
                    {columns.category && renderSortHeader('category', 'Category', 'left')}
                    {columns.stock && renderSortHeader('currentStock', 'Stock Level', 'right')}
                    {columns.cost && renderSortHeader('costPerUnit', 'Cost / Unit', 'right')}
                    {columns.supplier && renderSortHeader('supplier', 'Supplier', 'left')}
                    {columns.lastRestocked && renderSortHeader('lastRestocked', 'Last Restocked', 'left')}
                    <th className="px-4 py-2.5 font-semibold w-0" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {displayed.map((item) => (
                    <tr
                      className={[
                        'cursor-pointer transition hover:bg-[var(--panel)]',
                        !item.isActive ? 'opacity-50' : '',
                      ].join(' ')}
                      key={item.id}
                      onClick={() => goToMovements(item)}
                      title="View stock movements"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.name}</span>
                          {item.categoryCode === 'equipment' && item.status && statusBadge(item.status)}
                        </div>
                        {item.description && (
                          <p className="mt-0.5 text-xs text-[var(--muted)] truncate max-w-xs">{item.description}</p>
                        )}
                        {!item.isActive && (
                          <span className="mt-0.5 inline-block text-[10px] text-[var(--muted)]">Inactive</span>
                        )}
                      </td>
                      {columns.category && (
                        <td className="px-4 py-3">{categoryBadge(item.categoryCode, item.categoryLabel)}</td>
                      )}
                      {columns.stock && (
                        <td className="px-4 py-3 text-right">
                          <div className={['tabular-nums font-medium whitespace-nowrap', item.isLowStock ? 'text-red-500' : ''].join(' ')}>
                            {formatQty(item.currentStock)} <span className="font-normal text-[var(--muted)]">{item.unitLabel}</span>
                          </div>
                          {item.altUnits.length > 0 && item.currentStock > 0 ? (
                            <div className="text-[10px] tabular-nums text-[var(--muted)]">
                              {item.altUnits
                                .filter((u) => u.isActive && u.unitsPerBase > 0)
                                .slice(0, 2)
                                .map((u) =>
                                  `≈ ${formatQty(item.currentStock * u.unitsPerBase)} ${u.unitLabel}`,
                                )
                                .join(' · ')}
                            </div>
                          ) : null}
                          <div className="text-[10px] text-[var(--muted)]">
                            min: {formatQty(item.lowStockThreshold)}
                          </div>
                          {item.isLowStock && (
                            <span className="inline-flex items-center rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-500 mt-0.5">
                              LOW
                            </span>
                          )}
                        </td>
                      )}
                      {columns.cost && (
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                          {formatCurrency(item.costPerUnit)}
                          <span className="text-xs text-[var(--muted)]">/{item.unitLabel}</span>
                        </td>
                      )}
                      {columns.supplier && (
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {item.supplier || '—'}
                        </td>
                      )}
                      {columns.lastRestocked && (
                        <td className="px-4 py-3 text-[var(--muted)] tabular-nums">
                          {item.categoryCode === 'equipment'
                            ? item.lastMaintenanceDate || '—'
                            : item.lastRestockedDate || '—'}
                        </td>
                      )}
                      <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 justify-end">
                          {canManage && (
                            <>
                              {item.categoryCode === 'equipment' ? (
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
                    <td className="border-t border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-xs text-[var(--muted)]" colSpan={colSpan}>
                      {displayed.length} item{displayed.length !== 1 ? 's' : ''}
                      {displayed.length !== items.length && ` (${items.length} total)`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )
          })()
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
                <ModalField dataTutorial="tutorial-item-name" label="Item Name" required>
                  <input autoFocus className={inputClass} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Detergent Powder" type="text" value={formName} />
                </ModalField>
                <ModalField dataTutorial="tutorial-item-category" label="Category" required>
                  <select className={selectClass} onChange={(e) => handleCategoryChange(e.target.value)} value={formCategory}>
                    {categories
                      .filter((category) => category.code === formCategory || category.isActive)
                      .map((category) => (
                        <option key={category.id} value={category.code}>
                          {category.label}
                          {!category.isActive ? ' (inactive)' : ''}
                        </option>
                      ))}
                  </select>
                </ModalField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <ModalField dataTutorial="tutorial-item-unit-type" label="Unit Type" required>
                  <select className={selectClass} onChange={(e) => handleUnitTypeChange(e.target.value)} value={formUnitType}>
                    {UNIT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </ModalField>
                <ModalField dataTutorial="tutorial-item-unit-label" label="Unit Label" required>
                  <input
                    className={inputClass}
                    list={formUnitType === 'liquid' ? 'liquid-unit-suggestions' : undefined}
                    onChange={(e) => setFormUnitLabel(e.target.value)}
                    placeholder="pcs, L, kg…"
                    type="text"
                    value={formUnitLabel}
                  />
                  <datalist id="liquid-unit-suggestions">
                    {LIQUID_UNITS.map((u) => (
                      <option key={u.label} value={u.label}>
                        {u.displayName}
                      </option>
                    ))}
                  </datalist>
                </ModalField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <ModalField dataTutorial="tutorial-item-cost" label="Cost per Unit">
                  <input className={inputClass} min="0" onChange={(e) => setFormCostPerUnit(e.target.value)} placeholder="0.00" step="0.01" type="number" value={formCostPerUnit} />
                </ModalField>
                <ModalField dataTutorial="tutorial-item-price" label="Selling Price (per unit)">
                  <input
                    className={inputClass}
                    min="0"
                    onChange={(e) => setFormSellingPrice(e.target.value)}
                    placeholder="Auto-fills sale lines"
                    step="0.01"
                    type="number"
                    value={formSellingPrice}
                  />
                </ModalField>
              </div>
              <div
                className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/80 p-3"
                data-tutorial="tutorial-item-alt-units"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Smaller selling units (optional)</p>
                    <p className="text-xs text-gray-500">
                      Sell this item by another unit too — e.g. a {(formUnitLabel || 'gallon').toLowerCase()} item that you also sell by the cup.
                      Stock stays in {formUnitLabel || 'the base unit'}; sales convert automatically.
                    </p>
                  </div>
                  <button
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50"
                    onClick={() =>
                      setFormAltUnits((prev) => [
                        ...prev,
                        {
                          key: `alt-new-${Math.random().toString(36).slice(2, 7)}`,
                          id: null,
                          labelStr: '',
                          ratioStr: '',
                          priceStr: '',
                        },
                      ])
                    }
                    type="button"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add unit
                  </button>
                </div>
                {formUnitType === 'liquid' && isKnownLiquidUnit(formUnitLabel) ? (
                  <div className="rounded-md border border-blue-100 bg-blue-50/60 p-2">
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-blue-700/80">
                      Quick-add liquid sub-units
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {LIQUID_UNITS.filter((u) => {
                        const base = findLiquidUnit(formUnitLabel)
                        return base != null && u.label !== base.label && u.mlValue < base.mlValue
                      }).map((u) => {
                        const ratio = calcUnitsPerBase(formUnitLabel, u.label)
                        if (ratio == null) return null
                        const targetLabel = u.label.toLowerCase()
                        const checked = formAltUnits.some(
                          (r) => r.labelStr.trim().toLowerCase() === targetLabel,
                        )
                        return (
                          <label
                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                              checked
                                ? 'border-blue-400 bg-white text-blue-700'
                                : 'border-blue-200 bg-white/60 text-gray-600 hover:border-blue-300 hover:bg-white'
                            }`}
                            key={u.label}
                            title={`${u.displayName} — ${ratio.toFixed(3).replace(/\.?0+$/, '')} per ${formUnitLabel}`}
                          >
                            <input
                              checked={checked}
                              className="h-3 w-3 cursor-pointer accent-blue-600"
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setFormAltUnits((prev) =>
                                    prev.some(
                                      (r) => r.labelStr.trim().toLowerCase() === targetLabel,
                                    )
                                      ? prev
                                      : [
                                          ...prev,
                                          {
                                            key: `alt-quick-${u.label}-${Math.random().toString(36).slice(2, 7)}`,
                                            id: null,
                                            labelStr: u.label,
                                            ratioStr: String(
                                              Math.round(ratio * 1000) / 1000,
                                            ),
                                            priceStr: '',
                                          },
                                        ],
                                  )
                                } else {
                                  setFormAltUnits((prev) =>
                                    prev.filter(
                                      (r) => r.labelStr.trim().toLowerCase() !== targetLabel,
                                    ),
                                  )
                                }
                              }}
                              type="checkbox"
                            />
                            {u.label}
                          </label>
                        )
                      })}
                    </div>
                    <p className="mt-1.5 text-[10px] text-blue-700/70">
                      Ratios fill automatically. Edit the row below to override.
                    </p>
                  </div>
                ) : null}
                {formAltUnits.length > 0 ? (
                  <>
                    <div className="hidden gap-2 px-1 text-[10px] font-medium uppercase tracking-wider text-gray-400 sm:flex">
                      <span className="flex-1">Unit name</span>
                      <span className="w-24 shrink-0 text-center">Per {formUnitLabel || 'base'}</span>
                      <span className="w-24 shrink-0 text-right">Default price</span>
                      <span className="w-7 shrink-0" />
                    </div>
                    <div className="space-y-2">
                      {formAltUnits.map((row) => (
                        <div className="flex items-start gap-2" key={row.key}>
                          <div className="min-w-0 flex-1">
                            <input
                              aria-label="Smaller unit label"
                              className={inputClass}
                              onChange={(e) => {
                                const v = e.target.value
                                setFormAltUnits((prev) =>
                                  prev.map((r) => (r.key === row.key ? { ...r, labelStr: v } : r)),
                                )
                              }}
                              placeholder="cup, sachet, 250ml…"
                              type="text"
                              value={row.labelStr}
                            />
                          </div>
                          <div className="w-24 shrink-0">
                            <input
                              aria-label="Units per base"
                              className={`${inputClass} text-center`}
                              min="0.001"
                              onChange={(e) => {
                                const v = e.target.value
                                setFormAltUnits((prev) =>
                                  prev.map((r) => (r.key === row.key ? { ...r, ratioStr: v } : r)),
                                )
                              }}
                              placeholder="31"
                              step="any"
                              type="number"
                              value={row.ratioStr}
                            />
                          </div>
                          <div className="w-24 shrink-0">
                            <input
                              aria-label="Default price for this unit"
                              className={`${inputClass} text-right`}
                              min="0"
                              onChange={(e) => {
                                const v = e.target.value
                                setFormAltUnits((prev) =>
                                  prev.map((r) => (r.key === row.key ? { ...r, priceStr: v } : r)),
                                )
                              }}
                              placeholder="0.00"
                              step="0.01"
                              type="number"
                              value={row.priceStr}
                            />
                          </div>
                          <button
                            aria-label="Remove smaller unit"
                            className="mt-1 shrink-0 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            onClick={() =>
                              setFormAltUnits((prev) => prev.filter((r) => r.key !== row.key))
                            }
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>

              <ModalField dataTutorial="tutorial-item-threshold" label="Min. Stock Threshold">
                <input className={inputClass} min="0" onChange={(e) => setFormLowStockThreshold(e.target.value)} placeholder="10" step="any" type="number" value={formLowStockThreshold} />
              </ModalField>

              <ModalField dataTutorial="tutorial-item-supplier" label="Supplier">
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
                <ModalField dataTutorial="tutorial-item-initial-stock" label="Initial Stock">
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

      <InventoryBackupDialog
        onApplied={() => {
          // Refresh categories and items so newly imported rows show up
          // immediately. Best-effort — failures are silent.
          void loadCategories()
          void loadItems()
        }}
        onClose={() => setIsBackupDialogOpen(false)}
        open={isBackupDialogOpen}
      />

      {/* ── FILTER DIALOG ── */}
      {isFilterOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setIsFilterOpen(false)}
        >
          <div
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">Filters & Columns</h2>
              <button
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                onClick={() => setIsFilterOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 p-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Category</label>
                <select
                  className={selectClass}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  value={categoryFilter}
                >
                  <option value="">All Categories</option>
                  {activeCategories.map((category) => (
                    <option key={category.id} value={category.code}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Stock Status</label>
                <select
                  className={selectClass}
                  onChange={(e) => setStockFilter(e.target.value as StockStatus)}
                  value={stockFilter}
                >
                  <option value="all">All Stock</option>
                  <option value="in">In Stock</option>
                  <option value="low">Low Stock</option>
                  <option value="out">Out of Stock</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Active</label>
                <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700">
                  <input
                    checked={showInactive}
                    className="rounded"
                    onChange={(e) => setShowInactive(e.target.checked)}
                    type="checkbox"
                  />
                  Include inactive items
                </label>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <p className="text-sm font-medium text-gray-700">Visible Columns</p>
                <p className="mt-0.5 text-xs text-gray-500">Preferences are saved on this device.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {COLUMN_DEFS.map((col) => (
                    <label
                      className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 cursor-pointer select-none hover:bg-gray-100"
                      key={col.key}
                    >
                      <input
                        checked={columns[col.key]}
                        className="rounded"
                        onChange={(e) => updateColumn(col.key, e.target.checked)}
                        type="checkbox"
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-5 py-3">
              <button
                className="text-sm font-medium text-gray-600 hover:text-gray-800 disabled:opacity-40"
                disabled={!hasActiveFilters}
                onClick={() => {
                  setCategoryFilter('')
                  setStockFilter('all')
                  setShowInactive(false)
                }}
                type="button"
              >
                Clear filters
              </button>
              <button
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                onClick={() => setIsFilterOpen(false)}
                type="button"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
