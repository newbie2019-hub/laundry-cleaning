import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  Banknote,
  BarChart3,
  Building2,
  Calendar,
  CreditCard,
  Download,
  Info,
  Layers,
  PieChart as PieChartIcon,
  Receipt,
  Repeat,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { exportFilteredTransactions } from '../../exports/export-service'
import {
  formatCurrency,
  formatDateRangeLabel,
  formatMonthLabel,
} from '../../../lib/format'
import {
  getDashboardData,
  getTransactionsSummary,
  listTransactions,
  type DashboardData,
  type TransactionsSummary,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'
import {
  autoComparisonRange,
  bucketGranularity,
  isValidRange,
  rangeDayCount,
  resolveRange,
  type DateRange,
  type PeriodPreset,
} from '../lib/period'

type LoadState =
  | { status: 'loading' }
  | {
      current: TransactionsSummary
      compare: TransactionsSummary | null
      monthly: DashboardData | null
      status: 'ready'
    }
  | { message: string; status: 'error' }

const PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
  { id: 'custom', label: 'Custom' },
]

const TYPE_COLORS: Record<string, string> = {
  SALE: '#10b981',
  EXPENSE: '#ef4444',
  'OPERATING EXPENSE': '#f59e0b',
}

const CHART_COLORS = {
  sales: '#10b981',
  expense: '#ef4444',
  operating: '#f59e0b',
  net: '#6366f1',
  compare: '#94a3b8',
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const tooltipStyle: CSSProperties = {
  backgroundColor: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: '8px',
  fontSize: '12px',
  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3)',
}

const tooltipLabelStyle: CSSProperties = { color: '#94a3b8', marginBottom: 4, fontWeight: 500 }
const tooltipItemStyle: CSSProperties = { color: '#e2e8f0' }
const axisTickProps = { fill: '#94a3b8', fontSize: 11 }
const gridStroke = 'rgba(148,163,184,0.12)'

function currencyTickFormatter(value: number) {
  const absValue = Math.abs(value)
  if (absValue >= 1000) return `₱${(value / 1000).toFixed(0)}k`
  return `₱${value}`
}

function currencyTooltipFormatter(value: unknown, name: unknown) {
  return [formatCurrency(Number(value) || 0), String(name ?? '')]
}

