import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  Area,
  AreaChart,
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
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Box,
  CreditCard,
  FileText,
  Package,
  Receipt,
  TrendingDown,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { MonthPicker } from '../../../components/month-picker'
import { LowStockWidget } from '../../inventory/components/low-stock-widget'
import { formatCurrency, formatMonthLabel } from '../../../lib/format'
import {
  getDashboardData,
  getLowStockItems,
  getRecentIncidents,
  getRecentTransactions,
  getTopCustomersForMonth,
  getTotalInventoryValue,
  listPayrollPayDateSummaries,
  type DashboardData,
  type IncidentReport,
  type LedgerTransaction,
  type LowStockItem,
  type TopCustomer,
} from '../../../lib/db/repository'

type LoadState =
  | { status: 'loading' }
  | {
      dashboard: DashboardData
      laborCost: number
      lowStockItems: LowStockItem[]
      recentIncidents: IncidentReport[]
      recentTransactions: LedgerTransaction[]
      status: 'ready'
      topCustomers: TopCustomer[]
      totalInventoryValue: number
    }
  | { message: string; status: 'error' }


const CHART_COLORS = {
  sales: '#10b981',
  expense: '#ef4444',
  netIncome: '#6366f1',
}

const TYPE_COLORS: Record<string, string> = {
  SALE: '#10b981',
  EXPENSE: '#ef4444',
  'OPERATING EXPENSE': '#f59e0b',
}


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

function currencyFormatter(value: import('recharts/types/component/DefaultTooltipContent').ValueType | undefined, name: import('recharts/types/component/DefaultTooltipContent').NameType | undefined) {
  return [formatCurrency(Number(value) || 0), String(name ?? '')]
}

/** Max categories charted per transaction type; the rest roll up into "Other". */
const MAX_CATEGORY_BARS = 7

