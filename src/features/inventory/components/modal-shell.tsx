import type { ReactNode } from 'react'
import { X } from 'lucide-react'

// Theme-aware class constants shared by all inventory dialogs. These use the
// app CSS variables (see src/index.css) so modals render correctly in BOTH
// light and dark mode — never hardcode `bg-white` / `text-gray-*` in a dialog.
export const modalInputClass =
  'h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition placeholder:text-[var(--muted)]'

export const modalSelectClass =
  'h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition'

export const modalTextareaClass =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition placeholder:text-[var(--muted)]'

export const modalPrimaryButtonClass =
  'rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50'

export const modalSecondaryButtonClass =
  'rounded-md border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--background)]'

export function ModalField({
  children,
  dataTutorial,
  hint,
  label,
  required,
}: {
  children: ReactNode
  dataTutorial?: string
  hint?: string
  label: string
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5" data-tutorial={dataTutorial}>
      <label className="text-sm font-medium text-[var(--foreground)]">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  )
}

/**
 * A theme-aware modal frame: fixed overlay, centered solid panel, a header with
 * title + close button, a scrollable body, and an optional sticky footer. New
 * inventory dialogs should build on this so they can never re-introduce the
 * hardcoded light-theme bug.
 */
export function ModalShell({
  children,
  footer,
  maxWidthClass = 'max-w-lg',
  onClose,
  title,
}: {
  children: ReactNode
  footer?: ReactNode
  maxWidthClass?: string
  onClose: () => void
  title: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className={[
          'flex w-full max-h-[90vh] flex-col rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] shadow-xl',
          maxWidthClass,
        ].join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
          <button
            aria-label="Close"
            className="rounded p-1 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
