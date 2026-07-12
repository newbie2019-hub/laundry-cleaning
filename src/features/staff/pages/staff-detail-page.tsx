import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ArrowLeft, CalendarDays, HandCoins, Lock, Receipt, Wallet } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  getOutstandingCashAdvanceTotal,
  getPayrollSettings,
  getStaff,
  listAttendance,
  listPayrolls,
  voidPayroll,
  type AttendanceEntry,
  type PayrollListItem,
  type Staff,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'
import { MonthPicker } from '../../../components/month-picker'
import { useAuth } from '../../auth/use-auth'
import { AttendanceCalendar } from '../components/attendance-calendar'
import { AttendanceDayDialog } from '../components/attendance-day-dialog'
import { CashAdvanceDialog } from '../components/cash-advance-dialog'
import { DeductionsEarningsTab } from '../components/deductions-earnings-tab'
import { PayrollDetailDialog } from '../components/payroll-detail-dialog'
import { PayrollDialog } from '../components/payroll-dialog'

export function StaffDetailPage() {
  const { id } = useParams<{ id: string }>()
  const staffId = Number(id)
  const { hasPermission, user } = useAuth()
  const canManageStaff = hasPermission('manage_staff')
  const canProcessPayroll = hasPermission('process_payroll')

  const [staff, setStaff] = useState<Staff | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'attendance' | 'payroll' | 'deductions'>('attendance')
  const [monthKey, setMonthKey] = useState(() => format(new Date(), 'yyyy-MM'))
  const [entries, setEntries] = useState<AttendanceEntry[]>([])
  const [holidayMultiplier, setHolidayMultiplier] = useState(1)
  const [payrolls, setPayrolls] = useState<PayrollListItem[]>([])
  const [payrollDialogOpen, setPayrollDialogOpen] = useState(false)
  const [payrollDetailId, setPayrollDetailId] = useState<number | null>(null)
  const [dayDialog, setDayDialog] = useState<{ date: string; entry: AttendanceEntry | null } | null>(null)
  const [voidingId, setVoidingId] = useState<number | null>(null)
  const [cashAdvanceOpen, setCashAdvanceOpen] = useState(false)
  const [outstandingAdvances, setOutstandingAdvances] = useState(0)

  const loadStaff = useCallback(async () => {
    if (!Number.isFinite(staffId) || staffId <= 0) {
      setStaff(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const s = await getStaff(staffId)
      setStaff(s)
    } finally {
      setLoading(false)
    }
  }, [staffId])

  const loadAttendance = useCallback(async () => {
    if (!Number.isFinite(staffId) || staffId <= 0) return
    const start = format(startOfMonth(new Date(`${monthKey}-01`)), 'yyyy-MM-dd')
    const end = format(endOfMonth(new Date(`${monthKey}-01`)), 'yyyy-MM-dd')
    const rows = await listAttendance({ staffId, from: start, to: end })
    setEntries(rows)
  }, [staffId, monthKey])

  const loadPayrolls = useCallback(async () => {
    if (!Number.isFinite(staffId) || staffId <= 0) return
    const rows = await listPayrolls(staffId)
    setPayrolls(rows)
  }, [staffId])

  const loadOutstandingAdvances = useCallback(async () => {
    if (!Number.isFinite(staffId) || staffId <= 0) return
    const total = await getOutstandingCashAdvanceTotal(staffId)
    setOutstandingAdvances(total)
  }, [staffId])

  useEffect(() => {
    void loadStaff()
  }, [loadStaff])

  useEffect(() => {
    void (async () => {
      const ps = await getPayrollSettings()
      setHolidayMultiplier(ps.holidayDefaultMultiplier)
    })()
  }, [])

  useEffect(() => {
    if (!staff) return
    void loadAttendance()
  }, [staff, loadAttendance])

  useEffect(() => {
    if (!staff) return
    void loadPayrolls()
  }, [staff, loadPayrolls])

  useEffect(() => {
    if (!staff) return
    void loadOutstandingAdvances()
  }, [staff, loadOutstandingAdvances])

  const entriesByDate = useMemo(() => {
    const m = new Map<string, AttendanceEntry>()
    for (const e of entries) {
      m.set(e.attendanceDate, e)
    }
    return m
  }, [entries])

  const payrollsByPayDate = useMemo(() => {
    const m = new Map<string, PayrollListItem>()
    for (const p of payrolls) {
      // Prefer the paid record if multiple payrolls share a pay date (e.g. one voided + one re-run).
      const existing = m.get(p.payDate)
      if (!existing || (existing.status === 'void' && p.status === 'paid')) {
        m.set(p.payDate, p)
      }
    }
    return m
  }, [payrolls])

  async function handleVoidPayroll(payrollId: number) {
    try {
      await voidPayroll(payrollId)
      toast.success('Payroll voided. Attendance days are unlocked.')
      await loadPayrolls()
      await loadAttendance()
      await loadOutstandingAdvances()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Unable to void payroll.')
    } finally {
      setVoidingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-[var(--muted)]">Loading…</div>
    )
  }

  if (!staff) {
    return (
      <div className="space-y-4">
        <Link className="inline-flex items-center gap-1 text-sm text-[var(--accent-strong)]" to="/staff">
          <ArrowLeft className="h-4 w-4" />
          Back to staff
        </Link>
        <p className="text-sm text-[var(--muted)]">Staff not found.</p>
      </div>
    )
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--accent-strong)] hover:underline"
            to="/staff"
          >
            <ArrowLeft className="h-4 w-4" />
            Staff list
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">{staff.displayName}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{staff.address || 'No address on file.'}</p>
          {outstandingAdvances > 0 ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700">
              <HandCoins className="h-3.5 w-3.5" />
              Outstanding cash advance: {formatCurrency(outstandingAdvances)}
            </p>
          ) : null}
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Default rate</dt>
              <dd className="font-medium tabular-nums">{formatCurrency(staff.defaultRate)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Civil status</dt>
              <dd className="font-medium">{staff.civilStatus}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Emergency</dt>
              <dd className="font-medium">
                {staff.emergencyContactName || staff.emergencyContactNumber
                  ? `${staff.emergencyContactName}${staff.emergencyContactName && staff.emergencyContactNumber ? ' · ' : ''}${staff.emergencyContactNumber}`
                  : '—'}
              </dd>
            </div>
            {staff.civilStatus === 'Married' && staff.spouseName ? (
              <div>
                <dt className="text-[var(--muted)]">Spouse</dt>
                <dd className="font-medium">{staff.spouseName}</dd>
              </div>
            ) : null}
          </dl>
        </div>
        {canProcessPayroll && user ? (
          <button
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--background)]"
            onClick={() => setCashAdvanceOpen(true)}
            type="button"
          >
            <HandCoins className="h-4 w-4" />
            Cash advance
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-2">
        <button
          className={[
            'inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition',
            tab === 'attendance'
              ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'
              : 'text-[var(--muted)] hover:bg-[var(--background)]',
          ].join(' ')}
          onClick={() => setTab('attendance')}
          type="button"
        >
          <CalendarDays className="h-4 w-4" />
          Attendance
        </button>
        <button
          className={[
            'inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition',
            tab === 'payroll'
              ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'
              : 'text-[var(--muted)] hover:bg-[var(--background)]',
          ].join(' ')}
          onClick={() => setTab('payroll')}
          type="button"
        >
          <Wallet className="h-4 w-4" />
          Payroll
        </button>
        <button
          className={[
            'inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition',
            tab === 'deductions'
              ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'
              : 'text-[var(--muted)] hover:bg-[var(--background)]',
          ].join(' ')}
          onClick={() => setTab('deductions')}
          type="button"
        >
          <Receipt className="h-4 w-4" />
          Deductions &amp; earnings
        </button>
      </div>

      {tab === 'attendance' && (
        <div className="space-y-4">
          <div className="max-w-xs">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Month
            </label>
            <MonthPicker onChange={setMonthKey} value={monthKey} />
          </div>
          <AttendanceCalendar
            entriesByDate={entriesByDate}
            monthKey={monthKey}
            onMonthChange={setMonthKey}
            onPickDay={(iso) => setDayDialog({ date: iso, entry: entriesByDate.get(iso) ?? null })}
            onPickPayroll={(id) => setPayrollDetailId(id)}
            payrollsByPayDate={payrollsByPayDate}
          />
          {!canManageStaff ? (
            <p className="text-xs text-[var(--muted)]">You can view attendance but not edit it.</p>
          ) : null}
        </div>
      )}

      {tab === 'payroll' && (
        <div className="space-y-4">
          {canProcessPayroll && user ? (
            <button
              className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              onClick={() => setPayrollDialogOpen(true)}
              type="button"
            >
              Process payroll
            </button>
          ) : (
            <p className="text-xs text-[var(--muted)]">You do not have permission to process payroll.</p>
          )}

          {payrolls.length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-10 text-center text-sm text-[var(--muted)]">
              No payroll records yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--panel)]">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--background)]/50 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Pay date</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                    <th className="px-4 py-3 text-right">Adj.</th>
                    <th className="px-4 py-3 text-right">Net</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Ledger</th>
                    <th className="w-36 px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {payrolls.map((p) => (
                    <tr
                      key={p.id}
                      className="cursor-pointer hover:bg-[var(--background)]/40"
                      onClick={() => setPayrollDetailId(p.id)}
                    >
                      <td className="px-4 py-3 font-mono text-xs tabular-nums">
                        {p.periodStart} → {p.periodEnd}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{p.payDate}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(p.grossPay)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(p.totalAdjustments)}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{formatCurrency(p.netPay)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            p.status === 'paid'
                              ? 'rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300'
                              : 'rounded bg-zinc-500/15 px-2 py-0.5 text-xs text-zinc-400'
                          }
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {p.transactionId ? (
                          <span className="font-mono text-[var(--muted)]">Txn #{p.transactionId}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {p.status === 'paid' && canProcessPayroll ? (
                          voidingId === p.id ? (
                            <span className="flex flex-wrap justify-end gap-1">
                              <button
                                className="rounded bg-red-500 px-2 py-1 text-xs text-white"
                                onClick={() => { void handleVoidPayroll(p.id) }}
                                type="button"
                              >
                                Confirm void
                              </button>
                              <button
                                className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                                onClick={() => setVoidingId(null)}
                                type="button"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              className="text-xs font-medium text-red-400 hover:underline"
                              onClick={() => setVoidingId(p.id)}
                              type="button"
                            >
                              Void
                            </button>
                          )
                        ) : p.status === 'void' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                            <Lock className="h-3 w-3" />
                            Unpaid days reopened
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'deductions' && (
        <DeductionsEarningsTab
          canEdit={canProcessPayroll && Boolean(user)}
          staffDisplayName={staff.displayName}
          staffId={staff.id}
          userId={user?.id ?? null}
        />
      )}

      {user && dayDialog ? (
        <AttendanceDayDialog
          defaultRate={staff.defaultRate}
          entry={dayDialog.entry}
          holidayDefaultMultiplier={holidayMultiplier}
          isoDate={dayDialog.date}
          onClose={() => setDayDialog(null)}
          onSaved={() => {
            void loadAttendance()
          }}
          open
          readOnly={!canManageStaff}
          staffId={staff.id}
          userId={user.id}
        />
      ) : null}

      {user && payrollDialogOpen ? (
        <PayrollDialog
          onClose={() => setPayrollDialogOpen(false)}
          onSuccess={() => {
            void loadPayrolls()
            void loadAttendance()
            void loadOutstandingAdvances()
          }}
          open
          staffDisplayName={staff.displayName}
          staffId={staff.id}
          userId={user.id}
        />
      ) : null}

      {payrollDetailId != null ? (
        <PayrollDetailDialog
          onClose={() => setPayrollDetailId(null)}
          open
          payrollId={payrollDetailId}
          staffDisplayName={staff.displayName}
        />
      ) : null}

      {user && cashAdvanceOpen ? (
        <CashAdvanceDialog
          onChanged={() => {
            void loadOutstandingAdvances()
          }}
          onClose={() => setCashAdvanceOpen(false)}
          open
          staffDisplayName={staff.displayName}
          staffId={staff.id}
          userId={user.id}
        />
      ) : null}
    </section>
  )
}
