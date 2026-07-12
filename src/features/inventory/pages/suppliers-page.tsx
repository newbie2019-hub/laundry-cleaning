import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteSupplier,
  listSuppliers,
  saveSupplier,
  type Supplier,
  type SupplierDraft,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'
import {
  ModalField,
  ModalShell,
  modalInputClass,
  modalPrimaryButtonClass,
  modalSecondaryButtonClass,
  modalTextareaClass,
} from '../components/modal-shell'

const EMPTY_DRAFT: SupplierDraft = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  notes: '',
  isActive: true,
}

export function SuppliersPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_inventory')

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<SupplierDraft>(EMPTY_DRAFT)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listSuppliers(showInactive)
      setSuppliers(rows)
    } catch {
      toast.error('Unable to load suppliers.')
    } finally {
      setLoading(false)
    }
  }, [showInactive])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.contactName.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q),
    )
  }, [suppliers, search])

  function openAdd() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setIsModalOpen(true)
  }

  function openEdit(supplier: Supplier) {
    setEditingId(supplier.id)
    setDraft({
      name: supplier.name,
      contactName: supplier.contactName,
      phone: supplier.phone,
      email: supplier.email,
      notes: supplier.notes,
      isActive: supplier.isActive,
    })
    setIsModalOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canManage) return
    if (!draft.name.trim()) return
    setIsSubmitting(true)
    try {
      await saveSupplier(draft, editingId ?? undefined)
      setIsModalOpen(false)
      toast.success(editingId ? 'Supplier updated.' : 'Supplier added.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to save supplier.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!canManage || !deleteTarget) return
    try {
      await deleteSupplier(deleteTarget.id)
      setDeleteTarget(null)
      toast.success('Supplier deleted.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to delete supplier.')
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Suppliers</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Manage vendors used for inventory items and purchase orders.
          </p>
        </div>
        {canManage ? (
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90"
            onClick={openAdd}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add Supplier
          </button>
        ) : null}
      </header>

      {!canManage ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          You need the <strong>Manage inventory</strong> permission to edit suppliers.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            className="h-9 w-64 rounded-md border border-[var(--border)] bg-[var(--panel)] pl-9 pr-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search suppliers…"
            type="search"
            value={search}
          />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--muted)]">
          <input
            checked={showInactive}
            className="rounded border-[var(--border)]"
            onChange={(e) => setShowInactive(e.target.checked)}
            type="checkbox"
          />
          Show inactive suppliers
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-16 text-center text-[var(--muted)]">
          <Building2 className="h-8 w-8 opacity-40" />
          <p className="text-sm">No suppliers found.</p>
          {canManage ? (
            <button className="mt-1 text-sm text-[var(--accent)] hover:underline" onClick={openAdd} type="button">
              Add your first supplier
            </button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--background)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-center">Items</th>
                <th className="px-4 py-3 text-center">Open POs</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {visible.map((supplier) => {
                const referenced = supplier.itemCount > 0 || supplier.openPoCount > 0
                return (
                  <tr key={supplier.id} className={supplier.isActive ? '' : 'opacity-60'}>
                    <td className="px-4 py-3 font-medium">{supplier.name}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{supplier.contactName || '—'}</td>
                    <td className="px-4 py-3 text-[var(--muted)] whitespace-nowrap">{supplier.phone || '—'}</td>
                    <td className="px-4 py-3 text-[var(--muted)] max-w-[14rem] truncate">{supplier.email || '—'}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{supplier.itemCount}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{supplier.openPoCount}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={[
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          supplier.isActive
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : 'bg-gray-500/15 text-[var(--muted)]',
                        ].join(' ')}
                      >
                        {supplier.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            aria-label="Edit supplier"
                            className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                            onClick={() => openEdit(supplier)}
                            type="button"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            aria-label="Delete supplier"
                            className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]"
                            disabled={referenced}
                            onClick={() => setDeleteTarget(supplier)}
                            title={
                              referenced
                                ? 'In use by items or purchase orders. Deactivate it instead.'
                                : 'Delete supplier'
                            }
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen ? (
        <ModalShell
          onClose={() => setIsModalOpen(false)}
          title={
            <span className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[var(--accent)]" />
              {editingId ? 'Edit Supplier' : 'Add Supplier'}
            </span>
          }
          footer={
            <>
              <button className={modalSecondaryButtonClass} onClick={() => setIsModalOpen(false)} type="button">
                Cancel
              </button>
              <button
                className={modalPrimaryButtonClass}
                disabled={!draft.name.trim() || isSubmitting}
                form="supplier-form"
                type="submit"
              >
                {isSubmitting ? 'Saving…' : editingId ? 'Save Changes' : 'Add Supplier'}
              </button>
            </>
          }
        >
          <form className="space-y-4" id="supplier-form" onSubmit={handleSubmit}>
            <ModalField label="Name" required>
              <input
                autoFocus
                className={modalInputClass}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Supplier name"
                value={draft.name}
              />
            </ModalField>
            <ModalField label="Contact name">
              <input
                className={modalInputClass}
                onChange={(e) => setDraft((d) => ({ ...d, contactName: e.target.value }))}
                placeholder="Primary contact"
                value={draft.contactName}
              />
            </ModalField>
            <div className="grid grid-cols-2 gap-3">
              <ModalField label="Phone">
                <input
                  className={modalInputClass}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                  placeholder="Phone"
                  value={draft.phone}
                />
              </ModalField>
              <ModalField label="Email">
                <input
                  className={modalInputClass}
                  onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                  placeholder="name@example.com"
                  type="email"
                  value={draft.email}
                />
              </ModalField>
            </div>
            <ModalField label="Notes">
              <textarea
                className={modalTextareaClass}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Optional notes"
                rows={3}
                value={draft.notes}
              />
            </ModalField>
            {editingId ? (
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--foreground)]">
                <input
                  checked={draft.isActive}
                  className="rounded border-[var(--border)]"
                  onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
                  type="checkbox"
                />
                Active
              </label>
            ) : null}
          </form>
        </ModalShell>
      ) : null}

      {deleteTarget ? (
        <ModalShell
          maxWidthClass="max-w-md"
          onClose={() => setDeleteTarget(null)}
          title="Delete Supplier"
          footer={
            <>
              <button className={modalSecondaryButtonClass} onClick={() => setDeleteTarget(null)} type="button">
                Cancel
              </button>
              <button
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
                onClick={() => void handleDelete()}
                type="button"
              >
                Delete Supplier
              </button>
            </>
          }
        >
          <p className="text-sm text-[var(--muted)]">
            Delete <span className="font-semibold text-[var(--foreground)]">{deleteTarget.name}</span>? This cannot be
            undone.
          </p>
        </ModalShell>
      ) : null}
    </section>
  )
}
