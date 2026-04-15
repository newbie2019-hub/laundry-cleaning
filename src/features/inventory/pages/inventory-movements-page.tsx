import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
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

  const [items, setItems] = useState<InventoryItem[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [monthFilter, setMonthFilter] = useState(format(new Date(), 'yyyy-MM'))
  const [itemFilter, setItemFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

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
        itemId: itemFilter ? Number(itemFilter) : null,
        monthKey: monthFilter || undefined,
        movementType: typeFilter || undefined,
      })
      setMovements(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [monthFilter, itemFilter, typeFilter])

  useEffect(() => { loadItems() }, [loadItems])
  useEffect(() => { loadMovements() }, [loadMovements])

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return movements
    return movements.filter(
      (m) => m.itemName.toLowerCase().includes(q) || m.notes.toLowerCase().includes(q),
    )
  }, [movements, search])

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
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="h-9 w-48 rounded-md border border-[var(--border)] bg-[var(--panel)] pl-9 pr-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              type="search"
              value={search}
            />
          </div>
          <input
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
            onChange={(e) => setMonthFilter(e.target.value)}
            type="month"
            value={monthFilter}
          />
          <select
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none"
            onChange={(e) => setItemFilter(e.target.value)}
            value={itemFilter}
          >
            <option value="">All items</option>
            {items.map((item) => (
              <option key={item.id} value={String(item.id)}>{item.name}</option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none"
            onChange={(e) => setTypeFilter(e.target.value)}
            value={typeFilter}
          >
            <option value="">All types</option>
            <option value="IN">Stock In</option>
            <option value="OUT">Stock Out</option>
          </select>
        </div>
        {canManage && (
          <button
            className="flex items-center gap-2 rounded-md bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 transition"
            onClick={openAdd}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Record Movement
          </button>
        )}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                <th className="px-4 py-2.5 text-left font-semibold">Item</th>
                <th className="px-4 py-2.5 text-left font-semibold">Type</th>
                <th className="px-4 py-2.5 text-right font-semibold">Qty</th>
                <th className="px-4 py-2.5 text-right font-semibold">Unit Cost</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                <th className="px-4 py-2.5 text-left font-semibold">Notes</th>
                <th className="hidden px-4 py-2.5 text-left font-semibold md:table-cell">By</th>
                <th className="px-4 py-2.5 font-semibold w-0" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {displayed.map((mov) => (
                <tr key={mov.id} className="transition hover:bg-[var(--background)]">
                  <td className="px-4 py-3 tabular-nums text-[var(--muted)] whitespace-nowrap">{mov.movementDate}</td>
                  <td className="px-4 py-3 font-medium max-w-[12rem] truncate">{mov.itemName}</td>
                  <td className="px-4 py-3">{movBadge(mov.movementType)}</td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                    {formatQty(mov.quantity)} <span className="text-[var(--muted)]">{mov.unitLabel}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)] whitespace-nowrap">
                    {formatCurrency(mov.unitCost)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium whitespace-nowrap">
                    {formatCurrency(mov.quantity * mov.unitCost)}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)] max-w-[12rem] truncate">{mov.notes || '—'}</td>
                  <td className="hidden px-4 py-3 text-xs text-[var(--muted)] whitespace-nowrap md:table-cell">
                    {mov.createdByName ?? '—'}
                  </td>
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
                <td className="border-t border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-xs text-[var(--muted)]" colSpan={9}>
                  {displayed.length} movement{displayed.length !== 1 ? 's' : ''}
                </td>
              </tr>
            </tfoot>
          </table>
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
    </section>
  )
}
