import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { differenceInYears, format, isValid, parseISO } from 'date-fns'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  UserCheck,
  Users,
  UserX,
  Wallet,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  listStaff,
  saveStaff,
  setStaffActive,
  type CivilStatus,
  type Staff,
  type StaffDraft,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'
import { useAuth } from '../../auth/use-auth'

const CIVIL_STATUSES: CivilStatus[] = ['Single', 'Married', 'Widowed', 'Separated']

const modalInputClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition placeholder:text-gray-400'

const modalSelectClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition'

const filterSelectClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition'

const errorInputClass = 'border-red-400 focus:border-red-500 focus:ring-red-500/30'

type StaffFormErrors = {
  firstName?: string
  lastName?: string
  defaultRate?: string
}

type SortKey = 'firstName' | 'lastName' | 'civilStatus' | 'defaultRate' | 'lastPayrollDate' | 'status'
type SortDir = 'asc' | 'desc'

type ColumnKey =
  | 'firstName'
  | 'lastName'
  | 'civilStatus'
  | 'defaultRate'
  | 'emergency'
  | 'lastPayrollDate'
  | 'status'

const COLUMN_DEFS: { key: ColumnKey; label: string }[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'civilStatus', label: 'Civil status' },
  { key: 'defaultRate', label: 'Default rate' },
  { key: 'emergency', label: 'Emergency contact' },
  { key: 'lastPayrollDate', label: 'Last payroll' },
  { key: 'status', label: 'Status' },
]

type ColumnVisibility = Record<ColumnKey, boolean>

const DEFAULT_COLUMNS: ColumnVisibility = {
  firstName: true,
  lastName: true,
  civilStatus: true,
  defaultRate: true,
  emergency: true,
  lastPayrollDate: true,
  status: true,
}

const COLUMNS_STORAGE_KEY = 'business-ledger.staff.columns'

function loadColumnPrefs(): ColumnVisibility {
  try {
    const stored = localStorage.getItem(COLUMNS_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_COLUMNS }
    return { ...DEFAULT_COLUMNS, ...(JSON.parse(stored) as Partial<ColumnVisibility>) }
  } catch {
    return { ...DEFAULT_COLUMNS }
  }
}

function saveColumnPrefs(prefs: ColumnVisibility): void {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore storage errors */
  }
}

function ModalField({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string | null
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  )
}

function ageFromBirthdate(birthdate: string): string {
  if (!birthdate.trim()) return '—'
  const d = parseISO(birthdate)
  if (!isValid(d)) return '—'
  return String(differenceInYears(new Date(), d))
}

function formatPayDate(value: string | null): string {
  if (!value) return '—'
  const d = parseISO(value)
  if (!isValid(d)) return value
  return format(d, 'MMM d, yyyy')
}

