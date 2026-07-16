import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { formatMonthLabel } from '../../../lib/format'
import {
  deleteIncomeShareRule,
  listAvailableMonthKeys,
  listIncomeShareMonth,
  listIncomeShareRules,
  saveIncomeShareMonth,
  saveIncomeShareRule,
  type IncomeShareRule,
  type IncomeShareRuleMonth,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

export function IncomeSharePage() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('edit_income_share')

  const [rules, setRules] = useState<IncomeShareRule[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)

  // Rule modal
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null)
  const [formRuleName, setFormRuleName] = useState('')
  const [formRulePercentage, setFormRulePercentage] = useState('')
  const [formRuleIsActive, setFormRuleIsActive] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Monthly percentages
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [months, setMonths] = useState<string[]>([])
  const [monthlyShares, setMonthlyShares] = useState<IncomeShareRuleMonth[]>([])
  const [monthlyLoading, setMonthlyLoading] = useState(false)
  const [monthlySaving, setMonthlySaving] = useState(false)

  const loadRules = useCallback(async () => {
    const data = await listIncomeShareRules(showInactive)
    setRules(data)
    setLoading(false)
  }, [showInactive])

  const loadMonthly = useCallback(async (monthKey = selectedMonth) => {
    setMonthlyLoading(true)
    const availableMonths = await listAvailableMonthKeys()
    const monthToUse =
      availableMonths.length > 0 && !availableMonths.includes(monthKey)
        ? availableMonths[0]
        : monthKey
    const shares = await listIncomeShareMonth(monthToUse)

    if (monthToUse !== selectedMonth) {
      setSelectedMonth(monthToUse)
    }

    setMonths(Array.from(new Set([monthToUse, ...availableMonths])).sort().reverse())
    setMonthlyShares(shares)
    setMonthlyLoading(false)
  }, [selectedMonth])

  useEffect(() => {
    void loadRules()
  }, [loadRules])

  useEffect(() => {
    void loadMonthly()
  }, [loadMonthly])

  // Rule modal handlers
  function openAddRule() {
    setEditingRuleId(null)
    setFormRuleName('')
    setFormRulePercentage('')
    setFormRuleIsActive(true)
    setFormError(null)
    setIsRuleModalOpen(true)
  }

  function openEditRule(rule: IncomeShareRule) {
    setEditingRuleId(rule.id)
    setFormRuleName(rule.name)
    setFormRulePercentage(String(rule.percentage))
    setFormRuleIsActive(rule.isActive)
    setFormError(null)
    setIsRuleModalOpen(true)
  }

  async function handleRuleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!formRuleName.trim()) {
      setFormError('Name is required.')
      return
    }
    const pct = parseFloat(formRulePercentage)
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setFormError('Percentage must be between 0 and 100.')
      return
    }

    setIsSubmitting(true)
    setFormError(null)
    try {
      await saveIncomeShareRule(
        { isActive: formRuleIsActive, name: formRuleName.trim(), percentage: pct },
        editingRuleId ?? undefined,
      )
      setIsRuleModalOpen(false)
      await loadRules()
      await loadMonthly()
    } catch {
      setFormError('Failed to save. The name may already exist.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDeleteRule(id: number) {
    try {
      await deleteIncomeShareRule(id)
      await loadRules()
      await loadMonthly()
    } catch {
      // silently ignore
    }
  }

  async function handleSaveMonthly() {
    setMonthlySaving(true)
    await saveIncomeShareMonth(
      selectedMonth,
      monthlyShares.map((s) => ({ percentage: s.percentage, ruleId: s.ruleId })),
    )
    await loadMonthly()
    setMonthlySaving(false)
  }

  const percentageTotal = monthlyShares.reduce((sum, s) => sum + s.percentage, 0)

  const inputClass =
    'h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:border-[var(--accent)] focus:outline-none'

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Income Share</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Manage share rules and monthly percentage allocations
        </p>
      </header>

      {/* ── Rules section ── */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Share Rules</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Define stakeholders and their default percentages
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[var(--muted)]">
              <input
                checked={showInactive}
                className="rounded"
                onChange={(e) => setShowInactive(e.target.checked)}
                type="checkbox"
              />
              Show inactive
            </label>
            {canEdit && (
              <button
                className="flex items-center gap-2 rounded-md bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 transition"
                onClick={openAddRule}
                type="button"
              >
                <Plus className="h-4 w-4" />
                Add Rule
              </button>
            )}
          </div>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-[var(--muted)]">Loading…</div>
          ) : rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-[var(--muted)]">
              <p className="text-sm">No share rules defined yet.</p>
              {canEdit && (
                <button
                  className="text-sm text-[var(--accent)] hover:underline"
                  onClick={openAddRule}
                  type="button"
                >
                  Create your first rule
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-3 ${
                    !rule.isActive ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium">{rule.name}</p>
                    <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold text-indigo-500">
                      {rule.percentage}%
                    </span>
                    {!rule.isActive && (
                      <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600 uppercase">
                        Inactive
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button
                        aria-label="Edit rule"
                        className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
                        onClick={() => openEditRule(rule)}
                        type="button"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        aria-label="Delete rule"
                        className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                        onClick={() => { void handleDeleteRule(rule.id) }}
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Monthly percentages section ── */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Monthly Percentages</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Override percentages per month — new months inherit from the previous one
            </p>
          </div>
          <select
            className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:border-[var(--accent)] focus:outline-none"
            onChange={(e) => setSelectedMonth(e.target.value)}
            value={selectedMonth}
          >
            {(months.length > 0 ? months : [selectedMonth]).map((m) => (
              <option key={m} value={m}>{formatMonthLabel(m)}</option>
            ))}
          </select>
        </div>

        <div className="p-5">
          {monthlyLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-[var(--muted)]">Loading…</div>
          ) : monthlyShares.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--muted)]">
              No share rules exist. Create rules above first.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                {monthlyShares.map((item) => (
                  <div
                    key={item.ruleId}
                    className="flex items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-3"
                  >
                    <p className="flex-1 text-sm font-medium">{item.ruleName}</p>
                    <div className="flex items-center gap-2">
                      <input
                        className="h-9 w-24 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-right tabular-nums focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
                        disabled={!canEdit}
                        min="0"
                        max="100"
                        onChange={(e) =>
                          setMonthlyShares((prev) =>
                            prev.map((s) =>
                              s.ruleId === item.ruleId
                                ? { ...s, percentage: Number(e.target.value) }
                                : s,
                            ),
                          )
                        }
                        step="0.01"
                        type="number"
                        value={item.percentage}
                      />
                      <span className="text-sm text-[var(--muted)]">%</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between rounded-lg border border-dashed border-[var(--border)] bg-[var(--background)] px-4 py-3">
                <div className="space-y-0.5">
                  <p className="text-xs text-[var(--muted)]">
                    Total: <span className="font-semibold text-[var(--foreground)]">{percentageTotal.toFixed(2)}%</span>
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Remainder: <span className="font-semibold text-[var(--foreground)]">{(100 - percentageTotal).toFixed(2)}%</span>
                  </p>
                </div>
                {canEdit && (
                  <button
                    className="flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                    disabled={monthlySaving}
                    onClick={() => { void handleSaveMonthly() }}
                    type="button"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {monthlySaving ? 'Saving…' : 'Save Percentages'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Rule modal ── */}
      {isRuleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">
                {editingRuleId ? 'Edit Rule' : 'Add Rule'}
              </h2>
              <button
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                onClick={() => setIsRuleModalOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form className="space-y-4 p-5" onSubmit={handleRuleSubmit}>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  autoFocus
                  className={inputClass}
                  onChange={(e) => setFormRuleName(e.target.value)}
                  placeholder="e.g. Owner, Partner A, Staff Pool"
                  type="text"
                  value={formRuleName}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Default Percentage <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    min="0"
                    max="100"
                    onChange={(e) => setFormRulePercentage(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    type="number"
                    value={formRulePercentage}
                  />
                  <span className="text-sm font-medium text-gray-500">%</span>
                </div>
              </div>

              {editingRuleId && (
                <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700">
                  <input
                    checked={formRuleIsActive}
                    className="rounded"
                    onChange={(e) => setFormRuleIsActive(e.target.checked)}
                    type="checkbox"
                  />
                  Active
                </label>
              )}

              {formError && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  onClick={() => setIsRuleModalOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={isSubmitting}
                  type="submit"
                >
                  {isSubmitting ? 'Saving…' : editingRuleId ? 'Save Changes' : 'Create Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
