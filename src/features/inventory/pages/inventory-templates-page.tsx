import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, LayoutTemplate, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  deleteTransactionTemplate,
  listInventoryItems,
  listTransactionTemplates,
  saveTransactionTemplate,
  type InventoryItem,
  type TransactionTemplateDraft,
  type TransactionTemplateSummary,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

function ModalField({ label, children, required }: { children: ReactNode; label: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition'
const selectClass = inputClass

type FormLine = { inventoryItemId: string; quantity: string; key: string }

function newLineKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function InventoryTemplatesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_inventory')

  const [templates, setTemplates] = useState<TransactionTemplateSummary[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formActive, setFormActive] = useState(true)
  const [formLines, setFormLines] = useState<FormLine[]>([])
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tpls, items] = await Promise.all([
        listTransactionTemplates(),
        listInventoryItems({ includeInactive: true }),
      ])
      setTemplates(tpls)
      setInventoryItems(items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })))
    } catch {
      setError('Unable to load templates.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const itemOptions = useMemo(() => inventoryItems, [inventoryItems])

  function openCreate() {
    setEditingId(null)
    setFormName('')
    setFormDescription('')
    setFormActive(true)
    setFormLines([{ inventoryItemId: '', quantity: '1', key: newLineKey() }])
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(t: TransactionTemplateSummary) {
    setEditingId(t.id)
    setFormName(t.name)
    setFormDescription(t.description)
    setFormActive(t.isActive)
    setFormLines(
      t.items.length > 0
        ? t.items.map((it) => ({
            inventoryItemId: String(it.inventoryItemId),
            quantity: String(it.quantity),
            key: newLineKey(),
          }))
        : [{ inventoryItemId: '', quantity: '1', key: newLineKey() }],
    )
    setFormError(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
    setFormError(null)
  }

  function addLine() {
    setFormLines((prev) => [...prev, { inventoryItemId: '', quantity: '1', key: newLineKey() }])
  }

  function removeLine(key: string) {
    setFormLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canManage) return
    const name = formName.trim()
    if (!name) {
      setFormError('Name is required.')
      return
    }

    const items: TransactionTemplateDraft['items'] = []
    for (const line of formLines) {
      if (!line.inventoryItemId) continue
      const q = Number(line.quantity)
      if (!Number.isFinite(q) || q <= 0) {
        setFormError('Each line needs a positive quantity.')
        return
      }
      items.push({ inventoryItemId: Number(line.inventoryItemId), quantity: q })
    }
    if (items.length === 0) {
      setFormError('Add at least one inventory item.')
      return
    }

    setFormSubmitting(true)
    setFormError(null)
    try {
      await saveTransactionTemplate({
        description: formDescription,
        id: editingId ?? undefined,
        isActive: formActive,
        items,
        name,
      })
      closeModal()
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save template.')
    } finally {
      setFormSubmitting(false)
    }
  }

  async function handleDelete(id: number) {
    if (!canManage) return
    try {
      await deleteTransactionTemplate(id)
      setDeleteConfirmId(null)
      await load()
    } catch {
      setError('Unable to delete template.')
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <LayoutTemplate className="h-6 w-6 text-[var(--accent)]" />
            Sale stock-out templates
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Define reusable sets of inventory items and quantities. When recording a SALE transaction, you can apply a
            template to create linked stock-out movements automatically.
          </p>
        </div>
        {canManage ? (
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90"
            onClick={openCreate}
            type="button"
          >
            <Plus className="h-4 w-4" />
            New template
          </button>
        ) : null}
      </header>

      {!canManage ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          You need the <strong>Manage inventory</strong> permission to edit templates.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading…</div>
      ) : templates.length === 0 ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          No templates yet. {canManage ? 'Create one to speed up sale stock-outs.' : ''}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--background)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Items</th>
                <th className="w-0 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-[var(--muted)]">{t.description || '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        'inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        t.isActive ? 'bg-emerald-500/15 text-emerald-600' : 'bg-gray-500/15 text-gray-500',
                      ].join(' ')}
                    >
                      {t.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{t.items.length}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canManage ? (
                        <>
                          <button
                            aria-label="Edit template"
                            className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                            onClick={() => openEdit(t)}
                            type="button"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {deleteConfirmId === t.id ? (
                            <span className="flex items-center gap-1">
                              <button
                                className="rounded bg-red-500 px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
                                onClick={() => void handleDelete(t.id)}
                                type="button"
                              >
                                Confirm
                              </button>
                              <button
                                className="rounded border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--background)]"
                                onClick={() => setDeleteConfirmId(null)}
                                type="button"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              aria-label="Delete template"
                              className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500"
                              onClick={() => setDeleteConfirmId(t.id)}
                              type="button"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">
                {editingId ? 'Edit template' : 'New template'}
              </h2>
              <button
                className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                onClick={closeModal}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
              <div className="space-y-4 overflow-y-auto p-5">
                <ModalField label="Name" required>
                  <input className={inputClass} onChange={(e) => setFormName(e.target.value)} value={formName} />
                </ModalField>
                <ModalField label="Description">
                  <textarea
                    className="min-h-[72px] w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    onChange={(e) => setFormDescription(e.target.value)}
                    rows={3}
                    value={formDescription}
                  />
                </ModalField>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                  <input
                    checked={formActive}
                    className="rounded border-gray-300"
                    onChange={(e) => setFormActive(e.target.checked)}
                    type="checkbox"
                  />
                  Active (shown in transaction form)
                </label>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Inventory lines</span>
                    <button
                      className="text-xs font-medium text-blue-600 hover:underline"
                      onClick={addLine}
                      type="button"
                    >
                      + Add line
                    </button>
                  </div>
                  <div className="space-y-2">
                    {formLines.map((line) => {
                      const inv = itemOptions.find((i) => String(i.id) === line.inventoryItemId)
                      return (
                        <div className="flex flex-wrap items-end gap-2" key={line.key}>
                          <div className="min-w-0 flex-1">
                            <select
                              className={selectClass}
                              onChange={(e) => {
                                const v = e.target.value
                                setFormLines((prev) =>
                                  prev.map((l) => (l.key === line.key ? { ...l, inventoryItemId: v } : l)),
                                )
                              }}
                              value={line.inventoryItemId}
                            >
                              <option value="">Select item…</option>
                              {itemOptions.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.name}
                                  {!i.isActive ? ' (inactive)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="w-24">
                            <input
                              className={inputClass}
                              min="0.001"
                              onChange={(e) => {
                                const v = e.target.value
                                setFormLines((prev) =>
                                  prev.map((l) => (l.key === line.key ? { ...l, quantity: v } : l)),
                                )
                              }}
                              placeholder="Qty"
                              step="any"
                              type="number"
                            />
                          </div>
                          <button
                            aria-label="Remove line"
                            className="mb-0.5 rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-40"
                            disabled={formLines.length <= 1}
                            onClick={() => removeLine(line.key)}
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          {inv && !inv.isActive ? (
                            <p className="flex w-full items-center gap-1 text-xs text-amber-700">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              Inactive item — it will be skipped when applying this template to a sale if still
                              inactive.
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-5 py-4">
                <button
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  onClick={closeModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={formSubmitting || !canManage}
                  type="submit"
                >
                  {formSubmitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
