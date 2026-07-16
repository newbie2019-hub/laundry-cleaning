// Preview-first duplicate-cleanup dialog, opened from Settings → "Find & remove
// duplicates". Nothing is deleted until the user reviews the candidates, has a
// backup, and confirms.
//
//   scan     — read-only scan of the active business
//   review   — candidates grouped by confidence tier, each with a checkbox
//              (exact + blank-shadow pre-checked, near left unchecked). A
//              backup is required before the delete button unlocks.
//   applying — reuse the per-entity deletes (records sync tombstones)
//   summary  — how many were removed, and any failures
//
// Visual style mirrors the reset-data and import dialogs on the Settings page.

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { exportActiveBusinessToJson } from '../backup/backup-export'
import { deleteDuplicateRecords, type DedupDeletableEntity } from '../../lib/db/repository'
import {
  ENTITY_LABELS,
  TIER_LABELS,
  scanForDuplicates,
  type DedupPlan,
  type DedupTier,
  type DuplicateCandidate,
} from './dedup-scan'

type Phase = 'idle' | 'scanning' | 'review' | 'applying' | 'summary' | 'error'

type Props = {
  open: boolean
  onClose: () => void
  /** Called after rows are removed so the parent can refresh any caches. */
  onApplied?: (deleted: number) => void
}

const TIER_ORDER: DedupTier[] = ['exact', 'blank-shadow']

const TIER_HELP: Record<DedupTier, string> = {
  exact: 'Identical in every field. Safe to remove — pre-selected.',
  'blank-shadow':
    'A blank entry that mirrors a labelled one (the import problem). Pre-selected, but review first.',
}

const keyOf = (c: DuplicateCandidate) => `${c.entity}:${c.id}`

