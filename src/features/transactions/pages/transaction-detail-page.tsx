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
import { formatCurrency, formatDateTime, formatTimeOfDay } from '../../../lib/format'
import {
  deleteInventoryMovement,
  getTransactionById,
  listInventoryItems,
  listInventoryMovementsByTransaction,
  listTransactionLineItems,
  saveInventoryMovement,
  type InventoryItem,
  type InventoryMovement,
  type LedgerTransaction,
  type TransactionLineItem,
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
  const { activeBusiness, user, hasPermission } = useAuth()
  const isCleaningBusiness = activeBusiness === 'cleaning'
  const canManageInventory = hasPermission('manage_inventory')
  const canDeleteInventory = hasPermission('delete_inventory')
  const canEditTransaction = hasPermission('edit_transaction')

  const [transaction, setTransaction] = useState<LedgerTransaction | null>(null)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [lineItems, setLineItems] = useState<TransactionLineItem[]>([])
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
      const [tx, invItems, movs, txLineItems] = await Promise.all([
        getTransactionById(transactionId),
        listInventoryItems({ includeInactive: true }),
        listInventoryMovementsByTransaction(transactionId),
        listTransactionLineItems(transactionId),
      ])
      setTransaction(tx)
      setItems(invItems)
      setMovements(movs)
      setLineItems(txLineItems)
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

  const lineItemsTotal = useMemo(
    () => lineItems.reduce((acc, li) => acc + (Number.isFinite(li.price) ? li.price : 0), 0),
    [lineItems],
  )

  const baseAmount = useMemo(() => {
    if (!transaction) return 0
    const base = transaction.amount - lineItemsTotal
    return base > 0 ? base : 0
  }, [transaction, lineItemsTotal])

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

  const trimmedDescription = transaction.description.trim()
  const hasLineItems = lineItems.length > 0
  const loadsSummary = isCleaningBusiness
    ? null
    : transaction.isLoyaltyReward
      ? 'Loyalty reward (free load)'
      : transaction.loads != null
        ? `${transaction.loads} load${transaction.loads === 1 ? '' : 's'}${
            transaction.kg != null ? ` · ${transaction.kg} kg` : ''
          }`
        : null

  const detailRows: Array<{ label: string; value: ReactNode }> = [
    { label: 'Category', value: transaction.categoryLabel },
    { label: 'Customer', value: transaction.customerName ?? '—' },
  ]
  if (transaction.staffCount != null) {
    detailRows.push({ label: 'Staff', value: <span className="tabular-nums">{transaction.staffCount}</span> })
  }
  if (loadsSummary) {
    detailRows.push({
      label: 'Loads',
      value: transaction.isLoyaltyReward ? (
        <span className="font-medium text-violet-600">Loyalty reward (free load)</span>
      ) : (
        <span className="tabular-nums">{loadsSummary}</span>
      ),
    })
  }
  if (trimmedDescription) {
    detailRows.push({ label: 'Description', value: trimmedDescription })
  }

  return (
    <section className="mx-auto max-w-3xl space-y-10 pb-12">
      <Link
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
        to="/transactions"
      >
        <ArrowLeft className="h-4 w-4" />
        Transactions
      </Link>

      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-3">
          <span className={typeBadgeClass(transaction.transactionTypeCode)}>
            {transaction.transactionTypeCode}
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
            {formatCurrency(transaction.amount)}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            {formatTransactionDisplayDate(transaction.entryDate)} · #{transaction.id}
          </p>
          {transaction.createdAt ? (
            <p className="text-xs text-[var(--muted)]">
              Recorded {formatDateTime(transaction.createdAt)}
              {transaction.createdByName ? ` by ${transaction.createdByName}` : ''}
              {transaction.updatedAt && transaction.updatedAt !== transaction.createdAt ? (
                <>
                  {' '}
                  · Updated {formatDateTime(transaction.updatedAt)}
                  {transaction.updatedByName ? ` by ${transaction.updatedByName}` : ''}
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        {canEditTransaction ? (
          <Link
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--background)]"
            to="/transactions"
            title="Use the list page to edit this transaction"
          >
            <Pencil className="h-4 w-4" />
            Edit on list
          </Link>
        ) : null}
      </header>

      <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {detailRows.map((row) => (
          <div
            className="flex items-start justify-between gap-6 py-4"
            key={row.label}
          >
            <dt className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {row.label}
            </dt>
            <dd className="text-right text-sm text-[var(--foreground)]">{row.value}</dd>
          </div>
        ))}
      </div>

      <section className="space-y-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          Breakdown
        </h2>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-6">
            <span className="text-[var(--foreground)]">Base amount</span>
            <span className="tabular-nums text-[var(--foreground)]">
              {formatCurrency(baseAmount)}
            </span>
          </div>
          {hasLineItems ? (
            <div className="space-y-2 pl-3">
              {lineItems.map((li) => (
                <div
                  className="flex items-center justify-between gap-6 text-[var(--muted)]"
                  key={li.id}
                >
                  <span className="truncate">{li.label}</span>
                  <span className="tabular-nums">{formatCurrency(li.price)}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-6 border-t border-[var(--border)] pt-4 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(transaction.amount)}</span>
          </div>
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Linked inventory movements
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Stock in/out recorded for this transaction. Movements total:{' '}
              <span className="tabular-nums text-[var(--foreground)]">
                {formatCurrency(movementsTotal)}
              </span>
            </p>
          </div>
          {canManageInventory ? (
            <button
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
              onClick={openAddMovement}
              type="button"
            >
              <Plus className="h-4 w-4" />
              Add movement
            </button>
          ) : null}
        </div>

        {movements.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No inventory movements linked yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--background)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit cost</th>
                  <th className="px-4 py-3 text-right">Line total</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="w-0 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {movements.map((mov) => (
                  <tr key={mov.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-[var(--muted)]">
                      <div className="tabular-nums">{mov.movementDate}</div>
                      {mov.createdAt ? (
                        <div className="text-[10px] text-[var(--muted)]">
                          Recorded {formatTimeOfDay(mov.createdAt)}
                        </div>
                      ) : null}
                    </td>
                    <td className="max-w-[12rem] px-4 py-3 font-medium">
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
                    <td className="px-4 py-3">{movBadge(mov.movementType)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatQty(mov.quantity)}{' '}
                      <span className="text-[var(--muted)]">{mov.unitLabel}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
                      {formatCurrency(mov.unitCost)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {formatCurrency(mov.quantity * mov.unitCost)}
                    </td>
                    <td className="max-w-[12rem] truncate px-4 py-3 text-[var(--muted)]">
                      {mov.notes || '—'}
                    </td>
                    <td className="px-4 py-3">
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
      </section>

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
