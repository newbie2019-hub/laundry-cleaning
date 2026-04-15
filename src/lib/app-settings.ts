const STORAGE_KEY = 'business-ledger.app-settings'

export type AppSettings = {
  name: string
  description: string
  logoDataUrl: string | null
}

const DEFAULTS: AppSettings = {
  name: 'Business Ledger',
  description: '',
  logoDataUrl: null,
}

export function loadAppSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(stored) as Partial<AppSettings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveAppSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent('app-settings-updated'))
}
