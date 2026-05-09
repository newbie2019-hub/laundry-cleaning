// Combined Export / Import dialog for the inventory section.
//
// The dialog has two modes:
//
//   - Export: pick what to include (always categories + items + alt units;
//     optional movements and maintenance records) and download a single
//     timestamped JSON file to the user's Downloads folder.
//
//   - Import: pick a JSON file produced by this app, see a per-entity preview
//     of inserts / conflicts / identical / orphan / invalid, optionally tick
//     "Overwrite when item already exists", then apply. The default
//     behaviour is **add-only** so existing local rows are never touched.
//
// Mirrors the visual style of `BackupImportDialog` in the backup feature.

import type { ChangeEvent, ReactNode } from 'react'
import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  FileJson,
  Loader2,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../auth/use-auth'
import {
  applyInventoryImportPlan,
  exportInventoryToJson,
  formatInventoryImportReport,
  InventoryBackupValidationError,
  validateAndPlanInventoryImport,
  type EntityPlan,
  type InventoryImportPlan,
  type InventoryImportSummary,
  type ValidationIssue,
} from '../inventory-backup'

type InventoryEntityKey = 'categories' | 'items' | 'movements' | 'maintenanceRecords'

const ENTITY_LABELS: Record<InventoryEntityKey, string> = {
  categories: 'Categories',
  items: 'Items',
  movements: 'Stock movements',
  maintenanceRecords: 'Maintenance records',
}

const ENTITY_ORDER: InventoryEntityKey[] = ['categories', 'items', 'movements', 'maintenanceRecords']

type Mode = 'choose' | 'export' | 'import'
type ImportPhase = 'pick' | 'validating' | 'preview' | 'applying' | 'summary' | 'error'

type Props = {
  open: boolean
  onClose: () => void
  /** Called after a successful apply so the parent can refresh its lists. */
  onApplied?: (summary: InventoryImportSummary) => void
}

