import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
  Calendar,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wrench,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { formatCurrency, formatMonthLabel } from '../../../lib/format'
import {
  getDashboardData,
  getLowStockItems,
  getRecentIncidents,
  getRecentTransactions,
  type DashboardData,
  type IncidentReport,
  type LedgerTransaction,
  type LowStockItem,
} from '../../../lib/db/repository'

type LoadState =
  | { status: 'loading' }
  | {
      dashboard: DashboardData
      lowStockItems: LowStockItem[]
      recentIncidents: IncidentReport[]
      recentTransactions: LedgerTransaction[]
      status: 'ready'
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

function currencyFormatter(value: unknown, name: string): [string, string] {
  return [formatCurrency(value as number), name]
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function MonthPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (monthKey: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(() => Number(value.slice(0, 4)))
  const ref = useRef<HTMLDivElement>(null)

  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth()
  const selectedYear = Number(value.slice(0, 4))
  const selectedMonthIndex = Number(value.slice(5, 7)) - 1

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function handleOpen() {
    setPickerYear(selectedYear)
    setOpen((prev) => !prev)
  }

  function selectMonth(monthIndex: number) {
    const key = `${pickerYear}-${String(monthIndex + 1).padStart(2, '0')}`
    onChange(key)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm outline-none transition hover:border-[var(--accent)] focus:border-[var(--accent)]"
        onClick={handleOpen}
        type="button"
      >
        <Calendar className="h-3.5 w-3.5 text-[var(--muted)]" />
        <span>{formatMonthLabel(value)}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
              onClick={() => setPickerYear((y) => y - 1)}
              type="button"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold tabular-nums">{pickerYear}</span>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:pointer-events-none"
              disabled={pickerYear >= currentYear}
              onClick={() => setPickerYear((y) => y + 1)}
              type="button"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {MONTH_LABELS.map((label, index) => {
              const isFuture = pickerYear === currentYear && index > currentMonth
              const isSelected = pickerYear === selectedYear && index === selectedMonthIndex
              return (
                <button
                  key={label}
                  className={`rounded-md py-2 text-xs font-medium transition ${
                    isSelected
                      ? 'bg-[var(--accent)] text-white'
                      : isFuture
                        ? 'text-[var(--muted)]/40 pointer-events-none opacity-30'
                        : 'text-[var(--foreground)] hover:bg-[var(--background)]'
                  }`}
                  disabled={isFuture}
                  onClick={() => selectMonth(index)}
                  type="button"
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'))
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let isMounted = true

    async function load() {
      try {
        const [dashboard, lowStockItems, recentTransactions, recentIncidents] =
          await Promise.all([
            getDashboardData(selectedMonth),
            getLowStockItems(),
            getRecentTransactions(5),
            getRecentIncidents(3),
          ])

        if (!isMounted) return

        setState({
          dashboard,
          lowStockItems,
          recentIncidents,
          recentTransactions,
          status: 'ready',
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

  const previousMonth = state.status === 'ready' ? state.dashboard.previousMonth : null

  function kpiDelta(current: number, previous: number | undefined) {
    if (previous === undefined || previous === 0) return null
    return ((current - previous) / Math.abs(previous)) * 100
  }

  return (
    <section className="space-y-5">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Business overview and key metrics
          </p>
        </div>

        <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
      </header>

      {state.status === 'error' ? (
        <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-400">
          {state.message}
        </div>
      ) : null}

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

      {/* Daily area chart */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-sm font-semibold">Daily Activity — {formatMonthLabel(selectedMonth)}</h2>
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
      </div>

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
            <button
              className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
              onClick={() => navigate('/inventory')}
              type="button"
            >
              View inventory
              <ArrowRight className="h-3 w-3" />
            </button>
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


      {/* Category breakdown per type */}
      {categoryCharts.length > 0 && (
        <div>
          <div className="mb-4">
            <h2 className="text-sm font-semibold">Category Breakdown by Type</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Top categories per transaction type — {formatMonthLabel(selectedMonth)}
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {categoryCharts.map(({ type, data }) => {
              const color = TYPE_COLORS[type] ?? '#6366f1'
              const chartHeight = Math.max(160, data.length * 36)
              return (
                <div
                  key={type}
                  className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5"
                >
                  <div className="mb-4 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                    <h3 className="text-xs font-semibold uppercase tracking-wide">{type}</h3>
                  </div>
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <BarChart
                      data={data}
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
                        width={88}
                      />
                      <Tooltip
                        formatter={currencyFormatter}
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        itemStyle={tooltipItemStyle}
                      />
                      <Bar
                        dataKey="amount"
                        fill={color}
                        radius={[0, 4, 4, 0]}
                        maxBarSize={18}
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

      {/* Recent activity */}
      {state.status === 'ready' && (
        <div className="grid gap-5 xl:grid-cols-2">
          {/* Recent transactions */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-[var(--muted)]" />
                <h2 className="text-sm font-semibold">Recent Transactions</h2>
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
