import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Banknote,
  Download,
  Package,
  Scale,
  Skull,
  TrendingDown,
  TrendingUp,
  Wrench,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency, formatMonthLabel } from '../../../lib/format'
import {
  getEquipmentStatusSummary,
  getInventoryActionCounts,
  getInventoryCategoryBreakdown,
  getInventoryCoverage,
  getInventoryDailyTrend,
  getInventoryItemSummaries,
  getInventoryMonthlyTrend,
  getInventoryWastage,
  getLowStockItems,
  getRecentInventoryMovements,
  getSlowMovers,
  type EquipmentStatusItem,
  type InventoryCategoryBreakdownRow,
  type InventoryCoverageRow,
  type InventoryDailyTrend,
  type InventoryItemSummary,
  type InventoryMonthlyTrend,
  type InventoryMovement,
  type InventoryWastageSummary,
  type LowStockItem,
  type SlowMoverItem,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'
import { QuickMovementModal } from '../components/quick-movement-modal'

const ITEM_CATEGORIES = [
  { value: 'consumable', label: 'Consumable' },
  { value: 'detergent_chemicals', label: 'Detergent & Chemicals' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'cleaning_materials', label: 'Cleaning Materials' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'other', label: 'Other' },
] as const

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  ITEM_CATEGORIES.map((c) => [c.value, c.label]),
)

const STATUS_LABELS: Record<string, string> = {
  operational: 'Operational',
  maintenance: 'Under Maintenance',
  out_of_service: 'Out of Service',
  retired: 'Retired',
  unknown: 'Unknown',
}

const EQUIPMENT_STATUS_ORDER = ['out_of_service', 'maintenance', 'retired', 'operational', 'unknown'] as const