export function InventoryBackupDialog({ open, onClose, onApplied }: Props) {
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<Mode>('choose')

  // Export state
  const [includeMovements, setIncludeMovements] = useState(true)
  const [includeMaintenance, setIncludeMaintenance] = useState(true)
  const [isExporting, setIsExporting] = useState(false)

  // Import state
  const [phase, setPhase] = useState<ImportPhase>('pick')
  const [pickedFileName, setPickedFileName] = useState<string | null>(null)
  const [plan, setPlan] = useState<InventoryImportPlan | null>(null)
  const [overwriteConflicts, setOverwriteConflicts] = useState(false)
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [summary, setSummary] = useState<InventoryImportSummary | null>(null)
  const [expanded, setExpanded] = useState<Record<InventoryEntityKey, boolean>>(() => emptyExpansion())

  function fullReset() {
    setMode('choose')
    resetImport()
    resetExport()
  }

  function resetExport() {
    setIncludeMovements(true)
    setIncludeMaintenance(true)
    setIsExporting(false)
  }

  function resetImport() {
    setPhase('pick')
    setPickedFileName(null)
    setPlan(null)
    setOverwriteConflicts(false)
    setValidationIssues([])
    setErrorMessage(null)
    setSummary(null)
    setExpanded(emptyExpansion())
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleClose() {
    if (isExporting || phase === 'validating' || phase === 'applying') return
    fullReset()
    onClose()
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  async function handleExport() {
    setIsExporting(true)
    try {
      const result = await exportInventoryToJson({
        includeMovements,
        includeMaintenanceRecords: includeMaintenance,
      })
      const totalItems = result.counts.items
      toast.success('Inventory exported.', {
        description: `${result.filename} · ${totalItems} item${totalItems === 1 ? '' : 's'}`,
      })
      handleClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Export failed', { description: msg })
    } finally {
      setIsExporting(false)
    }
  }

  // ─── Import ────────────────────────────────────────────────────────────────

  async function handleFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setPickedFileName(file.name)
    setPhase('validating')
    setValidationIssues([])
    setErrorMessage(null)
    try {
      const built = await validateAndPlanInventoryImport(file)
      setPlan(built)
      setPhase('preview')
    } catch (err) {
      if (err instanceof InventoryBackupValidationError) {
        setValidationIssues(err.issues)
        setErrorMessage(err.message)
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Could not read the backup file.')
      }
      setPhase('error')
    }
  }

  const totalConflicts = useMemo(() => {
    if (!plan) return 0
    return ENTITY_ORDER.reduce((acc, k) => acc + plan.perEntity[k].conflict.length, 0)
  }, [plan])

  async function handleApply() {
    if (!plan || !user) return
    setPhase('applying')
    try {
      const result = await applyInventoryImportPlan(
        plan,
        { overwriteConflicts },
        user.id,
        pickedFileName,
      )
      setSummary(result)
      setPhase('summary')
      if (result.ok) {
        toast.success('Inventory import complete.', {
          description: pickedFileName ?? undefined,
        })
      } else {
        toast.warning('Import finished with errors.', {
          description: 'See the summary screen for per-entity counts.',
        })
      }
      onApplied?.(result)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not finish the import.')
      setPhase('error')
    }
  }

  function copyReport() {
    if (!summary) return
    const text = formatInventoryImportReport(summary, pickedFileName)
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success('Report copied to clipboard.'))
      .catch(() => toast.error('Could not copy.'))
  }

  if (!open) return null

  const isBusy = isExporting || phase === 'validating' || phase === 'applying'

  return (
    <div
      aria-labelledby="inventory-backup-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
      role="dialog"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-[var(--border)] p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            <ArrowLeftRight className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold" id="inventory-backup-title">
              Inventory backup
            </h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {mode === 'choose' &&
                'Move inventory between devices without touching transactions, customers, or staff.'}
              {mode === 'export' && 'Pick what to include and download a JSON file.'}
              {mode === 'import' && phase === 'pick' &&
                'Pick a JSON file. The importer previews every change before anything is written.'}
              {mode === 'import' && phase === 'validating' && 'Validating and computing changes…'}
              {mode === 'import' && phase === 'preview' && pickedFileName}
              {mode === 'import' && phase === 'applying' && 'Importing…'}
              {mode === 'import' && phase === 'summary' &&
                (summary?.ok ? 'Done.' : 'Done — with errors. Review below.')}
              {mode === 'import' && phase === 'error' && (errorMessage ?? 'Could not import.')}
            </p>
          </div>
          <button
            aria-label="Close"
            className="rounded-md p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-50"
            disabled={isBusy}
            onClick={handleClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-5">
          {mode === 'choose' && (
            <ChooseStep onPickExport={() => setMode('export')} onPickImport={() => setMode('import')} />
          )}

          {mode === 'export' && (
            <ExportStep
              includeMaintenance={includeMaintenance}
              includeMovements={includeMovements}
              onToggleMaintenance={setIncludeMaintenance}
              onToggleMovements={setIncludeMovements}
            />
          )}

          {mode === 'import' && phase === 'pick' && (
            <PickStep onPick={() => fileInputRef.current?.click()} />
          )}

          {mode === 'import' && phase === 'validating' && (
            <BusyStep label="Validating backup file…" />
          )}

          {mode === 'import' && phase === 'preview' && plan && (
            <PreviewStep
              expanded={expanded}
              onToggleExpanded={(key) => setExpanded({ ...expanded, [key]: !expanded[key] })}
              overwriteConflicts={overwriteConflicts}
              plan={plan}
              setOverwriteConflicts={setOverwriteConflicts}
              totalConflicts={totalConflicts}
            />
          )}

          {mode === 'import' && phase === 'applying' && <BusyStep label="Importing…" />}

          {mode === 'import' && phase === 'summary' && summary && <SummaryStep summary={summary} />}

          {mode === 'import' && phase === 'error' && (
            <ErrorStep
              issues={validationIssues}
              message={errorMessage}
              onRetry={() => resetImport()}
            />
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] p-4">
          <div className="text-xs text-[var(--muted)]">
            {mode === 'import' && phase === 'preview' && totalConflicts > 0 && (
              <span>
                <strong className="text-amber-500">{totalConflicts}</strong> conflict
                {totalConflicts === 1 ? '' : 's'}{' '}
                {overwriteConflicts ? 'will be overwritten.' : 'will be skipped.'}
              </span>
            )}
            {mode === 'import' && phase === 'preview' && totalConflicts === 0 && (
              <span>Existing rows are preserved.</span>
            )}
            {mode === 'import' && phase === 'summary' && summary && (
              <span className={summary.ok ? 'text-emerald-500' : 'text-amber-500'}>
                {summary.ok ? 'No errors.' : 'Completed with errors.'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {mode === 'choose' && (
              <button
                className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
                onClick={handleClose}
                type="button"
              >
                Close
              </button>
            )}

            {mode === 'export' && (
              <>
                <button
                  className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 disabled:opacity-50"
                  disabled={isExporting}
                  onClick={() => setMode('choose')}
                  type="button"
                >
                  Back
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isExporting}
                  onClick={() => {
                    void handleExport()
                  }}
                  type="button"
                >
                  <Download className="h-3.5 w-3.5" />
                  {isExporting ? 'Exporting…' : 'Download .json'}
                </button>
              </>
            )}

            {mode === 'import' && (
              <>
                {phase === 'pick' && (
                  <button
                    className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
                    onClick={() => setMode('choose')}
                    type="button"
                  >
                    Back
                  </button>
                )}

                {phase === 'preview' && (
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      void handleApply()
                    }}
                    type="button"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Apply import
                  </button>
                )}

                {phase === 'summary' && (
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
                    onClick={copyReport}
                    type="button"
                  >
                    <ClipboardCopy className="h-3.5 w-3.5" />
                    Copy report
                  </button>
                )}

                <button
                  className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isBusy}
                  onClick={handleClose}
                  type="button"
                >
                  {phase === 'summary' || phase === 'error' ? 'Close' : 'Cancel'}
                </button>
              </>
            )}
          </div>
        </footer>

        <input
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void handleFilePicked(e)
          }}
          ref={fileInputRef}
          type="file"
        />
      </div>
    </div>
  )
}

