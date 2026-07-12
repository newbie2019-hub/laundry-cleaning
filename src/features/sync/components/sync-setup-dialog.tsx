import { HardDriveDownload, HardDriveUpload, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import type { SyncRole } from '../../../lib/sync'

export function SyncSetupDialog({
  onChoose,
  onClose,
}: {
  onChoose: (role: SyncRole) => Promise<unknown>
  onClose: () => void
}) {
  const [busy, setBusy] = useState<SyncRole | null>(null)

  async function handleChoose(role: SyncRole) {
    setBusy(role)
    try {
      await onChoose(role)
      onClose()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Set up device sync</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Choose how this device joins the shared data. You only do this once.
            </p>
          </div>
          <button
            aria-label="Close"
            className="rounded p-1 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-50"
            disabled={busy != null}
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <button
            className="flex w-full items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-left transition hover:border-[var(--accent)] disabled:opacity-60"
            disabled={busy != null}
            onClick={() => handleChoose('primary')}
            type="button"
          >
            <HardDriveUpload className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-strong)]" />
            <div className="min-w-0">
              <p className="font-medium">
                This device has the real data (Primary)
                {busy === 'primary' && (
                  <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />
                )}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Uploads everything on this device to the cloud as the starting
                point. Choose this on the ONE device that already holds the
                correct, complete records.
              </p>
            </div>
          </button>

          <button
            className="flex w-full items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-left transition hover:border-[var(--accent)] disabled:opacity-60"
            disabled={busy != null}
            onClick={() => handleChoose('secondary')}
            type="button"
          >
            <HardDriveDownload className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-strong)]" />
            <div className="min-w-0">
              <p className="font-medium">
                Copy the data from another device (Secondary)
                {busy === 'secondary' && (
                  <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />
                )}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Backs up this device's current data to a local file first, then
                replaces it with the shared dataset from the primary. Choose this
                on devices that don't yet have the real records.
              </p>
            </div>
          </button>
        </div>

        <p className="mt-4 text-xs text-[var(--muted)]">
          Not sure? If this is the computer you've been using all along, pick
          Primary. Set up the primary device first, then the others.
        </p>
      </div>
    </div>
  )
}
