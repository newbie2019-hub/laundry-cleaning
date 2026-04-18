import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { endOfMonth, format } from 'date-fns'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { MonthPicker } from '../../../components/month-picker'
import { formatCurrency } from '../../../lib/format'
import {
  deleteInventoryMovement,
  listInventoryItems,
  listInventoryMovements,
  saveInventoryMovement,
  type InventoryItem,
  type InventoryMovement,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

type FilterPeriodMode = 'dateRange' | 'month'

type MovementColumnKey = 'date' | 'item' | 'type' | 'qty' | 'unitCost' | 'total' | 'notes' | 'by'

const MOVEMENT_COLUMN_DEFS: { key: MovementColumnKey; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'item', label: 'Item' },
  { key: 'type', label: 'Type' },
  { key: 'qty', label: 'Qty' },
  { key: 'unitCost', label: 'Unit Cost' },
  { key: 'total', label: 'Total' },
  { key: 'notes', label: 'Notes' },
  { key: 'by', label: 'By' },
]

type MovementColumnVisibility = Record<MovementColumnKey, boolean>

const DEFAULT_MOVEMENT_COLUMNS: MovementColumnVisibility = {
  date: true,
  item: true,
  type: true,
  qty: true,
  unitCost: true,
  total: true,
  notes: true,
  by: true,
}

const MOVEMENT_COLUMNS_STORAGE_KEY = 'business-ledger.inventory-movements.columns'

function loadMovementColumnPrefs(): MovementColumnVisibility {
  try {
    const stored = localStorage.getItem(MOVEMENT_COLUMNS_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_MOVEMENT_COLUMNS }
    return { ...DEFAULT_MOVEMENT_COLUMNS, ...(JSON.parse(stored) as Partial<MovementColumnVisibility>) }
  } catch {
    return { ...DEFAULT_MOVEMENT_COLUMNS }
  }
}

function saveMovementColumnPrefs(prefs: MovementColumnVisibility): void {
  try {
    localStorage.setItem(MOVEMENT_COLUMNS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore storage errors */
  }
}

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

function movBadge(type: 'IN' | 'OUT') {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap',
        type === 'IN' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-500',
      ].join(' ')}
    >
      {type === 'IN' ? <ArrowDownToLine className="h-3 w-3" /> : <ArrowUpFromLine className="h-3 w-3" />}
      {type === 'IN' ? 'In' : 'Out'}
    </span>
  )
}

