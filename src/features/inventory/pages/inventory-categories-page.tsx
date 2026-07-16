import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Save, Tags, Trash2, X } from 'lucide-react'
import {
  deleteInventoryCategory,
  listInventoryCategories,
  saveInventoryCategory,
  type InventoryCategory,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

type EditableCategory = InventoryCategory & { draftLabel: string }
type DeleteCategoryState = { id: number; relatedRecordsCount: number; transferCategoryId: number | null }

export function InventoryCategoriesPage() {
  const { activeBusiness, hasPermission } = useAuth()
  const canManage = hasPermission('manage_inventory')

  const [categories, setCategories] = useState<EditableCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formCode, setFormCode] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [deleteCategoryState, setDeleteCategoryState] = useState<DeleteCategoryState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latestLoadRequestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++latestLoadRequestRef.current
    setLoading(true)
    setError(null)
    try {
      const rows = await listInventoryCategories(showInactive)
      if (requestId !== latestLoadRequestRef.current) {
        return
      }
      setCategories(rows.map((row) => ({ ...row, draftLabel: row.label })))
    } catch {
      if (requestId !== latestLoadRequestRef.current) {
        return
      }
      setError('Unable to load inventory categories.')
    } finally {
      if (requestId === latestLoadRequestRef.current) {
        setLoading(false)
      }
    }
  }, [activeBusiness, showInactive])

  useEffect(() => {
    void load()
  }, [load])

  const visibleCategories = useMemo(
    () => (showInactive ? categories : categories.filter((category) => category.isActive)),
    [categories, showInactive],
  )

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!canManage) return
    if (!formCode.trim() || !formLabel.trim()) return
    setIsSubmitting(true)
    setError(null)
    try {
      await saveInventoryCategory({
        code: formCode,
        isActive: true,
        label: formLabel.trim(),
        sortOrder: categories.length,
      })
      setFormCode('')
      setFormLabel('')
      setIsModalOpen(false)
      await load()
    } catch {
      setError('Unable to create category. Make sure the code is unique.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function updateDraft(id: number, patch: Partial<EditableCategory>) {
    setCategories((prev) => prev.map((category) => (category.id === id ? { ...category, ...patch } : category)))
  }

  async function handleSave(category: EditableCategory) {
    if (!canManage) return
    setSavingId(category.id)
    setError(null)
    try {
      await saveInventoryCategory(
        {
          code: category.code,
          isActive: category.isActive,
          label: category.draftLabel.trim(),
          sortOrder: category.sortOrder,
        },
        category.id,
      )
      await load()
    } catch {
      setError('Unable to save category changes.')
    } finally {
      setSavingId(null)
    }
  }

  async function handleDelete() {
    if (!canManage) return
    if (!deleteCategoryState) return
    const needsTransfer = deleteCategoryState.relatedRecordsCount > 0
    if (needsTransfer && !deleteCategoryState.transferCategoryId) return
    setError(null)
    try {
      await deleteInventoryCategory(
        deleteCategoryState.id,
        deleteCategoryState.transferCategoryId ?? undefined,
      )
      setDeleteCategoryState(null)
      await load()
    } catch {
      setError('Unable to delete category.')
    }
  }

  const transferTargets = useMemo(
    () =>
      deleteCategoryState == null
        ? []
        : categories.filter((category) => category.id !== deleteCategoryState.id && category.isActive),
    [categories, deleteCategoryState],
  )

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inventory Categories</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Manage inventory category options for item setup and summaries.
          </p>
        </div>
        {canManage ? (
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90"
            onClick={() => setIsModalOpen(true)}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add Category
          </button>
        ) : null}
      </header>

      {!canManage ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          You need the <strong>Manage inventory</strong> permission to edit inventory categories.
        </p>
      ) : null}

      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--muted)]">
        <input
          checked={showInactive}
          className="rounded border-[var(--border)]"
          onChange={(e) => setShowInactive(e.target.checked)}
          type="checkbox"
        />
        Show inactive categories
      </label>

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading…</div>
      ) : visibleCategories.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-10 text-center text-sm text-[var(--muted)]">
          No categories found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--background)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Label</th>
                <th className="px-4 py-3 text-center">Related</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Type</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {visibleCategories.map((category) => (
                <tr key={category.id}>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--accent)]">
                      <Tags className="h-3.5 w-3.5" />
                      {category.code}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <input
                        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:border-[var(--accent)] focus:outline-none"
                        onChange={(e) => updateDraft(category.id, { draftLabel: e.target.value })}
                        value={category.draftLabel}
                      />
                    ) : (
                      <span className="font-medium">{category.label}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="rounded-full bg-gray-500/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
                      {category.relatedRecordsCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {canManage ? (
                      <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
                        <input
                          checked={category.isActive}
                          className="rounded border-[var(--border)]"
                          onChange={(e) => updateDraft(category.id, { isActive: e.target.checked })}
                          type="checkbox"
                        />
                        Active
                      </label>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">{category.isActive ? 'Active' : 'Inactive'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs text-[var(--muted)]">{category.isSystem ? 'System' : 'Custom'}</span>
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2.5 text-xs font-medium transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)] disabled:opacity-50"
                          disabled={savingId === category.id}
                          onClick={() => void handleSave(category)}
                          type="button"
                        >
                          <Save className="h-3.5 w-3.5" />
                          {savingId === category.id ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          aria-label="Delete category"
                          className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500"
                          onClick={() =>
                            setDeleteCategoryState({
                              id: category.id,
                              relatedRecordsCount: category.relatedRecordsCount,
                              transferCategoryId: null,
                            })
                          }
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Pencil className="h-4 w-4 text-[var(--accent)]" />
                Add Inventory Category
              </h2>
              <button
                className="rounded p-1 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={() => setIsModalOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form className="space-y-4 p-5" onSubmit={handleCreate}>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Code <span className="text-red-500">*</span>
                </label>
                <input
                  autoFocus
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormCode(e.target.value)}
                  placeholder="e.g. detergent_chemicals"
                  value={formCode}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Label <span className="text-red-500">*</span>
                </label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder="e.g. Detergent & Chemicals"
                  value={formLabel}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="h-9 rounded-md border border-[var(--border)] px-4 text-sm font-medium transition hover:bg-[var(--background)]"
                  onClick={() => setIsModalOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  disabled={!formCode.trim() || !formLabel.trim() || isSubmitting}
                  type="submit"
                >
                  {isSubmitting ? 'Saving…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteCategoryState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-base font-semibold">Delete Inventory Category</h2>
              <button
                className="rounded p-1 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={() => setDeleteCategoryState(null)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-[var(--muted)]">
                This category has{' '}
                <span className="font-semibold text-[var(--foreground)]">
                  {deleteCategoryState.relatedRecordsCount}
                </span>{' '}
                related inventory item{deleteCategoryState.relatedRecordsCount === 1 ? '' : 's'}.
              </p>

              {deleteCategoryState.relatedRecordsCount > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                    Transfer Related Items To
                  </label>
                  <select
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:border-[var(--accent)] focus:outline-none"
                    onChange={(e) =>
                      setDeleteCategoryState((prev) =>
                        prev
                          ? {
                              ...prev,
                              transferCategoryId: e.target.value ? Number(e.target.value) : null,
                            }
                          : prev,
                      )
                    }
                    value={deleteCategoryState.transferCategoryId ?? ''}
                  >
                    <option value="">Select replacement category…</option>
                    {transferTargets.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  className="h-9 rounded-md border border-[var(--border)] px-4 text-sm font-medium transition hover:bg-[var(--background)]"
                  onClick={() => setDeleteCategoryState(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 rounded-md bg-red-600 px-4 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                  disabled={deleteCategoryState.relatedRecordsCount > 0 && !deleteCategoryState.transferCategoryId}
                  onClick={() => {
                    void handleDelete()
                  }}
                  type="button"
                >
                  Delete Category
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
