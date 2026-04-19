import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Plus, Trash2, Wallet, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  createCashAdvance,
  listCashAdvances,
  voidCashAdvance,
  type CashAdvance,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'

type Props = {
  onClose: () => void
  onChanged?: () => void
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

function StatusBadge({ status }: { status: CashAdvance['status'] }) {
  if (status === 'outstanding') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
        Outstanding
      </span>
    )
  }
  if (status === 'settled') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
        Settled
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
      Void
    </span>
  )
}

export function CashAdvanceDialog({
  onClose,
  onChanged,
  open,
  staffDisplayName,
  staffId,
  userId,
}: Props) {
  const [advances, setAdvances] = useState<CashAdvance[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [formDate, setFormDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [formAmount, setFormAmount] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formErrors, setFormErrors] = useState<{ amount?: string; advanceDate?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [voidingId, setVoidingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listCashAdvances(staffId, { status: 'all' })
      setAdvances(rows)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to load cash advances.')
    } finally {
      setLoading(false)
    }
  }, [staffId])

  useEffect(() => {
    if (!open) return
    setShowForm(false)
    setFormDate(format(new Date(), 'yyyy-MM-dd'))
    setFormAmount('')
    setFormNotes('')
    setFormErrors({})
    setFormError(null)
    void load()
  }, [open, load])

  const outstandingTotal = useMemo(
    () =>
      advances
        .filter((a) => a.status === 'outstanding')
        .reduce((sum, a) => sum + a.amount, 0),
    [advances],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const nextErrors: { amount?: string; advanceDate?: string } = {}
    const amount = Number(formAmount)
    if (!formDate.trim()) nextErrors.advanceDate = 'Date is required.'
    if (formAmount.trim() === '' || !Number.isFinite(amount) || amount <= 0) {
      nextErrors.amount = 'Amount must be greater than zero.'
    }
    setFormErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    try {
      await createCashAdvance(
        { advanceDate: formDate, amount, notes: formNotes, staffId },
        userId,
      )
      toast.success('Cash advance recorded.', {
        description: `${formatCurrency(amount)} logged for ${staffDisplayName}.`,
      })
      setShowForm(false)
      setFormAmount('')
      setFormNotes('')
      await load()
      onChanged?.()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to record advance.'
      setFormError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVoid(advance: CashAdvance) {
    setVoidingId(advance.id)
    try {
      await voidCashAdvance(advance.id, userId)
      toast.success('Cash advance voided.')
      await load()
      onChanged?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to void advance.')
    } finally {
      setVoidingId(null)
    }
  }

  if (!open) return null

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <Wallet className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Cash advances</h2>
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

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
                Outstanding balance
              </p>
              <p className="text-lg font-semibold tabular-nums text-amber-800">
                {formatCurrency(outstandingTotal)}
              </p>
            </div>
            {!showForm ? (
              <button
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
                onClick={() => setShowForm(true)}
                type="button"
              >
                <Plus className="h-3.5 w-3.5" />
                Issue advance
              </button>
            ) : null}
          </div>

          {showForm ? (
            <form
              className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4"
              onSubmit={handleSubmit}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Advance date" required error={formErrors.advanceDate}>
                  <input
                    className={`${inputClass} ${formErrors.advanceDate ? errorInputClass : ''}`}
                    onChange={(e) => {
                      setFormDate(e.target.value)
                      if (formErrors.advanceDate) {
                        setFormErrors((prev) => ({ ...prev, advanceDate: undefined }))
                      }
                    }}
                    type="date"
                    value={formDate}
                  />
                </Field>
                <Field
                  label="Amount (PHP)"
                  required
                  error={formErrors.amount}
                  help="Recorded as an expense today, deducted from the next payroll by default."
                >
                  <input
                    autoFocus
                    className={`${inputClass} tabular-nums ${formErrors.amount ? errorInputClass : ''}`}
                    inputMode="decimal"
                    min={0}
                    onChange={(e) => {
                      setFormAmount(e.target.value)
                      if (formErrors.amount) {
                        setFormErrors((prev) => ({ ...prev, amount: undefined }))
                      }
                    }}
                    placeholder="e.g. 500"
                    step="0.01"
                    type="number"
                    value={formAmount}
                  />
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  className="min-h-[56px] w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Optional memo that will appear on the expense transaction…"
                  value={formNotes}
                />
              </Field>
              {formError ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                  {formError}
                </div>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                  onClick={() => setShowForm(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                  disabled={submitting}
                  type="submit"
                >
                  {submitting ? 'Saving…' : 'Record advance'}
                </button>
              </div>
            </form>
          ) : null}

          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Notes</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-800">
                {loading ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-xs text-gray-500" colSpan={5}>
                      Loading…
                    </td>
                  </tr>
                ) : advances.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-xs text-gray-500" colSpan={5}>
                      No cash advances on file.
                    </td>
                  </tr>
                ) : (
                  advances.map((a) => (
                    <tr key={a.id} className="transition hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-gray-700">
                        {a.advanceDate}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatCurrency(a.amount)}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {a.notes ? (
                          <span className="line-clamp-2">{a.notes}</span>
                        ) : a.status === 'settled' && a.settledPayrollId ? (
                          <span className="font-mono text-gray-400">
                            Payroll #{a.settledPayrollId}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {a.status === 'outstanding' ? (
                          <button
                            aria-label="Void advance"
                            className="inline-flex items-center gap-1 rounded p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            disabled={voidingId === a.id}
                            onClick={() => {
                              void handleVoid(a)
                            }}
                            title="Void (reverses the expense transaction)"
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end border-t border-gray-200 px-5 py-3">
          <button
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