function emptyExpansion(): Record<InventoryEntityKey, boolean> {
  return {
    categories: false,
    items: false,
    movements: false,
    maintenanceRecords: false,
  }
}

// ─── Step components ─────────────────────────────────────────────────────────

function ChooseStep({
  onPickExport,
  onPickImport,
}: {
  onPickExport: () => void
  onPickImport: () => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <button
        className="group flex flex-col items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 text-left transition hover:border-[var(--accent)]/50 hover:bg-[var(--panel)]"
        onClick={onPickExport}
        type="button"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
          <Download className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold">Export inventory</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            Save items, categories, alt units, and (optionally) stock movements + maintenance
            records to a single JSON file in your Downloads folder.
          </p>
        </div>
      </button>
      <button
        className="group flex flex-col items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 text-left transition hover:border-[var(--accent)]/50 hover:bg-[var(--panel)]"
        onClick={onPickImport}
        type="button"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
          <Upload className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold">Import inventory</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            Add new items from another device. Existing local items are kept as-is by default;
            you can opt-in to overwrite per-row conflicts.
          </p>
        </div>
      </button>
    </div>
  )
}

function ExportStep({
  includeMaintenance,
  includeMovements,
  onToggleMaintenance,
  onToggleMovements,
}: {
  includeMaintenance: boolean
  includeMovements: boolean
  onToggleMaintenance: (next: boolean) => void
  onToggleMovements: (next: boolean) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
        <FileJson className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]" />
        <div className="space-y-1 text-xs">
          <p className="font-medium text-[var(--foreground)]">Always included</p>
          <p className="leading-relaxed text-[var(--muted)]">
            Inventory categories, items (including supplier, status, last maintenance date,
            and selling price), and any alternate selling units defined per item.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Optional</p>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 transition hover:border-[var(--accent)]/50">
          <input
            checked={includeMovements}
            className="mt-0.5 h-4 w-4 rounded border-[var(--border)]"
            onChange={(e) => onToggleMovements(e.target.checked)}
            type="checkbox"
          />
          <div className="flex-1 text-sm">
            <p className="font-medium">Stock movements</p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
              Every IN / OUT row that has been recorded against an inventory item. Re-importing
              will only add movements that aren't already present (matched by item, date, type,
              quantity, cost, and notes), so existing history is preserved.
            </p>
          </div>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 transition hover:border-[var(--accent)]/50">
          <input
            checked={includeMaintenance}
            className="mt-0.5 h-4 w-4 rounded border-[var(--border)]"
            onChange={(e) => onToggleMaintenance(e.target.checked)}
            type="checkbox"
          />
          <div className="flex-1 text-sm">
            <p className="font-medium">Equipment maintenance records</p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
              Service entries logged on equipment items. Same de-duplication as movements:
              same item + date + service type + performed by counts as identical.
            </p>
          </div>
        </label>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-[11px] leading-relaxed text-[var(--muted)]">
        Tip — the file is just text. Save it to a USB drive, send it through chat, or attach it
        to an email.
      </div>
    </div>
  )
}

