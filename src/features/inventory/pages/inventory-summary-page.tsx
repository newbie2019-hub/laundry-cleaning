import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Banknote,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency, formatMonthLabel } from '../../../lib/format'
import {
  getInventoryDailyTrend,
  getInventoryItemSummaries,
  getInventoryMonthlyTrend,
  getLowStockItems,
  type InventoryDailyTrend,
  type InventoryItemSummary,
  type InventoryMonthlyTrend,
  type LowStockItem,
} from '../../../lib/db/repository'

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

export function InventorySummaryPage() {
  const [summaryMonth, setSummaryMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [itemSummaries, setItemSummaries] = useState<InventoryItemSummary[]>([])
  const [dailyTrend, setDailyTrend] = useState<InventoryDailyTrend[]>([])
  const [monthlyTrend, setMonthlyTrend] = useState<InventoryMonthlyTrend[]>([])
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([])
  const [loading, setLoading] = useState(false)

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const [summaries, daily, monthly, lowStock] = await Promise.all([
        getInventoryItemSummaries(summaryMonth),
        getInventoryDailyTrend(summaryMonth),
        getInventoryMonthlyTrend(6),
        getLowStockItems(),
      ])
      setItemSummaries(summaries)
      setDailyTrend(daily)
      setMonthlyTrend(monthly)
      setLowStockItems(lowStock)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [summaryMonth])

  useEffect(() => { loadSummary() }, [loadSummary])

  const totals = useMemo(() => {
    const totalIn = itemSummaries.reduce((s, i) => s + i.totalIn, 0)
    const totalOut = itemSummaries.reduce((s, i) => s + i.totalOut, 0)
    const totalInCost = itemSummaries.reduce((s, i) => s + i.totalInCost, 0)
    const totalOutCost = itemSummaries.reduce((s, i) => s + i.totalOutCost, 0)
    return { totalIn, totalOut, totalInCost, totalOutCost }
  }, [itemSummaries])

  const itemChartData = useMemo(() =>
    itemSummaries
      .filter((s) => s.totalIn > 0 || s.totalOut > 0)
      .map((s) => ({
        name: s.name.length > 12 ? s.name.slice(0, 12) + '…' : s.name,
        'Stock In': s.totalIn,
        'Stock Out': s.totalOut,
      })),
    [itemSummaries],
  )

  const dailyChartData = useMemo(() =>
    dailyTrend.map((d) => ({
      date: d.date.slice(8),
      'Stock In': d.totalIn,
      'Stock Out': d.totalOut,
    })),
    [dailyTrend],
  )

  const monthlyChartData = useMemo(() =>
    monthlyTrend.map((m) => ({
      month: formatMonthLabel(m.monthKey).replace(/\s\d{4}$/, ''),
      'In Cost': m.totalInCost,
      'Out Cost': m.totalOutCost,
    })),
    [monthlyTrend],
  )

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Inventory Summary</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Reports, trends, and breakdown of stock movements.
        </p>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-[var(--muted)]">Period:</label>
        <input
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
          onChange={(e) => setSummaryMonth(e.target.value)}
          type="month"
          value={summaryMonth}
        />
        <span className="text-sm font-medium">{formatMonthLabel(summaryMonth)}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">Loading summary…</div>
      ) : (
        <>
          {/* Low stock alerts */}
          {lowStockItems.length > 0 && (
            <div className="rounded-xl border border-amber-300/50 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-400 mb-2">Low Stock Alerts</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {lowStockItems.map((item) => (
                  <div key={item.id} className="rounded-md bg-white/80 dark:bg-black/20 px-3 py-2 text-xs">
                    <p className="font-medium text-amber-900 dark:text-amber-300 truncate">{item.name}</p>
                    <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                      {formatQty(item.currentStock, item.unitLabel)} / min {formatQty(item.lowStockThreshold, item.unitLabel)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard
              label="Total Stock In"
              value={formatQty(totals.totalIn)}
              sub={formatCurrency(totals.totalInCost)}
              icon={ArrowDownToLine}
              color="text-emerald-500"
              bg="bg-emerald-500/10"
            />
            <SummaryCard
              label="Total Stock Out"
              value={formatQty(totals.totalOut)}
              sub={formatCurrency(totals.totalOutCost)}
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
              value={formatCurrency(totals.totalInCost - totals.totalOutCost)}
              sub="In cost − Out cost"
              icon={Banknote}
              color={totals.totalInCost - totals.totalOutCost >= 0 ? 'text-amber-500' : 'text-red-500'}
              bg={totals.totalInCost - totals.totalOutCost >= 0 ? 'bg-amber-500/10' : 'bg-red-500/10'}
            />
          </div>

          {/* Charts */}
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

          {/* Monthly cost trend */}
          {monthlyChartData.length > 1 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
                Monthly Cost Trend (Last 6 Months)
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="In Cost" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Out Cost" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Item breakdown table */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">
              Item Breakdown — {formatMonthLabel(summaryMonth)}
            </h3>
            <div className="rounded-xl border border-[var(--border)] overflow-hidden">
              {itemSummaries.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-[var(--muted)]">
                  <BarChart3 className="h-8 w-8 opacity-40" />
                  <p className="text-sm">No data for this period.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--panel)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      <th className="px-4 py-2.5 text-left font-semibold">Item</th>
                      <th className="px-4 py-2.5 text-right font-semibold">In Qty</th>
                      <th className="px-4 py-2.5 text-right font-semibold">In Cost</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Out Qty</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Out Cost</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Net Change</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Current Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {itemSummaries.map((s) => {
                      const net = s.totalIn - s.totalOut
                      return (
                        <tr key={s.id} className="transition hover:bg-[var(--background)]">
                          <td className="px-4 py-3 font-medium">{s.name}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-emerald-600 whitespace-nowrap">
                            {s.totalIn > 0 ? (
                              <span className="inline-flex items-center justify-end gap-1">
                                <TrendingUp className="h-3 w-3" />
                                {formatQty(s.totalIn, s.unitLabel)}
                              </span>
                            ) : <span className="text-[var(--muted)]">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-emerald-600 whitespace-nowrap">
                            {s.totalInCost > 0 ? formatCurrency(s.totalInCost) : <span className="text-[var(--muted)]">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-red-500 whitespace-nowrap">
                            {s.totalOut > 0 ? (
                              <span className="inline-flex items-center justify-end gap-1">
                                <TrendingDown className="h-3 w-3" />
                                {formatQty(s.totalOut, s.unitLabel)}
                              </span>
                            ) : <span className="text-[var(--muted)]">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-red-500 whitespace-nowrap">
                            {s.totalOutCost > 0 ? formatCurrency(s.totalOutCost) : <span className="text-[var(--muted)]">—</span>}
                          </td>
                          <td className={[
                            'px-4 py-3 text-right tabular-nums font-medium whitespace-nowrap',
                            net > 0 ? 'text-emerald-600' : net < 0 ? 'text-red-500' : 'text-[var(--muted)]',
                          ].join(' ')}>
                            {net > 0 ? '+' : ''}{formatQty(net, s.unitLabel)}
                          </td>
                          <td className={[
                            'px-4 py-3 text-right tabular-nums font-medium whitespace-nowrap',
                            s.currentStock <= 0 ? 'text-red-500' : '',
                          ].join(' ')}>
                            {formatQty(s.currentStock, s.unitLabel)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--border)] bg-[var(--panel)] text-xs font-semibold">
                      <td className="px-4 py-2.5 uppercase tracking-wide text-[var(--muted)]">Totals</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 whitespace-nowrap">{formatQty(totals.totalIn)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 whitespace-nowrap">{formatCurrency(totals.totalInCost)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-red-500 whitespace-nowrap">{formatQty(totals.totalOut)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-red-500 whitespace-nowrap">{formatCurrency(totals.totalOutCost)}</td>
                      <td className={[
                        'px-4 py-2.5 text-right tabular-nums font-bold whitespace-nowrap',
                        totals.totalIn - totals.totalOut >= 0 ? 'text-emerald-600' : 'text-red-500',
                      ].join(' ')}>
                        {totals.totalIn - totals.totalOut >= 0 ? '+' : ''}{formatQty(totals.totalIn - totals.totalOut)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