function kpiDelta(current: number, previous: number | undefined | null) {
  if (previous === undefined || previous === null || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

function presetLabel(preset: PeriodPreset): string {
  return PRESETS.find((p) => p.id === preset)?.label ?? 'Custom'
}

function KpiCard({
  label,
  value,
  previousValue,
  icon: Icon,
  color,
  bg,
  invertDelta,
  valueFormatter = formatCurrency,
  compareEnabled,
}: {
  bg: string
  color: string
  compareEnabled: boolean
  icon: typeof BarChart3
  invertDelta?: boolean
  label: string
  previousValue: number | null
  value: number
  valueFormatter?: (v: number) => string
}) {
  const delta = kpiDelta(value, previousValue ?? undefined)
  const showDelta = compareEnabled && delta != null && previousValue != null

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <p className={`text-2xl font-semibold tabular-nums tracking-tight ${color}`}>
          {valueFormatter(value)}
        </p>
        {showDelta && (
          <span
            className={`inline-flex cursor-default items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold ${
              (invertDelta ? delta <= 0 : delta >= 0)
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-rose-500/10 text-rose-500'
            }`}
            title={`Previous: ${valueFormatter(previousValue!)} → Current: ${valueFormatter(value)}`}
          >
            {delta >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {delta >= 0 ? '+' : ''}
            {delta.toFixed(1)}%
          </span>
        )}
      </div>
      {compareEnabled && previousValue != null ? (
        <p className="mt-1.5 text-xs text-[var(--muted)] tabular-nums">
          Prev: {valueFormatter(previousValue)}
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          {compareEnabled ? 'No previous data' : 'Comparison off'}
        </p>
      )}
    </div>
  )
}

function SectionHeading({
  subtitle,
  title,
  action,
  info,
}: {
  action?: React.ReactNode
  info?: string
  subtitle?: string
  title: string
}) {
  return (
    <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
          {info && (
            <span
              aria-label={info}
              className="group relative inline-flex cursor-help items-center text-[var(--muted)] transition hover:text-[var(--foreground)]"
              tabIndex={0}
            >
              <Info className="h-3.5 w-3.5" />
              <span
                className="pointer-events-none absolute left-5 top-1/2 z-20 w-64 -translate-y-1/2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[11px] font-normal leading-relaxed text-[var(--foreground)] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100"
                role="tooltip"
              >
                {info}
              </span>
            </span>
          )}
        </div>
        {subtitle && <p className="text-xs text-[var(--muted)] mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

function bucketLabel(granularity: 'day' | 'week' | 'month', date: string): string {
  if (granularity === 'day') return date.slice(8)
  if (granularity === 'month') return formatMonthLabel(date.slice(0, 7)).replace(/\s\d{4}$/, '')
  const d = new Date(`${date}T00:00:00`)
  return format(d, 'MMM d')
}

function startOfIsoWeekKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return format(d, 'yyyy-MM-dd')
}

type TrendRow = {
  bucket: string
  label: string
  Sales: number
  Expenses: number
  Net: number
  CompareSales?: number
  CompareExpenses?: number
  CompareNet?: number
}

function bucketDailySeries(
  summary: TransactionsSummary,
  granularity: 'day' | 'week' | 'month',
): Map<string, { sales: number; expense: number; operating: number; net: number }> {
  const map = new Map<string, { sales: number; expense: number; operating: number; net: number }>()
  for (const row of summary.dailySeries) {
    let key = row.date
    if (granularity === 'week') key = startOfIsoWeekKey(row.date)
    else if (granularity === 'month') key = `${row.date.slice(0, 7)}-01`

    const existing = map.get(key) ?? { sales: 0, expense: 0, operating: 0, net: 0 }
    existing.sales += row.sales
    existing.expense += row.expense
    existing.operating += row.operatingExpense
    existing.net += row.netIncome
    map.set(key, existing)
  }
  return map
}

export function TransactionsSummaryPage() {
  const { hasPermission } = useAuth()
  const canExport = hasPermission('export_data')

  const [preset, setPreset] = useState<PeriodPreset>('month')
  const [anchorDate, setAnchorDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [customRange, setCustomRange] = useState<DateRange>(() => {
    const r = resolveRange('month', new Date())
    return r
  })
  const [compareEnabled, setCompareEnabled] = useState(true)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [exporting, setExporting] = useState(false)

  const [isPeriodOpen, setIsPeriodOpen] = useState(false)
  const [draftPreset, setDraftPreset] = useState<PeriodPreset>('month')
  const [draftAnchor, setDraftAnchor] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [draftCustomRange, setDraftCustomRange] = useState<DateRange>(() => resolveRange('month', new Date()))
  const [draftCompareEnabled, setDraftCompareEnabled] = useState(true)

  const currentRange = useMemo<DateRange>(() => {
    if (preset === 'custom') return customRange
    return resolveRange(preset, new Date(`${anchorDate}T00:00:00`))
  }, [preset, anchorDate, customRange])

  const compareRange = useMemo<DateRange | null>(() => {
    if (!compareEnabled) return null
    return autoComparisonRange(currentRange, preset)
  }, [compareEnabled, currentRange, preset])

  const shouldLoadMonthlyShares = preset === 'month' && !compareEnabled
  const monthKey = anchorDate.slice(0, 7)

  const load = useCallback(async () => {
    if (!isValidRange(currentRange)) {
      setState({ message: 'Invalid date range.', status: 'error' })
      return
    }
    setState({ status: 'loading' })
    try {
      const [current, compare, monthly] = await Promise.all([
        getTransactionsSummary(currentRange.from, currentRange.to),
        compareRange ? getTransactionsSummary(compareRange.from, compareRange.to) : Promise.resolve(null),
        shouldLoadMonthlyShares ? getDashboardData(monthKey) : Promise.resolve(null),
      ])
      setState({ compare, current, monthly, status: 'ready' })
    } catch (error: unknown) {
      setState({
        message: error instanceof Error ? error.message : 'Unable to load summary.',
        status: 'error',
      })
    }
  }, [currentRange, compareRange, shouldLoadMonthlyShares, monthKey])

  useEffect(() => {
    void load()
  }, [load])

  function openPeriodSheet() {
    setDraftPreset(preset)
    setDraftAnchor(anchorDate)
    setDraftCustomRange(customRange)
    setDraftCompareEnabled(compareEnabled)
    setIsPeriodOpen(true)
  }

  function applyPeriodSheet() {
    setPreset(draftPreset)
    setAnchorDate(draftAnchor)
    if (draftPreset !== 'custom') {
      setCustomRange(resolveRange(draftPreset, new Date(`${draftAnchor}T00:00:00`)))
    } else {
      setCustomRange(draftCustomRange)
    }
    setCompareEnabled(draftCompareEnabled)
    setIsPeriodOpen(false)
  }

  function resetPeriodDraft() {
    const today = format(new Date(), 'yyyy-MM-dd')
    const defaultRange = resolveRange('month', new Date())
    setDraftPreset('month')
    setDraftAnchor(today)
    setDraftCustomRange(defaultRange)
    setDraftCompareEnabled(true)
  }

  const granularity = useMemo(() => bucketGranularity(currentRange), [currentRange])

  const trendData = useMemo<TrendRow[]>(() => {
    if (state.status !== 'ready') return []
    const currentBuckets = bucketDailySeries(state.current, granularity)
    const compareBuckets = state.compare ? bucketDailySeries(state.compare, granularity) : null

    const currentKeys = Array.from(currentBuckets.keys()).sort()
    const rows: TrendRow[] = currentKeys.map((key) => {
      const cur = currentBuckets.get(key)!
      return {
        bucket: key,
        label: bucketLabel(granularity, key),
        Sales: cur.sales,
        Expenses: cur.expense + cur.operating,
        Net: cur.net,
      }
    })

    if (compareBuckets) {
      const compareKeys = Array.from(compareBuckets.keys()).sort()
      for (let i = 0; i < rows.length; i += 1) {
        const compareKey = compareKeys[i]
        if (!compareKey) continue
        const cmp = compareBuckets.get(compareKey)!
        rows[i].CompareSales = cmp.sales
        rows[i].CompareExpenses = cmp.expense + cmp.operating
        rows[i].CompareNet = cmp.net
      }
    }

    return rows
  }, [state, granularity])

  const cumulativeNetData = useMemo(() => {
    let running = 0
    return trendData.map((row) => {
      running += row.Net
      return { label: row.label, 'Cumulative Net': running }
    })
  }, [trendData])

  const typeBreakdownData = useMemo(() => {
    if (state.status !== 'ready') return []
    const ORDER = ['SALE', 'EXPENSE', 'OPERATING EXPENSE']
    return ORDER.map((code) => {
      const row = state.current.typeBreakdown.find((r) => r.transactionTypeCode === code)
      return {
        name: code,
        value: row?.totalAmount ?? 0,
      }
    }).filter((r) => r.value > 0)
  }, [state])

  const typeCompareData = useMemo(() => {
    if (state.status !== 'ready') return []
    const ORDER = ['SALE', 'EXPENSE', 'OPERATING EXPENSE']
    return ORDER.map((code) => {
      const cur = state.current.typeBreakdown.find((r) => r.transactionTypeCode === code)
      const cmp = state.compare?.typeBreakdown.find((r) => r.transactionTypeCode === code)
      return {
        name: code,
        Current: cur?.totalAmount ?? 0,
        Previous: cmp?.totalAmount ?? 0,
      }
    }).filter((r) => r.Current > 0 || r.Previous > 0)
  }, [state])

  const categoriesByType = useMemo(() => {
    if (state.status !== 'ready') return []
    const grouped = new Map<string, Array<{ name: string; amount: number }>>()
    for (const item of state.current.categoryBreakdown) {
      const bucket = grouped.get(item.transactionTypeCode) ?? []
      bucket.push({ name: item.categoryLabel, amount: item.totalAmount })
      grouped.set(item.transactionTypeCode, bucket)
    }
    return Array.from(grouped.entries()).map(([type, data]) => ({
      type,
      data: [...data].sort((a, b) => b.amount - a.amount),
    }))
  }, [state])

  const weekdayData = useMemo(() => {
    if (state.status !== 'ready') return []
    const base = new Map<number, { sales: number; expense: number }>()
    for (let i = 0; i < 7; i += 1) base.set(i, { sales: 0, expense: 0 })
    for (const row of state.current.weekdayBreakdown) {
      base.set(row.weekday, {
        sales: row.sales,
        expense: row.expense + row.operatingExpense,
      })
    }
    return WEEKDAY_LABELS.map((label, index) => {
      const row = base.get(index)!
      return { day: label, Sales: row.sales, Expenses: row.expense }
    })
  }, [state])

  const topCategoriesTable = useMemo(() => {
    if (state.status !== 'ready') return []
    const compareIndex = new Map<string, number>()
    if (state.compare) {
      for (const row of state.compare.categoryBreakdown) {
        compareIndex.set(`${row.transactionTypeCode}|${row.categoryLabel}`, row.totalAmount)
      }
    }
    return state.current.categoryBreakdown
      .map((row) => {
        const key = `${row.transactionTypeCode}|${row.categoryLabel}`
        const prev = state.compare ? compareIndex.get(key) ?? 0 : null
        const delta =
          prev != null && prev > 0 ? ((row.totalAmount - prev) / Math.abs(prev)) * 100 : null
        return {
          ...row,
          delta,
          previous: prev,
        }
      })
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 15)
  }, [state])

  const monthlyBreakdownTable = useMemo(() => {
    if (state.status !== 'ready') return []
    if (granularity !== 'month') return []
    return state.current.monthlySeries.map((row) => ({
      label: formatMonthLabel(row.monthKey),
      sales: row.sales,
      expense: row.expense,
      operatingExpense: row.operatingExpense,
      net: row.netIncome,
    }))
  }, [state, granularity])

  async function handleExport() {
    if (!canExport) return
    setExporting(true)
    try {
      const transactions = await listTransactions({
        dateFrom: currentRange.from,
        dateTo: currentRange.to,
      })
      const filename = `transactions-summary-${currentRange.from}-to-${currentRange.to}.xlsx`
      await exportFilteredTransactions(transactions, filename)
    } finally {
      setExporting(false)
    }
  }

  const dayCount = rangeDayCount(currentRange)
  const rangeLabel = formatDateRangeLabel(currentRange.from, currentRange.to)
  const compareLabel = compareRange ? formatDateRangeLabel(compareRange.from, compareRange.to) : null

  const kpis = state.status === 'ready' ? state.current.kpis : null
  const compareKpis = state.status === 'ready' ? state.compare?.kpis ?? null : null

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Transactions Summary</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Analyze and compare sales, expenses, and net income across any period.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--foreground)]">
              <Calendar className="h-3.5 w-3.5 text-[var(--muted)]" />
              {rangeLabel}
            </span>
            <span>·</span>
            <span>
              {presetLabel(preset)} · {dayCount} day{dayCount !== 1 ? 's' : ''}
            </span>
            {compareLabel && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Repeat className="h-3 w-3" />
                  vs {compareLabel}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
            onClick={openPeriodSheet}
            type="button"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Period
          </button>
          {canExport && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-50"
              disabled={exporting || state.status !== 'ready'}
              onClick={() => {
                void handleExport()
              }}
              type="button"
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          )}
        </div>
      </header>

      {state.status === 'error' && (
        <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-400">
          {state.message}
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          bg="bg-emerald-500/10"
          color="text-emerald-500"
          compareEnabled={compareEnabled}
          icon={TrendingUp}
          label="Total Sales"
          previousValue={compareKpis?.totalSales ?? null}
          value={kpis?.totalSales ?? 0}
        />
        <KpiCard
          bg="bg-red-500/10"
          color="text-red-500"
          compareEnabled={compareEnabled}
          icon={CreditCard}
          invertDelta
          label="Expenses"
          previousValue={compareKpis ? compareKpis.totalExpenses - compareKpis.operatingExpense : null}
          value={kpis ? kpis.totalExpenses - kpis.operatingExpense : 0}
        />
        <KpiCard
          bg="bg-amber-500/10"
          color="text-amber-500"
          compareEnabled={compareEnabled}
          icon={Building2}
          invertDelta
          label="Operating Exp."
          previousValue={compareKpis?.operatingExpense ?? null}
          value={kpis?.operatingExpense ?? 0}
        />
        <KpiCard
          bg={kpis && kpis.netIncome >= 0 ? 'bg-indigo-500/10' : 'bg-red-500/10'}
          color={kpis && kpis.netIncome >= 0 ? 'text-indigo-500' : 'text-red-500'}
          compareEnabled={compareEnabled}
          icon={Banknote}
          label="Net Income"
          previousValue={compareKpis?.netIncome ?? null}
          value={kpis?.netIncome ?? 0}
        />
        <KpiCard
          bg="bg-sky-500/10"
          color="text-sky-500"
          compareEnabled={compareEnabled}
          icon={Receipt}
          label="Transactions"
          previousValue={compareKpis?.transactionCount ?? null}
          value={kpis?.transactionCount ?? 0}
          valueFormatter={(v) => String(Math.round(v))}
        />
        <KpiCard
          bg="bg-violet-500/10"
          color="text-violet-500"
          compareEnabled={compareEnabled}
          icon={Users}
          label="Sales / Staff Shift"
          previousValue={compareKpis?.salesPerStaffShift ?? null}
          value={kpis?.salesPerStaffShift ?? 0}
        />
      </div>

      {state.status === 'ready' &&
        shouldLoadMonthlyShares &&
        state.monthly &&
        state.monthly.incomeShares.length > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <SectionHeading
              action={
                <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                  <PieChartIcon className="h-3.5 w-3.5" />
                  Base: {formatCurrency(state.monthly.kpis.incomeShareAllocationBase)}
                </span>
              }
              info="Monthly income share allocation based on net sales (total sales minus operating expenses, excluding rent). Each stakeholder's slice is computed from their configured percentage for this month."
              subtitle={`Allocations for ${formatMonthLabel(state.monthly.monthKey)}`}
              title="Income shares"
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    <th className="py-2 pr-3 text-left font-semibold">Share</th>
                    <th className="py-2 px-2 text-right font-semibold">Percentage</th>
                    <th className="py-2 pl-2 text-right font-semibold">Allocated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {state.monthly.incomeShares.map((share) => (
                    <tr
                      className="transition hover:bg-[var(--background)]"
                      key={share.ruleName}
                    >
                      <td className="py-2 pr-3 font-medium">{share.ruleName}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-[var(--muted)]">
                        {share.percentage.toFixed(2)}%
                      </td>
                      <td className="py-2 pl-2 text-right tabular-nums font-semibold text-indigo-500">
                        {formatCurrency(share.allocatedAmount)}
                      </td>
                    </tr>
                  ))}
                  {(() => {
                    const totalPct = state.monthly.incomeShares.reduce(
                      (sum, s) => sum + s.percentage,
                      0,
                    )
                    const totalAmt = state.monthly.incomeShares.reduce(
                      (sum, s) => sum + s.allocatedAmount,
                      0,
                    )
                    return (
                      <tr className="bg-[var(--background)]/40">
                        <td className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                          Total
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-semibold">
                          {totalPct.toFixed(2)}%
                        </td>
                        <td className="py-2 pl-2 text-right tabular-nums font-semibold">
                          {formatCurrency(totalAmt)}
                        </td>
                      </tr>
                    )
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {state.status === 'loading' ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">
          Loading summary…
        </div>
      ) : state.status === 'ready' && kpis?.transactionCount === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] py-16 text-[var(--muted)]">
          <WalletCards className="h-10 w-10 opacity-30" />
          <p className="text-sm">No transactions in this period.</p>
        </div>
      ) : state.status === 'ready' ? (
        <>
          {/* Trend chart */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <SectionHeading
              info="Sales and combined expenses plotted over time. When comparison is on, the dashed lines show the same metrics from the previous period, aligned bucket-to-bucket so you can spot growth or decline."
              subtitle={`Grouped by ${granularity}${compareLabel ? ` · dashed = ${compareLabel}` : ''}`}
              title="Sales vs Expenses trend"
            />
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trendData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.sales} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_COLORS.sales} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.expense} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CHART_COLORS.expense} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={gridStroke} vertical={false} />
                <XAxis dataKey="label" tick={axisTickProps} axisLine={false} tickLine={false} />
                <YAxis
                  tick={axisTickProps}
                  tickFormatter={currencyTickFormatter}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={currencyTooltipFormatter}
                  itemStyle={tooltipItemStyle}
                  labelStyle={tooltipLabelStyle}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="circle" iconSize={8} />
                <Area
                  activeDot={{ r: 4 }}
                  dataKey="Sales"
                  dot={false}
                  fill="url(#salesGrad)"
                  stroke={CHART_COLORS.sales}
                  strokeWidth={2}
                  type="monotone"
                />
                <Area
                  activeDot={{ r: 4 }}
                  dataKey="Expenses"
                  dot={false}
                  fill="url(#expenseGrad)"
                  stroke={CHART_COLORS.expense}
                  strokeWidth={2}
                  type="monotone"
                />
                {compareRange && (
                  <>
                    <Line
                      dataKey="CompareSales"
                      dot={false}
                      name="Prev Sales"
                      stroke={CHART_COLORS.sales}
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      type="monotone"
                    />
                    <Line
                      dataKey="CompareExpenses"
                      dot={false}
                      name="Prev Expenses"
                      stroke={CHART_COLORS.expense}
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      type="monotone"
                    />
                  </>
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Net income per bucket */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <SectionHeading
                info="Net income per bucket (sales − expenses − operating expense). Indigo bars mean the business was profitable that period, red bars mean a loss."
                subtitle={`Per ${granularity}`}
                title="Net income"
              />
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={trendData}>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="label" tick={axisTickProps} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={axisTickProps}
                    tickFormatter={currencyTickFormatter}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={currencyTooltipFormatter}
                    itemStyle={tooltipItemStyle}
                    labelStyle={tooltipLabelStyle}
                  />
                  <Bar dataKey="Net" radius={[3, 3, 0, 0]}>
                    {trendData.map((row) => (
                      <Cell
                        key={row.bucket}
                        fill={row.Net >= 0 ? CHART_COLORS.net : CHART_COLORS.expense}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Cumulative net */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <SectionHeading
                info="Running total of net income across the selected period. An upward slope means the business is gaining money overall; a downward slope means it is losing money."
                subtitle="Running total of net income"
                title="Cumulative net income"
              />
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={cumulativeNetData}>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="label" tick={axisTickProps} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={axisTickProps}
                    tickFormatter={currencyTickFormatter}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={currencyTooltipFormatter}
                    itemStyle={tooltipItemStyle}
                    labelStyle={tooltipLabelStyle}
                  />
                  <Line
                    dataKey="Cumulative Net"
                    dot={false}
                    stroke={CHART_COLORS.net}
                    strokeWidth={2}
                    type="monotone"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Type donut */}
            {typeBreakdownData.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <SectionHeading
                  info="How the total pesos recorded in this period are split between Sales, Expenses, and Operating Expenses. Helps show where the money is flowing."
                  subtitle="Share of total amount"
                  title="By transaction type"
                />
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={currencyTooltipFormatter}
                      itemStyle={tooltipItemStyle}
                      labelStyle={tooltipLabelStyle}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                    <Pie
                      data={typeBreakdownData}
                      dataKey="value"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {typeBreakdownData.map((row) => (
                        <Cell
                          fill={TYPE_COLORS[row.name] ?? CHART_COLORS.net}
                          key={row.name}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Period-over-period type comparison */}
            {compareRange && typeCompareData.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <SectionHeading
                  info="Side-by-side totals of each transaction type between the selected period and the comparison period. Makes it easy to see which areas grew or shrank."
                  subtitle={`Current vs ${compareLabel}`}
                  title="Period-over-period by type"
                />
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={typeCompareData}>
                    <CartesianGrid stroke={gridStroke} vertical={false} />
                    <XAxis dataKey="name" tick={axisTickProps} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={axisTickProps}
                      tickFormatter={currencyTickFormatter}
                      axisLine={false}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={currencyTooltipFormatter}
                      itemStyle={tooltipItemStyle}
                      labelStyle={tooltipLabelStyle}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                    <Bar dataKey="Current" fill={CHART_COLORS.net} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Previous" fill={CHART_COLORS.compare} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Weekday */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <SectionHeading
              info="Sales and expenses aggregated by day of the week across the entire selected range. Useful for spotting your busiest and slowest days."
              subtitle="Which days drive the most revenue?"
              title="Activity by weekday"
            />
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={weekdayData}>
                <CartesianGrid stroke={gridStroke} vertical={false} />
                <XAxis dataKey="day" tick={axisTickProps} axisLine={false} tickLine={false} />
                <YAxis
                  tick={axisTickProps}
                  tickFormatter={currencyTickFormatter}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={currencyTooltipFormatter}
                  itemStyle={tooltipItemStyle}
                  labelStyle={tooltipLabelStyle}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                <Bar dataKey="Sales" fill={CHART_COLORS.sales} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Expenses" fill={CHART_COLORS.expense} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Category breakdown per type */}
          {categoriesByType.length > 0 && (
            <div>
              <SectionHeading
                info="The largest categories within each transaction type, ranked by total amount. Quickly identifies where most of the money is coming from or going to."
                subtitle="Top categories per type"
                title="Category breakdown"
              />
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {categoriesByType.map(({ type, data }) => {
                  const color = TYPE_COLORS[type] ?? CHART_COLORS.net
                  const chartHeight = Math.max(160, data.length * 36)
                  return (
                    <div
                      className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"
                      key={type}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <h4 className="text-xs font-semibold uppercase tracking-wide">{type}</h4>
                      </div>
                      <ResponsiveContainer width="100%" height={chartHeight}>
                        <BarChart
                          data={data}
                          layout="vertical"
                          margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                        >
                          <CartesianGrid stroke={gridStroke} horizontal={false} />
                          <XAxis
                            axisLine={false}
                            tick={{ ...axisTickProps, fontSize: 10 }}
                            tickFormatter={currencyTickFormatter}
                            tickLine={false}
                            type="number"
                          />
                          <YAxis
                            axisLine={false}
                            dataKey="name"
                            tick={{ ...axisTickProps, fontSize: 11 }}
                            tickLine={false}
                            type="category"
                            width={100}
                          />
                          <Tooltip
                            contentStyle={tooltipStyle}
                            formatter={currencyTooltipFormatter}
                            itemStyle={tooltipItemStyle}
                            labelStyle={tooltipLabelStyle}
                          />
                          <Bar
                            dataKey="amount"
                            fill={color}
                            maxBarSize={18}
                            name="Amount"
                            radius={[0, 4, 4, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Top categories table */}
          {topCategoriesTable.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <SectionHeading
                info="Up to 15 categories with the largest current totals. When comparison is enabled, the Δ % column shows the percent change vs the previous period."
                subtitle={
                  compareRange ? 'Current vs previous period' : 'Largest totals in the period'
                }
                title="Top categories"
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      <th className="py-2 pr-3 text-left font-semibold">Category</th>
                      <th className="py-2 px-2 text-left font-semibold">Type</th>
                      <th className="py-2 px-2 text-right font-semibold">Current</th>
                      <th className="py-2 px-2 text-right font-semibold">Count</th>
                      {compareRange && (
                        <>
                          <th className="py-2 px-2 text-right font-semibold">Previous</th>
                          <th className="py-2 pl-2 text-right font-semibold">Δ %</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {topCategoriesTable.map((row) => (
                      <tr
                        className="transition hover:bg-[var(--background)]"
                        key={`${row.transactionTypeCode}|${row.categoryLabel}`}
                      >
                        <td className="py-2 pr-3 font-medium">{row.categoryLabel}</td>
                        <td className="py-2 px-2">
                          <span
                            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                            style={{
                              backgroundColor: `${TYPE_COLORS[row.transactionTypeCode] ?? CHART_COLORS.net}1a`,
                              color: TYPE_COLORS[row.transactionTypeCode] ?? CHART_COLORS.net,
                            }}
                          >
                            {row.transactionTypeCode}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-medium">
                          {formatCurrency(row.totalAmount)}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-[var(--muted)]">
                          {row.count}
                        </td>
                        {compareRange && (
                          <>
                            <td className="py-2 px-2 text-right tabular-nums text-[var(--muted)]">
                              {row.previous != null ? formatCurrency(row.previous) : '—'}
                            </td>
                            <td className="py-2 pl-2 text-right tabular-nums font-semibold">
                              {row.delta != null ? (
                                <span
                                  className={
                                    row.delta >= 0 ? 'text-emerald-500' : 'text-rose-500'
                                  }
                                >
                                  {row.delta >= 0 ? '+' : ''}
                                  {row.delta.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-[var(--muted)]">—</span>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Monthly bucketed breakdown */}
          {monthlyBreakdownTable.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <SectionHeading
                action={
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                    <Layers className="h-3.5 w-3.5" />
                    {monthlyBreakdownTable.length} month
                    {monthlyBreakdownTable.length !== 1 ? 's' : ''}
                  </span>
                }
                info="Totals broken down month-by-month for the selected range. Only shown when the period covers multiple months."
                title="Monthly breakdown"
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      <th className="py-2 pr-3 text-left font-semibold">Month</th>
                      <th className="py-2 px-2 text-right font-semibold">Sales</th>
                      <th className="py-2 px-2 text-right font-semibold">Expenses</th>
                      <th className="py-2 px-2 text-right font-semibold">Operating</th>
                      <th className="py-2 pl-2 text-right font-semibold">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {monthlyBreakdownTable.map((row) => (
                      <tr className="transition hover:bg-[var(--background)]" key={row.label}>
                        <td className="py-2 pr-3 font-medium">{row.label}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-emerald-500">
                          {formatCurrency(row.sales)}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-red-500">
                          {formatCurrency(row.expense)}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-amber-500">
                          {formatCurrency(row.operatingExpense)}
                        </td>
                        <td
                          className={`py-2 pl-2 text-right tabular-nums font-semibold ${
                            row.net >= 0 ? 'text-indigo-500' : 'text-red-500'
                          }`}
                        >
                          {formatCurrency(row.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}

      {isPeriodOpen && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsPeriodOpen(false)}
          />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-[var(--panel)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">
                  Period
                </h2>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  Select the date range and optional previous-period comparison.
                </p>
              </div>
              <button
                className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={() => setIsPeriodOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Preset
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      className={`rounded-md px-3 py-2 text-xs font-medium transition ${
                        draftPreset === p.id
                          ? 'bg-[var(--accent)] text-white'
                          : 'border border-[var(--border)] bg-[var(--background)] text-[var(--muted)] hover:text-[var(--foreground)]'
                      }`}
                      key={p.id}
                      onClick={() => setDraftPreset(p.id)}
                      type="button"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {draftPreset === 'custom' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
                    From
                    <input
                      className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
                      max={draftCustomRange.to || undefined}
                      onChange={(e) =>
                        setDraftCustomRange((prev) => ({ ...prev, from: e.target.value }))
                      }
                      type="date"
                      value={draftCustomRange.from}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
                    To
                    <input
                      className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
                      min={draftCustomRange.from || undefined}
                      onChange={(e) =>
                        setDraftCustomRange((prev) => ({ ...prev, to: e.target.value }))
                      }
                      type="date"
                      value={draftCustomRange.to}
                    />
                  </label>
                </div>
              ) : (
                <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
                  Anchor date
                  <input
                    className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
                    onChange={(e) => setDraftAnchor(e.target.value)}
                    type="date"
                    value={draftAnchor}
                  />
                  <span className="text-[10px] text-[var(--muted)]">
                    Pick any date inside the {presetLabel(draftPreset).toLowerCase()} you want to view.
                  </span>
                </label>
              )}

              <div className="space-y-3 border-t border-[var(--border)] pt-4">
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <input
                    checked={draftCompareEnabled}
                    className="h-4 w-4 accent-[var(--accent)]"
                    onChange={(e) => setDraftCompareEnabled(e.target.checked)}
                    type="checkbox"
                  />
                  Compare with previous period
                </label>

                {draftCompareEnabled && (
                  <>
                    <p className="text-xs text-[var(--muted)]">
                      Compares with the period immediately before your selection (e.g. this month vs
                      last month).
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-4">
              <button
                className="text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
                onClick={resetPeriodDraft}
                type="button"
              >
                Reset
              </button>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
                  onClick={() => setIsPeriodOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                  onClick={applyPeriodSheet}
                  type="button"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