export function DedupDialog({ open, onClose, onApplied }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [plan, setPlan] = useState<DedupPlan | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [backedUp, setBackedUp] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [result, setResult] = useState<{ deleted: number; failed: number } | null>(null)

  const grouped = useMemo(() => {
    const map: Record<DedupTier, DuplicateCandidate[]> = { exact: [], 'blank-shadow': [] }
    for (const c of plan?.candidates ?? []) map[c.tier].push(c)
    return map
  }, [plan])

  function resetState() {
    setPhase('idle')
    setPlan(null)
    setSelected(new Set())
    setBackedUp(false)
    setExporting(false)
    setErrorMessage(null)
    setResult(null)
  }

  function handleClose() {
    if (phase === 'scanning' || phase === 'applying') return
    resetState()
    onClose()
  }

  async function runScan() {
    setPhase('scanning')
    setErrorMessage(null)
    try {
      const p = await scanForDuplicates()
      setPlan(p)
      // Both tiers are high-precision, so pre-select everything; the user can
      // still uncheck any row and reviews the whole list before removing.
      setSelected(new Set(p.candidates.map(keyOf)))
      setPhase('review')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Scan failed.')
      setPhase('error')
    }
  }

  function toggle(c: DuplicateCandidate) {
    const k = keyOf(c)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function toggleTier(tier: DedupTier, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of grouped[tier]) {
        const k = keyOf(c)
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  async function handleBackup() {
    setExporting(true)
    try {
      const res = await exportActiveBusinessToJson()
      if (res.status === 'cancelled') {
        toast.message('Backup cancelled — no changes made.')
        return
      }
      setBackedUp(true)
      toast.success('Backup saved', { description: res.filename })
    } catch (err) {
      toast.error('Backup failed', { description: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setExporting(false)
    }
  }

  async function handleApply() {
    if (!plan) return
    const items = plan.candidates
      .filter((c) => selected.has(keyOf(c)))
      .map((c) => ({ entity: c.entity as DedupDeletableEntity, id: c.id }))
    if (items.length === 0) return
    setPhase('applying')
    try {
      const { deleted, failures } = await deleteDuplicateRecords(items)
      setResult({ deleted, failed: failures.length })
      setPhase('summary')
      if (failures.length === 0) toast.success(`Removed ${deleted} duplicate${deleted === 1 ? '' : 's'}.`)
      else toast.warning(`Removed ${deleted}; ${failures.length} could not be removed.`)
      onApplied?.(deleted)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Removal failed.')
      setPhase('error')
    }
  }

  if (!open) return null

  const totalFound = plan?.candidates.length ?? 0
  const selectedCount = selected.size

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
      role="dialog"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <Search className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Find &amp; remove duplicates</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
                Scans transactions, inventory movements, attendance, incident and
                maintenance records. Deletions sync to your other devices.
              </p>
            </div>
          </div>
          <button
            className="rounded-md p-1 text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-40"
            disabled={phase === 'scanning' || phase === 'applying'}
            onClick={handleClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {phase === 'idle' && (
            <div className="space-y-4 text-sm">
              <p className="text-[var(--muted)]">
                This looks for records that appear more than once — exact copies,
                and blank entries that mirror a labelled one (the cross-device
                import problem). You&apos;ll review everything before anything is deleted.
              </p>
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
                onClick={() => void runScan()}
                type="button"
              >
                <Search className="h-4 w-4" />
                Scan for duplicates
              </button>
            </div>
          )}

          {phase === 'scanning' && (
            <div className="flex items-center gap-3 py-8 text-sm text-[var(--muted)]">
              <Loader2 className="h-5 w-5 animate-spin" />
              Scanning every record…
            </div>
          )}

          {phase === 'review' && plan && (
            <div className="space-y-5">
              {totalFound === 0 ? (
                <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-600">
                  <ShieldCheck className="h-5 w-5" />
                  No duplicates found. Your data is clean.
                </div>
              ) : (
                <>
                  <p className="text-xs text-[var(--muted)]">
                    Found <span className="font-semibold text-[var(--foreground)]">{totalFound}</span>{' '}
                    possible duplicate{totalFound === 1 ? '' : 's'}. Review each group, then remove the selected rows.
                  </p>

                  {TIER_ORDER.map((tier) => {
                    const rows = grouped[tier]
                    if (rows.length === 0) return null
                    const allOn = rows.every((c) => selected.has(keyOf(c)))
                    return (
                      <div key={tier} className="rounded-lg border border-[var(--border)]">
                        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--background)] px-4 py-2.5">
                          <div>
                            <p className="text-sm font-semibold">
                              {TIER_LABELS[tier]}{' '}
                              <span className="text-[var(--muted)]">({rows.length})</span>
                            </p>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">
                              {TIER_HELP[tier]}
                            </p>
                          </div>
                          <button
                            className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
                            onClick={() => toggleTier(tier, !allOn)}
                            type="button"
                          >
                            {allOn ? 'Deselect all' : 'Select all'}
                          </button>
                        </div>
                        <ul className="divide-y divide-[var(--border)]">
                          {rows.map((c) => {
                            const k = keyOf(c)
                            return (
                              <li key={k}>
                                <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 transition hover:bg-[var(--background)]">
                                  <input
                                    checked={selected.has(k)}
                                    className="mt-0.5 h-4 w-4 rounded border-[var(--border)]"
                                    onChange={() => toggle(c)}
                                    type="checkbox"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-baseline justify-between gap-2">
                                      <span className="truncate text-sm font-medium">{c.label}</span>
                                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                                        {ENTITY_LABELS[c.entity]}
                                      </span>
                                    </span>
                                    <span className="mt-0.5 block text-xs text-[var(--muted)]">{c.detail}</span>
                                  </span>
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )
                  })}

                  {/* Backup gate */}
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <div className="flex-1 text-xs leading-relaxed text-[var(--muted)]">
                        <p className="font-medium text-[var(--foreground)]">Back up before removing.</p>
                        <p className="mt-0.5">
                          Removal can&apos;t be undone in-app. Export a JSON backup first — you
                          can re-import it if something looks wrong.
                        </p>
                        <button
                          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 disabled:opacity-50"
                          disabled={exporting}
                          onClick={() => void handleBackup()}
                          type="button"
                        >
                          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          {backedUp ? 'Backup saved ✓' : 'Export backup now'}
                        </button>
                      </div>
                    </div>
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs">
                      <input
                        checked={backedUp}
                        className="h-4 w-4 rounded border-[var(--border)]"
                        onChange={(e) => setBackedUp(e.target.checked)}
                        type="checkbox"
                      />
                      I have a backup and understand this permanently removes the selected rows.
                    </label>
                  </div>
                </>
              )}
            </div>
          )}

          {phase === 'applying' && (
            <div className="flex items-center gap-3 py-8 text-sm text-[var(--muted)]">
              <Loader2 className="h-5 w-5 animate-spin" />
              Removing selected duplicates…
            </div>
          )}

          {phase === 'summary' && result && (
            <div className="space-y-3 py-4 text-sm">
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-emerald-600">
                <Check className="h-5 w-5" />
                Removed {result.deleted} duplicate{result.deleted === 1 ? '' : 's'}.
              </div>
              {result.failed > 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-red-500">
                  <AlertTriangle className="h-5 w-5" />
                  {result.failed} row{result.failed === 1 ? '' : 's'} could not be removed (they may be
                  linked to other records). Nothing else was affected.
                </div>
              )}
              <p className="text-xs text-[var(--muted)]">
                The removals are queued to sync to your other devices automatically.
              </p>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{errorMessage ?? 'Something went wrong.'}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] p-4">
          {phase === 'review' && totalFound > 0 && (
            <>
              <span className="mr-auto text-xs text-[var(--muted)]">{selectedCount} selected</span>
              <button
                className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
                onClick={handleClose}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={selectedCount === 0 || !backedUp}
                onClick={() => void handleApply()}
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove {selectedCount} selected
              </button>
            </>
          )}
          {(phase === 'summary' || phase === 'error' || (phase === 'review' && totalFound === 0)) && (
            <button
              className="inline-flex items-center rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              onClick={handleClose}
              type="button"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