function SectionHeading({
  action,
  id,
  subtitle,
  title,
}: {
  action?: React.ReactNode
  id?: string
  subtitle?: string
  title: string
}) {
  return (
    <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between" id={id}>
      <div>
        <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
        {subtitle && <p className="text-xs text-[var(--muted)] mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  bg,
}: {
  bg: string
  color: string
  icon: LucideIcon
  label: string
  sub?: string
  value: string
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  )
}

function formatQty(qty: number, unitLabel?: string) {
  const formatted = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  return unitLabel ? `${formatted} ${unitLabel}` : formatted
}

function scrollToId(anchor: string) {
  document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function categoryLabel(cat: string) {
  return CATEGORY_LABELS[cat] ?? cat
}

export function InventorySummaryPage() {
  const { hasPermission, user } = useAuth()
  const canManage = hasPermission('manage_inventory')

  const [summaryMonth, setSummaryMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [itemSummaries, setItemSummaries] = useState<InventoryItemSummary[]>([])
  const [dailyTrend, setDailyTrend] = useState<InventoryDailyTrend[]>([])
  const [monthlyTrend, setMonthlyTrend] = useState<InventoryMonthlyTrend[]>([])
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([])
  const [actionCounts, setActionCounts] = useState({
    equipmentDown: 0,
    lowStock: 0,
    needsReorder: 0,
    outOfStock: 0,
  })
  const [coverage, setCoverage] = useState<InventoryCoverageRow[]>([])
  const [wastage, setWastage] = useState<InventoryWastageSummary | null>(null)
  const [categoryBreakdown, setCategoryBreakdown] = useState<InventoryCategoryBreakdownRow[]>([])
  const [equipmentSummary, setEquipmentSummary] = useState<Awaited<ReturnType<typeof getEquipmentStatusSummary>> | null>(
    null,
  )
  const [slowMovers, setSlowMovers] = useState<SlowMoverItem[]>([])
  const [recentMovements, setRecentMovements] = useState<InventoryMovement[]>([])
  const [loading, setLoading] = useState(false)
  const [tableCategory, setTableCategory] = useState('')
  const [tableSearch, setTableSearch] = useState('')
  const [quickMov, setQuickMov] = useState<{ item: InventoryCoverageRow; type: 'IN' | 'OUT' } | null>(null)

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const [
        summaries,
        daily,
        monthly,
        lowStock,
        counts,
        cov,
        wastageData,
        catBreak,
        equip,
        slow,
        recent,
      ] = await Promise.all([
        getInventoryItemSummaries(summaryMonth),
        getInventoryDailyTrend(summaryMonth),
        getInventoryMonthlyTrend(6),
        getLowStockItems(),
        getInventoryActionCounts(30),
        getInventoryCoverage(30),
        getInventoryWastage(summaryMonth),
        getInventoryCategoryBreakdown(summaryMonth),
        getEquipmentStatusSummary(),
        getSlowMovers(60),
        getRecentInventoryMovements(10),
      ])
      setItemSummaries(summaries)
      setDailyTrend(daily)
      setMonthlyTrend(monthly)
      setLowStockItems(lowStock)
      setActionCounts(counts)
      setCoverage(cov)
      setWastage(wastageData)
      setCategoryBreakdown(catBreak)
      setEquipmentSummary(equip)
      setSlowMovers(slow)
      setRecentMovements(recent)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [summaryMonth])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  const coverageById = useMemo(() => new Map(coverage.map((c) => [c.id, c])), [coverage])

  const totals = useMemo(() => {
    const totalIn = itemSummaries.reduce((s, i) => s + i.totalIn, 0)
    const totalOut = itemSummaries.reduce((s, i) => s + i.totalOut, 0)
    const totalInCost = itemSummaries.reduce((s, i) => s + i.totalInCost, 0)
    const totalOutCost = itemSummaries.reduce((s, i) => s + i.totalOutCost, 0)
    return { totalIn, totalOut, totalInCost, totalOutCost }
  }, [itemSummaries])

  const outOfStockItems = useMemo(
    () => itemSummaries.filter((s) => s.currentStock <= 0 && s.category !== 'equipment'),
    [itemSummaries],
  )
  const lowStockNonZero = useMemo(
    () => itemSummaries.filter((s) => s.currentStock > 0 && s.currentStock <= s.lowStockThreshold),
    [itemSummaries],
  )

  const worstCoverage = useMemo(() => {
    let best: InventoryCoverageRow | null = null
    let minDays = Infinity
    for (const row of coverage) {
      if (row.daysOfSupply != null && row.avgDailyUsage > 0 && row.daysOfSupply < minDays) {
        minDays = row.daysOfSupply
        best = row
      }
    }
    return best
  }, [coverage])

  const wastagePctOfOut = useMemo(() => {
    if (!wastage || totals.totalOutCost <= 0) return null
    return (wastage.totalCost / totals.totalOutCost) * 100
  }, [wastage, totals.totalOutCost])

  const reorderCandidates = useMemo(() => {
    const rows = coverage.filter((c) => {
      const urgentDays = c.daysOfSupply != null && c.avgDailyUsage > 0 && c.daysOfSupply < 14
      const belowMin = c.currentStock <= c.lowStockThreshold
      return urgentDays || belowMin
    })
    return [...rows].sort((a, b) => {
      const da = a.daysOfSupply ?? Infinity
      const db = b.daysOfSupply ?? Infinity
      if (da !== db) return da - db
      return a.name.localeCompare(b.name)
    })
  }, [coverage])

  const deadStockValue = useMemo(() => slowMovers.reduce((s, m) => s + m.stockValue, 0), [slowMovers])

  const topConsumed = useMemo(() => {
    return [...itemSummaries]
      .filter((s) => s.category !== 'equipment' && s.totalOut > 0)
      .sort((a, b) => b.totalOut - a.totalOut)
      .slice(0, 5)
  }, [itemSummaries])

  const itemChartData = useMemo(
    () =>
      itemSummaries
        .filter((s) => s.totalIn > 0 || s.totalOut > 0)
        .map((s) => ({
          name: s.name.length > 12 ? s.name.slice(0, 12) + '…' : s.name,
          'Stock In': s.totalIn,
          'Stock Out': s.totalOut,
        })),
    [itemSummaries],
  )

  const dailyChartData = useMemo(
    () =>
      dailyTrend.map((d) => ({
        date: d.date.slice(8),
        'Stock In': d.totalIn,
        'Stock Out': d.totalOut,
      })),
    [dailyTrend],
  )

  const monthlyLineData = useMemo(
    () =>
      monthlyTrend.map((m) => ({
        month: formatMonthLabel(m.monthKey).replace(/\s\d{4}$/, ''),
        monthKey: m.monthKey,
        'In Cost': m.totalInCost,
        'Out Cost': m.totalOutCost,
      })),
    [monthlyTrend],
  )

  const categoryStockChartData = useMemo(
    () =>
      [...categoryBreakdown]
        .map((r) => ({
          name: categoryLabel(r.category),
          value: r.stockValue,
        }))
        .filter((r) => r.value > 0 || categoryBreakdown.length <= 6),
    [categoryBreakdown],
  )

  const categoryMovementChartData = useMemo(
    () =>
      categoryBreakdown.map((r) => ({
        name: categoryLabel(r.category),
        'Stock In': r.totalIn,
        'Stock Out': r.totalOut,
      })),
    [categoryBreakdown],
  )

  const filteredTableRows = useMemo(() => {
    let rows = itemSummaries
    if (tableCategory) rows = rows.filter((r) => r.category === tableCategory)
    const q = tableSearch.trim().toLowerCase()
    if (q) {
      rows = rows.filter((r) => r.name.toLowerCase().includes(q))
    }
    return rows
  }, [itemSummaries, tableCategory, tableSearch])

  function exportTableCsv() {
    const headers = [
      'Item',
      'Category',
      'In Qty',
      'In Cost',
      'Out Qty',
      'Out Cost',
      'Net Change',
      'Current Stock',
      'Avg daily usage (30d)',
      'Days of supply',
      'Wastage cost (month)',
    ]
    const lines = [headers.join(',')]
    for (const s of filteredTableRows) {
      const cov = coverageById.get(s.id)
      const days =
        cov?.daysOfSupply != null && cov.avgDailyUsage > 0 ? cov.daysOfSupply.toFixed(1) : ''
      const avg = cov?.avgDailyUsage != null ? String(cov.avgDailyUsage) : ''
      lines.push(
        [
          `"${s.name.replaceAll('"', '""')}"`,
          `"${categoryLabel(s.category).replaceAll('"', '""')}"`,
          s.totalIn,
          s.totalInCost,
          s.totalOut,
          s.totalOutCost,
          s.totalIn - s.totalOut,
          s.currentStock,
          avg,
          days,
          s.wastageCostThisMonth,
        ].join(','),
      )
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `inventory-summary-${summaryMonth}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const equipmentDownBreakdown = useMemo(() => {
    if (!equipmentSummary) return ''
    const m = equipmentSummary.counts.maintenance ?? 0
    const o = equipmentSummary.counts.out_of_service ?? 0
    return `${m} maintenance · ${o} out of service`
  }, [equipmentSummary])

  const hasEquipment =
    equipmentSummary &&
    Object.values(equipmentSummary.counts).reduce((a, b) => a + b, 0) > 0

  function renderEquipmentGroup(status: string, items: EquipmentStatusItem[]) {
    if (items.length === 0) return null
    return (
      <div key={status} className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {STATUS_LABELS[status] ?? status} ({items.length})
        </h4>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs"
            >
              <p className="font-medium text-[var(--foreground)] truncate">{item.name}</p>
              <p className="text-[var(--muted)] mt-1">
                Last maintenance: {item.lastMaintenanceDate || '—'}
                {item.daysSinceMaintenance != null && (
                  <span className="ml-1 tabular-nums">({item.daysSinceMaintenance}d ago)</span>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inventory Summary</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Operations health, reorder guidance, and movement trends.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-[var(--muted)]">Period:</label>
          <input
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
            onChange={(e) => setSummaryMonth(e.target.value)}
            type="month"
            value={summaryMonth}
          />
          <span className="text-sm font-medium">{formatMonthLabel(summaryMonth)}</span>
        </div>
      </div>

      {!loading && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-sm">
          <span className="font-medium text-[var(--foreground)]">Status:</span>
          <button
            className="text-red-600 hover:underline dark:text-red-400"
            onClick={() => scrollToId('section-attention')}
            type="button"
          >
            {actionCounts.outOfStock} out of stock
          </button>
          <span className="text-[var(--muted)]">·</span>
          <button
            className="text-amber-700 hover:underline dark:text-amber-400"
            onClick={() => scrollToId('section-attention')}
            type="button"
          >
            {actionCounts.lowStock} low
          </button>
          <span className="text-[var(--muted)]">·</span>
          <button
            className="text-orange-700 hover:underline dark:text-orange-400"
            onClick={() => scrollToId('section-equipment')}
            type="button"
          >
            {actionCounts.equipmentDown} equipment down
          </button>
          <span className="text-[var(--muted)]">·</span>
          <button
            className="text-[var(--accent)] hover:underline"
            onClick={() => scrollToId('section-reorder')}
            type="button"
          >
            {actionCounts.needsReorder} need reorder
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading summary…</div>
      ) : (
        <>
          <div className="space-y-4" id="section-attention">
            <SectionHeading
              subtitle="Items that need immediate attention"
              title="Attention"
            />
            {(outOfStockItems.length > 0 || lowStockNonZero.length > 0) && (
              <div className="grid gap-4 lg:grid-cols-2">
                {outOfStockItems.length > 0 && (
                  <div className="rounded-xl border border-red-300/40 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
                    <h3 className="text-sm font-semibold text-red-800 dark:text-red-400 mb-2">Out of stock</h3>
                    <ul className="space-y-1 text-xs text-red-900 dark:text-red-300">
                      {outOfStockItems.map((item) => (
                        <li key={item.id} className="truncate font-medium">
                          {item.name} ({formatQty(item.currentStock, item.unitLabel)})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {lowStockNonZero.length > 0 && (
                  <div className="rounded-xl border border-amber-300/50 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-400 mb-2">Low stock</h3>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 max-h-48 overflow-y-auto">
                      {lowStockNonZero.map((item) => (
                        <div key={item.id} className="rounded-md bg-white/80 dark:bg-black/20 px-3 py-2 text-xs">
                          <p className="font-medium text-amber-900 dark:text-amber-300 truncate">{item.name}</p>
                          <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                            {formatQty(item.currentStock, item.unitLabel)} / min{' '}
                            {formatQty(item.lowStockThreshold, item.unitLabel)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {lowStockItems.length > 0 && lowStockNonZero.length === 0 && outOfStockItems.length === 0 && (
              <div className="rounded-xl border border-amber-300/50 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-400 mb-2">Low Stock Alerts</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {lowStockItems.map((item) => (
                    <div key={item.id} className="rounded-md bg-white/80 dark:bg-black/20 px-3 py-2 text-xs">
                      <p className="font-medium text-amber-900 dark:text-amber-300 truncate">{item.name}</p>
                      <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                        {formatQty(item.currentStock, item.unitLabel)} / min{' '}
                        {formatQty(item.lowStockThreshold, item.unitLabel)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {outOfStockItems.length === 0 && lowStockNonZero.length === 0 && lowStockItems.length === 0 && (
              <p className="text-sm text-[var(--muted)]">No stock alerts for active catalog items.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard
              label="Items needing attention"
              sub={`${actionCounts.outOfStock} out · ${actionCounts.lowStock} low`}
              value={String(actionCounts.outOfStock + actionCounts.lowStock)}
              icon={AlertTriangle}
              color="text-amber-500"
              bg="bg-amber-500/10"
            />
            <SummaryCard
              label="Equipment not operational"
              sub={equipmentDownBreakdown || 'All operational'}
              value={String(actionCounts.equipmentDown)}
              icon={Wrench}
              color={actionCounts.equipmentDown > 0 ? 'text-orange-500' : 'text-emerald-500'}
              bg={actionCounts.equipmentDown > 0 ? 'bg-orange-500/10' : 'bg-emerald-500/10'}
            />
            <SummaryCard
              label="Shortest runway"
              sub={
                worstCoverage
                  ? `${worstCoverage.name} · ${worstCoverage.daysOfSupply != null ? `${worstCoverage.daysOfSupply.toFixed(1)}d` : '—'}`
                  : 'No usage-based estimate'
              }
              value={
                worstCoverage?.daysOfSupply != null && worstCoverage.avgDailyUsage > 0
                  ? `${worstCoverage.daysOfSupply.toFixed(1)}d`
                  : '—'
              }
              icon={Package}
              color="text-blue-500"
              bg="bg-blue-500/10"
            />
            <SummaryCard
              label="Wastage cost (period)"
              sub={
                wastagePctOfOut != null
                  ? `${wastagePctOfOut.toFixed(1)}% of out cost`
                  : wastage && wastage.totalCost > 0
                    ? 'Share of out cost'
                    : 'No wastage tagged'
              }
              value={wastage ? formatCurrency(wastage.totalCost) : '—'}
              icon={Skull}
              color={wastage && wastage.totalCost > 0 ? 'text-red-500' : 'text-[var(--muted)]'}
              bg={wastage && wastage.totalCost > 0 ? 'bg-red-500/10' : 'bg-gray-500/10'}
            />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4" id="section-reorder">
            <SectionHeading
              subtitle="Based on last 30 days usage and min stock levels"
              title="Reorder recommendations"
            />
            {reorderCandidates.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No items match reorder criteria right now.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      <th className="py-2 pr-3 text-left">Item</th>
                      <th className="py-2 px-2 text-right">Stock</th>
                      <th className="py-2 px-2 text-right">Avg / day</th>
                      <th className="py-2 px-2 text-right">Runway</th>
                      <th className="py-2 px-2 text-right">Suggested qty</th>
                      {canManage && <th className="py-2 pl-2 text-right w-28">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {reorderCandidates.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 pr-3 font-medium">{row.name}</td>
                        <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                          {formatQty(row.currentStock, row.unitLabel)}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                          {row.avgDailyUsage > 0 ? formatQty(row.avgDailyUsage, row.unitLabel) : '—'}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                          {row.daysOfSupply != null && row.avgDailyUsage > 0
                            ? `${row.daysOfSupply.toFixed(1)}d`
                            : '—'}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                          {formatQty(row.suggestedReorderQty, row.unitLabel)}
                        </td>
                        {canManage && (
                          <td className="py-2 pl-2 text-right">
                            <button
                              className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                              onClick={() => setQuickMov({ item: row, type: 'IN' })}
                              type="button"
                            >
                              Restock
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {hasEquipment && equipmentSummary && (
            <div id="section-equipment">
              <SectionHeading subtitle="Grouped by operational status" title="Equipment" />
              <div className="space-y-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                {EQUIPMENT_STATUS_ORDER.map((st) =>
                  renderEquipmentGroup(st, equipmentSummary.byStatus[st] ?? []),
                )}
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {categoryStockChartData.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">Stock value by category</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={categoryStockChartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatCurrency(v)} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value) || 0)} />
                    <Bar dataKey="value" fill="#6366f1" name="Stock value" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {categoryMovementChartData.some((d) => d['Stock In'] > 0 || d['Stock Out'] > 0) && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
                  Movement by category — {formatMonthLabel(summaryMonth)}
                </h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={categoryMovementChartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Stock In" fill="#10b981" stackId="a" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Stock Out" fill="#ef4444" stackId="a" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <SectionHeading title="Movement activity" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard
                label="Total Stock In"
                sub={formatCurrency(totals.totalInCost)}
                value={formatQty(totals.totalIn)}
                icon={ArrowDownToLine}
                color="text-emerald-500"
                bg="bg-emerald-500/10"
              />
              <SummaryCard
                label="Total Stock Out"
                sub={formatCurrency(totals.totalOutCost)}
                value={formatQty(totals.totalOut)}
                icon={ArrowUpFromLine}
                color="text-red-500"
                bg="bg-red-500/10"
              />
              <SummaryCard
                label="Net Change"
                value={(totals.totalIn - totals.totalOut >= 0 ? '+' : '') + formatQty(totals.totalIn - totals.totalOut)}
                icon={Scale}
                color={totals.totalIn - totals.totalOut >= 0 ? 'text-emerald-500' : 'text-red-500'}
                bg={totals.totalIn - totals.totalOut >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}
              />
              <SummaryCard
                label="Cost Difference"
                sub="In cost − Out cost"
                value={formatCurrency(totals.totalInCost - totals.totalOutCost)}
                icon={Banknote}
                color={totals.totalInCost - totals.totalOutCost >= 0 ? 'text-amber-500' : 'text-red-500'}
                bg={totals.totalInCost - totals.totalOutCost >= 0 ? 'bg-amber-500/10' : 'bg-red-500/10'}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {dailyChartData.length > 0 && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                  <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
                    Daily Movement — {formatMonthLabel(summaryMonth)}
                  </h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={dailyChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Stock In" fill="#10b981" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Stock Out" fill="#ef4444" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {itemChartData.length > 0 && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                  <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
                    Per-Item In vs Out — {formatMonthLabel(summaryMonth)}
                  </h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={itemChartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={90} />
                      <Tooltip />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Stock In" fill="#10b981" radius={[0, 3, 3, 0]} />
                      <Bar dataKey="Stock Out" fill="#ef4444" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {monthlyLineData.length > 1 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">Monthly cost trend (last 6 months)</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={monthlyLineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value) || 0)} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                    <Line dataKey="In Cost" dot={false} stroke="#3b82f6" strokeWidth={2} type="monotone" />
                    <Line dataKey="Out Cost" dot={false} stroke="#f59e0b" strokeWidth={2} type="monotone" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">Top consumed (qty)</h3>
              {topConsumed.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">No outbound usage this period.</p>
              ) : (
                <ol className="space-y-2 text-sm list-decimal list-inside">
                  {topConsumed.map((s) => (
                    <li key={s.id} className="text-[var(--foreground)]">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[var(--muted)] tabular-nums ml-1">
                        {formatQty(s.totalOut, s.unitLabel)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">Slow movers (60d)</h3>
              <p className="text-xs text-[var(--muted)] mb-2">No OUT movements in 60 days, stock on hand.</p>
              {slowMovers.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">None detected.</p>
              ) : (
                <ul className="space-y-1.5 text-xs max-h-40 overflow-y-auto">
                  {slowMovers.slice(0, 8).map((m) => (
                    <li key={m.id} className="truncate">
                      <span className="font-medium">{m.name}</span>
                      <span className="text-[var(--muted)] ml-1">{formatCurrency(m.stockValue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">Dead stock value</h3>
              <p className="text-2xl font-semibold tabular-nums text-red-500">{formatCurrency(deadStockValue)}</p>
              <p className="text-xs text-[var(--muted)] mt-1">Sum of on-hand value for slow movers ({slowMovers.length} items)</p>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <SectionHeading
              action={
                <Link
                  className="text-xs font-medium text-[var(--accent)] hover:underline"
                  to="/inventory-movements"
                >
                  View full log
                </Link>
              }
              title="Recent activity"
            />
            {recentMovements.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No movements yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)] text-sm">
                {recentMovements.map((mov) => (
                  <li className="flex flex-wrap items-center gap-2 py-2" key={mov.id}>
                    <span
                      className={[
                        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                        mov.movementType === 'IN' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-500',
                      ].join(' ')}
                    >
                      {mov.movementType}
                    </span>
                    <span className="font-medium">{mov.itemName}</span>
                    <span className="text-[var(--muted)] tabular-nums">
                      {mov.movementDate} · {formatQty(mov.quantity, mov.unitLabel)}
                    </span>
                    {mov.notes && <span className="text-xs text-[var(--muted)] truncate max-w-xs">— {mov.notes}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <SectionHeading
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--panel)]"
                    onClick={exportTableCsv}
                    type="button"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export CSV
                  </button>
                </div>
              }
              subtitle={formatMonthLabel(summaryMonth)}
              title="Item breakdown"
            />
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                className="h-9 w-48 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Search items…"
                type="search"
                value={tableSearch}
              />
              <select
                className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm"
                onChange={(e) => setTableCategory(e.target.value)}
                value={tableCategory}
              >
                <option value="">All categories</option>
                {ITEM_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-xl border border-[var(--border)] overflow-hidden">
              {filteredTableRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-[var(--muted)]">
                  <BarChart3 className="h-8 w-8 opacity-40" />
                  <p className="text-sm">No rows match filters.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[960px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--panel)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                        <th className="px-3 py-2.5 text-left font-semibold">Item</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Category</th>
                        <th className="px-3 py-2.5 text-right font-semibold">In Qty</th>
                        <th className="px-3 py-2.5 text-right font-semibold">In Cost</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Out Qty</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Out Cost</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Net</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Stock</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Avg/day</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Runway</th>
                        <th className="px-3 py-2.5 text-center font-semibold">Waste</th>
                        {canManage && <th className="px-3 py-2.5 text-right font-semibold w-0" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {filteredTableRows.map((s) => {
                        const net = s.totalIn - s.totalOut
                        const cov = coverageById.get(s.id)
                        const avg =
                          cov && cov.avgDailyUsage > 0 ? formatQty(cov.avgDailyUsage, s.unitLabel) : '—'
                        const runway =
                          cov && cov.daysOfSupply != null && cov.avgDailyUsage > 0
                            ? `${cov.daysOfSupply.toFixed(1)}d`
                            : '—'
                        return (
                          <tr key={s.id}>
                            <td className="px-3 py-3 font-medium">{s.name}</td>
                            <td className="px-3 py-3 text-xs text-[var(--muted)]">{categoryLabel(s.category)}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-emerald-600 whitespace-nowrap">
                              {s.totalIn > 0 ? (
                                <span className="inline-flex items-center justify-end gap-1">
                                  <TrendingUp className="h-3 w-3" />
                                  {formatQty(s.totalIn, s.unitLabel)}
                                </span>
                              ) : (
                                <span className="text-[var(--muted)]">—</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-emerald-600 whitespace-nowrap">
                              {s.totalInCost > 0 ? formatCurrency(s.totalInCost) : <span className="text-[var(--muted)]">—</span>}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-red-500 whitespace-nowrap">
                              {s.totalOut > 0 ? (
                                <span className="inline-flex items-center justify-end gap-1">
                                  <TrendingDown className="h-3 w-3" />
                                  {formatQty(s.totalOut, s.unitLabel)}
                                </span>
                              ) : (
                                <span className="text-[var(--muted)]">—</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-red-500 whitespace-nowrap">
                              {s.totalOutCost > 0 ? formatCurrency(s.totalOutCost) : <span className="text-[var(--muted)]">—</span>}
                            </td>
                            <td
                              className={[
                                'px-3 py-3 text-right tabular-nums font-medium whitespace-nowrap',
                                net > 0 ? 'text-emerald-600' : net < 0 ? 'text-red-500' : 'text-[var(--muted)]',
                              ].join(' ')}
                            >
                              {net > 0 ? '+' : ''}
                              {formatQty(net, s.unitLabel)}
                            </td>
                            <td
                              className={[
                                'px-3 py-3 text-right tabular-nums font-medium whitespace-nowrap',
                                s.currentStock <= 0 ? 'text-red-500' : '',
                              ].join(' ')}
                            >
                              {formatQty(s.currentStock, s.unitLabel)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-xs whitespace-nowrap">{avg}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-xs whitespace-nowrap">{runway}</td>
                            <td className="px-3 py-3 text-center">
                              {s.wastageCostThisMonth > 0 ? (
                                <span
                                  className="inline-flex rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-500"
                                  title={formatCurrency(s.wastageCostThisMonth)}
                                >
                                  {formatCurrency(s.wastageCostThisMonth)}
                                </span>
                              ) : (
                                <span className="text-[var(--muted)]">—</span>
                              )}
                            </td>
                            {canManage && s.category !== 'equipment' && cov && (
                              <td className="px-3 py-3 text-right">
                                <button
                                  aria-label="Restock"
                                  className="rounded p-1.5 text-emerald-500 transition hover:bg-emerald-500/10"
                                  onClick={() => cov && setQuickMov({ item: cov, type: 'IN' })}
                                  title="Restock"
                                  type="button"
                                >
                                  <ArrowDownToLine className="h-4 w-4" />
                                </button>
                              </td>
                            )}
                            {canManage && (s.category === 'equipment' || !cov) && <td className="px-3 py-3" />}
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[var(--border)] bg-[var(--panel)] text-xs font-semibold">
                        <td className="px-3 py-2.5 uppercase tracking-wide text-[var(--muted)]" colSpan={2}>
                          Totals (visible)
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 whitespace-nowrap">
                          {formatQty(filteredTableRows.reduce((a, s) => a + s.totalIn, 0))}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 whitespace-nowrap">
                          {formatCurrency(filteredTableRows.reduce((a, s) => a + s.totalInCost, 0))}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-red-500 whitespace-nowrap">
                          {formatQty(filteredTableRows.reduce((a, s) => a + s.totalOut, 0))}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-red-500 whitespace-nowrap">
                          {formatCurrency(filteredTableRows.reduce((a, s) => a + s.totalOutCost, 0))}
                        </td>
                        <td
                          className={[
                            'px-3 py-2.5 text-right tabular-nums font-bold whitespace-nowrap',
                            filteredTableRows.reduce((a, s) => a + (s.totalIn - s.totalOut), 0) >= 0
                              ? 'text-emerald-600'
                              : 'text-red-500',
                          ].join(' ')}
                        >
                          {filteredTableRows.reduce((a, s) => a + (s.totalIn - s.totalOut), 0) >= 0 ? '+' : ''}
                          {formatQty(filteredTableRows.reduce((a, s) => a + (s.totalIn - s.totalOut), 0))}
                        </td>
                        <td colSpan={canManage ? 5 : 4} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <QuickMovementModal
        initialType={quickMov?.type ?? 'IN'}
        item={quickMov?.item ?? null}
        onClose={() => setQuickMov(null)}
        onSaved={loadSummary}
        open={quickMov !== null}
        userId={user?.id ?? null}
      />
    </section>
  )
}
