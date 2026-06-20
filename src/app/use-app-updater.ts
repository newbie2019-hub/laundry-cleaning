import { useEffect } from 'react'
import { toast } from 'sonner'
import { useUpdater } from './updater-context'

export function useAppUpdater() {
  const { checkForUpdates, installUpdate, status, update } = useUpdater()

  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdates()
    }, 3000)
    return () => clearTimeout(timer)
  // Only run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (status !== 'available' || !update) return

    toast.info(`Update available: v${update.version}`, {
      description: update.body ?? 'A new version is ready to install.',
      duration: Infinity,
      action: {
        label: 'Install & Restart',
        onClick: () => void installUpdate(),
      },
      cancel: {
        label: 'Later',
        onClick: () => {},
      },
    })
  }, [status, update, installUpdate])
}
