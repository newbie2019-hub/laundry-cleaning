import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CalendarDays, Loader2, X } from 'lucide-react'
import {
  listAttendanceForDate,
  type AttendanceEntryWithStaff,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from '../lib/attendance'

type Props = {
  date: string | null
  onClose: () => void
  open: boolean
}

const STATUS_COLOR: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-500/15 text-emerald-400',
  overtime: 'bg-violet-500/15 text-violet-400',
  half: 'bg-amber-500/15 text-amber-400',
  holiday: 'bg-sky-500/15 text-sky-400',
  absent: 'bg-zinc-500/15 text-[var(--muted)]',
}

const STATUS_DOT: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-500',
  overtime: 'bg-violet-400',
  half: 'bg-amber-500',
  holiday: 'bg-sky-400',
  absent: 'bg-zinc-500',
}

export function AttendanceDaySummaryDialog({ date, onClose, open }: Props) {
  const [entries, setEntries] = useState<AttendanceEntryWithStaff[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !date) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setEntries([])

    void (async () => {
      try {
        const result = await listAttendanceForDate(date)
        if (!cancelled) setEntries(result)
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Unable to load attendance.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [open, date])

  if (!open || !date) return null

  // Sort: paid earners first (non-absent), then absent
  const sorted = [...entries].sort((a, b) => {
    if (a.status === 'absent' && b.status !== 'absent') return 1
    if (a.status !== 'absent' && b.status === 'absent') return -1
    return b.computedPay - a.computedPay
  })

  const presentEntries = sorted.filter((e) => e.status !== 'absent')
  const absentEntries = sorted.filter((e) => e.status === 'absent')
  const totalPay = entries.reduce((s, e) => s + e.computedPay, 0)

  let label = ''
  try {
    label = format(parseISO(date), 'EEEE, MMMM d, yyyy')
  } catch {
    label = date
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-[var(--panel)] shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-emerald-500/15 p-2 text-emerald-400">
              <CalendarDays className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">Daily Attendance</h2>
              <p className="text-xs text-[var(--muted)]">{label}</p>
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--muted)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : error ? (
            <div className="m-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted)]">
              No attendance records for this date.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {sorted.map((e) => (
                <li
                  key={e.id}
                  className={[
                    'flex items-center gap-3 px-5 py-3',
                    e.status === 'absent' ? 'opacity-50' : '',
                  ].join(' ')}
                >
                  {/* Status dot */}
                  <span
                    className={['h-2 w-2 flex-shrink-0 rounded-full', STATUS_DOT[e.status]].join(' ')}
                  />

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      {e.staffDisplayName}
                    </p>
                    <p className="text-[10px] text-[var(--muted)]">
                      {e.multiplier !== 1 && `×${e.multiplier} · `}
                      {e.rateOverride != null ? `override ₱${e.rateOverride}` : 'default rate'}
                    </p>
                  </div>

                  {/* Status badge */}
                  <span
                    className={[
                      'flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                      STATUS_COLOR[e.status],
                    ].join(' ')}
                  >
                    {ATTENDANCE_STATUS_LABELS[e.status]}
                  </span>

                  {/* Pay */}
                  <span
                    className={[
                      'flex-shrink-0 w-20 text-right text-sm font-semibold tabular-nums',
                      e.status === 'absent' ? 'text-[var(--muted)]' : 'text-[var(--foreground)]',
                    ].join(' ')}
                  >
                    {e.status === 'absent' ? '—' : formatCurrency(e.computedPay)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer summary */}
        {!loading && !error && entries.length > 0 && (
          <div className="border-t border-[var(--border)] bg-[var(--background)]/40 px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
                {presentEntries.length > 0 && (
                  <span>
                    <span className="font-semibold text-emerald-400">{presentEntries.length}</span> working
                  </span>
                )}
                {absentEntries.length > 0 && (
                  <span>
                    <span className="font-semibold text-[var(--foreground)]">{absentEntries.length}</span> absent
                  </span>
                )}
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Total Day Pay
                </p>
                <p className="text-base font-bold tabular-nums text-[var(--foreground)]">
                  {formatCurrency(totalPay)}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
