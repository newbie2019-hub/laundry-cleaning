import { Plus, Trash2 } from 'lucide-react'
import { categoriesForKind } from '../lib/attendance'
import {
  type AdjRow,
  effectiveAmount,
  newAdjRow,
  newOvertimeRow,
} from '../lib/payroll-lines'
import { formatCurrency } from '../../../lib/format'

type Theme = 'light' | 'dark'

type Props = {
  overtimeMultiplier: number
  rows: AdjRow[]
  setRows: (updater: (prev: AdjRow[]) => AdjRow[]) => void
  staffDefaultRate: number
  standardDayHours: number
  theme?: Theme
}

const STYLES: Record<Theme, { card: string; input: string; muted: string; select: string }> = {
  light: {
    card: 'border-gray-200 bg-gray-50',
    input:
      'h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition placeholder:text-gray-400',
    muted: 'text-gray-500',
    select:
      'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition',
  },
  dark: {
    card: 'border-[var(--border)] bg-[var(--background)]/60',
    input:
      'h-9 rounded-md border border-[var(--border)] bg-[var(--background)]/80 px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition placeholder:text-[var(--muted)]',
    muted: 'text-[var(--muted)]',
    select:
      'h-9 rounded-md border border-[var(--border)] bg-[var(--background)]/80 px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition',
  },
}

/**
 * Editable list of payroll earnings & deductions. Handles category selection,
 * hours-based overtime (amount = hours × rate), and recurring-item badges.
 * Styling adapts to the host dialog via the `theme` prop.
 */
export function AdjustmentLinesEditor({
  overtimeMultiplier,
  rows,
  setRows,
  staffDefaultRate,
  standardDayHours,
  theme = 'dark',
}: Props) {
  const s = STYLES[theme]

  function patch(key: string, next: Partial<AdjRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)))
  }

  function changeKind(key: string, kind: AdjRow['kind']) {
    // Reset category to the first valid one for the new side.
    const category = categoriesForKind(kind)[0]?.value ?? 'other'
    patch(key, { category, kind, source: 'manual', recurringId: null })
  }

  function changeCategory(row: AdjRow, category: string) {
    if (category === 'overtime') {
      patch(row.key, {
        category,
        source: 'overtime',
        label: row.label.trim() ? row.label : 'Overtime',
        rate: row.rate || Math.round((staffDefaultRate / (standardDayHours || 8)) * overtimeMultiplier * 100) / 100,
      })
    } else {
      patch(row.key, { category, source: row.recurringId ? 'recurring' : 'manual' })
    }
  }

  function remove(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-sm font-medium ${theme === 'light' ? 'text-gray-700' : 'text-[var(--foreground)]'}`}>
          Earnings &amp; deductions
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition ${
              theme === 'light'
                ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]'
            }`}
            onClick={() => setRows((prev) => [...prev, newAdjRow('earning', 'bonus')])}
            type="button"
          >
            <Plus className="h-3 w-3" />
            Earning
          </button>
          <button
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition ${
              theme === 'light'
                ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]'
            }`}
            onClick={() =>
              setRows((prev) => [
                ...prev,
                newOvertimeRow(staffDefaultRate, standardDayHours, overtimeMultiplier),
              ])
            }
            type="button"
          >
            <Plus className="h-3 w-3" />
            Overtime
          </button>
          <button
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition ${
              theme === 'light'
                ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]'
            }`}
            onClick={() => setRows((prev) => [...prev, newAdjRow('deduction', 'other')])}
            type="button"
          >
            <Plus className="h-3 w-3" />
            Deduction
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className={`text-xs ${s.muted}`}>No earnings or deductions added.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const isOvertime = row.category === 'overtime'
            const amount = effectiveAmount(row)
            return (
              <div key={row.key} className={`flex flex-col gap-2 rounded-md border p-2 ${s.card}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Type"
                    className={`${s.select} w-28`}
                    onChange={(e) => changeKind(row.key, e.target.value as AdjRow['kind'])}
                    value={row.kind}
                  >
                    <option value="earning">Earning</option>
                    <option value="deduction">Deduction</option>
                  </select>
                  <select
                    aria-label="Category"
                    className={`${s.select} w-36`}
                    onChange={(e) => changeCategory(row, e.target.value)}
                    value={row.category}
                  >
                    {categoriesForKind(row.kind).map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Label"
                    className={`${s.input} min-w-[9rem] flex-1`}
                    onChange={(e) => patch(row.key, { label: e.target.value })}
                    placeholder="Label"
                    value={row.label}
                  />
                  {!isOvertime ? (
                    <input
                      aria-label="Amount"
                      className={`${s.input} w-28 tabular-nums`}
                      min={0}
                      onChange={(e) => patch(row.key, { flatAmount: Number(e.target.value) || 0 })}
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                      value={row.flatAmount || ''}
                    />
                  ) : null}
                  <button
                    aria-label="Remove line"
                    className={`rounded-md p-2 transition ${
                      theme === 'light'
                        ? 'text-gray-400 hover:bg-red-50 hover:text-red-600'
                        : 'text-[var(--muted)] hover:bg-red-500/10 hover:text-red-400'
                    }`}
                    onClick={() => remove(row.key)}
                    type="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {isOvertime ? (
                  <div className="flex flex-wrap items-center gap-2 pl-1">
                    <label className={`text-xs ${s.muted}`}>Hours</label>
                    <input
                      aria-label="Overtime hours"
                      className={`${s.input} w-24 tabular-nums`}
                      min={0}
                      onChange={(e) => patch(row.key, { hours: Number(e.target.value) || 0 })}
                      placeholder="0"
                      step="0.25"
                      type="number"
                      value={row.hours || ''}
                    />
                    <label className={`text-xs ${s.muted}`}>× rate/hr</label>
                    <input
                      aria-label="Overtime hourly rate"
                      className={`${s.input} w-28 tabular-nums`}
                      min={0}
                      onChange={(e) => patch(row.key, { rate: Number(e.target.value) || 0 })}
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                      value={row.rate || ''}
                    />
                    <span className={`ml-auto text-xs ${s.muted}`}>
                      ={' '}
                      <span className={theme === 'light' ? 'font-medium text-gray-900' : 'font-medium text-[var(--foreground)]'}>
                        {formatCurrency(amount)}
                      </span>
                    </span>
                  </div>
                ) : null}

                {row.recurringId ? (
                  <span
                    className={`w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      theme === 'light' ? 'bg-blue-50 text-blue-600' : 'bg-[var(--accent)]/15 text-[var(--accent)]'
                    }`}
                  >
                    Recurring
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
