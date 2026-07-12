import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { subscribeToActiveBusiness } from '../../lib/db/business'
import {
  chooseDeviceRole,
  getSyncOverview,
  runFullResync,
  runSync,
  subscribeSync,
  type SyncOverview,
  type SyncRole,
} from '../../lib/sync'

const EMPTY: SyncOverview = {
  configured: false,
  needsSetup: false,
  resetPending: false,
  role: null,
  bootstrapped: false,
  lastSyncedAt: null,
  lastError: null,
  syncing: false,
}

export function useSync() {
  const [overview, setOverview] = useState<SyncOverview>(EMPTY)

  const refresh = useCallback(() => {
    getSyncOverview()
      .then(setOverview)
      .catch(() => setOverview(EMPTY))
  }, [])

  useEffect(() => {
    refresh()
    const unsubscribeSync = subscribeSync(refresh)
    const unsubscribeBusiness = subscribeToActiveBusiness(refresh)
    return () => {
      unsubscribeSync()
      unsubscribeBusiness()
    }
  }, [refresh])

  const sync = useCallback(async () => {
    const result = await runSync()
    if (result.error === 'needs-setup') {
      refresh()
      return result
    }
    if (result.error) {
      toast.error(`Sync failed — ${result.error}`)
    } else {
      const changes = result.pushed + result.pulled + result.deleted
      toast.success(changes === 0 ? 'Already up to date' : 'Sync complete')
    }
    refresh()
    return result
  }, [refresh])

  const fullResync = useCallback(async () => {
    const result = await runFullResync()
    if (result.error) {
      toast.error(`Re-upload failed — ${result.error}`)
    } else {
      toast.success(`Re-uploaded everything — ${result.pushed} record(s) sent`)
    }
    refresh()
    return result
  }, [refresh])

  const chooseRole = useCallback(
    async (role: SyncRole) => {
      await chooseDeviceRole(role)
      const result = await runSync()
      if (result.error && result.error !== 'needs-setup') {
        toast.error(`First sync failed — ${result.error}`)
      } else {
        toast.success(
          role === 'primary'
            ? 'This device is now the primary. Data uploaded.'
            : 'This device is now synced from the primary.',
        )
      }
      refresh()
      return result
    },
    [refresh],
  )

  return { overview, sync, chooseRole, fullResync, refresh }
}
