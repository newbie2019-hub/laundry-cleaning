// Per-user persistence for the onboarding tour state so that:
//  - First-time users see the tour automatically.
//  - The current step survives the /select-business → /dashboard navigation.
//  - Users that skip/finish the tour don't see it again on next login.
//
// We key the tour state by username rather than numeric user id because the
// same admin has different numeric ids across the Laundry and Cleaning
// databases. Username is stable across both tenants, so completing the tour
// once carries across business switches.
const PREFIX = 'business-ledger.tour.'

function key(username: string, suffix: 'completed' | 'step') {
  return `${PREFIX}${username.toLowerCase()}.${suffix}`
}

export function isTourCompleted(username: string): boolean {
  try {
    return window.localStorage.getItem(key(username, 'completed')) === '1'
  } catch {
    return true
  }
}

export function markTourCompleted(username: string): void {
  try {
    window.localStorage.setItem(key(username, 'completed'), '1')
    window.localStorage.removeItem(key(username, 'step'))
  } catch {
    // Non-fatal: storage might be unavailable (private mode).
  }
}

export function resetTourProgress(username: string): void {
  try {
    window.localStorage.removeItem(key(username, 'completed'))
    window.localStorage.removeItem(key(username, 'step'))
  } catch {
    // Non-fatal.
  }
}

export function readTourStep(username: string): string | null {
  try {
    return window.localStorage.getItem(key(username, 'step'))
  } catch {
    return null
  }
}

export function writeTourStep(username: string, stepId: string | null): void {
  try {
    const k = key(username, 'step')
    if (stepId) {
      window.localStorage.setItem(k, stepId)
    } else {
      window.localStorage.removeItem(k)
    }
  } catch {
    // Non-fatal.
  }
}
