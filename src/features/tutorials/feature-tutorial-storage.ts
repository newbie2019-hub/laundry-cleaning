// Per-user, per-feature persistence for tutorial completion.
//
// Each feature tutorial has its own completion key so completing the
// Inventory tutorial does not silence the Transactions tutorial. Keys are
// namespaced by the lowercased username so the same admin keeps progress
// across business databases.
const PREFIX = 'business-ledger.tutorial.'

function key(featureKey: string, username: string): string {
  return `${PREFIX}${featureKey}.${username.toLowerCase()}.completed`
}

export function isFeatureTutorialCompleted(
  featureKey: string,
  username: string,
): boolean {
  try {
    return window.localStorage.getItem(key(featureKey, username)) === '1'
  } catch {
    return false
  }
}

export function markFeatureTutorialCompleted(
  featureKey: string,
  username: string,
): void {
  try {
    window.localStorage.setItem(key(featureKey, username), '1')
  } catch {
    // Non-fatal: storage might be unavailable (private mode).
  }
}

export function resetFeatureTutorial(
  featureKey: string,
  username: string,
): void {
  try {
    window.localStorage.removeItem(key(featureKey, username))
  } catch {
    // Non-fatal.
  }
}
