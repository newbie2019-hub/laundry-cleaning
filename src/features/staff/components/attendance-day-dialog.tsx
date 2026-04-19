import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Lock, X } from 'lucide-react'
import { toast } from 'sonner'
import { upsertAttendance, type AttendanceEntry } from '../../../lib/db/repository'
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  computeDayPay,
  defaultMultiplierForStatus,
  type AttendanceStatus,
} from '../lib/attendance'

type Props = {
  defaultRate: number
  entry: AttendanceEntry | null
  holidayDefaultMultiplier: number
  isoDate: string
  onClose: () => void
  onSaved: () => void
  open: boolean
  readOnly: boolean
  staffId: number
  userId: number
}

const modalInputClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition placeholder:text-gray-400 disabled:opacity-60'

const modalSelectClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition disabled:opacity-60'

const errorInputClass =
  'border-red-400 focus:border-red-500 focus:ring-red-500/30'

function ModalField({
  label,
  children,
  error,
  help,
  required,
}: {
  label: string
  children: ReactNode
  error?: string | null
  help?: ReactNode
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      {!error && help ? <p className="text-[11px] text-gray-500">{help}</p> : null}
    </div>
  )
}

export function AttendanceDayDialog({
  defaultRate,
  entry,
  holidayDefaultMultiplier,
  isoDate,
  onClose,
  onSaved,
  open,
  readOnly,
  staffId,
  userId,
}: Props) {
  const [status, setStatus] = useState<AttendanceStatus>('present')
  const [multiplier, setMultiplier] = useState('1')
  const [rateOverride, setRateOverride] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ multiplier?: string; rateOverride?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (entry) {
      setStatus(entry.status)
      setMultiplier(String(entry.multiplier))
      setRateOverride(entry.rateOverride != null ? String(entry.rateOverride) : '')
      setNotes(entry.notes)
    } else {
      setStatus('present')
      setMultiplier(String(defaultMultiplierForStatus('present', holidayDefaultMultiplier)))
      setRateOverride('')
      setNotes('')
    }
    setErrors({})
    setFormError(null)
  }, [open, entry, holidayDefaultMultiplier])

  function applyStatusDefaults(next: AttendanceStatus) {
    setStatus(next)
    setMultiplier(String(defaultMultiplierForStatus(next, holidayDefaultMultiplier)))
    setErrors((prev) => ({ ...prev, multiplier: undefined }))
  }

  const multRaw = multiplier.trim()
  const multNum = multRaw === '' ? NaN : Number(multRaw)
  const overrideRaw = rateOverride.trim()
  const overrideNum = overrideRaw === '' ? null : Number(overrideRaw)
  const previewPay = Number.isFinite(multNum)
    ? computeDayPay(
        defaultRate,
        multNum,
        overrideNum != null && Number.isFinite(overrideNum) && overrideNum >= 0 ? overrideNum : null,
      )
    : 0

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (readOnly || entry?.isPaid) return
    setFormError(null)

    const nextErrors: typeof errors = {}
    if (multRaw === '' || !Number.isFinite(multNum)) {
      nextErrors.multiplier = 'Enter a valid number (e.g. 0, 0.5, 1, 1.25).'
    } else if (multNum < 0) {
      nextErrors.multiplier = 'Multiplier cannot be negative.'
    }
    if (overrideRaw !== '' && (overrideNum == null || !Number.isFinite(overrideNum) || overrideNum < 0)) {
      nextErrors.rateOverride = 'Rate override must be zero or a positive number.'
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSaving(true)
    try {
      await upsertAttendance(
        staffId,
        isoDate,
        {
          multiplier: multNum,
          notes,
          rateOverride:
            overrideNum != null && Number.isFinite(overrideNum) && overrideNum >= 0
              ? overrideNum
              : null,
          status,
        },
        userId,
      )
      toast.success('Attendance saved.')
      onSaved()
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to save attendance.'
      setFormError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const label = format(parseISO(isoDate), 'EEE, MMM d, yyyy')
  const locked = Boolean(entry?.isPaid) || readOnly

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Attendance</h2>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
          <div className="flex items-center gap-2">
            {locked ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-semibold uppercase text-gray-500">
                <Lock className="h-3 w-3" />
                Paid
              </span>
            ) : null}
            <button
              className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <form className="divide-y divide-gray-100" onSubmit={handleSubmit}>
          <div className="space-y-4 p-5">
            <ModalField label="Status" required>
              <select
                className={modalSelectClass}
                disabled={locked}
                onChange={(e) => applyStatusDefaults(e.target.value as AttendanceStatus)}
                value={status}
              >
                {ATTENDANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ATTENDANCE_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </ModalField>

            <ModalField
              label="Multiplier"
              required
              error={errors.multiplier}
              help="Adjust for special cases; holiday uses the default from Settings until you change it here."
            >
              <input
                className={`${modalInputClass} ${errors.multiplier ? errorInputClass : ''}`}
                disabled={locked}
                onChange={(e) => {
                  setMultiplier(e.target.value)
                  setErrors((prev) => ({ ...prev, multiplier: undefined }))
                }}
                step="0.01"
                type="number"
                value={multiplier}
              />
            </ModalField>

            <ModalField
              label="Rate override (PHP, optional)"
              error={errors.rateOverride}
              help={`Leave blank to use the staff default rate of ₱${defaultRate.toLocaleString()}.`}
            >
              <input
                className={`${modalInputClass} ${errors.rateOverride ? errorInputClass : ''}`}
                disabled={locked}
                min="0"
                onChange={(e) => {
                  setRateOverride(e.target.value)
                  setErrors((prev) => ({ ...prev, rateOverride: undefined }))
                }}
                placeholder={`Default: ${defaultRate}`}
                step="0.01"
                type="number"
                value={rateOverride}
              />
            </ModalField>

            <ModalField label="Notes">
              <textarea
                className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition resize-none placeholder:text-gray-400 disabled:opacity-60"
                disabled={locked}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional note…"
                rows={2}
                value={notes}
              />
            </ModalField>

            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
              <span className="text-gray-500">Day pay:&nbsp;</span>
              <span className="font-semibold tabular-nums text-gray-900">
                ₱{previewPay.toFixed(2)}
              </span>
            </div>

            {formError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
                {formError}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4">
            <button
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
              onClick={onClose}
              type="button"
            >
              {locked ? 'Close' : 'Cancel'}
            </button>
            {!locked ? (
              <button
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                disabled={saving}
                type="submit"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  )
}