export function InventoryMovementsPage() {
  const { hasPermission, user } = useAuth()
  const canManage = hasPermission('manage_inventory')
  const canDelete = hasPermission('delete_inventory')

  const [searchParams, setSearchParams] = useSearchParams()
  const initialItemId = searchParams.get('itemId') ?? ''

  const currentMonthKey = format(new Date(), 'yyyy-MM')

  const [items, setItems] = useState<InventoryItem[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState('')

  // Applied filters
  const [periodMode, setPeriodMode] = useState<FilterPeriodMode>('month')
  const [monthFilter, setMonthFilter] = useState(currentMonthKey)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [itemFilter, setItemFilter] = useState(initialItemId)
  const [typeFilter, setTypeFilter] = useState('')
  const [unitCostMin, setUnitCostMin] = useState('')
  const [unitCostMax, setUnitCostMax] = useState('')
  const [qtyMin, setQtyMin] = useState('')
  const [qtyMax, setQtyMax] = useState('')

  // Filter dialog + drafts
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [draftPeriodMode, setDraftPeriodMode] = useState<FilterPeriodMode>('month')
  const [draftMonthKey, setDraftMonthKey] = useState(currentMonthKey)
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const [draftItemId, setDraftItemId] = useState(initialItemId)
  const [draftType, setDraftType] = useState('')
  const [draftUnitCostMin, setDraftUnitCostMin] = useState('')
  const [draftUnitCostMax, setDraftUnitCostMax] = useState('')
  const [draftQtyMin, setDraftQtyMin] = useState('')
  const [draftQtyMax, setDraftQtyMax] = useState('')

  const [columns, setColumns] = useState<MovementColumnVisibility>(() => loadMovementColumnPrefs())

  useEffect(() => {
    const urlItemId = searchParams.get('itemId') ?? ''
    if (urlItemId !== itemFilter) {
      setItemFilter(urlItemId)
    }
  }, [searchParams, itemFilter])

  const updateItemInUrl = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value) next.set('itemId', value)
          else next.delete('itemId')
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  function updateColumn(key: MovementColumnKey, visible: boolean) {
    setColumns((prev) => {
      const next = { ...prev, [key]: visible }
      saveMovementColumnPrefs(next)
      return next
    })
  }

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formItemId, setFormItemId] = useState('')
  const [formDate, setFormDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [formType, setFormType] = useState<'IN' | 'OUT'>('IN')
  const [formQty, setFormQty] = useState('')
  const [formUnitCost, setFormUnitCost] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const loadItems = useCallback(async () => {
    try {
      const data = await listInventoryItems({ includeInactive: true })
      setItems(data)
    } catch { /* ignore */ }
  }, [])

  const loadMovements = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listInventoryMovements({
        dateFrom: periodMode === 'dateRange' ? dateFrom || undefined : undefined,
        dateTo: periodMode === 'dateRange' ? dateTo || undefined : undefined,
        itemId: itemFilter ? Number(itemFilter) : null,
        monthKey: periodMode === 'month' ? monthFilter || undefined : undefined,
        movementType: typeFilter || undefined,
      })
      setMovements(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [periodMode, monthFilter, dateFrom, dateTo, itemFilter, typeFilter])

  useEffect(() => { loadItems() }, [loadItems])
  useEffect(() => { loadMovements() }, [loadMovements])

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qMin = qtyMin ? parseFloat(qtyMin) : null
    const qMax = qtyMax ? parseFloat(qtyMax) : null
    const cMin = unitCostMin ? parseFloat(unitCostMin) : null
    const cMax = unitCostMax ? parseFloat(unitCostMax) : null

    return movements.filter((m) => {
      if (q && !m.itemName.toLowerCase().includes(q) && !m.notes.toLowerCase().includes(q)) {
        return false
      }
      if (qMin != null && !isNaN(qMin) && m.quantity < qMin) return false
      if (qMax != null && !isNaN(qMax) && m.quantity > qMax) return false
      if (cMin != null && !isNaN(cMin) && m.unitCost < cMin) return false
      if (cMax != null && !isNaN(cMax) && m.unitCost > cMax) return false
      return true
    })
  }, [movements, search, qtyMin, qtyMax, unitCostMin, unitCostMax])

  const activeFilterCount =
    (periodMode === 'month' && monthFilter !== currentMonthKey ? 1 : 0) +
    (periodMode === 'dateRange' && (dateFrom || dateTo) ? 1 : 0) +
    (itemFilter ? 1 : 0) +
    (typeFilter ? 1 : 0) +
    (unitCostMin || unitCostMax ? 1 : 0) +
    (qtyMin || qtyMax ? 1 : 0)

  const selectedItem = items.find((i) => String(i.id) === formItemId)

  // ── Modal helpers ──

  function openAdd() {
    setEditingId(null)
    setFormItemId('')
    setFormDate(format(new Date(), 'yyyy-MM-dd'))
    setFormType('IN')
    setFormQty('')
    setFormUnitCost('')
    setFormNotes('')
    setFormError(null)
    setIsModalOpen(true)
  }

  function openEdit(mov: InventoryMovement) {
    setEditingId(mov.id)
    setFormItemId(String(mov.itemId))
    setFormDate(mov.movementDate)
    setFormType(mov.movementType)
    setFormQty(String(mov.quantity))
    setFormUnitCost(String(mov.unitCost))
    setFormNotes(mov.notes)
    setFormError(null)
    setIsModalOpen(true)
  }

  function handleItemChange(itemId: string) {
    setFormItemId(itemId)
    const found = items.find((i) => String(i.id) === itemId)
    if (found) setFormUnitCost(String(found.costPerUnit))
  }

  function openFilterDialog() {
    setDraftPeriodMode(periodMode)
    setDraftMonthKey(monthFilter || currentMonthKey)
    setDraftDateFrom(dateFrom)
    setDraftDateTo(dateTo)
    setDraftItemId(itemFilter)
    setDraftType(typeFilter)
    setDraftUnitCostMin(unitCostMin)
    setDraftUnitCostMax(unitCostMax)
    setDraftQtyMin(qtyMin)
    setDraftQtyMax(qtyMax)
    setIsFilterOpen(true)
  }

  function applyFilters() {
    setPeriodMode(draftPeriodMode)
    if (draftPeriodMode === 'dateRange') {
      const from = draftDateFrom || ''
      let to = draftDateTo || from
      if (from && to && to < from) to = from
      setDateFrom(from)
      setDateTo(to)
    } else {
      setMonthFilter(draftMonthKey.length >= 7 ? draftMonthKey : currentMonthKey)
    }
    setItemFilter(draftItemId)
    updateItemInUrl(draftItemId)
    setTypeFilter(draftType)
    setUnitCostMin(draftUnitCostMin)
    setUnitCostMax(draftUnitCostMax)
    setQtyMin(draftQtyMin)
    setQtyMax(draftQtyMax)
    setIsFilterOpen(false)
  }

  function clearDraftFilters() {
    setDraftPeriodMode('month')
    setDraftMonthKey(currentMonthKey)
    setDraftDateFrom('')
    setDraftDateTo('')
    setDraftItemId('')
    setDraftType('')
    setDraftUnitCostMin('')
    setDraftUnitCostMax('')
    setDraftQtyMin('')
    setDraftQtyMax('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!formItemId) { setFormError('Please select an item.'); return }
    const qty = parseFloat(formQty)
    if (isNaN(qty) || qty <= 0) { setFormError('Quantity must be a positive number.'); return }
    const unitCost = parseFloat(formUnitCost || '0')
    if (isNaN(unitCost) || unitCost < 0) { setFormError('Unit cost must be non-negative.'); return }
    if (!user) return

    setIsSubmitting(true)
    setFormError(null)
    try {
      await saveInventoryMovement(
        {
          itemId: Number(formItemId),
          movementDate: formDate,
          movementType: formType,
          notes: formNotes.trim(),
          quantity: qty,
          unitCost,
        },
        user.id,
        editingId ?? undefined,
      )
      setIsModalOpen(false)
      await loadMovements()
      await loadItems()
    } catch {
      setFormError('Failed to save movement.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteInventoryMovement(id)
      await loadMovements()
      await loadItems()
    } catch { /* ignore */ }
  }

  const QUICK_NOTES_IN = ['Restock', 'Return', 'Adjustment']
  const QUICK_NOTES_OUT = ['Daily Usage', 'Damaged', 'Expired', 'Lost', 'Adjustment']

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Stock Movements</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Track all stock in, stock out, and usage history.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {canManage ? (
          <button
            className="flex items-center gap-2 rounded-md bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 transition"
            onClick={openAdd}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Record Movement
          </button>
        ) : (
          <div />
        )}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="h-9 w-56 rounded-md border border-[var(--border)] bg-[var(--panel)] pl-9 pr-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search movements…"
              type="search"
              value={search}
            />
          </div>
          <button
            aria-label="Open filters"
            className="relative flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--background)] transition"
            onClick={openFilterDialog}
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

      {/* Table */}
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading…</div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-[var(--muted)]">
            <ArrowDownToLine className="h-8 w-8 opacity-40" />
            <p className="text-sm">No movements found.</p>
            {canManage && (
              <button className="mt-1 text-sm text-[var(--accent)] hover:underline" onClick={openAdd} type="button">
                Record first movement
              </button>
            )}
          </div>
        ) : (
          (() => {
            const visibleDataCols =
              (columns.date ? 1 : 0) +
              (columns.item ? 1 : 0) +
              (columns.type ? 1 : 0) +
              (columns.qty ? 1 : 0) +
              (columns.unitCost ? 1 : 0) +
              (columns.total ? 1 : 0) +
              (columns.notes ? 1 : 0) +
              (columns.by ? 1 : 0)
            const colSpan = Math.max(1, visibleDataCols) + 1

            return (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--panel)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {columns.date && <th className="px-4 py-2.5 text-left font-semibold">Date</th>}
                    {columns.item && <th className="px-4 py-2.5 text-left font-semibold">Item</th>}
                    {columns.type && <th className="px-4 py-2.5 text-left font-semibold">Type</th>}
                    {columns.qty && <th className="px-4 py-2.5 text-right font-semibold">Qty</th>}
                    {columns.unitCost && <th className="px-4 py-2.5 text-right font-semibold">Unit Cost</th>}
                    {columns.total && <th className="px-4 py-2.5 text-right font-semibold">Total</th>}
                    {columns.notes && <th className="px-4 py-2.5 text-left font-semibold">Notes</th>}
                    {columns.by && <th className="px-4 py-2.5 text-left font-semibold">By</th>}
                    <th className="px-4 py-2.5 font-semibold w-0" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {displayed.map((mov) => (
                    <tr key={mov.id}>
                      {columns.date && (
                        <td className="px-4 py-3 tabular-nums text-[var(--muted)] whitespace-nowrap">{mov.movementDate}</td>
                      )}
                      {columns.item && (
                        <td className="px-4 py-3 font-medium max-w-[12rem] truncate">{mov.itemName}</td>
                      )}
                      {columns.type && <td className="px-4 py-3">{movBadge(mov.movementType)}</td>}
                      {columns.qty && (
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                          {formatQty(mov.quantity)} <span className="text-[var(--muted)]">{mov.unitLabel}</span>
                        </td>
                      )}
                      {columns.unitCost && (
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)] whitespace-nowrap">
                          {formatCurrency(mov.unitCost)}
                        </td>
                      )}
                      {columns.total && (
                        <td className="px-4 py-3 text-right tabular-nums font-medium whitespace-nowrap">
                          {formatCurrency(mov.quantity * mov.unitCost)}
                        </td>
                      )}
                      {columns.notes && (
                        <td className="px-4 py-3 text-[var(--muted)] max-w-[12rem] truncate">{mov.notes || '—'}</td>
                      )}
                      {columns.by && (
                        <td className="px-4 py-3 text-xs text-[var(--muted)] whitespace-nowrap">
                          {mov.createdByName ?? '—'}
                        </td>
                      )}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1 justify-end">
                          {canManage && (
                            <button
                              aria-label="Edit"
                              className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                              onClick={() => openEdit(mov)}
                              type="button"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              aria-label="Delete"
                              className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                              onClick={() => handleDelete(mov.id)}
                              type="button"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="border-t border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-xs text-[var(--muted)]" colSpan={colSpan}>
                      {displayed.length} movement{displayed.length !== 1 ? 's' : ''}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )
          })()
        )}
      </div>

      {/* ── MOVEMENT MODAL ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">
                {editingId ? 'Edit Movement' : 'Record Movement'}
              </h2>
              <button className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" onClick={() => setIsModalOpen(false)} type="button">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="space-y-4 p-5" onSubmit={handleSubmit}>
              <ModalField label="Movement Type" required>
                <div className="flex gap-2">
                  {(['IN', 'OUT'] as const).map((type) => (
                    <button
                      key={type}
                      className={[
                        'flex flex-1 items-center justify-center gap-2 rounded-md border py-2 text-sm font-medium transition',
                        formType === type
                          ? type === 'IN' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-red-400 bg-red-50 text-red-600'
                          : 'border-gray-300 bg-gray-50 text-gray-500 hover:bg-gray-100',
                      ].join(' ')}
                      onClick={() => setFormType(type)}
                      type="button"
                    >
                      {type === 'IN' ? <ArrowDownToLine className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />}
                      Stock {type === 'IN' ? 'In' : 'Out'}
                    </button>
                  ))}
                </div>
              </ModalField>

              <ModalField label="Item" required>
                <select className={selectClass} onChange={(e) => handleItemChange(e.target.value)} value={formItemId}>
                  <option value="">Select item…</option>
                  {items.filter((i) => i.isActive).map((item) => (
                    <option key={item.id} value={String(item.id)}>{item.name} ({item.unitLabel})</option>
                  ))}
                </select>
              </ModalField>

              {selectedItem && (
                <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600 flex gap-4">
                  <span>Current: <strong>{formatQty(selectedItem.currentStock, selectedItem.unitLabel)}</strong></span>
                  <span>Min: <strong>{formatQty(selectedItem.lowStockThreshold, selectedItem.unitLabel)}</strong></span>
                </div>
              )}

              <ModalField label="Date" required>
                <input className={inputClass} onChange={(e) => setFormDate(e.target.value)} type="date" value={formDate} />
              </ModalField>

              <div className="grid grid-cols-2 gap-3">
                <ModalField label="Quantity" required>
                  <input className={inputClass} min="0.001" onChange={(e) => setFormQty(e.target.value)} placeholder="0" step="any" type="number" value={formQty} />
                </ModalField>
                <ModalField label="Unit Cost">
                  <input className={inputClass} min="0" onChange={(e) => setFormUnitCost(e.target.value)} placeholder="0.00" step="0.01" type="number" value={formUnitCost} />
                </ModalField>
              </div>

              {formQty && formUnitCost && (
                <p className="text-xs text-gray-500">
                  Total: <strong className="text-gray-800">{formatCurrency(parseFloat(formQty || '0') * parseFloat(formUnitCost || '0'))}</strong>
                </p>
              )}

              <ModalField label="Notes">
                <input className={inputClass} onChange={(e) => setFormNotes(e.target.value)} placeholder="Reason or notes" type="text" value={formNotes} />
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {(formType === 'IN' ? QUICK_NOTES_IN : QUICK_NOTES_OUT).map((note) => (
                    <button
                      key={note}
                      className={[
                        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                        formNotes === note
                          ? 'border-blue-400 bg-blue-50 text-blue-700'
                          : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
                      ].join(' ')}
                      onClick={() => setFormNotes(note)}
                      type="button"
                    >
                      {note}
                    </button>
                  ))}
                </div>
              </ModalField>

              {formError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" onClick={() => setIsModalOpen(false)} type="button">
                  Cancel
                </button>
                <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" disabled={isSubmitting} type="submit">
                  {isSubmitting ? 'Saving…' : editingId ? 'Save Changes' : 'Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── FILTER DIALOG ── */}
      {isFilterOpen && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsFilterOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">Filters & Columns</h2>
              <button
                className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                onClick={() => setIsFilterOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <ModalField label="Period">
                <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                  <button
                    className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition ${
                      draftPeriodMode === 'dateRange'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                    onClick={() => {
                      setDraftPeriodMode('dateRange')
                      if (!draftDateFrom || !draftDateTo) {
                        const seed = draftMonthKey.length >= 7 ? draftMonthKey : currentMonthKey
                        const from = `${seed}-01`
                        const to = format(endOfMonth(new Date(`${seed}-01T12:00:00`)), 'yyyy-MM-dd')
                        setDraftDateFrom(from)
                        setDraftDateTo(to)
                      }
                    }}
                    type="button"
                  >
                    Date range
                  </button>
                  <button
                    className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition ${
                      draftPeriodMode === 'month'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                    onClick={() => {
                      setDraftPeriodMode('month')
                      if (draftDateFrom && draftDateFrom.length >= 7) {
                        setDraftMonthKey(draftDateFrom.slice(0, 7))
                      }
                    }}
                    type="button"
                  >
                    Month
                  </button>
                </div>
              </ModalField>

              {draftPeriodMode === 'dateRange' ? (
                <div className="grid grid-cols-2 gap-3">
                  <ModalField label="From">
                    <input
                      className={inputClass}
                      max={draftDateTo || undefined}
                      onChange={(e) => setDraftDateFrom(e.target.value)}
                      type="date"
                      value={draftDateFrom}
                    />
                  </ModalField>
                  <ModalField label="To">
                    <input
                      className={inputClass}
                      min={draftDateFrom || undefined}
                      onChange={(e) => setDraftDateTo(e.target.value)}
                      type="date"
                      value={draftDateTo}
                    />
                  </ModalField>
                </div>
              ) : (
                <ModalField label="Calendar month">
                  <MonthPicker onChange={setDraftMonthKey} value={draftMonthKey} />
                </ModalField>
              )}

              <ModalField label="Item">
                <select
                  className={selectClass}
                  onChange={(e) => setDraftItemId(e.target.value)}
                  value={draftItemId}
                >
                  <option value="">All items</option>
                  {items.map((item) => (
                    <option key={item.id} value={String(item.id)}>{item.name}</option>
                  ))}
                </select>
              </ModalField>

              <ModalField label="Movement type">
                <select
                  className={selectClass}
                  onChange={(e) => setDraftType(e.target.value)}
                  value={draftType}
                >
                  <option value="">All types</option>
                  <option value="IN">Stock In</option>
                  <option value="OUT">Stock Out</option>
                </select>
              </ModalField>

              <div className="grid grid-cols-2 gap-3">
                <ModalField label="Quantity min">
                  <input
                    className={inputClass}
                    min="0"
                    onChange={(e) => setDraftQtyMin(e.target.value)}
                    placeholder="Any"
                    step="any"
                    type="number"
                    value={draftQtyMin}
                  />
                </ModalField>
                <ModalField label="Quantity max">
                  <input
                    className={inputClass}
                    min="0"
                    onChange={(e) => setDraftQtyMax(e.target.value)}
                    placeholder="Any"
                    step="any"
                    type="number"
                    value={draftQtyMax}
                  />
                </ModalField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <ModalField label="Unit cost min">
                  <input
                    className={inputClass}
                    min="0"
                    onChange={(e) => setDraftUnitCostMin(e.target.value)}
                    placeholder="Any"
                    step="0.01"
                    type="number"
                    value={draftUnitCostMin}
                  />
                </ModalField>
                <ModalField label="Unit cost max">
                  <input
                    className={inputClass}
                    min="0"
                    onChange={(e) => setDraftUnitCostMax(e.target.value)}
                    placeholder="Any"
                    step="0.01"
                    type="number"
                    value={draftUnitCostMax}
                  />
                </ModalField>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <p className="text-sm font-medium text-gray-700">Visible Columns</p>
                <p className="mt-0.5 text-xs text-gray-500">Preferences are saved on this device.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {MOVEMENT_COLUMN_DEFS.map((col) => (
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

            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
              <button
                className="text-sm text-gray-500 transition hover:text-gray-700"
                onClick={clearDraftFilters}
                type="button"
              >
                Clear all
              </button>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
                  onClick={() => setIsFilterOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                  onClick={applyFilters}
                  type="button"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
