import type { ValidationIssue } from '../types'

export function required(
  issues: ValidationIssue[],
  field: string,
  value: string | number | null | undefined,
  label?: string,
): boolean {
  if (value === null || value === undefined || value === '' || (typeof value === 'number' && isNaN(value))) {
    issues.push({ field, message: `${label ?? field} is required.`, severity: 'error' })
    return false
  }
  return true
}

export function minValue(
  issues: ValidationIssue[],
  field: string,
  value: number,
  min: number,
  label?: string,
): boolean {
  if (value < min) {
    issues.push({ field, message: `${label ?? field} must be at least ${min}.`, severity: 'error' })
    return false
  }
  return true
}

export function warnDuplicate(
  issues: ValidationIssue[],
  label: string,
): void {
  issues.push({ field: 'duplicate', message: `A ${label} with this name already exists.`, severity: 'warning' })
}

export function warnExistingAttendance(issues: ValidationIssue[]): void {
  issues.push({ field: 'attendance', message: 'An attendance record already exists for this date. It will be updated.', severity: 'warning' })
}

export function isValidDate(s: string): boolean {
  if (!s) return false
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00'))
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}
