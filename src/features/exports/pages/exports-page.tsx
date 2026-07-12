import { format, startOfMonth } from 'date-fns'
import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { MonthPicker } from '../../../components/month-picker'
import { ColumnSelectDialog } from '../components/column-select-dialog'
import { DateRangeFields } from '../components/date-range-fields'
import {
  EXPORT_DESCRIPTORS,
  EXPORT_GROUPS,
  type ExportDescriptor,
  type ExportFilters,
} from '../lib/export-registry'

function defaultFilters(descriptor: ExportDescriptor): ExportFilters {
  const today = format(new Date(), 'yyyy-MM-dd')
  switch (descriptor.filter) {
    case 'dateRange':
      return { dateFrom: format(startOfMonth(new Date()), 'yyyy-MM-dd'), dateTo: today }
    case 'month':
      return { monthKey: format(new Date(), 'yyyy-MM') }
    case 'includeArchived':
      return { includeArchived: false }
  }
}

const buttonClass =
  'inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)]/50 disabled:cursor-not-allowed disabled:opacity-50'

export function ExportsPage() {
  const [filters, setFilters] = useState<Record<string, ExportFilters>>(() =>
    Object.fromEntries(EXPORT_DESCRIPTORS.map((d) => [d.key, defaultFilters(d)])),
  )
  // Remembered column selection per dataset; defaults to every column.
  const [columns, setColumns] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      EXPORT_DESCRIPTORS.filter((d) => d.columns).map((d) => [
        d.key,
        d.columns!().map((c) => c.key),
      ]),
    ),
  )
  const [exportingKey, setExportingKey] = useState<string | null>(null)
  // Descriptor whose column-selection dialog is currently open, if any.
  const [dialogKey, setDialogKey] = useState<string | null>(null)

  function updateFilter(key: string, patch: Partial<ExportFilters>) {
    setFilters((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  async function runExport(descriptor: ExportDescriptor, columnKeys?: string[]) {
    setExportingKey(descriptor.key)
    try {
      await descriptor.run(filters[descriptor.key], columnKeys)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Something went wrong.'
      toast.error('Export failed', { description: message })
    } finally {
      setExportingKey(null)
    }
  }

  function handleExportClick(descriptor: ExportDescriptor) {
    // Tabular datasets open the column picker first; others export straight away.
    if (descriptor.columns) {
      setDialogKey(descriptor.key)
    } else {
      void runExport(descriptor)
    }
  }

  const dialogDescriptor = dialogKey
    ? EXPORT_DESCRIPTORS.find((d) => d.key === dialogKey)
    : undefined

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Export</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Choose a dataset and filter, then export a pre-formatted Excel workbook. For table
          datasets you'll pick the columns to include, then choose where to save the file.
        </p>
      </header>

      {EXPORT_GROUPS.map((group) => {
        const items = EXPORT_DESCRIPTORS.filter((d) => d.group === group)
        if (items.length === 0) return null
        return (
          <div key={group} className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {group}
            </h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {items.map((descriptor) => (
                <ExportCard
                  key={descriptor.key}
                  descriptor={descriptor}
                  filters={filters[descriptor.key]}
                  busy={exportingKey === descriptor.key}
                  disabled={exportingKey !== null}
                  onFilterChange={(patch) => updateFilter(descriptor.key, patch)}
                  onExport={() => handleExportClick(descriptor)}
                />
              ))}
            </div>
          </div>
        )
      })}

      {dialogDescriptor && dialogDescriptor.columns && (
        <ColumnSelectDialog
          title={dialogDescriptor.label}
          columns={dialogDescriptor.columns()}
          initialSelected={columns[dialogDescriptor.key] ?? []}
          onClose={() => setDialogKey(null)}
          onConfirm={(selectedKeys) => {
            setColumns((prev) => ({ ...prev, [dialogDescriptor.key]: selectedKeys }))
            setDialogKey(null)
            void runExport(dialogDescriptor, selectedKeys)
          }}
        />
      )}
    </section>
  )
}

function ExportCard({
  descriptor,
  filters,
  busy,
  disabled,
  onFilterChange,
  onExport,
}: {
  descriptor: ExportDescriptor
  filters: ExportFilters
  busy: boolean
  disabled: boolean
  onFilterChange: (patch: Partial<ExportFilters>) => void
  onExport: () => void
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div>
        <h3 className="text-sm font-semibold">{descriptor.label}</h3>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{descriptor.description}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {descriptor.filter === 'dateRange' && (
            <DateRangeFields
              from={filters.dateFrom ?? ''}
              to={filters.dateTo ?? ''}
              onChange={({ from, to }) => onFilterChange({ dateFrom: from, dateTo: to })}
            />
          )}
          {descriptor.filter === 'month' && (
            <MonthPicker
              value={filters.monthKey ?? format(new Date(), 'yyyy-MM')}
              onChange={(monthKey) => onFilterChange({ monthKey })}
            />
          )}
          {descriptor.filter === 'includeArchived' && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--border)]"
                checked={filters.includeArchived ?? false}
                onChange={(e) => onFilterChange({ includeArchived: e.target.checked })}
              />
              Include archived
            </label>
          )}
        </div>

        <button type="button" className={buttonClass} onClick={onExport} disabled={disabled}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Exporting…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Export XLSX
            </>
          )}
        </button>
      </div>
    </div>
  )
}
