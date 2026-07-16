// "Device sync" block for the Settings page. Surfaces the one-time
// primary/secondary choice (previously only reachable from the sidebar sync
// widget) plus ongoing status and a "Sync now" button. Reuses the same
// `useSync` hook the widget uses, so state stays consistent between the two.

import { formatDistanceToNow } from 'date-fns'
import {
  CheckCircle2,
  CloudUpload,
  HardDriveDownload,
  HardDriveUpload,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../auth/use-auth'
import { useSync } from '../use-sync'
import type { SyncRole } from '../../../lib/sync'

function lastSyncedLabel(iso: string | null): string {
  if (!iso) return 'Never synced'
  try {
    return `Last synced ${formatDistanceToNow(new Date(iso), { addSuffix: true })}`
  } catch {
    return 'Synced'
  }
}

export function SyncSettingsSection() {
  const { overview, sync, chooseRole, fullResync } = useSync()
  const { refreshSession } = useAuth()
  const [busyRole, setBusyRole] = useState<SyncRole | null>(null)
  const [resyncing, setResyncing] = useState(false)

  // Sync isn't configured on this build (no cloud credentials) — hide entirely,
  // matching the sidebar widget's behavior.
  if (!overview.configured) return null

  async function handleChoose(role: SyncRole) {
    setBusyRole(role)
    try {
      const result = await chooseRole(role)
      // A secondary bootstrap wiped+re-pulled the users table, so the logged-in
      // user's local id changed. Re-resolve the session (by username) or new
      // rows get created_by = stale id → FK violation ("Unable to save").
      if (role === 'secondary' && !result.error) await refreshSession()
    } finally {
      setBusyRole(null)
    }
  }

  async function handleFullResync() {
    if (
      !window.confirm(
        'Re-upload this device’s entire dataset to the cloud? Use this if the cloud is missing data. Nothing on this device is deleted.',
      )
    ) {
      return
    }
    setResyncing(true)
    try {
      await fullResync()
    } finally {
      setResyncing(false)
    }
  }

  const busy = overview.syncing || resyncing

  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-4 py-8 md:grid-cols-[280px_1fr]">
      <div>
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-[var(--muted)]" />
          <h2 className="text-sm font-semibold">Device sync</h2>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          Share this business's data across devices through the cloud. Set up
          each device once, then everything syncs both ways automatically.
        </p>
      </div>

      <div className="w-full max-w-[480px] space-y-3 md:justify-self-end">
        {overview.needsSetup ? (
          <>
            <p className="text-xs text-[var(--foreground)]/80">
              This device hasn't joined sync yet. Choose how it starts — you only
              do this once:
            </p>

            <button
              className="flex w-full items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-left transition hover:border-[var(--accent)] disabled:opacity-60"
              disabled={busyRole != null}
              onClick={() => {
                void handleChoose('primary')
              }}
              type="button"
            >
              <HardDriveUpload className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-strong)]" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  This device is the source
                  {busyRole === 'primary' && (
                    <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />
                  )}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Uploads everything on this device to the cloud as the starting
                  point. Choose this on the ONE device that already holds the
                  correct, complete records.
                </p>
              </div>
            </button>

            <button
              className="flex w-full items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-left transition hover:border-[var(--accent)] disabled:opacity-60"
              disabled={busyRole != null}
              onClick={() => {
                void handleChoose('secondary')
              }}
              type="button"
            >
              <HardDriveDownload className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-strong)]" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  Copy the data from the source
                  {busyRole === 'secondary' && (
                    <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />
                  )}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Backs up this device's current data to a local file first, then
                  replaces it with the shared dataset from the source. Choose this
                  on devices that don't yet have the real records.
                </p>
              </div>
            </button>

            <p className="text-[11px] leading-relaxed text-amber-500/90">
              Set up the source device first, then the others. Picking "Copy the
              data" will replace this device's current data with the source's (a
              local backup is saved first).
            </p>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  This device
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                  {overview.role === 'primary' ? (
                    <>
                      <HardDriveUpload className="h-3.5 w-3.5 text-[var(--accent-strong)]" />
                      Source device
                    </>
                  ) : (
                    <>
                      <HardDriveDownload className="h-3.5 w-3.5 text-[var(--accent-strong)]" />
                      Synced copy
                    </>
                  )}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-xs">
                {overview.lastError ? (
                  <>
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span className="text-amber-500">
                      Last sync failed — {overview.lastError}
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    <span className="text-[var(--muted)]">
                      {lastSyncedLabel(overview.lastSyncedAt)}
                    </span>
                  </>
                )}
              </div>
            </div>

            <button
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)] disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                void sync()
              }}
              type="button"
            >
              <RefreshCw className={`h-4 w-4 ${overview.syncing ? 'animate-spin' : ''}`} />
              {overview.syncing ? 'Syncing…' : 'Sync now'}
            </button>

            {overview.role === 'primary' && (
              <div className="border-t border-[var(--border)] pt-3">
                <button
                  className="inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)] transition hover:text-[var(--accent)] disabled:opacity-50"
                  disabled={busy}
                  onClick={() => {
                    void handleFullResync()
                  }}
                  type="button"
                >
                  <CloudUpload className={`h-3.5 w-3.5 ${resyncing ? 'animate-pulse' : ''}`} />
                  {resyncing ? 'Re-uploading…' : 'Re-upload everything to the cloud'}
                </button>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
                  Use this if the cloud is missing records. Sends this device's
                  full dataset again; nothing here is deleted.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
