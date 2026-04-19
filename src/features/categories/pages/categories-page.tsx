import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Plus, Save, Tags, Trash2, X } from 'lucide-react'
import {
  createTransactionType,
  deleteTransactionType,
  listCategories,
  listTransactionTypes,
  saveCategory,
  type Category,
  type TransactionType,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

type PageState = {
  categories: Category[]
  transactionTypes: TransactionType[]
}

export function CategoriesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_master_data')

  const [state, setState] = useState<PageState>({ categories: [], transactionTypes: [] })
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [collapsedTypes, setCollapsedTypes] = useState<Set<number>>(new Set())

  const [typeModalOpen, setTypeModalOpen] = useState(false)
  const [typeCode, setTypeCode] = useState('')
  const [typeLabel, setTypeLabel] = useState('')
  const [typeSubmitting, setTypeSubmitting] = useState(false)

  const [categoryModalTypeId, setCategoryModalTypeId] = useState<number | null>(null)
  const [categoryLabel, setCategoryLabel] = useState('')
  const [categoryModalLoadable, setCategoryModalLoadable] = useState(true)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const load = useCallback(async () => {
    const [categories, transactionTypes] = await Promise.all([
      listCategories(false),
      listTransactionTypes(),
    ])
    setState({ categories, transactionTypes })
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const grouped = useMemo(
    () =>
      state.transactionTypes.map((type) => ({
        categories: state.categories.filter((c) => c.transactionTypeId === type.id),
        type,
      })),
    [state],
  )

  function toggleType(id: number) {
    setCollapsedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleCreateType(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!typeCode.trim() || !typeLabel.trim()) return
    setTypeSubmitting(true)
    await createTransactionType({ code: typeCode.trim(), label: typeLabel.trim() })
    setTypeCode('')
    setTypeLabel('')
    setTypeModalOpen(false)
    setTypeSubmitting(false)
    await load()
  }

  async function handleCreateCategory(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (categoryModalTypeId == null || !categoryLabel.trim()) return
    const modalType = state.transactionTypes.find((t) => t.id === categoryModalTypeId)
    await saveCategory({
      isArchived: false,
      isLoadable: modalType?.code === 'SALE' ? categoryModalLoadable : false,
      label: categoryLabel.trim(),
      transactionTypeId: categoryModalTypeId,
    })
    setCategoryLabel('')
    setCategoryModalLoadable(true)
    setCategoryModalTypeId(null)
    await load()
  }

  async function handleDeleteType(id: number) {
    await deleteTransactionType(id)
    setConfirmDeleteId(null)
    await load()
  }

  async function handleSave(category: Category) {
    if (!canManage) return
    setSavingId(category.id)
    await saveCategory({
      id: category.id,
      isArchived: category.isArchived,
      isLoadable: category.isLoadable,
      label: category.label,
      transactionTypeId: category.transactionTypeId,
    })
    await load()
    setSavingId(null)
  }

  function updateCategory(id: number, patch: Partial<Category>) {
    setState((prev) => ({
      ...prev,
      categories: prev.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
  }

  const categoryModalType = state.transactionTypes.find((t) => t.id === categoryModalTypeId)

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Categories</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Manage transaction categories grouped by type
          </p>
        </div>
        {canManage && (
          <button
            className="flex h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90"
            onClick={() => setTypeModalOpen(true)}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add Transaction Type
          </button>
        )}
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading…</div>
      ) : (
        <div className="space-y-3">
          {grouped.map(({ type, categories }) => {
            const isCollapsed = collapsedTypes.has(type.id)
            return (
              <div
                key={type.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden"
              >
                <div className="flex items-center justify-between px-5 py-3.5">
                  <button
                    className="flex flex-1 items-center gap-2.5 text-left transition hover:opacity-80"
                    onClick={() => toggleType(type.id)}
                    type="button"
                  >
                    <Tags className="h-4 w-4 text-[var(--accent)]" />
                    <span className="text-sm font-semibold uppercase tracking-wide">{type.code}</span>
                    <span className="text-xs text-[var(--muted)]">— {type.label}</span>
                    <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--accent)]">
                      {categories.length}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-[var(--muted)] transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                    />
                  </button>
                  {canManage && !type.isSystem && (
                    confirmDeleteId === type.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-600"
                          onClick={() => { void handleDeleteType(type.id) }}
                          type="button"
                        >
                          Confirm
                        </button>
                        <button
                          className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition hover:bg-[var(--background)]"
                          onClick={() => setConfirmDeleteId(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        aria-label="Delete transaction type"
                        className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                        onClick={() => setConfirmDeleteId(type.id)}
                        title="Delete transaction type"
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )
                  )}
                </div>

                {!isCollapsed && (
                  <div className="border-t border-[var(--border)]">
                    {categories.length === 0 ? (
                      <p className="px-5 py-6 text-center text-sm text-[var(--muted)]">
                        No categories for this type.
                      </p>
                    ) : (
                      <div className="divide-y divide-[var(--border)]">
                        {categories.map((category) => (
                          <div
                            key={category.id}
                            className="flex flex-wrap items-center gap-3 px-5 py-2.5"
                          >
                            <div className="flex-1 min-w-0">
                              {canManage ? (
                                <input
                                  className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:border-[var(--accent)] focus:outline-none"
                                  onChange={(e) => updateCategory(category.id, { label: e.target.value })}
                                  value={category.label}
                                />
                              ) : (
                                <p className="text-sm font-medium">{category.label}</p>
                              )}
                            </div>
                            {type.code === 'SALE' && (
                              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
                                <input
                                  checked={category.isLoadable}
                                  className="rounded border-[var(--border)]"
                                  disabled={!canManage}
                                  onChange={(e) =>
                                    updateCategory(category.id, { isLoadable: e.target.checked })
                                  }
                                  type="checkbox"
                                />
                                Loadable
                              </label>
                            )}
                            {canManage && (
                              <button
                                className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-3 text-xs font-medium transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)] disabled:opacity-50"
                                disabled={savingId === category.id}
                                onClick={() => { void handleSave(category) }}
                                type="button"
                              >
                                <Save className="h-3 w-3" />
                                {savingId === category.id ? 'Saving…' : 'Save'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {canManage && (
                      <div className="border-t border-[var(--border)] px-5 py-3">
                        <button
                          className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] transition hover:opacity-80"
                          onClick={() => {
                            setCategoryModalTypeId(type.id)
                            setCategoryLabel('')
                            setCategoryModalLoadable(type.code === 'SALE')
                          }}
                          type="button"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Category
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add Transaction Type Modal */}
      {typeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-base font-semibold">Add Transaction Type</h2>
              <button
                className="rounded p-1 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={() => setTypeModalOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="space-y-4 p-5" onSubmit={handleCreateType}>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Code <span className="text-red-500">*</span>
                </label>
                <input
                  autoFocus
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm uppercase placeholder:normal-case placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setTypeCode(e.target.value)}
                  placeholder="e.g. SALE, EXPENSE"
                  value={typeCode}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Label <span className="text-red-500">*</span>
                </label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setTypeLabel(e.target.value)}
                  placeholder="e.g. Sale, Expense"
                  value={typeLabel}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="h-9 rounded-md border border-[var(--border)] px-4 text-sm font-medium transition hover:bg-[var(--background)]"
                  onClick={() => setTypeModalOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  disabled={!typeCode.trim() || !typeLabel.trim() || typeSubmitting}
                  type="submit"
                >
                  {typeSubmitting ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Category Modal */}
      {categoryModalTypeId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-base font-semibold">
                Add Category — {categoryModalType?.code}
              </h2>
              <button
                className="rounded p-1 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={() => setCategoryModalTypeId(null)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="space-y-4 p-5" onSubmit={handleCreateCategory}>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Category Name <span className="text-red-500">*</span>
                </label>
                <input
                  autoFocus
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setCategoryLabel(e.target.value)}
                  placeholder="e.g. Food, Supplies, Rent"
                  value={categoryLabel}
                />
              </div>

              {categoryModalType?.code === 'SALE' ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--foreground)]">
                  <input
                    checked={categoryModalLoadable}
                    className="rounded border-[var(--border)]"
                    onChange={(e) => setCategoryModalLoadable(e.target.checked)}
                    type="checkbox"
                  />
                  Counts toward loyalty loads
                </label>
              ) : null}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="h-9 rounded-md border border-[var(--border)] px-4 text-sm font-medium transition hover:bg-[var(--background)]"
                  onClick={() => setCategoryModalTypeId(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  disabled={!categoryLabel.trim()}
                  type="submit"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
