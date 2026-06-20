import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

// Updates are only meaningful in production builds. In dev mode the endpoint
// hasn't been published yet, so any check will always fail.
const IS_DEV = import.meta.env.DEV

type UpdaterStatus =
  | 'idle'
  | 'dev'          // running in dev / debug mode — checks are skipped
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error'

interface UpdaterState {
  appVersion: string | null
  status: UpdaterStatus
  update: Update | null
  downloadProgress: number | null
  error: string | null
  checkForUpdates: () => Promise<void>
  installUpdate: () => Promise<void>
}

const UpdaterContext = createContext<UpdaterState | null>(null)

export function UpdaterProvider({ children }: PropsWithChildren) {
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [status, setStatus] = useState<UpdaterStatus>(IS_DEV ? 'dev' : 'idle')
  const [update, setUpdate] = useState<Update | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {})
  }, [])

  const checkForUpdates = useCallback(async () => {
    if (IS_DEV) return
    setStatus('checking')
    setError(null)
    setUpdate(null)
    try {
      const result = await check()
      if (result) {
        setUpdate(result)
        setStatus('available')
      } else {
        setStatus('up-to-date')
      }
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Update check failed.')
    }
  }, [])

  const installUpdate = useCallback(async () => {
    if (!update) return
    setStatus('downloading')
    setDownloadProgress(0)
    let contentLength = 0
    let downloaded = 0
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength ?? 0
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          if (contentLength > 0) {
            setDownloadProgress(Math.round((downloaded / contentLength) * 100))
          }
        } else if (event.event === 'Finished') {
          setStatus('installing')
          setDownloadProgress(100)
        }
      })
      await relaunch()
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Installation failed.')
    }
  }, [update])

  return (
    <UpdaterContext value={{ appVersion, checkForUpdates, downloadProgress, error, installUpdate, status, update }}>
      {children}
    </UpdaterContext>
  )
}

export function useUpdater() {
  const ctx = useContext(UpdaterContext)
  if (!ctx) throw new Error('useUpdater must be used within UpdaterProvider')
  return ctx
}