export function DashboardPage() {
  const navigate = useNavigate()
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'))
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let isMounted = true

    async function load() {
      try {
        const [
          dashboard,
          lowStockItems,
          recentTransactions,
          recentIncidents,
          totalInventoryValue,
          payrollSummaries,
          topCustomers,
        ] = await Promise.all([
          getDashboardData(selectedMonth),
          getLowStockItems(),
          getRecentTransactions(5),
          getRecentIncidents(3),
          getTotalInventoryValue(),
          listPayrollPayDateSummaries(`${selectedMonth}-01`, `${selectedMonth}-31`),
          getTopCustomersForMonth(selectedMonth, 5),
        ])

        if (!isMounted) return

        const laborCost = payrollSummaries.reduce((sum, row) => sum + row.totalGross, 0)

        setState({
          dashboard,
          laborCost,
          lowStockItems,
          recentIncidents,
          recentTransactions,
          status: 'ready',
          topCustomers,
          totalInventoryValue,
        })
      } catch (error: unknown) {
        if (!isMounted) return
        setState({
          message: error instanceof Error ? error.message : 'Unable to load dashboard data.',
          status: 'error',
        })
      }
    }

    void load()
    return () => {
      isMounted = false
    }
  }, [selectedMonth])

  const dailyData = useMemo(() => {
    if (state.status !== 'ready') return []
    return state.dashboard.dailySeries.map((row) => ({
      day: format(new Date(`${row.date}T00:00:00`), 'd'),
      Sales: row.sales,
      Expenses: row.expense + row.operatingExpense,
    }))
  }, [state])

  const categoryCharts = useMemo(() => {
    if (state.status !== 'ready') return []
    const grouped = new Map<string, { name: string; amount: number }[]>()
    for (const item of state.dashboard.categoryBreakdown) {
      if (!grouped.has(item.transactionTypeCode)) {
        grouped.set(item.transactionTypeCode, [])
      }
      grouped.get(item.transactionTypeCode)!.push({
        name: item.categoryLabel,
        amount: item.totalAmount,
      })
    }
    return Array.from(grouped.entries()).map(([type, data]) => ({
      type,
      data: [...data].sort((a, b) => b.amount - a.amount),
    }))
  }, [state])

  const monthlyTrend = useMemo(() => {
    if (state.status !== 'ready') return []
    return state.dashboard.monthlySeries.map((row) => ({
      month: formatMonthLabel(row.monthKey),
      Sales: row.sales,
      Expenses: row.expense,
      Net: row.netIncome,
    }))
  }, [state])

  const topCustomerData = useMemo(() => {
    if (state.status !== 'ready') return []
    return state.topCustomers.map((customer) => ({
      name: customer.name,
      Total: customer.total,
      transactionCount: customer.transactionCount,
    }))
  }, [state])

  const dayHighlights = useMemo(() => {
    if (state.status !== 'ready') return null
    const withSales = state.dashboard.dailySeries.filter((row) => row.sales > 0)
    if (withSales.length === 0) return null
    let peak = withSales[0]
    let slow = withSales[0]
    for (const row of withSales) {
      if (row.sales > peak.sales) peak = row
      if (row.sales < slow.sales) slow = row
    }
    return { peak, slow, activeDays: withSales.length }
  }, [state])

  const previousMonth = state.status === 'ready' ? state.dashboard.previousMonth : null

  function kpiDelta(current: number, previous: number | undefined) {
    if (previous === undefined || previous === 0) return null
    return ((current - previous) / Math.abs(previous)) * 100
  }

  function formatDayLabel(date: string) {
    return format(new Date(`${date}T00:00:00`), 'MMM d')
  }

  return (
    <section className="space-y-5">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Business overview and key metrics
          </p>
        </div>

        <div className="flex flex-col items-start gap-1 sm:items-end">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Reporting period
          </span>
          <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
        </div>
      </header>

      {state.status === 'error' ? (
        <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-400">
          {state.message}
        </div>
      ) : null}

      {/* ── Monthly figures group ── */}
      <div className="pt-1">
        <h2 className="text-base font-semibold tracking-tight">Monthly Summary</h2>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Sales, expenses, and categories for {formatMonthLabel(selectedMonth)}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {state.status === 'ready'
          ? [
              {
                label: 'Gross Sales',
                value: state.dashboard.kpis.totalSales,
                prevValue: previousMonth?.kpis.totalSales,
                icon: TrendingUp,
                color: 'text-emerald-500',
                bg: 'bg-emerald-500/10',
                delta: kpiDelta(state.dashboard.kpis.totalSales, previousMonth?.kpis.totalSales),
              },
              {
                label: 'Total Expenses',
                value: state.dashboard.kpis.totalExpenses,
                prevValue: previousMonth?.kpis.totalExpenses,
                icon: CreditCard,
                color: 'text-red-500',
                bg: 'bg-red-500/10',
                delta: kpiDelta(state.dashboard.kpis.totalExpenses, previousMonth?.kpis.totalExpenses),
                invertDelta: true,
              },
              {
                label: 'Net Income',
                value: state.dashboard.kpis.netIncome,
                prevValue: previousMonth?.kpis.netIncome,
                icon: Banknote,
                color: 'text-indigo-500',
                bg: 'bg-indigo-500/10',
                delta: kpiDelta(state.dashboard.kpis.netIncome, previousMonth?.kpis.netIncome),
              },
            ].map(({ label, value, prevValue, icon: Icon, color, bg, delta, invertDelta }) => (
              <div
                key={label}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                    {label}
                  </p>
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
                    <Icon className={`h-3.5 w-3.5 ${color}`} />
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <p className="text-2xl font-semibold tabular-nums tracking-tight">
                    {formatCurrency(Number(value))}
                  </p>
                  {delta != null && prevValue != null && (
                    <span
                      className={`inline-flex cursor-default items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold ${
                        (invertDelta ? delta <= 0 : delta >= 0)
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : 'bg-rose-500/10 text-rose-500'
                      }`}
                      title={`Previous: ${formatCurrency(prevValue)} → Current: ${formatCurrency(Number(value))}\nChange: ${delta >= 0 ? '+' : ''}${formatCurrency(Number(value) - prevValue)}`}
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
                {prevValue != null ? (
                  <p className="mt-1.5 text-xs text-[var(--muted)] tabular-nums">
                    {formatCurrency(prevValue)}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-[var(--muted)]">No previous data</p>
                )}
              </div>
            ))
          : Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-[106px] animate-pulse rounded-lg border border-[var(--border)] bg-[var(--panel)]"
              />
            ))}
      </div>

      {/* Health ratios */}
      {state.status === 'ready'
        ? (() => {
            const { totalSales, netIncome, operatingExpense } = state.dashboard.kpis
            const margin = totalSales > 0 ? (netIncome / totalSales) * 100 : null
            const opexRatio = totalSales > 0 ? (operatingExpense / totalSales) * 100 : null
            const laborRatio = totalSales > 0 ? (state.laborCost / totalSales) * 100 : null
            const metrics = [
              {
                label: 'Profit Margin',
                value: margin != null ? `${margin.toFixed(1)}%` : '—',
                hint: 'Net income ÷ gross sales',
                tone: margin == null ? '' : margin >= 0 ? 'text-emerald-500' : 'text-rose-500',
              },
              {
                label: 'Operating Expense Ratio',
                value: opexRatio != null ? `${opexRatio.toFixed(1)}%` : '—',
                hint: 'Operating expense ÷ gross sales',
                tone: '',
              },
              {
                label: 'Labor Cost',
                value: formatCurrency(state.laborCost),
                hint: laborRatio != null ? `${laborRatio.toFixed(1)}% of sales` : 'Payroll paid this month',
                tone: '',
              },
            ]
            return (
              <div className="grid gap-3 sm:grid-cols-3">
                {metrics.map((m) => (
                  <div
                    key={m.label}
                    className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3"
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                      {m.label}
                    </p>
                    <p className={`mt-1 text-lg font-semibold tabular-nums ${m.tone}`}>{m.value}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">{m.hint}</p>
                  </div>
                ))}
              </div>
            )
          })()
        : null}

      {/* Daily area chart */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-sm font-semibold">Daily Activity</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Sales vs combined expenses per day</p>
        <div className="mt-5 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.sales} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={CHART_COLORS.sales} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.expense} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={CHART_COLORS.expense} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={gridStroke} vertical={false} />
              <XAxis dataKey="day" tick={axisTickProps} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`}
                tick={axisTickProps}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <Tooltip
                formatter={currencyFormatter}
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                labelFormatter={(label) => `Day ${String(label)}`}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="circle" iconSize={8} />
              <Area
                type="monotone"
                dataKey="Sales"
                stroke={CHART_COLORS.sales}
                strokeWidth={2}
                fill="url(#salesGrad)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Area
                type="monotone"
                dataKey="Expenses"
                stroke={CHART_COLORS.expense}
                strokeWidth={2}
                fill="url(#expenseGrad)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {dayHighlights && (
          <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Best day</p>
              <p className="mt-0.5 text-sm font-semibold">
                {formatDayLabel(dayHighlights.peak.date)}
                <span className="ml-1.5 font-normal text-emerald-500 tabular-nums">
                  {formatCurrency(dayHighlights.peak.sales)}
                </span>
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Slowest day</p>
              <p className="mt-0.5 text-sm font-semibold">
                {formatDayLabel(dayHighlights.slow.date)}
                <span className="ml-1.5 font-normal text-[var(--muted)] tabular-nums">
                  {formatCurrency(dayHighlights.slow.sales)}
                </span>
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Active days</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {dayHighlights.activeDays}
                <span className="ml-1.5 font-normal text-[var(--muted)]">with sales</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Inventory low-stock alert */}
      <LowStockWidget />

      {/* Category breakdown per type — one type per row */}
      {categoryCharts.length > 0 && (
        <div>
          <div className="mb-3">
            <h3 className="text-sm font-semibold">Category Breakdown by Type</h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Where sales and spending went, grouped by transaction type
            </p>
          </div>
          <div className="space-y-4">
            {categoryCharts.map(({ type, data }) => {
              const color = TYPE_COLORS[type] ?? '#6366f1'
              const typeTotal = data.reduce((sum, row) => sum + row.amount, 0)
              const shown = data.slice(0, MAX_CATEGORY_BARS)
              const rest = data.slice(MAX_CATEGORY_BARS)
              const chartData =
                rest.length > 0
                  ? [
                      ...shown,
                      {
                        name: `Other (${rest.length})`,
                        amount: rest.reduce((sum, row) => sum + row.amount, 0),
                      },
                    ]
                  : shown
              const chartHeight = Math.max(120, chartData.length * 34)
              return (
                <div
                  key={type}
                  className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                      <h3 className="text-xs font-semibold uppercase tracking-wide">{type}</h3>
                      <span className="text-[10px] text-[var(--muted)]">
                        {data.length} categor{data.length === 1 ? 'y' : 'ies'}
                      </span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums" style={{ color }}>
                      {formatCurrency(typeTotal)}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <BarChart
                      data={chartData}
                      layout="vertical"
                      margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                    >
                      <CartesianGrid stroke={gridStroke} horizontal={false} />
                      <XAxis
                        type="number"
                        tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`}
                        tick={{ ...axisTickProps, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ ...axisTickProps, fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={140}
                      />
                      <Tooltip
                        formatter={currencyFormatter}
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        itemStyle={tooltipItemStyle}
                        cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                      />
                      <Bar
                        dataKey="amount"
                        fill={color}
                        radius={[0, 4, 4, 0]}
                        maxBarSize={22}
                        name="Amount"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Top customers this month */}
      {state.status === 'ready' && state.topCustomers.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--muted)]" />
              <h3 className="text-sm font-semibold">Top Customers</h3>
            </div>
            <button
              className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
              onClick={() => navigate('/customers')}
              type="button"
            >
              View all
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCustomerData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid stroke={gridStroke} vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ ...axisTickProps, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`}
                  tick={axisTickProps}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  formatter={currencyFormatter}
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                />
                <Bar
                  dataKey="Total"
                  fill={CHART_COLORS.sales}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={56}
                  name="Total"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Current status group (always latest, ignores the month filter) ── */}
      <div className="pt-4">
        <h2 className="text-base font-semibold tracking-tight">Current Status</h2>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          All-time trend, live inventory, and recent activity — not affected by the selected month
        </p>
      </div>

      {/* Monthly trend (all months) */}
      {monthlyTrend.length > 1 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <h2 className="text-sm font-semibold">Monthly Trend</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Sales, expenses, and net income across all months
          </p>
          <div className="mt-5 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTrend} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid stroke={gridStroke} vertical={false} />
                <XAxis dataKey="month" tick={axisTickProps} axisLine={false} tickLine={false} />
                <YAxis
                  tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`}
                  tick={axisTickProps}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  formatter={currencyFormatter}
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="circle" iconSize={8} />
                <Line
                  type="monotone"
                  dataKey="Sales"
                  stroke={CHART_COLORS.sales}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="Expenses"
                  stroke={CHART_COLORS.expense}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="Net"
                  stroke={CHART_COLORS.netIncome}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Low Stock Alerts */}
      {state.status === 'ready' && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {state.lowStockItems.length > 0 ? (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              ) : (
                <Box className="h-4 w-4 text-emerald-500" />
              )}
              <h2 className="text-sm font-semibold">Inventory Stock Alerts</h2>
              {state.lowStockItems.length > 0 && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                  {state.lowStockItems.length} item{state.lowStockItems.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden text-right sm:block">
                <p className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  <Package className="h-3 w-3" />
                  On hand
                </p>
                <p className="text-sm font-semibold tabular-nums">
                  {formatCurrency(state.totalInventoryValue)}
                </p>
              </div>
              <button
                className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                onClick={() => navigate('/inventory')}
                type="button"
              >
                View inventory
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {state.lowStockItems.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2 pr-4 text-left font-semibold">Item</th>
                    <th className="pb-2 px-4 text-right font-semibold">Current Stock</th>
                    <th className="pb-2 px-4 text-right font-semibold">Threshold</th>
                    <th className="pb-2 px-4 text-right font-semibold">Status</th>
                    <th className="pb-2 pl-4 text-right font-semibold">Stock Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {state.lowStockItems.map((item) => {
                    const isCritical = item.currentStock <= 0
                    return (
                      <tr key={item.id} className="transition hover:bg-[var(--background)]">
                        <td className="py-2.5 pr-4 font-medium">{item.name}</td>
                        <td
                          className={`py-2.5 px-4 text-right tabular-nums font-medium ${
                            isCritical ? 'text-red-500' : 'text-amber-600'
                          }`}
                        >
                          {item.currentStock % 1 === 0
                            ? String(item.currentStock)
                            : item.currentStock.toFixed(2)}{' '}
                          <span className="font-normal text-[var(--muted)]">{item.unitLabel}</span>
                        </td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-[var(--muted)]">
                          {item.lowStockThreshold} {item.unitLabel}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              isCritical
                                ? 'bg-red-500/15 text-red-500'
                                : 'bg-amber-500/15 text-amber-600'
                            }`}
                          >
                            {isCritical ? 'Out of stock' : 'Low stock'}
                          </span>
                        </td>
                        <td className="py-2.5 pl-4 text-right tabular-nums text-[var(--muted)]">
                          {formatCurrency(item.stockValue)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2 rounded-md bg-emerald-500/10 px-4 py-3">
              <Box className="h-4 w-4 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-600">
                All stock levels are healthy — no items below threshold.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Recent activity */}
      {state.status === 'ready' && (
        <div className="grid gap-5 xl:grid-cols-2">
          {/* Recent transactions */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-[var(--muted)]" />
                <h2 className="text-sm font-semibold">Recent Transactions</h2>
                <span className="text-[10px] text-[var(--muted)]">Latest 5</span>
              </div>
              <button
                className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                onClick={() => navigate('/transactions')}
                type="button"
              >
                View all
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            {state.recentTransactions.length > 0 ? (
              <div className="space-y-2">
                {state.recentTransactions.map((txn) => (
                  <div
                    key={txn.id}
                    className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: TYPE_COLORS[txn.transactionTypeCode] ?? '#6366f1' }}
                        />
                        <p className="truncate text-sm font-medium">
                          {txn.description || txn.categoryLabel}
                        </p>
                      </div>
                      <p className="mt-0.5 pl-3.5 text-xs text-[var(--muted)]">
                        {txn.entryDate} · {txn.categoryLabel}
                      </p>
                    </div>
                    <span
                      className={`ml-3 shrink-0 text-sm font-semibold tabular-nums ${
                        txn.transactionTypeCode === 'SALE' ? 'text-emerald-500' : 'text-red-500'
                      }`}
                    >
                      {txn.transactionTypeCode === 'SALE' ? '+' : '-'}
                      {formatCurrency(txn.amount)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-[var(--muted)]">No recent transactions.</p>
            )}
          </div>

          {/* Recent incidents */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[var(--muted)]" />
                <h2 className="text-sm font-semibold">Recent Incident Reports</h2>
                <span className="text-[10px] text-[var(--muted)]">Latest 3</span>
              </div>
              <button
                className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                onClick={() => navigate('/incidents')}
                type="button"
              >
                View all
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            {state.recentIncidents.length > 0 ? (
              <div className="space-y-2">
                {state.recentIncidents.map((incident) => (
                  <div
                    key={incident.id}
                    className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-500">
                          {incident.incidentType || 'Incident'}
                        </span>
                        <span className="text-xs text-[var(--muted)]">{incident.incidentDate}</span>
                      </div>
                      {incident.estimatedLoss > 0 && (
                        <span className="text-xs font-medium text-red-500 tabular-nums">
                          -{formatCurrency(incident.estimatedLoss)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-sm text-[var(--foreground)]">
                      {incident.whatHappened || 'No description'}
                    </p>
                    {incident.handledBy && (
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        Handled by: {incident.handledBy}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-6 text-[var(--muted)]">
                <Wrench className="h-6 w-6 opacity-40" />
                <p className="text-sm">No recent incidents — keep it up!</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
