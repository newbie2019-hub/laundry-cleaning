import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowLeft, Ban, PackageCheck, Plus, Save, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '../../../lib/format'
import {
  getPurchaseOrder,
  listInventoryItems,
  listSuppliers,
  receivePurchaseOrder,
  savePurchaseOrder,
  setPurchaseOrderStatus,
  type InventoryItem,
  type PurchaseOrderDraft,
  type PurchaseOrderStatus,
  type ReorderDraftGroup,
  type Supplier,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'
import {
  ModalField,
  ModalShell,
  modalInputClass,
  modalPrimaryButtonClass,
  modalSecondaryButtonClass,
  modalSelectClass,
  modalTextareaClass,
} from '../components/modal-shell'

type LineRow = {
  key: string
  id?: number
  itemId: number
  quantity: string
  unitCost: string
  itemName?: string
  unitLabel?: string
  receivedQuantity: number
}

const STATUS_STYLES: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-gray-500/15 text-[var(--muted)]',
  ordered: 'bg-blue-500/15 text-blue-600',
  received: 'bg-emerald-500/15 text-emerald-600',
  cancelled: 'bg-red-500/15 text-red-500',
}

let keyCounter = 0
function newKey(): string {
  keyCounter += 1
  return `line-${keyCounter}-${Math.random().toString(36).slice(2, 7)}`
}

