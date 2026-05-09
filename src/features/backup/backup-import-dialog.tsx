// Five-step wizard the user walks through when importing a JSON backup.
//
//   1. pick     — user clicks "Choose file…"
//   2. validating — we parse, run all checks, and build the ImportPlan
//   3. preview  — show per-entity counts (insert/update/skip/orphan/invalid)
//   4. resolve  — for every conflict, user picks Skip or Overwrite (with
//                 per-entity bulk buttons). Apply is disabled until every
//                 conflict has a decision.
//   5. summary  — counts of inserted/updated/skipped/failed per entity
//
// The dialog mirrors the visual style of the existing reset-data dialog in
// `src/features/settings/pages/settings-page.tsx`.

import type { ChangeEvent, ReactNode } from 'react'
import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  FileJson,
  Loader2,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/use-auth'
import {
  applyImportPlan,
  BackupValidationError,
  formatSummaryReport,
  validateAndPlan,
} from './backup-import'
import {
  ENTITY_APPLY_ORDER,
  ENTITY_LABELS,
  makeResolutionKey,
  type EntityKey,
  type EntityPlan,
  type ImportPlan,
  type ImportSummary,
  type ResolutionMap,
  type ValidationIssue,
} from './backup-types'

type Phase = 'pick' | 'validating' | 'preview' | 'applying' | 'summary' | 'error'

type Props = {
  open: boolean
  onClose: () => void
  /** Called after a successful apply so the parent can refresh in-memory caches. */
  onApplied?: (summary: ImportSummary) => void
}

