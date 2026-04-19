import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  archiveCustomer,
  listCustomers,
  saveCustomer,
  type Customer,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function CustomersPage() {
  const { hasPermission, user } = useAuth()
  const canManage = hasPermission('manage_master_data')

  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formCompany, setFormCompany] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [confirmArchiveId, setConfirmArchiveId] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listCustomers({
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
    setModalOpen(true)
  }

  function openEdit(c: Customer) {
    setEditingId(c.id)
    setFormName(c.name)
    setFormCompany(c.company)
    setFormEmail(c.email)
    setFormPhone(c.phone)
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
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--background)]/50 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="w-40 px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {customers.map((c) => (
                <tr key={c.id} className="transition hover:bg-[var(--background)]/40">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      className="text-[var(--accent-strong)] transition hover:underline"
                      to={`/customers/${c.id}`}
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{c.company || '—'}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{c.phone || '—'}</td>
                  <td className="px-4 py-3 text-right">
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
