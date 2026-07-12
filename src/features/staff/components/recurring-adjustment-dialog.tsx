import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Repeat, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  saveStaffRecurringAdjustment,
  type RecurringAdjustment,
} from '../../../lib/db/repository'
import { categoriesForKind, type AdjustmentKind } from '../lib/attendance'

type Props = {
  /** When set, the dialog edits this item; otherwise it creates a new one. */
  editing: RecurringAdjustment | null
  onClose: () => void
  onSaved: () => void
  open: boolean
  staffDisplayName: string
  staffId: number
  userId: number
}

const inputClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition placeholder:text-gray-400'

const errorInputClass = 'border-red-400 focus:border-red-500 focus:ring-red-500/30'

function Field({
  children,
  error,
  help,
  label,
  required,
}: {
  children: ReactNode
  error?: string | null
  help?: ReactNode
  label: string
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </label>
      {children}
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      {!error && help ? <p className="text-[11px] text-gray-500">{help}</p> : null}
    </div>
  )
}

export function RecurringAdjustmentDialog({
  editing,
  onClose,
  onSaved,
  open,
  staffDisplayName,
  staffId,
  userId,
}: Props) {
  const [kind, setKind] = useState<AdjustmentKind>('deduction')
  const [category, setCategory] = useState('other')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [taxable, setTaxable] = useState(false)
  const [oneTime, setOneTime] = useState(false)
  const [hasBalance, setHasBalance] = useState(false)
  const [originalBalance, setOriginalBalance] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<{ amount?: string; balance?: string; label?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  // Seed the form each time the dialog opens (from the item being edited, or blank).
  useEffect(() => {
    if (!open) return
    setErrors({})
    setSubmitting(false)
    if (editing) {
      setKind(editing.kind)
      setCategory(editing.category || 'other')
      setLabel(editing.label)
      setAmount(String(editing.amount))
      setTaxable(editing.taxable)
      setOneTime(editing.oneTime)
      setHasBalance(editing.hasBalance)
      setOriginalBalance(editing.originalBalance == null ? '' : String(editing.originalBalance))
      setStartDate(editing.startDate || '')
      setEndDate(editing.endDate || '')
      setNotes(editing.notes || '')
    } else {
      setKind('deduction')
      setCategory('other')
      setLabel('')
      setAmount('')
      setTaxable(false)
      setOneTime(false)
      setHasBalance(false)
      setOriginalBalance('')
      setStartDate('')
      setEndDate('')
      setNotes('')
    }
  }, [open, editing])

  function handleKindChange(next: AdjustmentKind) {
    setKind(next)
    // Reset the category to a valid option for the new kind.
    setCategory('other')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors: { amount?: string; balance?: string; label?: string } = {}
    const amountValue = Number(amount)
    const balanceValue = Number(originalBalance)
    if (!label.trim()) nextErrors.label = 'A label is required.'
    if (amount.trim() === '' || !Number.isFinite(amountValue) || amountValue < 0) {
      nextErrors.amount = 'Amount must be zero or a positive number.'
    }
    if (hasBalance && (originalBalance.trim() === '' || !Number.isFinite(balanceValue) || balanceValue <= 0)) {
      nextErrors.balance = 'A balance-tracked item needs a total greater than zero.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    try {
      await saveStaffRecurringAdjustment(
        staffId,
        {
          amount: amountValue,
          category,
          endDate,
          hasBalance,
          kind,
          label: label.trim(),
          notes,
          oneTime,
          originalBalance: oneTime ? null : hasBalance ? balanceValue : null,
          startDate,
          taxable,
        },
        userId,
        editing?.id,
      )
      toast.success(editing ? 'Recurring item updated.' : 'Recurring item added.', {
        description: `${label.trim()} for ${staffDisplayName}.`,
      })
      onSaved()
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to save recurring item.'
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const categories = categoriesForKind(kind)

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              <Repeat className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                {editing ? 'Edit recurring item' : 'Add recurring item'}
              </h2>
              <p className="text-xs text-gray-500">{staffDisplayName}</p>
            </div>
          </div>
          <button
            className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="flex-1 space-y-4 overflow-y-auto p-5" onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={[
                'rounded-md border px-3 py-2 text-sm font-medium transition',
                kind === 'earning'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50',
              ].join(' ')}
              onClick={() => handleKindChange('earning')}
              type="button"
            >
              Earning
            </button>
            <button
              className={[
                'rounded-md border px-3 py-2 text-sm font-medium transition',
                kind === 'deduction'
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50',
              ].join(' ')}
              onClick={() => handleKindChange('deduction')}
              type="button"
            >
              Deduction
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <select
                className={inputClass}
                onChange={(e) => setCategory(e.target.value)}
                value={category}
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount (PHP)" required error={errors.amount} help="Applied each payroll run.">
              <input
                className={`${inputClass} tabular-nums ${errors.amount ? errorInputClass : ''}`}
                inputMode="decimal"
                min={0}
                onChange={(e) => {
                  setAmount(e.target.value)
                  if (errors.amount) setErrors((p) => ({ ...p, amount: undefined }))
                }}
                placeholder="e.g. 600"
                step="0.01"
                type="number"
                value={amount}
              />
            </Field>
          </div>

          <Field label="Label" required error={errors.label}>
            <input
              className={`${inputClass} ${errors.label ? errorInputClass : ''}`}
              onChange={(e) => {
                setLabel(e.target.value)
                if (errors.label) setErrors((p) => ({ ...p, label: undefined }))
              }}
              placeholder={kind === 'earning' ? 'e.g. Rice allowance' : 'e.g. SSS contribution'}
              type="text"
              value={label}
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-gray-700">Frequency</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={[
                  'rounded-md border px-3 py-2 text-left text-sm transition',
                  !oneTime
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50',
                ].join(' ')}
                onClick={() => setOneTime(false)}
                type="button"
              >
                <span className="block font-medium">Recurring</span>
                <span className="block text-[11px] opacity-80">Every payroll run</span>
              </button>
              <button
                className={[
                  'rounded-md border px-3 py-2 text-left text-sm transition',
                  oneTime
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50',
                ].join(' ')}
                onClick={() => {
                  setOneTime(true)
                  setHasBalance(false)
                }}
                type="button"
              >
                <span className="block font-medium">One-time</span>
                <span className="block text-[11px] opacity-80">Next payroll only, then removed</span>
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              checked={taxable}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30"
              onChange={(e) => setTaxable(e.target.checked)}
              type="checkbox"
            />
            Taxable
          </label>

          {!oneTime ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                checked={hasBalance}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30"
                onChange={(e) => {
                  setHasBalance(e.target.checked)
                  if (errors.balance) setErrors((p) => ({ ...p, balance: undefined }))
                }}
                type="checkbox"
              />
              Track a running balance
            </label>
            <p className="mt-1 text-[11px] text-gray-500">
              For loans and other items that stop once fully paid off. The remaining balance goes
              down each payroll run.
            </p>
            {hasBalance ? (
              <div className="mt-3">
                <Field label="Total balance (PHP)" required error={errors.balance}>
                  <input
                    className={`${inputClass} tabular-nums ${errors.balance ? errorInputClass : ''}`}
                    inputMode="decimal"
                    min={0}
                    onChange={(e) => {
                      setOriginalBalance(e.target.value)
                      if (errors.balance) setErrors((p) => ({ ...p, balance: undefined }))
                    }}
                    placeholder="e.g. 5000"
                    step="0.01"
                    type="number"
                    value={originalBalance}
                  />
                </Field>
                {editing && editing.hasBalance && editing.remainingBalance != null ? (
                  <p className="mt-1 text-[11px] text-gray-500">
                    Changing the total resets the remaining balance unless it stays the same.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          ) : null}

          {!oneTime ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start date" help="Optional — leave blank to apply immediately.">
              <input
                className={inputClass}
                onChange={(e) => setStartDate(e.target.value)}
                type="date"
                value={startDate}
              />
            </Field>
            <Field label="End date" help="Optional — leave blank for no end.">
              <input
                className={inputClass}
                onChange={(e) => setEndDate(e.target.value)}
                type="date"
                value={endDate}
              />
            </Field>
          </div>
          ) : (
            <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-700">
              This item will be applied to the next payroll run and then automatically removed.
            </p>
          )}

          <Field label="Notes">
            <textarea
              className="min-h-[56px] w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional memo…"
              value={notes}
            />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              disabled={submitting}
              type="submit"
            >
              {submitting ? 'Saving…' : editing ? 'Save changes' : 'Add item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