export function BackupImportDialog({ open, onClose, onApplied }: Props) {
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<Phase>('pick')
  const [pickedFileName, setPickedFileName] = useState<string | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [resolutions, setResolutions] = useState<ResolutionMap>({})
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [expanded, setExpanded] = useState<Record<EntityKey, boolean>>(() => emptyExpansion())

  function reset() {
    setPhase('pick')
    setPickedFileName(null)
    setPlan(null)
    setResolutions({})
    setValidationIssues([])
    setErrorMessage(null)
    setSummary(null)
    setExpanded(emptyExpansion())
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleClose() {
    if (phase === 'validating' || phase === 'applying') return
    reset()
    onClose()
  }

  async function handleFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setPickedFileName(file.name)
    setPhase('validating')
    setValidationIssues([])
    setErrorMessage(null)
    try {
      const built = await validateAndPlan(file)
      setPlan(built)
      setPhase('preview')
    } catch (err: unknown) {
      if (err instanceof BackupValidationError) {
        setValidationIssues(err.issues)
        setErrorMessage(err.message)
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Could not read the backup file.')
      }
      setPhase('error')
    }
  }

  // ─── Resolution helpers ────────────────────────────────────────────────────

  const allConflictKeys = useMemo(() => {
    const keys: string[] = []
    if (!plan) return keys
    for (const entity of ENTITY_APPLY_ORDER) {
      for (const item of plan.perEntity[entity].update) {
        keys.push(makeResolutionKey(entity, item.fingerprint))
      }
    }
    return keys
  }, [plan])

  const undecidedCount = allConflictKeys.filter((k) => !(k in resolutions)).length

  function setOne(entity: EntityKey, fingerprint: string, choice: 'skip' | 'overwrite') {
    setResolutions((prev) => ({
      ...prev,
      [makeResolutionKey(entity, fingerprint)]: choice,
    }))
  }

  function setAllForEntity(entity: EntityKey, choice: 'skip' | 'overwrite') {
    setResolutions((prev) => {
      const next = { ...prev }
      for (const item of plan?.perEntity[entity].update ?? []) {
        next[makeResolutionKey(entity, item.fingerprint)] = choice
      }
      return next
    })
  }

  function setAllGlobal(choice: 'skip' | 'overwrite') {
    setResolutions(() => {
      const next: ResolutionMap = {}
      for (const k of allConflictKeys) next[k] = choice
      return next
    })
  }

  // ─── Apply ────────────────────────────────────────────────────────────────

  async function handleApply() {
    if (!plan || !user) return
    if (undecidedCount > 0) {
      toast.error('Resolve every conflict before applying.', {
        description: `${undecidedCount} conflict${undecidedCount === 1 ? '' : 's'} still need a decision.`,
      })
      return
    }
    setPhase('applying')
    try {
      const result = await applyImportPlan(plan, resolutions, user.id, pickedFileName)
      setSummary(result)
      setPhase('summary')
      if (result.ok) {
        toast.success('Import complete.', { description: pickedFileName ?? undefined })
      } else {
        toast.warning('Import finished with errors.', {
          description: 'See the summary screen for per-entity counts.',
        })
      }
      onApplied?.(result)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not finish the import.')
      setPhase('error')
    }
  }

  function copyReport() {
    if (!summary) return
    const text = formatSummaryReport(summary, pickedFileName)
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success('Report copied to clipboard.'))
      .catch(() => toast.error('Could not copy.'))
  }

  if (!open) return null

  // ─── Render ──────────────────────────────────────────────────────────────

  const isBusy = phase === 'validating' || phase === 'applying'

  return (
    <div
      aria-labelledby="backup-import-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
      role="dialog"
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-[var(--border)] p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            <Upload className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold" id="backup-import-title">
              Import data from backup
            </h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {phase === 'pick' && 'Pick a JSON backup file. The importer will validate it and preview every change before anything is written.'}
              {phase === 'validating' && 'Validating and computing changes…'}
              {phase === 'preview' && pickedFileName}
              {phase === 'applying' && 'Applying…'}
              {phase === 'summary' && (summary?.ok ? 'Done.' : 'Done — with errors. Review below.')}
              {phase === 'error' && (errorMessage ?? 'Could not import.')}
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
          {phase === 'pick' && <PickStep onPick={() => fileInputRef.current?.click()} />}

          {phase === 'validating' && <BusyStep label="Validating backup file…" />}

          {phase === 'preview' && plan && (
            <PreviewStep
              plan={plan}
              resolutions={resolutions}
              expanded={expanded}
              setExpanded={setExpanded}
              onSetOne={setOne}
              onSetAllForEntity={setAllForEntity}
              onSetAllGlobal={setAllGlobal}
            />
          )}

          {phase === 'applying' && <BusyStep label="Importing…" />}

          {phase === 'summary' && summary && <SummaryStep summary={summary} />}

          {phase === 'error' && (
            <ErrorStep
              issues={validationIssues}
              message={errorMessage}
              onRetry={() => {
                reset()
              }}
            />
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] p-4">
          <div className="text-xs text-[var(--muted)]">
            {phase === 'preview' &&
              (undecidedCount > 0
                ? `${undecidedCount} conflict${undecidedCount === 1 ? '' : 's'} still need a decision.`
                : `${allConflictKeys.length} conflict${allConflictKeys.length === 1 ? '' : 's'} resolved.`)}
            {phase === 'summary' && summary && (
              <span className={summary.ok ? 'text-emerald-500' : 'text-amber-500'}>
                {summary.ok ? 'No errors.' : 'Completed with errors.'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {phase === 'preview' && (
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={undecidedCount > 0}
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

function emptyExpansion(): Record<EntityKey, boolean> {
  return {
    transactionTypes: false,
    categories: false,
    customers: false,
    inventoryCategories: false,
    inventoryItems: false,
    inventoryMovements: false,
    inventoryMaintenanceRecords: false,
    transactionTemplates: false,
    transactions: false,
    staff: false,
    staffAttendance: false,
    staffPayrolls: false,
    staffCashAdvances: false,
    incidentReports: false,
    incomeShareRules: false,
    incomeShareMonthlyVersions: false,
    settings: false,
  }
}

// ─── Step components ─────────────────────────────────────────────────────────

function PickStep({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
        <FileJson className="h-8 w-8" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h4 className="text-sm font-semibold">Pick a backup JSON file</h4>
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          Use a file produced by the &quot;Export all data&quot; button on the device you're syncing
          from. The importer will skip rows that already exist with the same data and ask you
          what to do for any conflicts.
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
                {issue.entity && (
                  <span className="text-[var(--muted)]">{ENTITY_LABELS[issue.entity]}</span>
                )}
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
  plan,
  resolutions,
  expanded,
  setExpanded,
  onSetOne,
  onSetAllForEntity,
  onSetAllGlobal,
}: {
  plan: ImportPlan
  resolutions: ResolutionMap
  expanded: Record<EntityKey, boolean>
  setExpanded: (next: Record<EntityKey, boolean>) => void
  onSetOne: (entity: EntityKey, fingerprint: string, choice: 'skip' | 'overwrite') => void
  onSetAllForEntity: (entity: EntityKey, choice: 'skip' | 'overwrite') => void
  onSetAllGlobal: (choice: 'skip' | 'overwrite') => void
}) {
  const totalConflicts = ENTITY_APPLY_ORDER.reduce(
    (acc, k) => acc + plan.perEntity[k].update.length,
    0,
  )

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
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <span className="text-[var(--foreground)]/90">
            <strong className="text-amber-500">{totalConflicts}</strong> row{totalConflicts === 1 ? '' : 's'}{' '}
            already exist locally with different values. Pick Skip or Overwrite for each below.
          </span>
          <div className="flex items-center gap-1">
            <button
              className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
              onClick={() => onSetAllGlobal('skip')}
              type="button"
            >
              Skip all
            </button>
            <button
              className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
              onClick={() => onSetAllGlobal('overwrite')}
              type="button"
            >
              Overwrite all
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {ENTITY_APPLY_ORDER.map((entity) => {
          const sec = plan.perEntity[entity]
          const total = totalRows(sec)
          if (total === 0) return null
          return (
            <EntityRow
              entity={entity}
              expanded={expanded[entity]}
              key={entity}
              onSetAllForEntity={onSetAllForEntity}
              onSetOne={onSetOne}
              onToggle={() => setExpanded({ ...expanded, [entity]: !expanded[entity] })}
              resolutions={resolutions}
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
    sec.update.length +
    sec.skipIdentical.length +
    sec.orphan.length +
    sec.invalid.length
  )
}

function EntityRow({
  entity,
  expanded,
  onSetAllForEntity,
  onSetOne,
  onToggle,
  resolutions,
  section,
}: {
  entity: EntityKey
  expanded: boolean
  onSetAllForEntity: (entity: EntityKey, choice: 'skip' | 'overwrite') => void
  onSetOne: (entity: EntityKey, fingerprint: string, choice: 'skip' | 'overwrite') => void
  onToggle: () => void
  resolutions: ResolutionMap
  section: EntityPlan
}) {
  const insertCount = section.insert.length
  const updateCount = section.update.length
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
          {insertCount > 0 && (
            <Pill color="emerald">+{insertCount} new</Pill>
          )}
          {updateCount > 0 && <Pill color="amber">{updateCount} conflict{updateCount === 1 ? '' : 's'}</Pill>}
          {skipIdenticalCount > 0 && <Pill color="slate">{skipIdenticalCount} identical</Pill>}
          {orphanCount > 0 && <Pill color="red">{orphanCount} orphan</Pill>}
          {invalidCount > 0 && <Pill color="red">{invalidCount} invalid</Pill>}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--border)] p-4">
          {updateCount > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--foreground)]">Conflicts ({updateCount})</p>
                <div className="flex gap-1">
                  <button
                    className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[11px] font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
                    onClick={() => onSetAllForEntity(entity, 'skip')}
                    type="button"
                  >
                    Skip all
                  </button>
                  <button
                    className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[11px] font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
                    onClick={() => onSetAllForEntity(entity, 'overwrite')}
                    type="button"
                  >
                    Overwrite all
                  </button>
                </div>
              </div>
              <ul className="space-y-2">
                {section.update.map((item) => {
                  const choice = resolutions[makeResolutionKey(entity, item.fingerprint)]
                  return (
                    <li
                      className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px]"
                      key={item.fingerprint}
                    >
                      <div className="flex items-start gap-2">
                        <p className="flex-1 font-mono text-[11px] leading-snug">{item.label}</p>
                        <div className="flex gap-1">
                          <button
                            className={[
                              'inline-flex items-center rounded-md px-2 py-0.5 font-medium transition',
                              choice === 'skip'
                                ? 'border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                                : 'border border-[var(--border)] bg-[var(--background)] text-[var(--muted)] hover:text-[var(--foreground)]',
                            ].join(' ')}
                            onClick={() => onSetOne(entity, item.fingerprint, 'skip')}
                            type="button"
                          >
                            Skip
                          </button>
                          <button
                            className={[
                              'inline-flex items-center rounded-md px-2 py-0.5 font-medium transition',
                              choice === 'overwrite'
                                ? 'border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                                : 'border border-[var(--border)] bg-[var(--background)] text-[var(--muted)] hover:text-[var(--foreground)]',
                            ].join(' ')}
                            onClick={() => onSetOne(entity, item.fingerprint, 'overwrite')}
                            type="button"
                          >
                            Overwrite
                          </button>
                        </div>
                      </div>
                      {item.diff && item.diff.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 pl-1 text-[10.5px] text-[var(--muted)]">
                          {item.diff.slice(0, 8).map((d, i) => (
                            <li className="font-mono" key={i}>
                              <span className="text-[var(--foreground)]/80">{d.field}</span>:{' '}
                              <span className="text-red-500/80">{shortValue(d.localValue)}</span>{' '}
                              →{' '}
                              <span className="text-emerald-500/80">{shortValue(d.incomingValue)}</span>
                            </li>
                          ))}
                          {item.diff.length > 8 && (
                            <li className="italic">+ {item.diff.length - 8} more field(s)</li>
                          )}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {orphanCount > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-red-500">
                Orphan rows that will be skipped ({orphanCount})
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
                Invalid rows that will be skipped ({invalidCount})
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

          {insertCount > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-emerald-500">
                New rows that will be inserted ({insertCount})
              </summary>
              <ul className="mt-2 space-y-1 pl-2 text-[11px]">
                {section.insert.slice(0, 30).map((it) => (
                  <li className="text-[var(--muted)] font-mono" key={it.fingerprint}>
                    {it.label}
                  </li>
                ))}
                {section.insert.length > 30 && (
                  <li className="italic">+ {section.insert.length - 30} more</li>
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

function SummaryStep({ summary }: { summary: ImportSummary }) {
  const grand = ENTITY_APPLY_ORDER.reduce(
    (acc, k) => {
      const s = summary.perEntity[k]
      return {
        inserted: acc.inserted + s.inserted,
        updated: acc.updated + s.updated,
        skipped:
          acc.skipped +
          s.skippedIdentical +
          s.skippedByUser +
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
        {ENTITY_APPLY_ORDER.map((k) => {
          const s = summary.perEntity[k]
          const total =
            s.inserted +
            s.updated +
            s.skippedIdentical +
            s.skippedByUser +
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
                  {s.skippedByUser > 0 && (
                    <Pill color="slate">{s.skippedByUser} skipped</Pill>
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