function PickStep({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
        <FileJson className="h-8 w-8" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h4 className="text-sm font-semibold">Pick an inventory backup file</h4>
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          Use a file produced by the &quot;Export inventory&quot; button on the device you're
          syncing from. The importer adds new items only — your existing inventory stays
          untouched unless you tick &quot;Overwrite&quot; on the next screen.
        </p>
      </div>
      <button
        className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
        onClick={onPick}
        type="button"
      >
        <Upload className="h-4 w-4" />
        Choose file…
      </button>
    </div>
  )
}

function BusyStep({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-[var(--muted)]">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

function ErrorStep({
  issues,
  message,
  onRetry,
}: {
  issues: ValidationIssue[]
  message: string | null
  onRetry: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium text-red-500">Import refused</p>
          <p className="text-xs text-[var(--foreground)]/80">
            {message ?? 'The backup file failed validation.'}
          </p>
        </div>
      </div>
      {issues.length > 0 && (
        <ul className="space-y-2">
          {issues.map((issue, i) => (
            <li
              className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3 text-xs"
              key={i}
            >
              <div className="flex items-center gap-2">
                <span
                  className={[
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                    issue.severity === 'error'
                      ? 'bg-red-500/15 text-red-500'
                      : 'bg-amber-500/15 text-amber-500',
                  ].join(' ')}
                >
                  {issue.severity}
                </span>
              </div>
              <p className="mt-1.5 text-[var(--foreground)]/90">{issue.message}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
          onClick={onRetry}
          type="button"
        >
          Pick a different file
        </button>
      </div>
    </div>
  )
}

function PreviewStep({
  expanded,
  onToggleExpanded,
  overwriteConflicts,
  plan,
  setOverwriteConflicts,
  totalConflicts,
}: {
  expanded: Record<InventoryEntityKey, boolean>
  onToggleExpanded: (key: InventoryEntityKey) => void
  overwriteConflicts: boolean
  plan: InventoryImportPlan
  setOverwriteConflicts: (next: boolean) => void
  totalConflicts: number
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-xs text-[var(--muted)]">
        <p>
          Source business: <strong className="text-[var(--foreground)]">{plan.file.businessId}</strong> ·
          Exported: <strong className="text-[var(--foreground)]">{plan.file.exportedAt.slice(0, 16).replace('T', ' ')}</strong> ·
          Schema: <strong className="text-[var(--foreground)]">v{plan.file.schemaVersion}</strong>
        </p>
      </div>

      {totalConflicts > 0 && (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <input
            checked={overwriteConflicts}
            className="mt-0.5 h-4 w-4 rounded border-[var(--border)]"
            onChange={(e) => setOverwriteConflicts(e.target.checked)}
            type="checkbox"
          />
          <span className="flex-1">
            <span className="font-medium text-[var(--foreground)]">
              Overwrite when item already exists
            </span>
            <span className="mt-0.5 block text-[var(--muted)]">
              <strong className="text-amber-500">{totalConflicts}</strong> row
              {totalConflicts === 1 ? '' : 's'} exist locally with different values. Leave this
              off to keep your existing data; turn it on to replace local fields with the
              file's values.
            </span>
          </span>
        </label>
      )}

      <ul className="space-y-2">
        {ENTITY_ORDER.map((entity) => {
          const sec = plan.perEntity[entity]
          const total = totalRows(sec)
          if (total === 0) return null
          return (
            <EntityRow
              entity={entity}
              expanded={expanded[entity]}
              key={entity}
              onToggle={() => onToggleExpanded(entity)}
              section={sec}
            />
          )
        })}
      </ul>
    </div>
  )
}

function totalRows(sec: EntityPlan): number {
  return (
    sec.insert.length +
    sec.conflict.length +
    sec.skipIdentical.length +
    sec.orphan.length +
    sec.invalid.length
  )
}

function EntityRow({
  entity,
  expanded,
  onToggle,
  section,
}: {
  entity: InventoryEntityKey
  expanded: boolean
  onToggle: () => void
  section: EntityPlan
}) {
  const insertCount = section.insert.length
  const conflictCount = section.conflict.length
  const skipIdenticalCount = section.skipIdentical.length
  const orphanCount = section.orphan.length
  const invalidCount = section.invalid.length

  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--background)]">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--panel)]"
        onClick={onToggle}
        type="button"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-[var(--muted)]" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[var(--muted)]" />
        )}
        <span className="flex-1 text-sm font-medium">{ENTITY_LABELS[entity]}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {insertCount > 0 && <Pill color="emerald">+{insertCount} new</Pill>}
          {conflictCount > 0 && <Pill color="amber">{conflictCount} conflict{conflictCount === 1 ? '' : 's'}</Pill>}
          {skipIdenticalCount > 0 && <Pill color="slate">{skipIdenticalCount} identical</Pill>}
          {orphanCount > 0 && <Pill color="red">{orphanCount} orphan</Pill>}
          {invalidCount > 0 && <Pill color="red">{invalidCount} invalid</Pill>}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--border)] p-4">
          {insertCount > 0 && (
            <details open>
              <summary className="cursor-pointer text-xs font-medium text-emerald-500">
                New rows that will be inserted ({insertCount})
              </summary>
              <ul className="mt-2 space-y-1 pl-2 text-[11px]">
                {section.insert.slice(0, 30).map((it) => (
                  <li className="font-mono text-[var(--muted)]" key={it.fingerprint}>
                    {it.label}
                  </li>
                ))}
                {section.insert.length > 30 && (
                  <li className="italic">+ {section.insert.length - 30} more</li>
                )}
              </ul>
            </details>
          )}

          {conflictCount > 0 && (
            <details open>
              <summary className="cursor-pointer text-xs font-medium text-amber-500">
                Conflicts ({conflictCount}) — fields that differ from your local copy
              </summary>
              <ul className="mt-2 space-y-2 pl-1 text-[11px]">
                {section.conflict.slice(0, 30).map((it) => (
                  <li
                    className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2"
                    key={it.fingerprint}
                  >
                    <p className="font-mono text-[11px]">{it.label}</p>
                    {it.diff && it.diff.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 pl-1 text-[10.5px] text-[var(--muted)]">
                        {it.diff.slice(0, 8).map((d, i) => (
                          <li className="font-mono" key={i}>
                            <span className="text-[var(--foreground)]/80">{d.field}</span>:{' '}
                            <span className="text-red-500/80">{shortValue(d.localValue)}</span>{' '}
                            →{' '}
                            <span className="text-emerald-500/80">{shortValue(d.incomingValue)}</span>
                          </li>
                        ))}
                        {it.diff.length > 8 && (
                          <li className="italic">+ {it.diff.length - 8} more field(s)</li>
                        )}
                      </ul>
                    )}
                  </li>
                ))}
                {section.conflict.length > 30 && (
                  <li className="italic">+ {section.conflict.length - 30} more</li>
                )}
              </ul>
            </details>
          )}

          {skipIdenticalCount > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-[var(--muted)]">
                Already in sync ({skipIdenticalCount})
              </summary>
              <ul className="mt-2 space-y-1 pl-2 text-[11px]">
                {section.skipIdentical.slice(0, 30).map((it) => (
                  <li className="font-mono text-[var(--muted)]" key={it.fingerprint}>
                    {it.label}
                  </li>
                ))}
                {section.skipIdentical.length > 30 && (
                  <li className="italic">+ {section.skipIdentical.length - 30} more</li>
                )}
              </ul>
            </details>
          )}

          {orphanCount > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-red-500">
                Skipped (parent missing) ({orphanCount})
              </summary>
              <ul className="mt-2 space-y-1 pl-2 text-[11px]">
                {section.orphan.slice(0, 50).map((it) => (
                  <li className="text-[var(--muted)]" key={it.fingerprint}>
                    <span className="font-mono">{it.label}</span>
                    {it.reason && <span> — {it.reason}</span>}
                  </li>
                ))}
                {section.orphan.length > 50 && (
                  <li className="italic">+ {section.orphan.length - 50} more</li>
                )}
              </ul>
            </details>
          )}

          {invalidCount > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-red-500">
                Invalid rows ({invalidCount})
              </summary>
              <ul className="mt-2 space-y-1 pl-2 text-[11px]">
                {section.invalid.slice(0, 50).map((it) => (
                  <li className="text-[var(--muted)]" key={it.fingerprint}>
                    <span className="font-mono">{it.label}</span>
                    {it.reason && <span> — {it.reason}</span>}
                  </li>
                ))}
                {section.invalid.length > 50 && (
                  <li className="italic">+ {section.invalid.length - 50} more</li>
                )}
              </ul>
            </details>
          )}
        </div>
      )}
    </li>
  )
}