function toNum(value: string): number {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

export function PurchaseOrderDetailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const isNew = id === 'new'
  const poId = isNew ? null : Number(id)

  const { hasPermission, user } = useAuth()
  const canManage = hasPermission('manage_inventory')

  const [loading, setLoading] = useState(!isNew)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<InventoryItem[]>([])

  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [reference, setReference] = useState('')
  const [orderDate, setOrderDate] = useState(isNew ? format(new Date(), 'yyyy-MM-dd') : '')
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<PurchaseOrderStatus>('draft')
  const [lines, setLines] = useState<LineRow[]>([])

  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receiptQty, setReceiptQty] = useState<Record<number, string>>({})
  const [receiving, setReceiving] = useState(false)

  const reorderState = (location.state as { reorder?: ReorderDraftGroup } | null)?.reorder

  const isDraft = status === 'draft'
  const editable = canManage && isDraft

  const load = useCallback(async () => {
    if (poId == null) return
    setLoading(true)
    try {
      const po = await getPurchaseOrder(poId)
      if (!po) {
        setNotFound(true)
        return
      }
      setSupplierId(po.supplierId)
      setReference(po.reference)
      setOrderDate(po.orderDate)
      setExpectedDate(po.expectedDate)
      setNotes(po.notes)
      setStatus(po.status)
      setLines(
        po.lines.map((l) => ({
          key: newKey(),
          id: l.id,
          itemId: l.itemId,
          quantity: String(l.quantity),
          unitCost: String(l.unitCost),
          itemName: l.itemName,
          unitLabel: l.unitLabel,
          receivedQuantity: l.receivedQuantity,
        })),
      )
    } catch {
      toast.error('Unable to load purchase order.')
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [poId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    listSuppliers()
      .then(setSuppliers)
      .catch(() => {
        /* ignore */
      })
    listInventoryItems({ includeInactive: false })
      .then((rows) => setItems(rows.filter((i) => i.isActive && i.categoryCode !== 'equipment')))
      .catch(() => {
        /* ignore */
      })
  }, [])

  // Prefill from reorder suggestions on the create form.
  useEffect(() => {
    if (!isNew || !reorderState) return
    setSupplierId(reorderState.supplierId)
    setLines(
      reorderState.lines.map((l) => ({
        key: newKey(),
        itemId: l.itemId,
        quantity: String(l.quantity),
        unitCost: String(l.unitCost),
        itemName: l.itemName,
        unitLabel: l.unitLabel,
        receivedQuantity: 0,
      })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew])

  const grandTotal = useMemo(
    () => lines.reduce((sum, l) => sum + toNum(l.quantity) * toNum(l.unitCost), 0),
    [lines],
  )

  function updateLine(key: string, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function handleItemPick(key: string, itemId: number) {
    const item = items.find((i) => i.id === itemId)
    updateLine(key, {
      itemId,
      unitLabel: item?.unitLabel,
      itemName: item?.name,
      ...(item ? { unitCost: String(item.costPerUnit) } : {}),
    })
  }

  function addLine() {
    setLines((prev) => [...prev, { key: newKey(), itemId: 0, quantity: '1', unitCost: '0', receivedQuantity: 0 }])
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key))
  }

  function buildDraft(): PurchaseOrderDraft {
    return {
      supplierId,
      status,
      reference: reference.trim(),
      orderDate,
      expectedDate,
      notes: notes.trim(),
      lines: lines
        .filter((l) => l.itemId > 0 && toNum(l.quantity) > 0)
        .map((l) => ({
          ...(l.id != null ? { id: l.id } : {}),
          itemId: l.itemId,
          quantity: toNum(l.quantity),
          unitCost: toNum(l.unitCost),
        })),
    }
  }

  async function handleSave() {
    if (!canManage) return
    setSaving(true)
    try {
      const newId = await savePurchaseOrder(buildDraft(), poId ?? undefined, user?.id ?? null)
      toast.success('Purchase order saved.')
      if (isNew) {
        navigate(`/purchase-orders/${newId}`, { replace: true })
      } else {
        await load()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to save purchase order.')
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(next: PurchaseOrderStatus) {
    if (!canManage || poId == null) return
    try {
      await setPurchaseOrderStatus(poId, next)
      toast.success(`Purchase order marked as ${next}.`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to update status.')
    }
  }

  function openReceive() {
    const seed: Record<number, string> = {}
    for (const l of lines) {
      if (l.id == null) continue
      const remaining = toNum(l.quantity) - l.receivedQuantity
      seed[l.id] = String(remaining > 0 ? remaining : 0)
    }
    setReceiptQty(seed)
    setReceiveOpen(true)
  }

  async function handleReceive() {
    if (!canManage || poId == null || !user) return
    const receipts = lines
      .filter((l) => l.id != null)
      .map((l) => ({ lineId: l.id as number, receivedQuantity: toNum(receiptQty[l.id as number] ?? '0') }))
      .filter((r) => r.receivedQuantity > 0)
    if (receipts.length === 0) {
      toast.error('Enter at least one received quantity.')
      return
    }
    setReceiving(true)
    try {
      await receivePurchaseOrder(poId, receipts, user.id)
      setReceiveOpen(false)
      toast.success('Stock received into inventory.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to receive purchase order.')
    } finally {
      setReceiving(false)
    }
  }

  const activeSuppliers = useMemo(
    () => suppliers.filter((s) => s.isActive || s.id === supplierId),
    [suppliers, supplierId],
  )

  const title = isNew ? 'New Purchase Order' : reference.trim() || (poId != null ? `PO #${poId}` : 'Purchase Order')

  if (loading) {
    return (
      <section className="space-y-5">
        <BackLink navigate={navigate} />
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading…</div>
      </section>
    )
  }

  if (notFound) {
    return (
      <section className="space-y-5">
        <BackLink navigate={navigate} />
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-16 text-center text-sm text-[var(--muted)]">
          Purchase order not found.
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <BackLink navigate={navigate} />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {!isNew ? (
            <span
              className={[
                'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                STATUS_STYLES[status],
              ].join(' ')}
            >
              {status}
            </span>
          ) : null}
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {!isNew && status === 'draft' ? (
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3.5 text-sm font-medium transition hover:bg-[var(--background)]"
                onClick={() => void changeStatus('ordered')}
                type="button"
              >
                <Send className="h-4 w-4" />
                Mark as ordered
              </button>
            ) : null}
            {!isNew && status === 'ordered' ? (
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3.5 text-sm font-medium text-white transition hover:bg-emerald-700"
                onClick={openReceive}
                type="button"
              >
                <PackageCheck className="h-4 w-4" />
                Receive
              </button>
            ) : null}
            {!isNew && (status === 'draft' || status === 'ordered') ? (
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-red-500/40 px-3.5 text-sm font-medium text-red-500 transition hover:bg-red-500/10"
                onClick={() => void changeStatus('cancelled')}
                type="button"
              >
                <Ban className="h-4 w-4" />
                Cancel PO
              </button>
            ) : null}
            {isDraft ? (
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                disabled={saving}
                onClick={() => void handleSave()}
                type="button"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save'}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {!canManage ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          You need the <strong>Manage inventory</strong> permission to edit purchase orders.
        </p>
      ) : null}

      {/* Header fields */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ModalField label="Supplier">
            <select
              className={modalSelectClass}
              disabled={!editable}
              onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}
              value={supplierId ?? ''}
            >
              <option value="">No supplier</option>
              {activeSuppliers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label="Reference">
            <input
              className={modalInputClass}
              disabled={!editable}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. INV-1024"
              value={reference}
            />
          </ModalField>
          <ModalField label="Order date">
            <input
              className={modalInputClass}
              disabled={!editable}
              onChange={(e) => setOrderDate(e.target.value)}
              type="date"
              value={orderDate}
            />
          </ModalField>
          <ModalField label="Expected date">
            <input
              className={modalInputClass}
              disabled={!editable}
              onChange={(e) => setExpectedDate(e.target.value)}
              type="date"
              value={expectedDate}
            />
          </ModalField>
          {!isNew ? (
            <ModalField label="Status">
              <select
                className={modalSelectClass}
                disabled={!canManage || !isDraft}
                onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus)}
                value={status}
              >
                <option value="draft">Draft</option>
                <option value="ordered">Ordered</option>
                <option value="received">Received</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </ModalField>
          ) : null}
          <ModalField label="Notes">
            <textarea
              className={modalTextareaClass}
              disabled={!editable}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              rows={2}
              value={notes}
            />
          </ModalField>
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Line items</h2>
          {editable ? (
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-xs font-medium transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
              onClick={addLine}
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
              Add line
            </button>
          ) : null}
        </div>

        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            {editable ? 'No lines yet. Add a line to get started.' : 'No lines on this purchase order.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-2 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-right">Quantity</th>
                  <th className="px-2 py-2 text-right">Unit cost</th>
                  {status === 'received' ? <th className="px-2 py-2 text-right">Received</th> : null}
                  <th className="px-2 py-2 text-right">Line total</th>
                  {editable ? <th className="px-2 py-2 w-0" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {lines.map((line) => {
                  const lineTotal = toNum(line.quantity) * toNum(line.unitCost)
                  return (
                    <tr key={line.key}>
                      <td className="px-2 py-2">
                        {editable ? (
                          <select
                            className={modalSelectClass}
                            onChange={(e) => handleItemPick(line.key, Number(e.target.value))}
                            value={line.itemId ? String(line.itemId) : ''}
                          >
                            <option value="">Select item…</option>
                            {items.map((item) => (
                              <option key={item.id} value={String(item.id)}>
                                {item.name} ({item.unitLabel})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-medium">
                            {line.itemName || `Item #${line.itemId}`}
                            {line.unitLabel ? (
                              <span className="ml-1 text-xs text-[var(--muted)]">({line.unitLabel})</span>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {editable ? (
                          <input
                            className={`${modalInputClass} text-right`}
                            min="0"
                            onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                            step="any"
                            type="number"
                            value={line.quantity}
                          />
                        ) : (
                          <span className="tabular-nums">
                            {line.quantity} {line.unitLabel}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {editable ? (
                          <input
                            className={`${modalInputClass} text-right`}
                            min="0"
                            onChange={(e) => updateLine(line.key, { unitCost: e.target.value })}
                            step="any"
                            type="number"
                            value={line.unitCost}
                          />
                        ) : (
                          <span className="tabular-nums text-[var(--muted)]">{formatCurrency(toNum(line.unitCost))}</span>
                        )}
                      </td>
                      {status === 'received' ? (
                        <td className="px-2 py-2 text-right tabular-nums">
                          {line.receivedQuantity} {line.unitLabel}
                        </td>
                      ) : null}
                      <td className="px-2 py-2 text-right tabular-nums font-medium">{formatCurrency(lineTotal)}</td>
                      {editable ? (
                        <td className="px-2 py-2 text-right">
                          <button
                            aria-label="Remove line"
                            className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500"
                            onClick={() => removeLine(line.key)}
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border)]">
                  <td className="px-2 py-3 text-sm font-semibold" colSpan={editable ? 3 : status === 'received' ? 3 : 2}>
                    Grand total
                  </td>
                  <td className="px-2 py-3 text-right text-sm font-semibold tabular-nums">
                    {formatCurrency(grandTotal)}
                  </td>
                  {editable ? <td /> : null}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {receiveOpen ? (
        <ModalShell
          onClose={() => setReceiveOpen(false)}
          title={
            <span className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-emerald-600" />
              Receive Stock
            </span>
          }
          footer={
            <>
              <button className={modalSecondaryButtonClass} onClick={() => setReceiveOpen(false)} type="button">
                Cancel
              </button>
              <button
                className={modalPrimaryButtonClass}
                disabled={receiving}
                onClick={() => void handleReceive()}
                type="button"
              >
                {receiving ? 'Receiving…' : 'Receive'}
              </button>
            </>
          }
        >
          <p className="mb-4 text-sm text-[var(--muted)]">
            Enter the quantity received for each line. This creates IN stock movements for the received amounts.
          </p>
          <div className="space-y-3">
            {lines
              .filter((l) => l.id != null)
              .map((line) => {
                const remaining = toNum(line.quantity) - line.receivedQuantity
                return (
                  <div className="flex items-center justify-between gap-3" key={line.key}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.itemName || `Item #${line.itemId}`}</p>
                      <p className="text-xs text-[var(--muted)]">
                        Ordered {line.quantity} {line.unitLabel} · Remaining {remaining > 0 ? remaining : 0}
                      </p>
                    </div>
                    <input
                      className={`${modalInputClass} w-28 text-right`}
                      min="0"
                      onChange={(e) =>
                        setReceiptQty((prev) => ({ ...prev, [line.id as number]: e.target.value }))
                      }
                      step="any"
                      type="number"
                      value={receiptQty[line.id as number] ?? ''}
                    />
                  </div>
                )
              })}
          </div>
        </ModalShell>
      ) : null}
    </section>
  )
}

function BackLink({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <button
      className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
      onClick={() => navigate('/purchase-orders')}
      type="button"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to purchase orders
    </button>
  )
}
