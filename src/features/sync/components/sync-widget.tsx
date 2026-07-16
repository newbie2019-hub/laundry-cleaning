import { formatDistanceToNow } from 'date-fns'
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../auth/use-auth'
import { useSync } from '../use-sync'
import type { SyncRole } from '../../../lib/sync'
import { SyncSetupDialog } from './sync-setup-dialog'

function lastSyncedLabel(iso: string | null): string {
  if (!iso) return 'Never synced'
  try {
    return `Synced ${formatDistanceToNow(new Date(iso), { addSuffix: true })}`
  } catch {
    return 'Synced'
  }
}

export function SyncWidget({ collapsed }: { collapsed: boolean }) {
  const { overview, sync, chooseRole } = useSync()
  const { refreshSession } = useAuth()
  const [setupOpen, setSetupOpen] = useState(false)

  // A secondary bootstrap changes the logged-in user's local id (users table is
  // wiped+re-pulled), so re-resolve the session afterwards or saves fail with an
  // FK violation. See sync-settings-section for the full explanation.
  async function handleChoose(role: SyncRole) {
    const result = await chooseRole(role)
    if (role === 'secondary' && !result.error) await refreshSession()
    return result
  }

  // Sync isn't configured (no cloud credentials) — render nothing.
  if (!overview.configured) return null

  const spinning = overview.syncing

  function handleClick() {
    if (overview.needsSetup) {
      setSetupOpen(true)
    } else {
      void sync()
    }
  }

  const title = overview.needsSetup
    ? 'Set up device sync'
    : overview.resetPending
      ? 'Data was reset — sync to restore it from the cloud'
      : overview.lastError
        ? `Last sync failed: ${overview.lastError}`
        : lastSyncedLabel(overview.lastSyncedAt)

  if (collapsed) {
    return (
      <>
        <button
          aria-label={title}
          className="flex w-full items-center justify-center rounded-md py-2 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
          disabled={spinning}
          onClick={handleClick}
          title={title}
          type="button"
        >
          {overview.needsSetup ? (
            <CloudOff className="h-4 w-4" />
          ) : overview.lastError ? (
            <TriangleAlert className="h-4 w-4 text-amber-500" />
          ) : (
            <RefreshCw className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`} />
          )}
        </button>
        {setupOpen && (
          <SyncSetupDialog onChoose={handleChoose} onClose={() => setSetupOpen(false)} />
        )}
      </>
    )
  }

  return (
    <>
      <button
        className="flex w-full items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-left transition hover:border-[var(--accent)] disabled:opacity-70"
        disabled={spinning}
        onClick={handleClick}
        title={title}
        type="button"
      >
        {overview.needsSetup ? (
          <CloudOff className="h-4 w-4 shrink-0 text-[var(--accent-strong)]" />
        ) : overview.lastError ? (
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
        ) : (
          <RefreshCw
            className={`h-4 w-4 shrink-0 text-[var(--muted)] ${spinning ? 'animate-spin' : ''}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold leading-tight">
            {overview.needsSetup
              ? 'Set up sync'
              : spinning
                ? 'Syncing…'
                : 'Sync now'}
          </p>
          <p className="truncate text-[10px] leading-tight text-[var(--muted)] mt-0.5">
            {overview.needsSetup
              ? 'Tap to choose this device'
              : overview.resetPending
                ? 'Data reset — tap to restore from cloud'
                : overview.lastError
                  ? 'Last sync failed — tap to retry'
                  : lastSyncedLabel(overview.lastSyncedAt)}
          </p>
        </div>
      </button>
      {setupOpen && (
        <SyncSetupDialog onChoose={handleChoose} onClose={() => setSetupOpen(false)} />
      )}
    </>
  )
}