function Pill({
  children,
  color,
}: {
  children: ReactNode
  color: 'emerald' | 'amber' | 'slate' | 'red'
}) {
  const cls =
    color === 'emerald'
      ? 'bg-emerald-500/15 text-emerald-500'
      : color === 'amber'
        ? 'bg-amber-500/15 text-amber-500'
        : color === 'red'
          ? 'bg-red-500/15 text-red-500'
          : 'bg-slate-500/15 text-slate-400'
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium ${cls}`}>
      {children}
    </span>
  )
}

function shortValue(value: unknown): string {
  if (value == null) return '∅'
  if (typeof value === 'string') return value.length > 32 ? `${value.slice(0, 30)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const json = JSON.stringify(value)
    return json.length > 40 ? `${json.slice(0, 38)}…` : json
  } catch {
    return '[?]'
  }
}

function SummaryStep({ summary }: { summary: InventoryImportSummary }) {
  const grand = ENTITY_ORDER.reduce(
    (acc, k) => {
      const s = summary.perEntity[k]
      return {
        inserted: acc.inserted + s.inserted,
        updated: acc.updated + s.updated,
        skipped:
          acc.skipped +
          s.skippedIdentical +
          s.skippedConflict +
          s.skippedOrphan +
          s.skippedInvalid,
        failed: acc.failed + s.failed,
      }
    },
    { inserted: 0, updated: 0, skipped: 0, failed: 0 },
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2 text-center">
        <SummaryStatBox color="emerald" count={grand.inserted} label="Inserted" />
        <SummaryStatBox color="amber" count={grand.updated} label="Updated" />
        <SummaryStatBox color="slate" count={grand.skipped} label="Skipped" />
        <SummaryStatBox color="red" count={grand.failed} label="Failed" />
      </div>

      <ul className="space-y-2">
        {ENTITY_ORDER.map((k) => {
          const s = summary.perEntity[k]
          const total =
            s.inserted +
            s.updated +
            s.skippedIdentical +
            s.skippedConflict +
            s.skippedOrphan +
            s.skippedInvalid +
            s.failed
          if (total === 0) return null
          return (
            <li
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-xs"
              key={k}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{ENTITY_LABELS[k]}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {s.inserted > 0 && <Pill color="emerald">+{s.inserted} new</Pill>}
                  {s.updated > 0 && <Pill color="amber">{s.updated} updated</Pill>}
                  {s.skippedIdentical > 0 && (
                    <Pill color="slate">{s.skippedIdentical} identical</Pill>
                  )}
                  {s.skippedConflict > 0 && (
                    <Pill color="slate">{s.skippedConflict} conflict (kept)</Pill>
                  )}
                  {s.skippedOrphan > 0 && <Pill color="red">{s.skippedOrphan} orphan</Pill>}
                  {s.skippedInvalid > 0 && <Pill color="red">{s.skippedInvalid} invalid</Pill>}
                  {s.failed > 0 && <Pill color="red">{s.failed} failed</Pill>}
                </span>
              </div>
              {s.errors.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[10.5px] text-red-500/90">
                  {s.errors.slice(0, 8).map((e, i) => (
                    <li className="font-mono" key={i}>
                      ! {e.label}: {e.message}
                    </li>
                  ))}
                  {s.errors.length > 8 && (
                    <li className="italic">+ {s.errors.length - 8} more</li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SummaryStatBox({
  color,
  count,
  label,
}: {
  color: 'emerald' | 'amber' | 'slate' | 'red'
  count: number
  label: string
}) {
  const text =
    color === 'emerald'
      ? 'text-emerald-500'
      : color === 'amber'
        ? 'text-amber-500'
        : color === 'red'
          ? 'text-red-500'
          : 'text-[var(--foreground)]'
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
      <p className={`text-xl font-semibold ${text}`}>{count}</p>
      <p className="mt-0.5 text-[10.5px] uppercase tracking-wider text-[var(--muted)]">{label}</p>
    </div>
  )
}
