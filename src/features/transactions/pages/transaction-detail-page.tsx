import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  LayoutTemplate,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { formatCurrency } from '../../../lib/format'
import {
  deleteInventoryMovement,
  getTransactionById,
  listInventoryItems,
  listInventoryMovementsByTransaction,
  saveInventoryMovement,
  type InventoryItem,
  type InventoryMovement,
  type LedgerTransaction,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

function formatTransactionDisplayDate(entryDate: string) {
  return format(new Date(`${entryDate}T00:00:00`), 'MMM d, yyyy')
}

const TYPE_COLORS: Record<string, string> = {
  SALE: 'bg-emerald-500/15 text-emerald-500',
  EXPENSE: 'bg-red-500/15 text-red-500',
  'OPERATING EXPENSE': 'bg-amber-500/15 text-amber-600',
}

function typeBadgeClass(code: string) {
  return [
    'inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap',
    TYPE_COLORS[code] ?? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]',
  ].join(' ')
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

const QUICK_NOTES_IN = ['Restock', 'Return', 'Adjustment']
const QUICK_NOTES_OUT = ['Daily Usage', 'Damaged', 'Expired', 'Lost', 'Adjustment']

function formatQty(qty: number, unitLabel?: string) {
  const formatted = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  return unitLabel ? `${formatted} ${unitLabel}` : formatted
}

export function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const transactionId = Number(id)
  const { user, hasPermission } = useAuth()
  const canManageInventory = hasPermission('manage_inventory')
  const canDeleteInventory = hasPermission('delete_inventory')
  const canEditTransaction = hasPermission('edit_transaction')

  const [transaction, setTransaction] = useState<LedgerTransaction | null>(null)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [loading, setLoading] = useState(true)

  const [addOpen, setAddOpen] = useState(false)
  const [formItemId, setFormItemId] = useState('')
  const [formType, setFormType] = useState<'IN' | 'OUT'>('IN')
  const [formQty, setFormQty] = useState('')
  const [formUnitCost, setFormUnitCost] = useState('')
  const [formDate, setFormDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [formNotes, setFormNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formSubmitting, setFormSubmitting] = useState(false)

  const loadAll = useCallback(async () => {
    if (!Number.isFinite(transactionId) || transactionId <= 0) {
      setTransaction(null)
      setMovements([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [tx, invItems, movs] = await Promise.all([
        getTransactionById(transactionId),
        listInventoryItems({ includeInactive: true }),
        listInventoryMovementsByTransaction(transactionId),
      ])
      setTransaction(tx)
      setItems(invItems)
      setMovements(movs)
    } finally {
      setLoading(false)
    }
  }, [transactionId])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const movementsTotal = useMemo(() => {
    let sum = 0
    for (const m of movements) {
      const line = m.quantity * m.unitCost
      sum += m.movementType === 'IN' ? line : -line
    }
    return sum
  }, [movements])

  const selectedItem = items.find((i) => String(i.id) === formItemId)

  function openAddMovement() {
    setFormItemId('')
    setFormType('IN')
    setFormQty('')
    setFormUnitCost('')
    setFormDate(format(new Date(), 'yyyy-MM-dd'))
    setFormNotes('')
    setFormError(null)
    setAddOpen(true)
  }

  function handleItemChange(itemId: string) {
    setFormItemId(itemId)
    const found = items.find((i) => String(i.id) === itemId)
    if (found) setFormUnitCost(String(found.costPerUnit))
  }

  async function handleAddMovementSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user || !Number.isFinite(transactionId) || transactionId <= 0) return
    if (!formItemId) {
      setFormError('Please select an item.')
      return
    }
    const qty = parseFloat(formQty)
    if (isNaN(qty) || qty <= 0) {
      setFormError('Quantity must be a positive number.')
      return
    }
    const unitCost = parseFloat(formUnitCost || '0')
    if (isNaN(unitCost) || unitCost < 0) {
      setFormError('Unit cost must be non-negative.')
      return
    }

    setFormSubmitting(true)
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
          transactionId,
        },
        user.id,
      )
      setAddOpen(false)
      await loadAll()
    } catch {
      setFormError('Failed to save movement.')
    } finally {
      setFormSubmitting(false)
    }
  }

  async function handleDeleteMovement(movementId: number) {
    if (!canDeleteInventory) return
    try {
      await deleteInventoryMovement(movementId)
      await loadAll()
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-sm text-[var(--muted)]">Loading…</div>
  }

  if (!Number.isFinite(transactionId) || transactionId <= 0 || !transaction) {
    return (
      <div className="space-y-4">
        <Link className="inline-flex items-center gap-1 text-sm text-[var(--accent-strong)]" to="/transactions">
          <ArrowLeft className="h-4 w-4" />
          Back to transactions
        </Link>
        <p className="text-sm text-[var(--muted)]">Transaction not found.</p>
      </div>
    )
  }

  const displayDescription = transaction.description.trim()
    ? transaction.description
    : transaction.categoryLabel

  return (
    <section className="space-y-6">
      <div>
        <Link
          className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--accent-strong)] hover:underline"
          to="/transactions"
        >
          <ArrowLeft className="h-4 w-4" />
          Transactions
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">Transaction #{transaction.id}</h1>
              <span className={typeBadgeClass(transaction.transactionTypeCode)}>{transaction.transactionTypeCode}</span>
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">{formatTransactionDisplayDate(transaction.entryDate)}</p>
            <p className="mt-2 text-sm font-medium text-[var(--foreground)]">{displayDescription}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Category</dt>
                <dd className="mt-0.5">{transaction.categoryLabel}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Customer</dt>
                <dd className="mt-0.5">{transaction.customerName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Staff count</dt>
                <dd className="mt-0.5 tabular-nums">{transaction.staffCount ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Loads / kg</dt>
                <dd className="mt-0.5 tabular-nums">
                  {transaction.isLoyaltyReward ? (
                    <span className="font-medium text-violet-600">Loyalty reward (free load)</span>
                  ) : transaction.loads != null ? (
                    <>
                      {transaction.loads} load{transaction.loads === 1 ? '' : 's'}
                      {transaction.kg != null ? <span className="text-[var(--muted)]"> ({transaction.kg} kg)</span> : null}
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Amount</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{formatCurrency(transaction.amount)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Movements total</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-[var(--muted)]">
                  {formatCurrency(movementsTotal)}{' '}
                  <span className="text-xs font-normal">(informational: IN − OUT by qty × unit cost)</span>
                </dd>
              </div>
            </dl>
          </div>
          {canEditTransaction ? (
            <Link
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--background)] transition"
              to="/transactions"
              title="Use the list page to edit this transaction"
            >
              <Pencil className="h-4 w-4" />
              Edit on list
            </Link>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Linked inventory movements</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Stock ins and outs recorded for this transaction only. Standalone movements stay on the Movements page.
            </p>
          </div>
          {canManageInventory ? (
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 transition"
              onClick={openAddMovement}
              type="button"
            >
              <Plus className="h-4 w-4" />
              Add movement
            </button>
          ) : null}
        </div>

        {movements.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--muted)]">No inventory movements linked yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--background)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5 text-right">Qty</th>
                  <th className="px-3 py-2.5 text-right">Unit cost</th>
                  <th className="px-3 py-2.5 text-right">Line total</th>
                  <th className="px-3 py-2.5">Notes</th>
                  <th className="w-0 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {movements.map((mov) => (
                  <tr key={mov.id}>
                    <td className="px-3 py-2.5 tabular-nums text-[var(--muted)] whitespace-nowrap">{mov.movementDate}</td>
                    <td className="px-3 py-2.5 font-medium max-w-[12rem]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate">{mov.itemName}</span>
                        {mov.templateId != null ? (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600"
                            title={mov.templateName ? `From template: ${mov.templateName}` : 'From sale template'}
                          >
                            <LayoutTemplate className="h-3 w-3" />
                            {mov.templateName ? mov.templateName : 'Template'}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{movBadge(mov.movementType)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {formatQty(mov.quantity)} <span className="text-[var(--muted)]">{mov.unitLabel}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--muted)]">{formatCurrency(mov.unitCost)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {formatCurrency(mov.quantity * mov.unitCost)}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--muted)] max-w-[12rem] truncate">{mov.notes || '—'}</td>
                    <td className="px-3 py-2.5">
                      {canDeleteInventory ? (
                        <button
                          aria-label="Delete movement"
                          className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                          onClick={() => void handleDeleteMovement(mov.id)}
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Add inventory movement</h2>
                <p className="mt-0.5 text-xs text-gray-500">Linked to transaction #{transactionId}</p>
              </div>
              <button
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                onClick={() => setAddOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="space-y-4 p-5" onSubmit={handleAddMovementSubmit}>
              <ModalField label="Item" required>
                <select
                  className={selectClass}
                  onChange={(e) => handleItemChange(e.target.value)}
                  required
                  value={formItemId}
                >
                  <option value="">Select item…</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </ModalField>

              <div className="flex gap-2">
                {(['IN', 'OUT'] as const).map((type) => (
                  <button
                    key={type}
                    className={[
                      'flex flex-1 items-center justify-center gap-2 rounded-md border py-2 text-sm font-medium transition',
                      formType === type
                        ? type === 'IN'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-red-400 bg-red-50 text-red-600'
                        : 'border-gray-300 bg-gray-50 text-gray-500 hover:bg-gray-100',
                    ].join(' ')}
                    onClick={() => setFormType(type)}
                    type="button"
                  >
                    {type === 'IN' ? <ArrowDownToLine className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />}
                    {type === 'IN' ? 'Stock In' : 'Stock Out'}
                  </button>
                ))}
              </div>

              {selectedItem ? (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 flex gap-4">
                  <span>
                    Current:{' '}
                    <strong>{formatQty(selectedItem.currentStock, selectedItem.unitLabel)}</strong>
                  </span>
                  <span>
                    Min: <strong>{formatQty(selectedItem.lowStockThreshold, selectedItem.unitLabel)}</strong>
                  </span>
                </div>
              ) : null}

              <ModalField label="Date" required>
                <input className={inputClass} onChange={(e) => setFormDate(e.target.value)} type="date" value={formDate} />
              </ModalField>

              <div className="grid grid-cols-2 gap-3">
                <ModalField label="Quantity" required>
                  <input
                    className={inputClass}
                    min="0.001"
                    onChange={(e) => setFormQty(e.target.value)}
                    placeholder="0"
                    step="any"
                    type="number"
                    value={formQty}
                  />
                </ModalField>
                <ModalField label="Unit cost">
                  <input
                    className={inputClass}
                    min="0"
                    onChange={(e) => setFormUnitCost(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    type="number"
                    value={formUnitCost}
                  />
                </ModalField>
              </div>

              <ModalField label="Notes">
                <input
                  className={inputClass}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Reason or notes"
                  type="text"
                  value={formNotes}
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
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

              {formError ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p> : null}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  onClick={() => setAddOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className={[
                    'rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50',
                    formType === 'IN' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600',
                  ].join(' ')}
                  disabled={formSubmitting}
                  type="submit"
                >
                  {formSubmitting ? 'Saving…' : 'Save movement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
