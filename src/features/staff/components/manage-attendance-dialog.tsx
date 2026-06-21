import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CalendarDays, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  getPayrollSettings,
  listAttendanceForDate,
  listStaff,
  upsertAttendance,
  type AttendanceEntryWithStaff,
  type Staff,
} from '../../../lib/db/repository'
import {
  defaultMultiplierForStatus,
  type AttendanceStatus,
} from '../lib/attendance'
import { useAuth } from '../../auth/use-auth'

type Props = {
  onClose: () => void
  onSaved: () => void
  open: boolean
  /** Default date to manage attendance for (ISO yyyy-MM-dd) */
  date: string
  /** Optional date range label, e.g. "Jun 9 – Jun 15" */
  periodLabel?: string
}

type StaffAttendanceRow = {
  staff: Staff
  entry: AttendanceEntryWithStaff | null
  pendingStatus: AttendanceStatus
  changed: boolean
}

const inputClass =
  'h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition'

export function ManageAttendanceDialog({ onClose, onSaved, open, date, periodLabel }: Props) {
  const { user } = useAuth()
  const [rows, setRows] = useState<StaffAttendanceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedDate, setSelectedDate] = useState(date)
  const [holidayMultiplier, setHolidayMultiplier] = useState(1)

  useEffect(() => {
    if (open) {
      setSelectedDate(date)
    }
  }, [open, date])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const [staffList, settings, existingEntries] = await Promise.all([
          listStaff({ includeArchived: false }),
          getPayrollSettings(),
          listAttendanceForDate(selectedDate),
        ])
        if (cancelled) return

        setHolidayMultiplier(settings.holidayDefaultMultiplier)

        const entryMap = new Map<number, AttendanceEntryWithStaff>()
        for (const e of existingEntries) {
          entryMap.set(e.staffId, e)
        }

        setRows(
          staffList.map((s) => {
            const entry = entryMap.get(s.id) ?? null
            const pendingStatus: AttendanceStatus = entry ? entry.status : 'present'
            return { staff: s, entry, pendingStatus, changed: false }
          }),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, selectedDate])

  function setStatus(staffId: number, status: AttendanceStatus) {
    setRows((prev) =>
      prev.map((r) =>
        r.staff.id === staffId
          ? {
              ...r,
              pendingStatus: status,
              changed: status !== (r.entry?.status ?? 'present'),
            }
          : r,
      ),
    )
  }

  async function handleSave() {
    if (!user) return
    const toSave = rows.filter((r) => r.changed && !r.entry?.isPaid)
    if (toSave.length === 0) {
      onClose()
      return
    }

    setSaving(true)
    let savedCount = 0
    let failCount = 0

    for (const r of toSave) {
      try {
        await upsertAttendance(
          r.staff.id,
          selectedDate,
          {
            multiplier: defaultMultiplierForStatus(r.pendingStatus, holidayMultiplier),
            notes: '',
            rateOverride: null,
            status: r.pendingStatus,
          },
          user.id,
        )
        savedCount++
      } catch {
        failCount++
      }
    }

    setSaving(false)

    if (failCount === 0) {
      toast.success(`Attendance updated for ${savedCount} staff.`)
      onSaved()
      onClose()
    } else {
      toast.warning(`Saved ${savedCount} — ${failCount} failed (some may be locked by a paid payroll).`)
    }
  }

  if (!open) return null

  const changedCount = rows.filter((r) => r.changed && !r.entry?.isPaid).length
  const presentCount = rows.filter((r) => r.pendingStatus !== 'absent').length

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-hidden flex flex-col rounded-xl bg-[var(--panel)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-[var(--accent)]/15 p-2 text-[var(--accent)]">
              <CalendarDays className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">Manage Attendance</h2>
              <p className="text-xs text-[var(--muted)]">
                {periodLabel ? `Period: ${periodLabel}` : 'Set attendance for each staff member'}
              </p>
            </div>
          </div>
          <button
            className="rounded-md p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Date picker */}
        <div className="border-b border-[var(--border)] px-5 py-3 bg-[var(--background)]/40">
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] whitespace-nowrap">
              Attendance Date
            </label>
            <input
              className={`${inputClass} flex-1`}
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
        </div>

        {/* Staff list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--muted)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted)]">No active staff found.</div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {rows.map((r) => {
                const locked = Boolean(r.entry?.isPaid)
                const isPresent = r.pendingStatus !== 'absent'

                return (
                  <li key={r.staff.id} className={['flex items-center gap-4 px-5 py-3 transition', locked ? 'opacity-60' : 'hover:bg-[var(--background)]/40'].join(' ')}>
                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {r.staff.displayName}
                      </p>
                      {locked && (
                        <p className="text-[10px] text-amber-400 font-medium">Locked (paid payroll)</p>
                      )}
                    </div>

                    {/* Toggle */}
                    {locked ? (
                      <span
                        className={[
                          'rounded-full px-3 py-1 text-xs font-semibold',
                          isPresent
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-red-500/15 text-red-400',
                        ].join(' ')}
                      >
                        {isPresent ? 'Present' : 'Absent'}
                      </span>
                    ) : (
                      <div className="flex rounded-md border border-[var(--border)] overflow-hidden text-xs font-medium">
                        <button
                          className={[
                            'px-3 py-1.5 transition',
                            r.pendingStatus !== 'absent'
                              ? 'bg-emerald-500 text-white'
                              : 'text-[var(--muted)] hover:bg-[var(--background)]',
                          ].join(' ')}
                          onClick={() => setStatus(r.staff.id, 'present')}
                          type="button"
                        >
                          Present
                        </button>
                        <button
                          className={[
                            'px-3 py-1.5 border-l border-[var(--border)] transition',
                            r.pendingStatus === 'absent'
                              ? 'bg-red-500 text-white'
                              : 'text-[var(--muted)] hover:bg-[var(--background)]',
                          ].join(' ')}
                          onClick={() => setStatus(r.staff.id, 'absent')}
                          type="button"
                        >
                          Absent
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--background)]/30 px-5 py-4">
          <div className="text-sm text-[var(--muted)]">
            <span className="font-medium text-emerald-400">{presentCount}</span>
            {' present · '}
            <span className="font-medium text-[var(--foreground)]">{rows.length}</span> total
            {changedCount > 0 && (
              <span className="ml-2 rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-xs font-medium text-[var(--accent)]">
                {changedCount} unsaved
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--background)]"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              disabled={saving || changedCount === 0}
              onClick={() => { void handleSave() }}
              type="button"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                `Save${changedCount > 0 ? ` (${changedCount})` : ''}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
