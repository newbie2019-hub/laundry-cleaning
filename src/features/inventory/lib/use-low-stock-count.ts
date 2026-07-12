import { useCallback, useEffect, useState } from 'react'
import { listInventoryItems } from '../../../lib/db/repository'

export type LowStockSummary = {
  /** Items at or below their low-stock threshold (includes out-of-stock). */
  lowCount: number
  /** Subset of lowCount that is fully out of stock (currentStock <= 0). */
  outCount: number
  loading: boolean
  refresh: () => void
}

/**
 * Lightweight low-stock counter used for the in-app alert badge (app shell) and
 * the dashboard widget. Reads the active catalogue and counts items flagged
 * low. Re-fetches on mount and whenever the window regains focus, so the badge
 * stays roughly current without a global store. `isLowStock` already includes
 * out-of-stock items (currentStock <= threshold).
 */
export function useLowStockCount(): LowStockSummary {
  const [lowCount, setLowCount] = useState(0)
  const [outCount, setOutCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const items = await listInventoryItems()
      // Equipment isn't "restockable" — exclude it from stock alerts.
      const relevant = items.filter((i) => i.categoryCode !== 'equipment')
      setLowCount(relevant.filter((i) => i.isLowStock).length)
      setOutCount(relevant.filter((i) => i.currentStock <= 0).length)
    } catch {
      /* leave previous counts on failure */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  return { lowCount, outCount, loading, refresh: () => void refresh() }
}
