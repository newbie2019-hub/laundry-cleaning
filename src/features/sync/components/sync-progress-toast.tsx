import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  getSyncProgress,
  subscribeSyncProgress,
  type SyncProgressState,
} from '../../../lib/sync'

// A single, persistent toast (fixed id) that mirrors the running sync's live
// progress in the bottom-right. It stays up for the whole sync — across both
// business databases — and is dismissed the moment the sync finishes, whatever
// triggered it (app-open auto-sync, the "Sync now" button, or a full re-upload).
const TOAST_ID = 'sync-progress'

function count(n: number): string {
  return n.toLocaleString()
}

/** Human-readable line for the current phase, with a percentage when the total
 *  is known and a plain running count while a phase is still sizing itself. */
function describe(p: SyncProgressState): string {
  const prefix = p.businessLabel ? `${p.businessLabel} · ` : ''
  const pct =
    p.total > 0 ? ` (${Math.min(100, Math.round((p.processed / p.total) * 100))}%)` : ''
  switch (p.phase) {
    case 'preparing':
      return p.processed > 0
        ? `${prefix}Preparing ${count(p.processed)} records…`
        : `${prefix}Preparing…`
    case 'uploading':
      return p.total > 0
        ? `${prefix}Uploading ${count(p.processed)} / ${count(p.total)}${pct}`
        : `${prefix}Uploading ${count(p.processed)}…`
    case 'downloading':
      return `${prefix}Downloading ${count(p.processed)} changes…`
    case 'applying':
      return p.total > 0
        ? `${prefix}Applying ${count(p.processed)} / ${count(p.total)}${pct}`
        : `${prefix}Applying ${count(p.processed)}…`
    default:
      return `${prefix}Syncing…`
  }
}

/**
 * Renders nothing itself — it subscribes to the sync module's progress stream
 * and drives a sonner loading toast. Mount it once, high in the tree, so the
 * toast appears for every sync no matter where it was started from.
 */
export function SyncProgressToast() {
  const shownRef = useRef(false)

  useEffect(() => {
    const render = () => {
      const p = getSyncProgress()
      if (!p) {
        // Sync ended — clear the running toast. Final success/error messaging is
        // owned by the callers that started the sync (see use-sync.ts).
        if (shownRef.current) {
          toast.dismiss(TOAST_ID)
          shownRef.current = false
        }
        return
      }
      shownRef.current = true
      toast.loading('Syncing…', {
        id: TOAST_ID,
        description: describe(p),
        duration: Infinity,
      })
    }

    const unsubscribe = subscribeSyncProgress(render)
    render() // catch a sync already in flight when this mounts
    return () => {
      unsubscribe()
      toast.dismiss(TOAST_ID)
    }
  }, [])

  return null
}
