import type { ChangeEvent, FormEvent } from 'react'
import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { Check, Database, ImagePlus, Save, User, X } from 'lucide-react'
import { downloadDir } from '@tauri-apps/api/path'
import { useAuth } from '../../auth/use-auth'
import { loadAppSettings, saveAppSettings, type AppSettings } from '../../../lib/app-settings'
import { updateUserProfile, vacuumInto } from '../../../lib/db/repository'

const inputClass =
  'h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30'

export function SettingsPage() {
  const { user, refreshSession } = useAuth()

  const [appSettings, setAppSettings] = useState<AppSettings>(loadAppSettings)
  const [appSaved, setAppSaved] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const [isExporting, setIsExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  const [profileDisplayName, setProfileDisplayName] = useState(user?.displayName ?? '')
  const [profileUsername, setProfileUsername] = useState(user?.username ?? '')
  const [profileNewPassword, setProfileNewPassword] = useState('')
  const [profileConfirmPassword, setProfileConfirmPassword] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<{ text: string; ok: boolean } | null>(null)

  function handleSaveAppSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    saveAppSettings(appSettings)
    setAppSaved(true)
    setTimeout(() => setAppSaved(false), 2000)
  }

  function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result as string
      setAppSettings((prev) => ({ ...prev, logoDataUrl: result }))
    }
    reader.readAsDataURL(file)
  }

  function handleRemoveLogo() {
    setAppSettings((prev) => ({ ...prev, logoDataUrl: null }))
    if (logoInputRef.current) logoInputRef.current.value = ''
  }

  async function handleExportDatabase() {
    setIsExporting(true)
    setExportMessage(null)
    try {
      const downloads = await downloadDir()
      const filename = `business-ledger-backup-${format(new Date(), 'yyyy-MM-dd')}.db`
      const sep = downloads.endsWith('/') || downloads.endsWith('\\') ? '' : '/'
      const targetPath = `${downloads}${sep}${filename}`
      await vacuumInto(targetPath)
      setExportMessage(`Saved to: ${targetPath}`)
    } catch (err: unknown) {
      setExportMessage(
        `Backup failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      )
    } finally {
      setIsExporting(false)
    }
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    if (!profileDisplayName.trim() || !profileUsername.trim()) {
      setProfileMessage({ text: 'Display name and username are required.', ok: false })
      return
    }

    if (profileNewPassword && profileNewPassword !== profileConfirmPassword) {
      setProfileMessage({ text: 'Passwords do not match.', ok: false })
      return
    }

    if (profileNewPassword && profileNewPassword.length < 6) {
      setProfileMessage({ text: 'Password must be at least 6 characters.', ok: false })
      return
    }

    setProfileSaving(true)
    setProfileMessage(null)

    try {
      await updateUserProfile(user.id, {
        displayName: profileDisplayName.trim(),
        newPassword: profileNewPassword || undefined,
        username: profileUsername.trim(),
      })
      await refreshSession()
      setProfileNewPassword('')
      setProfileConfirmPassword('')
      setProfileMessage({ text: 'Profile updated.', ok: true })
      setTimeout(() => setProfileMessage(null), 3000)
    } catch (err: unknown) {
      setProfileMessage({
        text: err instanceof Error ? err.message : 'Unable to update profile.',
        ok: false,
      })
    } finally {
      setProfileSaving(false)
    }
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Manage your account, app branding, and database
        </p>
      </header>

      {/* Account */}
      {user && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-[var(--muted)]" />
              <h2 className="text-sm font-semibold">Account</h2>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Update your personal details</p>
          </div>
          <form className="p-5 space-y-5" onSubmit={handleSaveProfile}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  Display name
                </span>
                <input
                  className={inputClass}
                  onChange={(e) => setProfileDisplayName(e.target.value)}
                  placeholder="Your name"
                  value={profileDisplayName}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  Username
                </span>
                <input
                  className={inputClass}
                  onChange={(e) => setProfileUsername(e.target.value)}
                  placeholder="Username"
                  value={profileUsername}
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  New password
                </span>
                <input
                  className={inputClass}
                  onChange={(e) => setProfileNewPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
                  type="password"
                  value={profileNewPassword}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  Confirm password
                </span>
                <input
                  className={inputClass}
                  disabled={!profileNewPassword}
                  onChange={(e) => setProfileConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  type="password"
                  value={profileConfirmPassword}
                />
              </label>
            </div>

            <div className="flex items-center gap-3">
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                disabled={profileSaving}
                type="submit"
              >
                <Save className="h-3.5 w-3.5" />
                {profileSaving ? 'Saving…' : 'Update profile'}
              </button>
              {profileMessage && (
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${profileMessage.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                  {profileMessage.ok && <Check className="h-3 w-3" />}
                  {profileMessage.text}
                </span>
              )}
            </div>
          </form>
        </div>
      )}

      {/* App information */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold">App information</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Branding shown throughout the app</p>
        </div>
        <form className="p-5 space-y-5" onSubmit={handleSaveAppSettings}>
          <div className="space-y-2">
            <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Logo</span>
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
                {appSettings.logoDataUrl ? (
                  <img
                    alt="App logo"
                    className="h-full w-full object-contain"
                    src={appSettings.logoDataUrl}
                  />
                ) : (
                  <ImagePlus className="h-5 w-5 text-[var(--muted)]" />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
                  onClick={() => logoInputRef.current?.click()}
                  type="button"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  Upload image
                </button>
                {appSettings.logoDataUrl && (
                  <button
                    className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-[var(--muted)] transition hover:text-red-500"
                    onClick={handleRemoveLogo}
                    type="button"
                  >
                    <X className="h-3 w-3" />
                    Remove
                  </button>
                )}
              </div>
              <input
                accept="image/*"
                className="hidden"
                onChange={handleLogoChange}
                ref={logoInputRef}
                type="file"
              />
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">App name</span>
            <input
              className={inputClass}
              onChange={(e) => setAppSettings((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Business Ledger"
              value={appSettings.name}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Description</span>
            <textarea
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              onChange={(e) => setAppSettings((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="A short description of what this app tracks…"
              rows={3}
              value={appSettings.description}
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              type="submit"
            >
              <Save className="h-3.5 w-3.5" />
              {appSaved ? 'Saved!' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>

      {/* Database backup */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold">Database backup</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Export all app data for safekeeping
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 space-y-1">
            <p className="text-sm font-medium">Export database file</p>
            <p className="text-xs text-[var(--muted)]">
              Saves a complete copy of the SQLite database (<code>.db</code>) to your Downloads
              folder. The file can be opened with any SQLite browser and used to restore the app.
            </p>
          </div>

          {exportMessage && (
            <p className={`text-xs ${exportMessage.includes('failed') ? 'text-red-500' : 'text-emerald-500'}`}>
              {exportMessage}
            </p>
          )}

          <button
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)] disabled:opacity-50"
            disabled={isExporting}
            onClick={() => { void handleExportDatabase() }}
            type="button"
          >
            <Database className="h-4 w-4" />
            {isExporting ? 'Exporting…' : 'Download backup'}
          </button>
        </div>
      </div>
    </section>
  )
}
