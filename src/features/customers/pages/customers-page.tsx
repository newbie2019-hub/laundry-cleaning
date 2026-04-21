import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  archiveCustomer,
  listCustomerSummaries,
  saveCustomer,
  setCustomerLoyaltyEnabled,
  type CustomerSummary,
} from '../../../lib/db/repository'
import { formatCurrency } from '../../../lib/format'
import { useAuth } from '../../auth/use-auth'

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatShortDate(entryDate: string) {
  return format(new Date(`${entryDate}T00:00:00`), 'MMM d, yyyy')
}

function LoyaltyCell({
  customer,
  canManage,
  onToggle,
}: {
  customer: CustomerSummary
  canManage: boolean
  onToggle: (customer: CustomerSummary, next: boolean) => void
}) {
  if (!customer.isLoyaltyEnabled) {
    if (!canManage) {
      return <span className="text-xs text-[var(--muted)]">Not enrolled</span>
    }
    return (
      <button
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
        onClick={(e) => {
          e.stopPropagation()
          onToggle(customer, true)
        }}
        type="button"
      >
        Enable loyalty
      </button>
    )
  }

  const progress = Math.min(customer.paidLoadsSinceLastReward, customer.freeAfterLoads)
  const pct = customer.freeAfterLoads > 0
    ? Math.min(100, (progress / customer.freeAfterLoads) * 100)
    : 0
  const eligible = customer.isEligibleForReward

  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[var(--background)]">
        <div
          className={`h-full rounded-full transition-all ${eligible ? 'bg-violet-500' : 'bg-[var(--accent)]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="whitespace-nowrap text-xs tabular-nums text-[var(--muted)]">
        {progress.toFixed(progress % 1 === 0 ? 0 : 2)} / {customer.freeAfterLoads}
      </span>
      {eligible ? (
        <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
          Free ready
        </span>
      ) : null}
      {canManage ? (
        <button
          className="text-[11px] text-[var(--muted)] transition hover:text-red-400"
          onClick={(e) => {
            e.stopPropagation()
            onToggle(customer, false)
          }}
          title="Disable loyalty for this customer"
          type="button"
        >
          Disable
        </button>
      ) : null}
    </div>
  )
}

export function CustomersPage() {
  const { activeBusiness, hasPermission, user } = useAuth()
  const isCleaningBusiness = activeBusiness === 'cleaning'
  const navigate = useNavigate()
  const canManage = hasPermission('manage_master_data')

  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formCompany, setFormCompany] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formLoyaltyEnabled, setFormLoyaltyEnabled] = useState(false)
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [confirmArchiveId, setConfirmArchiveId] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listCustomerSummaries({
        includeArchived: false,
        search: debouncedSearch.trim() || undefined,
      })
      setCustomers(rows)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch])

  useEffect(() => {
    void load()
  }, [load])

  function openNew() {
    setEditingId(null)
    setFormName('')
    setFormCompany('')
    setFormEmail('')
    setFormPhone('')
    setFormLoyaltyEnabled(false)
    setModalOpen(true)
  }

  function openEdit(c: CustomerSummary) {
    setEditingId(c.id)
    setFormName(c.name)
    setFormCompany(c.company)
    setFormEmail(c.email)
    setFormPhone(c.phone)
    setFormLoyaltyEnabled(c.isLoyaltyEnabled)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!user || !canManage) return
    if (!formName.trim()) {
      toast.error('Name is required.')
      return
    }
    if (formEmail.trim() && !emailRegex.test(formEmail.trim())) {
      toast.error('Please enter a valid email address.')
      return
    }
    setFormSubmitting(true)
    try {
      await saveCustomer(
        {
          company: formCompany,
          email: formEmail,
          isLoyaltyEnabled: formLoyaltyEnabled,
          name: formName,
          phone: formPhone,
        },
        user.id,
        editingId ?? undefined,
      )
      toast.success(editingId ? 'Customer updated.' : 'Customer added.')
      closeModal()
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to save customer.')
    } finally {
      setFormSubmitting(false)
    }
  }

  async function handleArchive(id: number) {
    if (!user || !canManage) return
    try {
      await archiveCustomer(id, user.id)
      setConfirmArchiveId(null)
      toast.success('Customer archived.')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to archive customer.')
    }
  }

  async function handleToggleLoyalty(customer: CustomerSummary, next: boolean) {
    if (!user || !canManage) return
    try {
      await setCustomerLoyaltyEnabled(customer.id, next, user.id)
      toast.success(next ? 'Loyalty enabled.' : 'Loyalty disabled.')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update loyalty.')
    }
  }

  function handleRowClick(id: number) {
    navigate(`/customers/${id}`)
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Manage customer details for sales transactions
          </p>
        </div>
        {canManage && (
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
            onClick={openNew}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add customer
          </button>
        )}
      </header>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
        <input
          className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] pl-8 pr-3 text-sm outline-none focus:border-[var(--accent)] transition"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, company, email, phone…"
          type="search"
          value={search}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading…</div>
      ) : customers.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-14 text-center text-sm text-[var(--muted)]">
          No customers found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--panel)]">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--background)]/50 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Last transaction</th>
                {!isCleaningBusiness && <th className="px-4 py-3">Loyalty</th>}
                <th className="w-32 px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer transition hover:bg-[var(--background)]/40"
                  onClick={() => handleRowClick(c.id)}
                >
                  <td className="px-4 py-3 font-medium">
                    <span className="text-[var(--accent-strong)]">{c.name}</span>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{c.company || '—'}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    <div className="flex flex-col leading-tight">
                      <span>{c.email || '—'}</span>
                      <span className="text-xs">{c.phone || ''}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.lastTransactionDate ? (
                      <div className="flex flex-col leading-tight">
                        <span className="text-[var(--foreground)]">
                          {formatShortDate(c.lastTransactionDate)}
                        </span>
                        <span className="text-xs tabular-nums text-[var(--muted)]">
                          {c.lastTransactionAmount != null
                            ? formatCurrency(c.lastTransactionAmount)
                            : '—'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">No transactions</span>
                    )}
                  </td>
                  {!isCleaningBusiness && (
                    <td className="px-4 py-3">
                      <LoyaltyCell
                        canManage={canManage}
                        customer={c}
                        onToggle={(customer, next) => {
                          void handleToggleLoyalty(customer, next)
                        }}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {canManage ? (
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <button
                          aria-label="Edit"
                          className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
                          onClick={() => openEdit(c)}
                          type="button"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {confirmArchiveId === c.id ? (
                          <span className="flex items-center gap-1">
                            <button
                              className="rounded bg-red-500 px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
                              onClick={() => { void handleArchive(c.id) }}
                              type="button"
                            >
                              Confirm
                            </button>
                            <button
                              className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                              onClick={() => setConfirmArchiveId(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            aria-label="Archive"
                            className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                            onClick={() => setConfirmArchiveId(c.id)}
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-base font-semibold">
                {editingId ? 'Edit customer' : 'Add customer'}
              </h2>
              <button
                className="rounded p-1 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={closeModal}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="space-y-4 p-5" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  autoFocus
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Customer name"
                  value={formName}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Company</label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormCompany(e.target.value)}
                  placeholder="Optional"
                  value={formCompany}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Email</label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="Optional"
                  type="email"
                  value={formEmail}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Phone</label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="Optional"
                  value={formPhone}
                />
              </div>

              {!isCleaningBusiness && (
                <label className="flex items-start gap-2.5 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
                  <input
                    checked={formLoyaltyEnabled}
                    className="mt-0.5 h-4 w-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    onChange={(e) => setFormLoyaltyEnabled(e.target.checked)}
                    type="checkbox"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">Enable loyalty card</span>
                    <span className="block text-xs text-[var(--muted)]">
                      Loyalty is not given to first-time customers. Turn this on once they qualify.
                    </span>
                  </span>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="h-9 rounded-md border border-[var(--border)] px-4 text-sm font-medium transition hover:bg-[var(--background)]"
                  onClick={closeModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  disabled={!formName.trim() || formSubmitting || !canManage}
                  type="submit"
                >
                  {formSubmitting ? 'Saving…' : editingId ? 'Update' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
