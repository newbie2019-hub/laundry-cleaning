import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ArrowDownToLine, ArrowUpFromLine, X } from 'lucide-react'
import { saveInventoryMovement } from '../../../lib/db/repository'

function ModalField({ label, required, children }: { children: ReactNode; label: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-[var(--foreground)]">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputClass =
  'h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition placeholder:text-[var(--muted)]'

const QUICK_NOTES_IN = ['Restock', 'Return', 'Adjustment']
const QUICK_NOTES_OUT = ['Daily Usage', 'Damaged', 'Expired', 'Lost', 'Adjustment']

export type QuickMovementTarget = {
  costPerUnit: number
  currentStock: number
  id: number
  lowStockThreshold: number
  name: string
  unitLabel: string
}

function formatQty(qty: number, unitLabel?: string) {
  const formatted = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  return unitLabel ? `${formatted} ${unitLabel}` : formatted
}

export function QuickMovementModal({
  initialType = 'IN',
  item,
  onClose,
  onSaved,
  open,
  userId,
}: {
  initialType?: 'IN' | 'OUT'
  item: QuickMovementTarget | null
  onClose: () => void
  onSaved: () => void | Promise<void>
  open: boolean
  userId: number | null
}) {
  const [movType, setMovType] = useState<'IN' | 'OUT'>('IN')
  const [movQty, setMovQty] = useState('')
  const [movUnitCost, setMovUnitCost] = useState('')
  const [movNotes, setMovNotes] = useState('')
  const [movDate, setMovDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [movError, setMovError] = useState<string | null>(null)
  const [movSubmitting, setMovSubmitting] = useState(false)

  useEffect(() => {
    if (open && item) {
      setMovType(initialType)
      setMovQty('')
      setMovUnitCost(String(item.costPerUnit))
      setMovNotes('')
      setMovDate(format(new Date(), 'yyyy-MM-dd'))
      setMovError(null)
    }
  }, [open, item, initialType])

  async function handleMovSubmit(e: FormEvent) {
    e.preventDefault()
    if (!item || !userId) return
    const qty = parseFloat(movQty)
    if (isNaN(qty) || qty <= 0) {
      setMovError('Quantity must be a positive number.')
      return
    }
    const unitCost = parseFloat(movUnitCost || '0')
    if (isNaN(unitCost) || unitCost < 0) {
      setMovError('Unit cost must be non-negative.')
      return
    }

    setMovSubmitting(true)
    setMovError(null)
    try {
      await saveInventoryMovement(
        {
          itemId: item.id,
          movementDate: movDate,
          movementType: movType,
          notes: movNotes.trim(),
          quantity: qty,
          unitCost,
        },
        userId,
      )
      onClose()
      await onSaved()
    } catch {
      setMovError('Failed to record movement.')
    } finally {
      setMovSubmitting(false)
    }
  }

  if (!open || !item) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {movType === 'IN' ? 'Restock' : 'Record Usage'}
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">{item.name}</p>
          </div>
          <button
            className="rounded p-1 text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--muted)]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4 p-5" onSubmit={handleMovSubmit}>
          <div className="flex gap-2">
            {(['IN', 'OUT'] as const).map((type) => (
              <button
                key={type}
                className={[
                  'flex flex-1 items-center justify-center gap-2 rounded-md border py-2 text-sm font-medium transition',
                  movType === type
                    ? type === 'IN'
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500'
                      : 'border-red-400 bg-red-500/10 text-red-500'
                    : 'border-[var(--border)] bg-[var(--background)] text-[var(--muted)] hover:bg-[var(--background)]',
                ].join(' ')}
                onClick={() => setMovType(type)}
                type="button"
              >
                {type === 'IN' ? <ArrowDownToLine className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />}
                {type === 'IN' ? 'Stock In' : 'Stock Out'}
              </button>
            ))}
          </div>

          <div className="rounded-md bg-[var(--background)] border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] flex gap-4">
            <span>
              Current: <strong>{formatQty(item.currentStock, item.unitLabel)}</strong>
            </span>
            <span>
              Min: <strong>{formatQty(item.lowStockThreshold, item.unitLabel)}</strong>
            </span>
          </div>

          <ModalField label="Date" required>
            <input className={inputClass} onChange={(e) => setMovDate(e.target.value)} type="date" value={movDate} />
          </ModalField>

          <div className="grid grid-cols-2 gap-3">
            <ModalField label="Quantity" required>
              <input
                className={inputClass}
                min="0.001"
                onChange={(e) => setMovQty(e.target.value)}
                placeholder="0"
                step="any"
                type="number"
                value={movQty}
              />
            </ModalField>
            <ModalField label="Unit Cost">
              <input
                className={inputClass}
                min="0"
                onChange={(e) => setMovUnitCost(e.target.value)}
                placeholder="0.00"
                step="any"
                type="number"
                value={movUnitCost}
              />
            </ModalField>
          </div>

          <ModalField label="Notes">
            <input
              className={inputClass}
              onChange={(e) => setMovNotes(e.target.value)}
              placeholder="Reason or notes"
              type="text"
              value={movNotes}
            />
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {(movType === 'IN' ? QUICK_NOTES_IN : QUICK_NOTES_OUT).map((note) => (
                <button
                  key={note}
                  className={[
                    'rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                    movNotes === note
                      ? 'border-blue-400 bg-blue-50 text-blue-700'
                      : 'border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:bg-[var(--background)]',
                  ].join(' ')}
                  onClick={() => setMovNotes(note)}
                  type="button"
                >
                  {note}
                </button>
              ))}
            </div>
          </ModalField>

          {movError && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">{movError}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--background)]"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className={[
                'rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50',
                movType === 'IN' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600',
              ].join(' ')}
              disabled={movSubmitting}
              type="submit"
            >
              {movSubmitting ? 'Saving…' : movType === 'IN' ? 'Record Restock' : 'Record Usage'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
