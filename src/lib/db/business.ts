// Tenant-style business definitions. Each business has its own SQLite database
// file (preloaded in `src-tauri/tauri.conf.json` and migrated in
// `src-tauri/src/db.rs`) so their data stays fully isolated, even though they
// share the exact same schema and feature set.

export type BusinessId = 'laundry' | 'cleaning'

export type BusinessDefinition = {
  id: BusinessId
  name: string
  shortName: string
  tagline: string
  dbUrl: string
  accent: string
}

export const BUSINESSES: Record<BusinessId, BusinessDefinition> = {
  cleaning: {
    accent: '#0ea5e9',
    dbUrl: 'sqlite:business-ledger-cleaning.db',
    id: 'cleaning',
    name: 'Cleaning Services',
    shortName: 'Cleaning',
    tagline: 'Dry cleaning and janitorial operations',
  },
  laundry: {
    accent: '#6366f1',
    dbUrl: 'sqlite:business-ledger.db',
    id: 'laundry',
    name: 'Laundry Services',
    shortName: 'Laundry',
    tagline: 'Wash, dry, and fold operations',
  },
}

export const BUSINESS_LIST: BusinessDefinition[] = [
  BUSINESSES.laundry,
  BUSINESSES.cleaning,
]

export const DEFAULT_BUSINESS: BusinessId = 'laundry'

const STORAGE_KEY = 'business-ledger.active-business'
const CHANGE_EVENT = 'business-ledger:active-business-changed'

function isBusinessId(value: unknown): value is BusinessId {
  return value === 'laundry' || value === 'cleaning'
}

export function getActiveBusinessId(): BusinessId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isBusinessId(stored)) {
      return stored
    }
  } catch {
    // Ignore storage access errors (e.g. private browsing).
  }
  return DEFAULT_BUSINESS
}

export function getActiveBusiness(): BusinessDefinition {
  return BUSINESSES[getActiveBusinessId()]
}

export function setActiveBusinessId(business: BusinessId) {
  const previous = getActiveBusinessId()
  window.localStorage.setItem(STORAGE_KEY, business)
  if (previous !== business) {
    window.dispatchEvent(
      new CustomEvent<BusinessId>(CHANGE_EVENT, { detail: business }),
    )
  }
}

export function subscribeToActiveBusiness(
  listener: (business: BusinessId) => void,
) {
  function handle(event: Event) {
    const detail = (event as CustomEvent<BusinessId>).detail
    if (isBusinessId(detail)) {
      listener(detail)
    }
  }
  window.addEventListener(CHANGE_EVENT, handle)
  return () => window.removeEventListener(CHANGE_EVENT, handle)
}
