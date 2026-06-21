import type { ChangeEvent, FormEvent } from "react"
import { useEffect, useRef, useState } from "react"
import { format } from "date-fns"
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Database,
  Download,
  Gift,
  ImagePlus,
  Info,
  Loader2,
  Monitor,
  Moon,
  RefreshCw,
  Save,
  Sun,
  Trash2,
  Upload,
  User,
  Wallet,
  X,
} from "lucide-react"
import { useUpdater } from "../../../app/updater-context"
import { downloadDir } from "@tauri-apps/api/path"
import { useNavigate } from "react-router-dom"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { useAuth } from "../../auth/use-auth"
import { BackupImportDialog } from "../../backup/backup-import-dialog"
import { exportActiveBusinessToJson } from "../../backup/backup-export"
import {
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from "../../../lib/app-settings"
import {
  getLoyaltySettings,
  getPayrollSettings,
  resetAllData,
  saveLoyaltySettings,
  savePayrollSettings,
  updateUserProfile,
  vacuumInto,
} from "../../../lib/db/repository"
import {
  loadAssistantSettings,
  saveAssistantSettings,
  type AiProvider,
  type AssistantSettings,
} from "../../../lib/assistant-settings"
import { testApiKey } from "../../assistant/lib/cloud-parser"

const inputClass =
  "h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const

export function SettingsPage() {
  const { activeBusiness, hasPermission, signOut, user, refreshSession } = useAuth()
  const isCleaningBusiness = activeBusiness === 'cleaning'
  const navigate = useNavigate()
  const canManagePayrollSettings = hasPermission("manage_staff")
  const canManageMasterData = hasPermission("manage_master_data")
  const isAdmin = user?.roles.includes("admin") ?? false
  const { theme, setTheme } = useTheme()
  const {
    appVersion,
    checkForUpdates,
    downloadProgress,
    error: updaterError,
    installUpdate,
    status: updaterStatus,
    update,
  } = useUpdater()

  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState("")
  const [isResetting, setIsResetting] = useState(false)

  const [appSettings, setAppSettings] = useState<AppSettings>(loadAppSettings)
  const [appSaved, setAppSaved] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const [isExporting, setIsExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  const [isExportingJson, setIsExportingJson] = useState(false)
  const [jsonExportMessage, setJsonExportMessage] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importRefreshKey, setImportRefreshKey] = useState(0)

  const [profileDisplayName, setProfileDisplayName] = useState(
    user?.displayName ?? "",
  )
  const [profileUsername, setProfileUsername] = useState(user?.username ?? "")
  const [profileNewPassword, setProfileNewPassword] = useState("")
  const [profileConfirmPassword, setProfileConfirmPassword] = useState("")
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<{
    text: string
    ok: boolean
  } | null>(null)

  const [payrollCutoffDay, setPayrollCutoffDay] = useState(6)
  const [holidayMultiplier, setHolidayMultiplier] = useState(1)
  const [autoDeductCashAdvances, setAutoDeductCashAdvances] = useState(true)
  const [payrollSettingsLoading, setPayrollSettingsLoading] = useState(true)
  const [payrollSettingsSaving, setPayrollSettingsSaving] = useState(false)

  const [loyaltyKgPerLoad, setLoyaltyKgPerLoad] = useState(8)
  const [loyaltyFreeAfterLoads, setLoyaltyFreeAfterLoads] = useState(9)
  const [loyaltySettingsLoading, setLoyaltySettingsLoading] = useState(true)
  const [loyaltySettingsSaving, setLoyaltySettingsSaving] = useState(false)

  // AI Assistant settings
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings>(loadAssistantSettings)
  const [assistantSaved, setAssistantSaved] = useState(false)
  const [assistantTesting, setAssistantTesting] = useState(false)
  const [assistantTestResult, setAssistantTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [geminiModels, setGeminiModels] = useState<Array<{ id: string; displayName: string }>>([])
  const [fetchingGeminiModels, setFetchingGeminiModels] = useState(false)
  const [geminiModelError, setGeminiModelError] = useState<string | null>(null)

  useEffect(() => {
    if (!canManagePayrollSettings) {
      setPayrollSettingsLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const s = await getPayrollSettings()
        if (!cancelled) {
          setPayrollCutoffDay(s.cutoffDay)
          setHolidayMultiplier(s.holidayDefaultMultiplier)
          setAutoDeductCashAdvances(s.autoDeductCashAdvances)
        }
      } catch {
        if (!cancelled) {
          toast.error("Unable to load payroll settings.")
        }
      } finally {
        if (!cancelled) setPayrollSettingsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canManagePayrollSettings])

  useEffect(() => {
    if (!canManageMasterData) {
      setLoyaltySettingsLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const s = await getLoyaltySettings()
        if (!cancelled) {
          setLoyaltyKgPerLoad(s.kgPerLoad)
          setLoyaltyFreeAfterLoads(s.freeAfterLoads)
        }
      } catch {
        if (!cancelled) {
          toast.error("Unable to load loyalty settings.")
        }
      } finally {
        if (!cancelled) setLoyaltySettingsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canManageMasterData])

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
    if (logoInputRef.current) logoInputRef.current.value = ""
  }

  async function handleExportDatabase() {
    setIsExporting(true)
    setExportMessage(null)
    try {
      const downloads = await downloadDir()
      const filename = `business-ledger-backup-${format(new Date(), "yyyy-MM-dd")}.db`
      const sep = downloads.endsWith("/") || downloads.endsWith("\\") ? "" : "/"
      const targetPath = `${downloads}${sep}${filename}`
      await vacuumInto(targetPath)
      setExportMessage(`Saved to: ${targetPath}`)
      toast.success("Backup saved", {
        description: `Your database file was written to:\n${targetPath}`,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      setExportMessage(`Backup failed: ${msg}`)
      toast.error("Backup failed", { description: msg })
    } finally {
      setIsExporting(false)
    }
  }

  async function handleExportJson() {
    setIsExportingJson(true)
    setJsonExportMessage(null)
    try {
      const result = await exportActiveBusinessToJson()
      const totalRows = Object.values(result.counts).reduce(
        (acc, n) => acc + (typeof n === "number" ? n : 0),
        0,
      )
      setJsonExportMessage(`Saved ${result.filename} (${totalRows} rows).`)
      toast.success("Backup file written", {
        description: `${result.filename} (${(result.byteLength / 1024).toFixed(1)} KB)`,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      setJsonExportMessage(`Export failed: ${msg}`)
      toast.error("Export failed", { description: msg })
    } finally {
      setIsExportingJson(false)
    }
  }

  async function handleSavePayrollSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canManagePayrollSettings) return
    setPayrollSettingsSaving(true)
    try {
      await savePayrollSettings({
        autoDeductCashAdvances,
        cutoffDay: payrollCutoffDay,
        holidayDefaultMultiplier: holidayMultiplier,
      })
      toast.success("Payroll settings saved.")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unable to save payroll settings.")
    } finally {
      setPayrollSettingsSaving(false)
    }
  }

  async function handleSaveLoyaltySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canManageMasterData) return
    setLoyaltySettingsSaving(true)
    try {
      await saveLoyaltySettings({
        freeAfterLoads: loyaltyFreeAfterLoads,
        kgPerLoad: loyaltyKgPerLoad,
      })
      toast.success("Loyalty settings saved.")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unable to save loyalty settings.")
    } finally {
      setLoyaltySettingsSaving(false)
    }
  }

  function handleSaveAssistantSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    saveAssistantSettings(assistantSettings)
    setAssistantSaved(true)
    setAssistantTestResult(null)
    setTimeout(() => setAssistantSaved(false), 2000)
  }

  async function handleTestConnection() {
    setAssistantTesting(true)
    setAssistantTestResult(null)
    try {
      const provider = assistantSettings.provider === 'auto' ? 'claude' : assistantSettings.provider
      const key = assistantSettings.apiKeys[provider as Exclude<AiProvider, 'auto'>]
      if (!key) {
        setAssistantTestResult({ ok: false, msg: 'No API key entered for this provider.' })
        return
      }
      const error = await testApiKey({
        provider: provider as Exclude<AiProvider, 'auto'>,
        apiKey: key,
        model: assistantSettings.models[provider as Exclude<AiProvider, 'auto'>],
      })
      if (error) {
        setAssistantTestResult({ ok: false, msg: error })
      } else {
        setAssistantTestResult({ ok: true, msg: 'Connection successful!' })
      }
    } catch (err) {
      setAssistantTestResult({ ok: false, msg: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setAssistantTesting(false)
    }
  }

  async function handleFetchGeminiModels() {
    const key = assistantSettings.apiKeys.gemini.trim()
    if (!key) {
      setGeminiModelError('Enter your Gemini API key first.')
      return
    }
    setFetchingGeminiModels(true)
    setGeminiModelError(null)
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=50`,
      )
      if (!res.ok) {
        let detail = ''
        try { detail = `: ${((await res.json()) as { error?: { message?: string } }).error?.message ?? res.status}` } catch { /* ignore */ }
        throw new Error(`Failed to fetch models${detail}`)
      }
      const data = (await res.json()) as {
        models: Array<{ name: string; displayName: string; supportedGenerationMethods?: string[] }>
      }
      const filtered = (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent') ?? true)
        .map((m) => ({
          id: m.name.replace('models/', ''),
          displayName: m.displayName,
        }))
      if (!filtered.length) throw new Error('No generateContent models found for this key.')
      setGeminiModels(filtered)
      // Auto-select current model if it exists in the list, otherwise pick first
      const current = assistantSettings.models.gemini
      const exists = filtered.some((m) => m.id === current)
      if (!exists) {
        const preferred = filtered.find((m) => m.id.includes('flash')) ?? filtered[0]
        setAssistantSettings((prev) => ({ ...prev, models: { ...prev.models, gemini: preferred.id } }))
      }
    } catch (err) {
      setGeminiModelError(err instanceof Error ? err.message : 'Failed to fetch models')
    } finally {
      setFetchingGeminiModels(false)
    }
  }

  function openResetDialog() {
    setResetConfirmText("")
    setResetDialogOpen(true)
  }

  function closeResetDialog() {
    if (isResetting) return
    setResetDialogOpen(false)
    setResetConfirmText("")
  }

  async function handleResetAllData() {
    if (resetConfirmText.trim() !== "RESET") return
    setIsResetting(true)
    try {
      await resetAllData()
      toast.success("All data reset", {
        description: "Every record has been cleared. Only your admin account remains.",
      })
      setResetDialogOpen(false)
      setResetConfirmText("")
      signOut()
      navigate("/login", { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unable to reset data."
      toast.error("Reset failed", { description: msg })
    } finally {
      setIsResetting(false)
    }
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    if (!profileDisplayName.trim() || !profileUsername.trim()) {
      setProfileMessage({
        text: "Display name and username are required.",
        ok: false,
      })
      return
    }

    if (profileNewPassword && profileNewPassword !== profileConfirmPassword) {
      setProfileMessage({ text: "Passwords do not match.", ok: false })
      return
    }

    if (profileNewPassword && profileNewPassword.length < 6) {
      setProfileMessage({
        text: "Password must be at least 6 characters.",
        ok: false,
      })
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
      setProfileNewPassword("")
      setProfileConfirmPassword("")
      setProfileMessage({ text: "Profile updated.", ok: true })
      setTimeout(() => setProfileMessage(null), 3000)
    } catch (err: unknown) {
      setProfileMessage({
        text: err instanceof Error ? err.message : "Unable to update profile.",
        ok: false,
      })
    } finally {
      setProfileSaving(false)
    }
  }

  return (
    <section className="mx-auto max-w-6xl">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Manage your account, appearance, app branding, and database
        </p>
      </header>

      <div className="divide-y divide-[var(--border)]">
        {/* Appearance */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 py-8 first:pt-0 md:grid-cols-[280px_1fr]">
          <div>
            <h2 className="text-sm font-semibold">Appearance</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              Choose how the app looks. Select a light or dark theme, or follow
              your system preference.
            </p>
          </div>
          <div className="md:justify-self-end md:max-w-[480px] md:w-full">
            <span className="mb-2 block text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              Theme
            </span>
            <div className="flex gap-2">
              {themeOptions.map((opt) => {
                const Icon = opt.icon
                const active = theme === opt.value
                return (
                  <button
                    key={opt.value}
                    className={[
                      "inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition",
                      active
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                        : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--accent)]/50",
                    ].join(" ")}
                    onClick={() => setTheme(opt.value)}
                    type="button"
                  >
                    <Icon className="h-4 w-4" />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Account */}
        {user && (
          <div className="grid grid-cols-1 gap-x-10 gap-y-4 py-8 md:grid-cols-[280px_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-[var(--muted)]" />
                <h2 className="text-sm font-semibold">Account</h2>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                Update your display name, username, and password. Changes take
                effect immediately.
              </p>
            </div>
            <form
              className="w-full max-w-[480px] space-y-4 md:justify-self-end"
              onSubmit={handleSaveProfile}
            >
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

              <div className="flex items-center justify-end gap-3">
                {profileMessage && (
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${profileMessage.ok ? "text-emerald-500" : "text-red-500"}`}
                  >
                    {profileMessage.ok && <Check className="h-3 w-3" />}
                    {profileMessage.text}
                  </span>
                )}
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  disabled={profileSaving}
                  type="submit"
                >
                  <Save className="h-3.5 w-3.5" />
                  {profileSaving ? "Saving…" : "Update profile"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* AI Assistant */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 py-8 md:grid-cols-[280px_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-[var(--muted)]" />
              <h2 className="text-sm font-semibold">AI Assistant</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              Connect an AI provider to get better natural language understanding. When offline or no key is set, the assistant uses a built-in local parser.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-amber-500/80">
              API keys are stored locally on this device only.
            </p>
          </div>
          <form
            className="w-full max-w-[480px] space-y-4 md:justify-self-end"
            onSubmit={handleSaveAssistantSettings}
          >
            {/* Enable toggle */}
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5">
              <input
                checked={assistantSettings.enabled}
                className="mt-0.5 h-4 w-4 rounded border-[var(--border)]"
                onChange={(e) => setAssistantSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
                type="checkbox"
              />
              <span className="flex-1">
                <span className="block text-sm font-medium">Enable AI Assistant</span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">Show the floating assistant button on all pages.</span>
              </span>
            </label>

            {/* Provider */}
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Provider</span>
              <select
                className={inputClass}
                onChange={(e) => setAssistantSettings((prev) => ({ ...prev, provider: e.target.value as AiProvider }))}
                value={assistantSettings.provider}
              >
                <option value="auto">Auto (first available key)</option>
                <option value="claude">Claude (Anthropic)</option>
                <option value="gpt">GPT (OpenAI)</option>
                <option value="gemini">Gemini (Google)</option>
              </select>
            </label>

            {/* Claude key */}
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Claude API Key</span>
              <div className="relative">
                <input
                  className={inputClass}
                  onChange={(e) => setAssistantSettings((prev) => ({ ...prev, apiKeys: { ...prev.apiKeys, claude: e.target.value } }))}
                  placeholder="sk-ant-…"
                  type={showKeys['claude'] ? 'text' : 'password'}
                  value={assistantSettings.apiKeys.claude}
                />
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"
                  onClick={() => setShowKeys((p) => ({ ...p, claude: !p['claude'] }))}
                  type="button"
                >
                  {showKeys['claude'] ? 'hide' : 'show'}
                </button>
              </div>
              <input
                className={`${inputClass} mt-1`}
                onChange={(e) => setAssistantSettings((prev) => ({ ...prev, models: { ...prev.models, claude: e.target.value } }))}
                placeholder="Model (e.g. claude-3-5-haiku-20241022)"
                value={assistantSettings.models.claude}
              />
            </label>

            {/* GPT key */}
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">OpenAI (GPT) API Key</span>
              <div className="relative">
                <input
                  className={inputClass}
                  onChange={(e) => setAssistantSettings((prev) => ({ ...prev, apiKeys: { ...prev.apiKeys, gpt: e.target.value } }))}
                  placeholder="sk-…"
                  type={showKeys['gpt'] ? 'text' : 'password'}
                  value={assistantSettings.apiKeys.gpt}
                />
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"
                  onClick={() => setShowKeys((p) => ({ ...p, gpt: !p['gpt'] }))}
                  type="button"
                >
                  {showKeys['gpt'] ? 'hide' : 'show'}
                </button>
              </div>
              <input
                className={`${inputClass} mt-1`}
                onChange={(e) => setAssistantSettings((prev) => ({ ...prev, models: { ...prev.models, gpt: e.target.value } }))}
                placeholder="Model (e.g. gpt-4o-mini)"
                value={assistantSettings.models.gpt}
              />
            </label>

            {/* Gemini key */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Gemini (Google) API Key</span>
              <div className="relative">
                <input
                  className={inputClass}
                  onChange={(e) => {
                    setAssistantSettings((prev) => ({ ...prev, apiKeys: { ...prev.apiKeys, gemini: e.target.value } }))
                    setGeminiModels([])
                    setGeminiModelError(null)
                  }}
                  placeholder="AIza…"
                  type={showKeys['gemini'] ? 'text' : 'password'}
                  value={assistantSettings.apiKeys.gemini}
                />
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"
                  onClick={() => setShowKeys((p) => ({ ...p, gemini: !p['gemini'] }))}
                  type="button"
                >
                  {showKeys['gemini'] ? 'hide' : 'show'}
                </button>
              </div>

              {/* Gemini model selector */}
              <div className="flex items-center gap-2 mt-1">
                {geminiModels.length > 0 ? (
                  <select
                    className={`${inputClass} flex-1`}
                    onChange={(e) => setAssistantSettings((prev) => ({ ...prev, models: { ...prev.models, gemini: e.target.value } }))}
                    value={assistantSettings.models.gemini}
                  >
                    {geminiModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.displayName} ({m.id})</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={`${inputClass} flex-1`}
                    onChange={(e) => setAssistantSettings((prev) => ({ ...prev, models: { ...prev.models, gemini: e.target.value } }))}
                    placeholder="Model (e.g. gemini-2.0-flash)"
                    value={assistantSettings.models.gemini}
                  />
                )}
                <button
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 disabled:opacity-50"
                  disabled={fetchingGeminiModels || !assistantSettings.apiKeys.gemini.trim()}
                  onClick={() => { void handleFetchGeminiModels() }}
                  title="Fetch available models from your API key"
                  type="button"
                >
                  {fetchingGeminiModels
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                  {geminiModels.length > 0 ? 'Refresh' : 'Fetch models'}
                </button>
              </div>
              {geminiModelError && (
                <p className="text-xs text-red-500 mt-1">{geminiModelError}</p>
              )}
              {geminiModels.length > 0 && (
                <p className="text-[10px] text-[var(--muted)]">{geminiModels.length} models loaded from your API key.</p>
              )}
            </div>

            {assistantTestResult && (
              <span className={`inline-flex items-center gap-1 text-xs font-medium ${assistantTestResult.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                {assistantTestResult.ok && <Check className="h-3 w-3" />}
                {assistantTestResult.msg}
              </span>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 disabled:opacity-50"
                disabled={assistantTesting}
                onClick={() => { void handleTestConnection() }}
                type="button"
              >
                {assistantTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Info className="h-3.5 w-3.5" />}
                Test connection
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                type="submit"
              >
                <Save className="h-3.5 w-3.5" />
                {assistantSaved ? 'Saved!' : 'Save AI settings'}
              </button>
            </div>
          </form>
        </div>

        {/* App information */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 py-8 md:grid-cols-[280px_1fr]">
          <div>
            <h2 className="text-sm font-semibold">App information</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              Branding shown throughout the app including the sidebar, login
              screen, and exports.
            </p>
          </div>
          <form
            className="w-full max-w-[480px] space-y-5 md:justify-self-end"
            onSubmit={handleSaveAppSettings}
          >
            <div className="space-y-2">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Logo
              </span>
              <div className="flex items-center gap-4">
                <button
                  className="group relative flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden transition hover:border-[var(--accent)]/50"
                  onClick={() => logoInputRef.current?.click()}
                  type="button"
                >
                  {appSettings.logoDataUrl ? (
                    <img
                      alt="App logo"
                      className="h-full w-full object-contain"
                      src={appSettings.logoDataUrl}
                    />
                  ) : (
                    <ImagePlus className="h-5 w-5 text-[var(--muted)]" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                    <ImagePlus className="h-4 w-4 text-white" />
                  </div>
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
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                App name
              </span>
              <input
                className={inputClass}
                onChange={(e) =>
                  setAppSettings((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Business Ledger"
                value={appSettings.name}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Description
              </span>
              <textarea
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                onChange={(e) =>
                  setAppSettings((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="A short description of what this app tracks…"
                rows={3}
                value={appSettings.description}
              />
            </label>

            <div className="flex justify-end">
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                type="submit"
              >
                <Save className="h-3.5 w-3.5" />
                {appSaved ? "Saved!" : "Save changes"}
              </button>
            </div>
          </form>
        </div>

        {/* Payroll (staff) */}
        {canManagePayrollSettings && (
          <div className="grid grid-cols-1 gap-x-10 gap-y-4 py-8 md:grid-cols-[280px_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-[var(--muted)]" />
                <h2 className="text-sm font-semibold">Payroll</h2>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                Weekly payroll periods end on this weekday. Holiday attendance
                status uses this multiplier unless changed on a specific day.
              </p>
            </div>
            {payrollSettingsLoading ? (
              <p className="text-sm text-[var(--muted)] md:justify-self-end">Loading…</p>
            ) : (
              <form
                className="w-full max-w-[480px] space-y-4 md:justify-self-end"
                onSubmit={handleSavePayrollSettings}
              >
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                    Week ends on (cutoff)
                  </span>
                  <select
                    className={inputClass}
                    onChange={(e) => setPayrollCutoffDay(Number(e.target.value))}
                    value={payrollCutoffDay}
                  >
                    {WEEKDAY_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                    Holiday default multiplier
                  </span>
                  <input
                    className={inputClass}
                    min={0}
                    onChange={(e) => setHolidayMultiplier(Number(e.target.value) || 0)}
                    step="0.01"
                    type="number"
                    value={holidayMultiplier}
                  />
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5">
                  <input
                    checked={autoDeductCashAdvances}
                    className="mt-0.5 h-4 w-4 rounded border-[var(--border)]"
                    onChange={(e) => setAutoDeductCashAdvances(e.target.checked)}
                    type="checkbox"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">
                      Auto-apply outstanding cash advances on payroll
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">
                      When enabled, cash advances are pre-checked in the payroll dialog and
                      deducted by default. You can still uncheck individual advances when
                      processing payroll to defer them.
                    </span>
                  </span>
                </label>
                <div className="flex justify-end">
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                    disabled={payrollSettingsSaving}
                    type="submit"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {payrollSettingsSaving ? "Saving…" : "Save payroll settings"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Loyalty (loads) — laundry only */}
        {canManageMasterData && !isCleaningBusiness && (
          <div className="grid grid-cols-1 gap-x-10 gap-y-4 border-t border-[var(--border)] py-8 md:grid-cols-[280px_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-[var(--muted)]" />
                <h2 className="text-sm font-semibold">Loyalty</h2>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                Customize the loyalty card. By default, 1 load equals 8 kg — adjust this to
                match how you charge. The free-load threshold controls how many paid loads
                a customer needs before earning a free one. Loyalty must be enabled per
                customer on the Customers page.
              </p>
            </div>
            {loyaltySettingsLoading ? (
              <p className="text-sm text-[var(--muted)] md:justify-self-end">Loading…</p>
            ) : (
              <form
                className="w-full max-w-[480px] space-y-4 md:justify-self-end"
                onSubmit={handleSaveLoyaltySettings}
              >
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                    Kilograms per load
                  </span>
                  <input
                    className={inputClass}
                    min={0.1}
                    onChange={(e) => setLoyaltyKgPerLoad(Number(e.target.value) || 0)}
                    step="0.1"
                    type="number"
                    value={loyaltyKgPerLoad}
                  />
                  <span className="block text-xs text-[var(--muted)]">
                    Default: 1 load = 8 kg. Change this to match your pricing.
                  </span>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                    Paid loads per free load
                  </span>
                  <input
                    className={inputClass}
                    min={1}
                    onChange={(e) =>
                      setLoyaltyFreeAfterLoads(Math.max(1, Math.floor(Number(e.target.value) || 0)))
                    }
                    step="1"
                    type="number"
                    value={loyaltyFreeAfterLoads}
                  />
                  <span className="block text-xs text-[var(--muted)]">
                    Customer earns a free load after {loyaltyFreeAfterLoads} paid loads.
                  </span>
                </label>
                <div className="flex justify-end">
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                    disabled={loyaltySettingsSaving}
                    type="submit"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {loyaltySettingsSaving ? "Saving…" : "Save loyalty settings"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Backup & Sync (manual JSON export/import for cross-device sync) */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 py-8 md:grid-cols-[280px_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-[var(--muted)]" />
              <h2 className="text-sm font-semibold">Backup &amp; Sync</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              Export every transaction, customer, staff record, inventory item,
              and incident report from this business as a single JSON file you
              can copy to another device. The importer skips identical rows and
              asks you per row whether to overwrite anything that conflicts.
              User accounts and permissions are intentionally not included.
            </p>
          </div>
          <div className="w-full max-w-[480px] space-y-3 md:justify-self-end">
            {jsonExportMessage && (
              <p
                className={`text-xs ${jsonExportMessage.includes("failed") ? "text-red-500" : "text-emerald-500"}`}
              >
                {jsonExportMessage}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)] disabled:opacity-50"
                disabled={isExportingJson}
                onClick={() => {
                  void handleExportJson()
                }}
                type="button"
              >
                <Download className="h-4 w-4" />
                {isExportingJson ? "Exporting…" : "Export all data (.json)"}
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
                onClick={() => setImportDialogOpen(true)}
                type="button"
              >
                <Upload className="h-4 w-4" />
                Import from .json
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              Tip: copy the file to a USB drive or send it through any chat app — it's
              just text.
            </p>
          </div>
        </div>

        {/* Database backup */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 py-8 md:grid-cols-[280px_1fr]">
          <div>
            <h2 className="text-sm font-semibold">Database backup</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              Export all app data for safekeeping. The backup includes every
              record in the database and can be used to fully restore the app.
            </p>
          </div>
          <div className="w-full max-w-[480px] space-y-4 md:justify-self-end">
            {exportMessage && (
              <p
                className={`text-xs ${exportMessage.includes("failed") ? "text-red-500" : "text-emerald-500"}`}
              >
                {exportMessage}
              </p>
            )}
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)] disabled:opacity-50"
              disabled={isExporting}
              onClick={() => {
                void handleExportDatabase()
              }}
              type="button"
            >
              <Database className="h-4 w-4" />
              {isExporting ? "Exporting…" : "Download backup"}
            </button>
          </div>
        </div>

        {/* About & Updates */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 py-8 md:grid-cols-[280px_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-[var(--muted)]" />
              <h2 className="text-sm font-semibold">About &amp; Updates</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              Current version and software updates. The app checks for updates
              automatically on startup.
            </p>
          </div>
          <div className="w-full max-w-[480px] space-y-4 md:justify-self-end">
            <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Version
              </span>
              <span className="font-mono text-sm font-medium">
                {appVersion ? `v${appVersion}` : '—'}
              </span>
            </div>

            {/* Update status card */}
            {updaterStatus === 'available' && update && (
              <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-4 py-3 space-y-3">
                <div className="flex items-start gap-2">
                  <Download className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-strong)]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--accent-strong)]">
                      v{update.version} available
                    </p>
                    {update.body && (
                      <p className="mt-0.5 text-xs text-[var(--muted)] line-clamp-3">
                        {update.body}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  disabled={updaterStatus !== 'available'}
                  onClick={() => void installUpdate()}
                  type="button"
                >
                  <Download className="h-4 w-4" />
                  Install &amp; Restart
                </button>
              </div>
            )}

            {(updaterStatus === 'downloading' || updaterStatus === 'installing') && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">
                    {updaterStatus === 'installing' ? 'Installing…' : 'Downloading…'}
                  </span>
                  {downloadProgress !== null && (
                    <span className="tabular-nums text-[var(--muted)]">{downloadProgress}%</span>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                    style={{ width: `${downloadProgress ?? 0}%` }}
                  />
                </div>
              </div>
            )}

            {updaterStatus === 'up-to-date' && (
              <div className="flex items-center gap-2 text-sm text-emerald-500">
                <CheckCircle2 className="h-4 w-4" />
                You're on the latest version.
              </div>
            )}

            {updaterStatus === 'error' && updaterError && (
              <p className="text-xs text-red-500">{updaterError}</p>
            )}

            <button
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)] disabled:opacity-50"
                disabled={updaterStatus === 'checking' || updaterStatus === 'downloading' || updaterStatus === 'installing'}
                onClick={() => void checkForUpdates()}
                type="button"
              >
                {updaterStatus === 'checking' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {updaterStatus === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>
          </div>
        </div>

        {/* Danger zone (admin only) */}
        {isAdmin && (
          <div className="grid grid-cols-1 gap-x-10 gap-y-4 py-8 md:grid-cols-[280px_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <h2 className="text-sm font-semibold text-red-500">Danger zone</h2>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                Permanently delete every transaction, customer, staff member,
                inventory item, incident report, and non-admin user. Your admin
                account and the app's master data will be kept. This cannot be
                undone — export a backup first.
              </p>
            </div>
            <div className="w-full max-w-[480px] md:justify-self-end">
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
                <p className="text-sm font-medium text-red-500">
                  Reset all data
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                  You'll be signed out after the reset and sent back to the
                  login screen.
                </p>
                <button
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-500 transition hover:bg-red-500/20 disabled:opacity-50"
                  onClick={openResetDialog}
                  type="button"
                >
                  <Trash2 className="h-4 w-4" />
                  Reset data…
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {resetDialogOpen && (
        <div
          aria-labelledby="reset-dialog-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeResetDialog}
          role="dialog"
        >
          <div
            className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold" id="reset-dialog-title">
                  Reset all data?
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                  This permanently deletes every transaction, customer, staff
                  member, attendance record, payroll, cash advance, inventory
                  item, movement, incident report, and non-admin user. Your
                  admin account and app settings are preserved. This cannot be
                  undone.
                </p>
              </div>
            </div>

            <label className="mt-5 block space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Type <span className="font-mono text-red-500">RESET</span> to confirm
              </span>
              <input
                autoFocus
                className={inputClass}
                disabled={isResetting}
                onChange={(event) => setResetConfirmText(event.target.value)}
                placeholder="RESET"
                value={resetConfirmText}
              />
            </label>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 disabled:opacity-50"
                disabled={isResetting}
                onClick={closeResetDialog}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isResetting || resetConfirmText.trim() !== "RESET"}
                onClick={() => {
                  void handleResetAllData()
                }}
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isResetting ? "Resetting…" : "Permanently reset"}
              </button>
            </div>
          </div>
        </div>
      )}

      <BackupImportDialog
        key={importRefreshKey}
        onApplied={() => {
          // Bump the key so the next time the dialog is reopened it starts
          // fresh; also nudge any other in-memory caches by reloading the
          // settings the user can see on this page.
          setImportRefreshKey((k) => k + 1)
          void Promise.all([
            getLoyaltySettings(),
            getPayrollSettings(),
          ]).then(([loyalty, payroll]) => {
            setLoyaltyKgPerLoad(loyalty.kgPerLoad)
            setLoyaltyFreeAfterLoads(loyalty.freeAfterLoads)
            setPayrollCutoffDay(payroll.cutoffDay)
            setHolidayMultiplier(payroll.holidayDefaultMultiplier)
            setAutoDeductCashAdvances(payroll.autoDeductCashAdvances)
          }).catch(() => {
            /* refreshing the visible settings is best-effort */
          })
        }}
        onClose={() => setImportDialogOpen(false)}
        open={importDialogOpen}
      />
    </section>
  )
}