export function StaffPage() {
  const { hasPermission, user } = useAuth()
  const canManage = hasPermission('manage_staff')
  const navigate = useNavigate()

  const [staffList, setStaffList] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Filters
  const [civilStatusFilter, setCivilStatusFilter] = useState<CivilStatus | ''>('')
  const [minRate, setMinRate] = useState('')
  const [maxRate, setMaxRate] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [columns, setColumns] = useState<ColumnVisibility>(() => loadColumnPrefs())

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('lastName')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Modal form state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formFirstName, setFormFirstName] = useState('')
  const [formMiddleName, setFormMiddleName] = useState('')
  const [formLastName, setFormLastName] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [formBirthdate, setFormBirthdate] = useState('')
  const [formCivilStatus, setFormCivilStatus] = useState<CivilStatus>('Single')
  const [formEmergencyName, setFormEmergencyName] = useState('')
  const [formEmergencyNumber, setFormEmergencyNumber] = useState('')
  const [formSpouseName, setFormSpouseName] = useState('')
  const [formDefaultRate, setFormDefaultRate] = useState('')
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formErrors, setFormErrors] = useState<StaffFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)

  const computedAge = useMemo(() => ageFromBirthdate(formBirthdate), [formBirthdate])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listStaff({
        includeArchived: true,
        search: debouncedSearch.trim() || undefined,
      })
      setStaffList(rows)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch])

  useEffect(() => {
    void load()
  }, [load])

  const filteredStaff = useMemo(() => {
    const min = minRate.trim() === '' ? null : Number(minRate)
    const max = maxRate.trim() === '' ? null : Number(maxRate)
    return staffList.filter((s) => {
      if (statusFilter === 'active' && s.isArchived) return false
      if (statusFilter === 'inactive' && !s.isArchived) return false
      if (civilStatusFilter && s.civilStatus !== civilStatusFilter) return false
      if (min != null && Number.isFinite(min) && s.defaultRate < min) return false
      if (max != null && Number.isFinite(max) && s.defaultRate > max) return false
      return true
    })
  }, [staffList, statusFilter, civilStatusFilter, minRate, maxRate])

  const sortedStaff = useMemo(() => {
    const copy = [...filteredStaff]
    const dir = sortDir === 'asc' ? 1 : -1
    copy.sort((a, b) => {
      switch (sortKey) {
        case 'firstName':
          return a.firstName.localeCompare(b.firstName) * dir
        case 'lastName':
          return a.lastName.localeCompare(b.lastName) * dir
        case 'civilStatus':
          return a.civilStatus.localeCompare(b.civilStatus) * dir
        case 'defaultRate':
          return (a.defaultRate - b.defaultRate) * dir
        case 'lastPayrollDate': {
          const av = a.lastPayrollDate ?? ''
          const bv = b.lastPayrollDate ?? ''
          if (av === bv) return 0
          if (!av) return 1
          if (!bv) return -1
          return av.localeCompare(bv) * dir
        }
        case 'status':
          return (Number(a.isArchived) - Number(b.isArchived)) * dir
        default:
          return 0
      }
    })
    return copy
  }, [filteredStaff, sortKey, sortDir])

  const summary = useMemo(() => {
    const total = staffList.length
    const active = staffList.filter((s) => !s.isArchived).length
    const inactive = total - active
    const activeStaff = staffList.filter((s) => !s.isArchived)
    const avgRate =
      activeStaff.length > 0
        ? activeStaff.reduce((sum, s) => sum + s.defaultRate, 0) / activeStaff.length
        : 0
    return { total, active, inactive, avgRate }
  }, [staffList])

  const activeFilterCount =
    (civilStatusFilter ? 1 : 0) +
    (minRate.trim() || maxRate.trim() ? 1 : 0) +
    (statusFilter !== 'active' ? 1 : 0)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function updateColumn(key: ColumnKey, visible: boolean) {
    setColumns((prev) => {
      const next = { ...prev, [key]: visible }
      saveColumnPrefs(next)
      return next
    })
  }

  function resetForm() {
    setFormFirstName('')
    setFormMiddleName('')
    setFormLastName('')
    setFormAddress('')
    setFormBirthdate('')
    setFormCivilStatus('Single')
    setFormEmergencyName('')
    setFormEmergencyNumber('')
    setFormSpouseName('')
    setFormDefaultRate('')
    setFormErrors({})
    setFormError(null)
  }

  function openNew() {
    setEditingId(null)
    resetForm()
    setModalOpen(true)
  }

  function openEdit(s: Staff) {
    setEditingId(s.id)
    setFormFirstName(s.firstName)
    setFormMiddleName(s.middleName)
    setFormLastName(s.lastName)
    setFormAddress(s.address)
    setFormBirthdate(s.birthdate)
    setFormCivilStatus(s.civilStatus)
    setFormEmergencyName(s.emergencyContactName)
    setFormEmergencyNumber(s.emergencyContactNumber)
    setFormSpouseName(s.spouseName)
    setFormDefaultRate(String(s.defaultRate))
    setFormErrors({})
    setFormError(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
    setFormErrors({})
    setFormError(null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!user || !canManage) return
    setFormError(null)

    const nextErrors: StaffFormErrors = {}
    if (!formFirstName.trim()) nextErrors.firstName = 'First name is required.'
    if (!formLastName.trim()) nextErrors.lastName = 'Last name is required.'
    const rate = Number(formDefaultRate)
    if (formDefaultRate.trim() === '' || !Number.isFinite(rate) || rate <= 0) {
      nextErrors.defaultRate = 'Enter a default rate greater than zero.'
    }
    setFormErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const draft: StaffDraft = {
      address: formAddress,
      birthdate: formBirthdate,
      civilStatus: formCivilStatus,
      defaultRate: rate,
      emergencyContactName: formEmergencyName,
      emergencyContactNumber: formEmergencyNumber,
      firstName: formFirstName,
      lastName: formLastName,
      middleName: formMiddleName,
      spouseName: formCivilStatus === 'Married' ? formSpouseName : '',
    }

    setFormSubmitting(true)
    try {
      await saveStaff(draft, user.id, editingId ?? undefined)
      toast.success(editingId ? 'Staff updated.' : 'Staff added.')
      closeModal()
      await load()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to save staff.'
      setFormError(message)
      toast.error(message)
    } finally {
      setFormSubmitting(false)
    }
  }

  async function handleToggleActive(s: Staff) {
    if (!user || !canManage) return
    setTogglingId(s.id)
    try {
      await setStaffActive(s.id, s.isArchived, user.id)
      toast.success(s.isArchived ? 'Staff reactivated.' : 'Staff marked inactive.')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update staff status.')
    } finally {
      setTogglingId(null)
    }
  }

  function openStaff(id: number) {
    navigate(`/staff/${id}`)
  }

  const renderSortHeader = (
    key: SortKey,
    label: string,
    align: 'left' | 'right' = 'left',
    extraClass = '',
  ) => {
    const active = sortKey === key
    const alignClass = align === 'right' ? 'justify-end text-right' : 'justify-start text-left'
    return (
      <th className={`px-4 py-3 ${extraClass}`}>
        <button
          className={[
            'inline-flex w-full items-center gap-1 font-semibold uppercase tracking-wider select-none transition hover:text-[var(--foreground)]',
            alignClass,
            active ? 'text-[var(--foreground)]' : '',
          ].join(' ')}
          onClick={() => toggleSort(key)}
          type="button"
        >
          <span>{label}</span>
          {active ? (
            sortDir === 'asc' ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            )
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-50" />
          )}
        </button>
      </th>
    )
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Staff</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Profiles, attendance, and weekly payroll
          </p>
        </div>
        {canManage && (
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
            onClick={openNew}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add staff
          </button>
        )}
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: 'Total Staff',
            value: String(summary.total),
            icon: Users,
            color: 'text-blue-500',
            bg: 'bg-blue-500/10',
            sub: `${summary.active} active · ${summary.inactive} inactive`,
          },
          {
            label: 'Active',
            value: String(summary.active),
            icon: UserCheck,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
            sub: summary.total > 0 ? `${Math.round((summary.active / summary.total) * 100)}% of staff` : 'no staff yet',
          },
          {
            label: 'Avg. Daily Rate',
            value: summary.active > 0 ? formatCurrency(summary.avgRate) : '—',
            icon: Wallet,
            color: 'text-indigo-500',
            bg: 'bg-indigo-500/10',
            sub: summary.active > 0 ? `across ${summary.active} active` : 'active staff',
          },
          {
            label: 'Inactive',
            value: String(summary.inactive),
            icon: UserX,
            color: 'text-zinc-500',
            bg: 'bg-zinc-500/10',
            sub:
              summary.total > 0
                ? `${Math.round((summary.inactive / summary.total) * 100)}% of staff`
                : 'no staff yet',
          },
        ].map(({ label, value, icon: Icon, color, bg, sub }) => (
          <div
            key={label}
            className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                {label}
              </p>
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-3.5 w-3.5 ${color}`} />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
            <p className="mt-1.5 text-xs text-[var(--muted)]">{sub}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            className="h-9 w-64 rounded-md border border-[var(--border)] bg-[var(--panel)] pl-9 pr-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff…"
            type="search"
            value={search}
          />
        </div>
        <button
          className="relative flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--background)]"
          onClick={() => setIsFilterOpen(true)}
          type="button"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">
          Loading…
        </div>
      ) : sortedStaff.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-14 text-center text-sm text-[var(--muted)]">
          No staff found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--panel)]">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--background)]/50 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              <tr>
                {columns.firstName && renderSortHeader('firstName', 'First name', 'left')}
                {columns.lastName && renderSortHeader('lastName', 'Last name', 'left')}
                {columns.defaultRate && renderSortHeader('defaultRate', 'Default rate', 'right')}
                {columns.civilStatus && renderSortHeader('civilStatus', 'Civil status', 'left')}
                {columns.emergency && (
                  <th className="px-4 py-3 font-semibold uppercase tracking-wider">Emergency</th>
                )}
                {columns.lastPayrollDate && renderSortHeader('lastPayrollDate', 'Last payroll', 'left')}
                {columns.status && renderSortHeader('status', 'Status', 'left')}
                {canManage && (
                  <th className="w-32 px-4 py-3 text-right font-semibold uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sortedStaff.map((s) => (
                <tr
                  key={s.id}
                  className={[
                    'cursor-pointer transition hover:bg-[var(--background)]/40',
                    s.isArchived ? 'opacity-60' : '',
                  ].join(' ')}
                  onClick={() => openStaff(s.id)}
                >
                  {columns.firstName && (
                    <td className="px-4 py-3 font-medium">{s.firstName || '—'}</td>
                  )}
                  {columns.lastName && (
                    <td className="px-4 py-3">
                      <div className="font-medium">{s.lastName || '—'}</div>
                      {s.address ? (
                        <div className="mt-0.5 line-clamp-1 text-xs text-[var(--muted)]">
                          {s.address}
                        </div>
                      ) : null}
                    </td>
                  )}
                  {columns.defaultRate && (
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(s.defaultRate)}
                    </td>
                  )}
                  {columns.civilStatus && (
                    <td className="px-4 py-3 text-[var(--muted)]">{s.civilStatus}</td>
                  )}
                  {columns.emergency && (
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {s.emergencyContactName || s.emergencyContactNumber
                        ? `${s.emergencyContactName}${s.emergencyContactName && s.emergencyContactNumber ? ' · ' : ''}${s.emergencyContactNumber}`
                        : '—'}
                    </td>
                  )}
                  {columns.lastPayrollDate && (
                    <td className="px-4 py-3 text-[var(--muted)] tabular-nums">
                      {formatPayDate(s.lastPayrollDate)}
                    </td>
                  )}
                  {columns.status && (
                    <td className="px-4 py-3">
                      {s.isArchived ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                          Inactive
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                          Active
                        </span>
                      )}
                    </td>
                  )}
                  {canManage && (
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <button
                          aria-label="Edit"
                          className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
                          onClick={() => openEdit(s)}
                          type="button"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          aria-label={s.isArchived ? 'Mark active' : 'Mark inactive'}
                          className={[
                            'rounded p-1.5 transition disabled:opacity-50',
                            s.isArchived
                              ? 'text-emerald-600 hover:bg-emerald-500/10'
                              : 'text-[var(--muted)] hover:bg-red-500/10 hover:text-red-400',
                          ].join(' ')}
                          disabled={togglingId === s.id}
                          onClick={() => { void handleToggleActive(s) }}
                          title={s.isArchived ? 'Mark active' : 'Mark inactive'}
                          type="button"
                        >
                          {s.isArchived ? (
                            <UserCheck className="h-4 w-4" />
                          ) : (
                            <UserX className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">
                {editingId ? 'Edit staff' : 'Add staff'}
              </h2>
              <button
                className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                onClick={closeModal}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              className="flex min-h-0 flex-1 flex-col"
              id="staff-form"
              onSubmit={handleSubmit}
            >
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <ModalField label="First name" required error={formErrors.firstName}>
                    <input
                      autoFocus
                      className={`${modalInputClass} ${formErrors.firstName ? errorInputClass : ''}`}
                      onChange={(e) => {
                        setFormFirstName(e.target.value)
                        if (formErrors.firstName) {
                          setFormErrors((prev) => ({ ...prev, firstName: undefined }))
                        }
                      }}
                      value={formFirstName}
                    />
                  </ModalField>
                  <ModalField label="Middle name">
                    <input
                      className={modalInputClass}
                      onChange={(e) => setFormMiddleName(e.target.value)}
                      value={formMiddleName}
                    />
                  </ModalField>
                  <div className="sm:col-span-2">
                    <ModalField label="Last name" required error={formErrors.lastName}>
                      <input
                        className={`${modalInputClass} ${formErrors.lastName ? errorInputClass : ''}`}
                        onChange={(e) => {
                          setFormLastName(e.target.value)
                          if (formErrors.lastName) {
                            setFormErrors((prev) => ({ ...prev, lastName: undefined }))
                          }
                        }}
                        value={formLastName}
                      />
                    </ModalField>
                  </div>
                </div>

                <ModalField label="Address">
                  <textarea
                    className="min-h-[72px] w-full resize-none rounded-md border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    onChange={(e) => setFormAddress(e.target.value)}
                    value={formAddress}
                  />
                </ModalField>

                <div className="grid gap-4 sm:grid-cols-2">
                  <ModalField label="Birthdate">
                    <input
                      className={modalInputClass}
                      onChange={(e) => setFormBirthdate(e.target.value)}
                      type="date"
                      value={formBirthdate}
                    />
                  </ModalField>
                  <ModalField label="Age">
                    <div className="flex h-10 items-center rounded-md border border-gray-200 bg-gray-100 px-3 text-sm text-gray-500">
                      {computedAge}
                    </div>
                  </ModalField>
                </div>

                <ModalField label="Civil status">
                  <select
                    className={modalSelectClass}
                    onChange={(e) => setFormCivilStatus(e.target.value as CivilStatus)}
                    value={formCivilStatus}
                  >
                    {CIVIL_STATUSES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </ModalField>

                {formCivilStatus === 'Married' && (
                  <ModalField label="Spouse name">
                    <input
                      className={modalInputClass}
                      onChange={(e) => setFormSpouseName(e.target.value)}
                      value={formSpouseName}
                    />
                  </ModalField>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <ModalField label="Emergency contact name">
                    <input
                      className={modalInputClass}
                      onChange={(e) => setFormEmergencyName(e.target.value)}
                      value={formEmergencyName}
                    />
                  </ModalField>
                  <ModalField label="Emergency contact number">
                    <input
                      className={modalInputClass}
                      onChange={(e) => setFormEmergencyNumber(e.target.value)}
                      value={formEmergencyNumber}
                    />
                  </ModalField>
                </div>

                <ModalField
                  label="Default daily rate (PHP)"
                  required
                  error={formErrors.defaultRate}
                >
                  <input
                    className={`${modalInputClass} tabular-nums ${formErrors.defaultRate ? errorInputClass : ''}`}
                    inputMode="decimal"
                    min={0}
                    onChange={(e) => {
                      setFormDefaultRate(e.target.value)
                      if (formErrors.defaultRate) {
                        setFormErrors((prev) => ({ ...prev, defaultRate: undefined }))
                      }
                    }}
                    placeholder="e.g. 650"
                    step="0.01"
                    type="number"
                    value={formDefaultRate}
                  />
                </ModalField>

                {formError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
                    {formError}
                  </div>
                ) : null}
              </div>
            </form>

            <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-5 py-4">
              <p className="text-xs text-gray-400">
                <span className="text-red-500">*</span> Required fields
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
                  onClick={closeModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                  disabled={formSubmitting || !canManage}
                  form="staff-form"
                  type="submit"
                >
                  {formSubmitting ? 'Saving…' : editingId ? 'Update' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isFilterOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setIsFilterOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">Filters & Columns</h2>
              <button
                className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                onClick={() => setIsFilterOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Status</label>
                <select
                  className={filterSelectClass}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                  value={statusFilter}
                >
                  <option value="active">Active only</option>
                  <option value="inactive">Inactive only</option>
                  <option value="all">All (active + inactive)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Civil status</label>
                <select
                  className={filterSelectClass}
                  onChange={(e) => setCivilStatusFilter(e.target.value as CivilStatus | '')}
                  value={civilStatusFilter}
                >
                  <option value="">All</option>
                  {CIVIL_STATUSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Daily rate (PHP)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className={modalInputClass}
                    inputMode="decimal"
                    min={0}
                    onChange={(e) => setMinRate(e.target.value)}
                    placeholder="Min"
                    step="0.01"
                    type="number"
                    value={minRate}
                  />
                  <input
                    className={modalInputClass}
                    inputMode="decimal"
                    min={0}
                    onChange={(e) => setMaxRate(e.target.value)}
                    placeholder="Max"
                    step="0.01"
                    type="number"
                    value={maxRate}
                  />
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <p className="text-sm font-medium text-gray-700">Visible columns</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Preferences are saved on this device.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {COLUMN_DEFS.map((col) => (
                    <label
                      className="flex cursor-pointer select-none items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      key={col.key}
                    >
                      <input
                        checked={columns[col.key]}
                        className="rounded"
                        onChange={(e) => updateColumn(col.key, e.target.checked)}
                        type="checkbox"
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-200 px-5 py-3">
              <button
                className="text-sm font-medium text-gray-600 transition hover:text-gray-800 disabled:opacity-40"
                disabled={activeFilterCount === 0}
                onClick={() => {
                  setCivilStatusFilter('')
                  setMinRate('')
                  setMaxRate('')
                  setStatusFilter('active')
                }}
                type="button"
              >
                Clear filters
              </button>
              <button
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                onClick={() => setIsFilterOpen(false)}
                type="button"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
