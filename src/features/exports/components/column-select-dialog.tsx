import { Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ColumnSpec } from '../lib/xlsx'

/**
 * Modal shown after the user clicks Export for a tabular dataset. Lets them pick
 * which columns to include; confirming triggers the export (and its Save dialog).
 */
export function ColumnSelectDialog({
  title,
  columns,
  initialSelected,
  onConfirm,
  onClose,
}: {
  title: string
  columns: ColumnSpec[]
  initialSelected: string[]
  onConfirm: (selectedKeys: string[]) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string[]>(() =>
    initialSelected.length > 0 ? initialSelected : columns.map((c) => c.key),
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function toggle(key: string, checked: boolean) {
    setSelected((prev) => (checked ? [...prev, key] : prev.filter((k) => k !== key)))
  }

  const allSelected = selected.length === columns.length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Select columns for ${title}`}
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Select columns</h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">
            {selected.length} of {columns.length} selected
          </span>
          <button
            type="button"
            onClick={() => setSelected(allSelected ? [] : columns.map((c) => c.key))}
            className="text-xs font-medium text-[var(--accent)] hover:underline"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>

        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] p-1">
          {columns.map((col) => (
            <label
              key={col.key}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-[var(--background)]"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--border)]"
                checked={selected.includes(col.key)}
                onChange={(e) => toggle(col.key, e.target.checked)}
              />
              {col.header}
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)]/50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => onConfirm(selected)}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>
    </div>
  )
}
