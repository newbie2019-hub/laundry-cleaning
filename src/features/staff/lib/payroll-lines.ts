import type {
  PayrollAdjustmentDraft,
  RecurringAdjustment,
} from '../../../lib/db/repository'
import {
  type AdjustmentKind,
  categoryLabel,
  overtimeHourlyRate,
  roundMoney,
} from './attendance'

/**
 * One editable earning/deduction line in a payroll dialog. Overtime lines are a
 * special case: their amount is derived from `hours × rate` rather than typed
 * directly, so those two fields drive the amount when `category === 'overtime'`.
 */
export type AdjRow = {
  category: string
  /** Typed amount for flat lines; ignored for overtime (see effectiveAmount). */
  flatAmount: number
  hours: number
  key: string
  kind: AdjustmentKind
  label: string
  rate: number
  recurringId: number | null
  source: 'manual' | 'recurring' | 'overtime'
}

let keySeq = 0
export function newRowKey(): string {
  keySeq += 1
  return `adj-${Date.now()}-${keySeq}`
}

export function newAdjRow(kind: AdjustmentKind = 'deduction', category = 'other'): AdjRow {
  return {
    category,
    flatAmount: 0,
    hours: 0,
    key: newRowKey(),
    kind,
    label: '',
    rate: 0,
    recurringId: null,
    source: 'manual',
  }
}

/** A fresh overtime earning row, pre-priced from the staff rate + settings. */
export function newOvertimeRow(
  defaultRate: number,
  standardDayHours: number,
  overtimeMultiplier: number,
): AdjRow {
  return {
    category: 'overtime',
    flatAmount: 0,
    hours: 0,
    key: newRowKey(),
    kind: 'earning',
    label: 'Overtime',
    rate: overtimeHourlyRate(defaultRate, standardDayHours, overtimeMultiplier),
    recurringId: null,
    source: 'overtime',
  }
}

/** Seed editable rows from a staff member's active recurring items. */
export function rowsFromRecurring(items: RecurringAdjustment[]): AdjRow[] {
  return items.map((it) => {
    // For a balance-tracked item (e.g. a loan), never deduct more than what is
    // still owed this period.
    const amount =
      it.hasBalance && it.remainingBalance != null
        ? roundMoney(Math.min(it.amount, it.remainingBalance))
        : it.amount
    return {
      category: it.category,
      flatAmount: amount,
      hours: 0,
      key: newRowKey(),
      kind: it.kind,
      label: it.label,
      rate: 0,
      recurringId: it.id,
      source: 'recurring',
    }
  })
}

/** Amount a row actually contributes (overtime rows are hours × rate). */
export function effectiveAmount(row: AdjRow): number {
  if (row.category === 'overtime') {
    return roundMoney((row.hours || 0) * (row.rate || 0))
  }
  return roundMoney(row.flatAmount || 0)
}

export function rowsTotals(rows: AdjRow[]): { deductionTotal: number; earningTotal: number } {
  let earningTotal = 0
  let deductionTotal = 0
  for (const row of rows) {
    if (!hasContent(row)) continue
    const amt = effectiveAmount(row)
    if (row.kind === 'earning') earningTotal += amt
    else deductionTotal += amt
  }
  return { deductionTotal: roundMoney(deductionTotal), earningTotal: roundMoney(earningTotal) }
}

/** A row counts once it has a label (or a computed amount, for overtime). */
export function hasContent(row: AdjRow): boolean {
  return row.label.trim().length > 0 || effectiveAmount(row) > 0
}

export function rowsToDrafts(rows: AdjRow[]): PayrollAdjustmentDraft[] {
  const drafts: PayrollAdjustmentDraft[] = []
  for (const row of rows) {
    if (!hasContent(row)) continue
    const amount = effectiveAmount(row)
    const isOvertime = row.category === 'overtime'
    drafts.push({
      amount,
      category: row.category,
      kind: row.kind,
      label: row.label.trim() || categoryLabel(row.category),
      quantity: isOvertime ? row.hours || 0 : null,
      rate: isOvertime ? row.rate || 0 : null,
      recurringId: row.recurringId,
      source: row.source,
      taxable: false,
    })
  }
  return drafts
}

/** True if any row has a label typed but a zero/invalid amount. */
export function firstInvalidRow(rows: AdjRow[]): AdjRow | null {
  for (const row of rows) {
    if (!row.label.trim() && effectiveAmount(row) === 0) continue
    const amt = effectiveAmount(row)
    if (!Number.isFinite(amt) || amt < 0) return row
  }
  return null
}
