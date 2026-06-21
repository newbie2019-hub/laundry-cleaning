import { AlertTriangle, Check, Info, X } from 'lucide-react'
import type { CreatePreview, ValidationIssue } from '../types'
import { formatCurrency } from '../../../lib/format'

type Props = {
  preview: CreatePreview
  onConfirm: () => void
  onCancel: () => void
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length) return null
  return (
    <div className="space-y-1 mt-2">
      {issues.map((issue, i) => (
        <div key={i} className={`flex items-start gap-1.5 text-xs rounded-md px-2.5 py-1.5 ${
          issue.severity === 'error'
            ? 'bg-red-500/10 text-red-500'
            : 'bg-amber-500/10 text-amber-600'
        }`}>
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-medium text-right ml-4">{String(value)}</span>
    </div>
  )
}

function CardWrapper({ title, icon, children, issues, onConfirm, onCancel }: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  issues: ValidationIssue[]
  onConfirm: () => void
  onCancel: () => void
}) {
  const hasErrors = issues.some((i) => i.severity === 'error')
  return (
    <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--border)] bg-[var(--panel)]">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</span>
        <Info className="h-3 w-3 text-[var(--muted)] ml-auto" />
      </div>
      <div className="px-3.5 py-3 space-y-0.5">
        {children}
      </div>
      <IssueList issues={issues} />
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-[var(--border)]">
        <button
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          disabled={hasErrors}
          onClick={onConfirm}
          type="button"
        >
          <Check className="h-3 w-3" />
          Confirm & Save
        </button>
        <button
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
          onClick={onCancel}
          type="button"
        >
          <X className="h-3 w-3" />
          Cancel
        </button>
      </div>
    </div>
  )
}

export function PreviewCard({ preview, onConfirm, onCancel }: Props) {
  switch (preview.type) {
    case 'customer':
      return (
        <CardWrapper title="New Customer" issues={preview.issues} onConfirm={onConfirm} onCancel={onCancel}>
          <Row label="Name" value={preview.draft.name} />
          <Row label="Phone" value={preview.draft.phone} />
          <Row label="Email" value={preview.draft.email} />
          <Row label="Company" value={preview.draft.company} />
        </CardWrapper>
      )

    case 'inventory':
      return (
        <CardWrapper title="New Inventory Item" issues={preview.issues} onConfirm={onConfirm} onCancel={onCancel}>
          <Row label="Name" value={preview.draft.name} />
          <Row label="Category" value={preview.draft.category} />
          <Row label="Unit" value={preview.draft.unitLabel} />
          <Row label="Cost / unit" value={formatCurrency(preview.draft.costPerUnit)} />
          <Row label="Selling price" value={formatCurrency(preview.draft.sellingPrice)} />
          <Row label="Initial stock" value={`${preview.draft.initialStock} ${preview.draft.unitLabel}`} />
          <Row label="Min threshold" value={preview.draft.lowStockThreshold} />
          <Row label="Supplier" value={preview.draft.supplier} />
        </CardWrapper>
      )

    case 'sale':
      return (
        <CardWrapper title="New Sale" issues={preview.issues} onConfirm={onConfirm} onCancel={onCancel}>
          <Row label="Date" value={preview.draft.date} />
          <Row label="Customer" value={preview.draft.customerName || '—'} />
          <Row label="Category" value={preview.draft.categoryName} />
          {preview.draft.items.map((item, i) => (
            <div key={i} className="flex justify-between text-xs py-0.5">
              <span className="text-[var(--muted)]">{item.itemName} × {item.quantity}</span>
              <span className="font-medium">{formatCurrency(item.quantity * item.unitPrice)}</span>
            </div>
          ))}
          <div className="border-t border-[var(--border)] pt-1 mt-1">
            <Row label="Total amount" value={formatCurrency(preview.draft.amount)} />
          </div>
          {preview.draft.items.map((item) => (
            !item.stockSufficient && (
              <div key={item.itemId} className="text-xs text-red-500">
                ⚠ {item.itemName}: only {item.currentStock} in stock
              </div>
            )
          ))}
        </CardWrapper>
      )

    case 'expense':
      return (
        <CardWrapper title="New Expense" issues={preview.issues} onConfirm={onConfirm} onCancel={onCancel}>
          <Row label="Date" value={preview.draft.date} />
          <Row label="Category" value={preview.draft.categoryName} />
          <Row label="Amount" value={formatCurrency(preview.draft.amount)} />
          <Row label="Description" value={preview.draft.description} />
        </CardWrapper>
      )

    case 'staff':
      return (
        <CardWrapper title="New Staff Member" issues={preview.issues} onConfirm={onConfirm} onCancel={onCancel}>
          <Row label="Name" value={`${preview.draft.firstName} ${preview.draft.middleName} ${preview.draft.lastName}`.replace(/\s+/g, ' ').trim()} />
          <Row label="Daily rate" value={formatCurrency(preview.draft.defaultRate)} />
          <Row label="Civil status" value={preview.draft.civilStatus} />
          <Row label="Birthdate" value={preview.draft.birthdate} />
          <Row label="Address" value={preview.draft.address} />
        </CardWrapper>
      )

    case 'attendance':
      return (
        <CardWrapper title="Attendance Record" issues={preview.issues} onConfirm={onConfirm} onCancel={onCancel}>
          <Row label="Staff" value={preview.draft.staffName} />
          <Row label="Date" value={preview.draft.date} />
          <Row label="Status" value={preview.draft.status} />
          <Row label="Multiplier" value={preview.draft.multiplier} />
          {preview.draft.rateOverride !== null && (
            <Row label="Rate override" value={formatCurrency(preview.draft.rateOverride)} />
          )}
          <Row label="Day pay" value={formatCurrency(preview.draft.computedPay)} />
          <Row label="Notes" value={preview.draft.notes} />
        </CardWrapper>
      )
  }
}
