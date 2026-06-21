const STORAGE_KEY = 'business-ledger.assistant-settings'

export type AiProvider = 'claude' | 'gpt' | 'gemini' | 'auto'

export type AssistantSettings = {
  enabled: boolean
  provider: AiProvider
  apiKeys: {
    claude: string
    gpt: string
    gemini: string
  }
  models: {
    claude: string
    gpt: string
    gemini: string
  }
}

const DEFAULTS: AssistantSettings = {
  enabled: true,
  provider: 'auto',
  apiKeys: { claude: '', gpt: '', gemini: '' },
  models: {
    claude: 'claude-3-5-haiku-20241022',
    gpt: 'gpt-4o-mini',
    gemini: 'gemini-2.0-flash',
  },
}

export function loadAssistantSettings(): AssistantSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return structuredClone(DEFAULTS)
    const parsed = JSON.parse(stored) as Partial<AssistantSettings>
    return {
      ...DEFAULTS,
      ...parsed,
      apiKeys: { ...DEFAULTS.apiKeys, ...(parsed.apiKeys ?? {}) },
      models: { ...DEFAULTS.models, ...(parsed.models ?? {}) },
    }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

export function saveAssistantSettings(settings: AssistantSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent('assistant-settings-updated'))
}

export function hasAnyApiKey(settings: AssistantSettings): boolean {
  return !!(settings.apiKeys.claude || settings.apiKeys.gpt || settings.apiKeys.gemini)
}

export function getActiveApiKey(settings: AssistantSettings): { provider: Exclude<AiProvider, 'auto'>; apiKey: string; model: string } | null {
  if (!hasAnyApiKey(settings)) return null

  const order: Array<Exclude<AiProvider, 'auto'>> =
    settings.provider === 'auto'
      ? ['claude', 'gpt', 'gemini']
      : [settings.provider as Exclude<AiProvider, 'auto'>]

  for (const p of order) {
    const apiKey = settings.apiKeys[p]
    if (apiKey) return { provider: p, apiKey, model: settings.models[p] }
  }
  return null
}
