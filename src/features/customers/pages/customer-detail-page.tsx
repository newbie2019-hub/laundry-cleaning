import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Pencil, Plus, X } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { formatCurrency } from '../../../lib/format'
import {
  getCustomerById,
  getCustomerLoyaltyStatus,
  listTransactions,
  saveCustomer,
  setCustomerLoyaltyEnabled,
  type Customer,
  type CustomerDraft,
  type CustomerLoyaltyStatus,
  type LedgerTransaction,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAGE_SIZE = 25

function formatTxDate(entryDate: string) {
  return format(new Date(`${entryDate}T00:00:00`), 'MMM d, yyyy')
}

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const customerId = Number(id)
  const { activeBusiness, hasPermission, user } = useAuth()
  const isCleaningBusiness = activeBusiness === 'cleaning'
  const canManage = hasPermission('manage_master_data')

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loyalty, setLoyalty] = useState<CustomerLoyaltyStatus | null>(null)
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [txPage, setTxPage] = useState(0)

  const [modalOpen, setModalOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formCompany, setFormCompany] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formLoyaltyEnabled, setFormLoyaltyEnabled] = useState(false)
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [loyaltyToggling, setLoyaltyToggling] = useState(false)

  const load = useCallback(async () => {
    if (!Number.isFinite(customerId) || customerId <= 0) {
      setCustomer(null)
      setLoyalty(null)
      setTransactions([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [c, l, txs] = await Promise.all([
        getCustomerById(customerId),
        getCustomerLoyaltyStatus(customerId),
        listTransactions({ customerId }),
      ])
      setCustomer(c)
      setLoyalty(l)
      setTransactions(txs)
      setTxPage(0)
    } finally {
      setLoading(false)
    }
  }, [customerId])

  useEffect(() => {
    void load()
  }, [load])

  function openEdit() {
    if (!customer) return
    setFormName(customer.name)
    setFormCompany(customer.company)
    setFormEmail(customer.email)
    setFormPhone(customer.phone)
    setFormLoyaltyEnabled(customer.isLoyaltyEnabled)
    setModalOpen(true)
  }

  async function handleToggleLoyalty(next: boolean) {
    if (!user || !canManage || !customer) return
    setLoyaltyToggling(true)
    try {
      await setCustomerLoyaltyEnabled(customer.id, next, user.id)
      toast.success(next ? 'Loyalty enabled.' : 'Loyalty disabled.')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update loyalty.')
    } finally {
      setLoyaltyToggling(false)
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!user || !canManage || !customer) return
    if (!formName.trim()) {
      toast.error('Name is required.')
      return
    }
    if (formEmail.trim() && !emailRegex.test(formEmail.trim())) {
      toast.error('Please enter a valid email address.')
      return
    }
    setFormSubmitting(true)
    try {
      const draft: CustomerDraft = {
        company: formCompany,
        email: formEmail,
        isLoyaltyEnabled: formLoyaltyEnabled,
        name: formName,
        phone: formPhone,
      }
      await saveCustomer(draft, user.id, customer.id)
      toast.success('Customer updated.')
      setModalOpen(false)
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to save customer.')
    } finally {
      setFormSubmitting(false)
    }
  }

  const totalTxPages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE))
  const pagedTransactions = useMemo(() => {
    const start = txPage * PAGE_SIZE
    return transactions.slice(start, start + PAGE_SIZE)
  }, [transactions, txPage])

  const stampSlots = loyalty ? loyalty.freeAfterLoads + 1 : 0
  const fullStamps = loyalty
    ? Math.min(Math.floor(loyalty.paidLoadsSinceLastReward), loyalty.freeAfterLoads)
    : 0

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-sm text-[var(--muted)]">Loading…</div>
  }

  if (!customer) {
    return (
      <section className="space-y-4">
        <Link className="inline-flex items-center gap-1 text-sm text-[var(--accent-strong)]" to="/customers">
          <ArrowLeft className="h-4 w-4" />
          Customers
        </Link>
        <p className="text-sm text-[var(--muted)]">Customer not found.</p>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--accent-strong)] hover:underline"
            to="/customers"
          >
            <ArrowLeft className="h-4 w-4" />
            Customers
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">{customer.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {[customer.company, customer.email, customer.phone].filter(Boolean).join(' · ') || 'No extra details'}
          </p>
        </div>
        {canManage ? (
          <button
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm font-medium transition hover:bg-[var(--background)]"
            onClick={openEdit}
            type="button"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
        ) : null}
      </div>

      {loyalty && !isCleaningBusiness ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Loyalty card</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {loyalty.isLoyaltyEnabled
                  ? `Paid loads on loadable sale categories count toward a free load after ${loyalty.freeAfterLoads} paid loads.`
                  : 'Loyalty is not given to first-time customers. Enable it once this customer qualifies.'}
              </p>
            </div>
            {canManage ? (
              <button
                className={[
                  'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-50',
                  loyalty.isLoyaltyEnabled
                    ? 'border border-[var(--border)] text-[var(--muted)] hover:text-red-400 hover:border-red-400/60'
                    : 'bg-[var(--accent)] text-white hover:opacity-90',
                ].join(' ')}
                disabled={loyaltyToggling}
                onClick={() => {
                  void handleToggleLoyalty(!loyalty.isLoyaltyEnabled)
                }}
                type="button"
              >
                {loyaltyToggling
                  ? 'Saving…'
                  : loyalty.isLoyaltyEnabled
                    ? 'Disable loyalty'
                    : 'Enable loyalty'}
              </button>
            ) : null}
          </div>

          {loyalty.isLoyaltyEnabled ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {Array.from({ length: stampSlots }, (_, i) => {
                  const isFreeSlot = i === loyalty.freeAfterLoads
                  if (isFreeSlot) {
                    return (
                      <div
                        key="free"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-violet-400/70 bg-violet-500/10 text-[10px] font-bold uppercase tracking-wide text-violet-600"
                      >
                        Free
                      </div>
                    )
                  }
                  const filled = i < fullStamps
                  return (
                    <div
                      key={i}
                      className={[
                        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold tabular-nums transition',
                        filled
                          ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                          : 'border-[var(--border)] bg-[var(--background)] text-[var(--muted)]',
                      ].join(' ')}
                      title={`Slot ${i + 1} of ${loyalty.freeAfterLoads}`}
                    >
                      {i + 1}
                    </div>
                  )
                })}
              </div>

              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Progress</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {loyalty.paidLoadsSinceLastReward.toFixed(2)} / {loyalty.freeAfterLoads} paid loads
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Rewards redeemed</dt>
                  <dd className="mt-0.5 tabular-nums">{loyalty.totalRewardsRedeemed}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Lifetime paid loads</dt>
                  <dd className="mt-0.5 tabular-nums">{loyalty.totalPaidLoads.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Last reward</dt>
                  <dd className="mt-0.5 tabular-nums">{loyalty.lastRewardDate ?? '—'}</dd>
                </div>
              </dl>

              {loyalty.isEligibleForReward ? (
                <p className="mt-3 text-sm font-medium text-violet-600">
                  Customer is eligible — record the next sale with &quot;Redeem loyalty reward&quot; on the Transactions
                  page.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Transactions</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{transactions.length} total</p>
          </div>
          <Link
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
            to={`/transactions?customerId=${customer.id}`}
          >
            <Plus className="h-4 w-4" />
            New transaction
          </Link>
        </div>

        {transactions.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--muted)]">No transactions for this customer yet.</p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--background)]/50 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Category</th>
                    {!isCleaningBusiness && <th className="px-3 py-2.5 text-right">Loads</th>}
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="px-3 py-2.5">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {pagedTransactions.map((t) => (
                    <tr key={t.id} className="hover:bg-[var(--background)]/40">
                      <td className="px-3 py-2.5 tabular-nums text-[var(--muted)] whitespace-nowrap">
                        {formatTxDate(t.entryDate)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--accent-strong)]">
                          {t.transactionTypeCode}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">{t.categoryLabel}</td>
                      {!isCleaningBusiness && (
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {t.isLoyaltyReward ? (
                            <span className="text-violet-600 font-medium">Free</span>
                          ) : t.loads != null ? (
                            <>
                              {t.loads}
                              {t.kg != null ? <span className="text-[var(--muted)]"> ({t.kg} kg)</span> : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatCurrency(t.amount)}</td>
                      <td className="px-3 py-2.5 max-w-[14rem] truncate text-[var(--muted)]">
                        {t.description.trim() || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {transactions.length > PAGE_SIZE ? (
              <div className="mt-3 flex items-center justify-between text-xs text-[var(--muted)]">
                <span>
                  Page {txPage + 1} of {totalTxPages}
                </span>
                <div className="flex gap-2">
                  <button
                    className="rounded-md border border-[var(--border)] px-2 py-1 font-medium text-[var(--foreground)] transition hover:bg-[var(--background)] disabled:opacity-40"
                    disabled={txPage <= 0}
                    onClick={() => setTxPage((p) => Math.max(0, p - 1))}
                    type="button"
                  >
                    Previous
                  </button>
                  <button
                    className="rounded-md border border-[var(--border)] px-2 py-1 font-medium text-[var(--foreground)] transition hover:bg-[var(--background)] disabled:opacity-40"
                    disabled={txPage >= totalTxPages - 1}
                    onClick={() => setTxPage((p) => Math.min(totalTxPages - 1, p + 1))}
                    type="button"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-base font-semibold">Edit customer</h2>
              <button
                className="rounded p-1 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                onClick={() => setModalOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form className="space-y-4 p-5" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormName(e.target.value)}
                  value={formName}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Company</label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormCompany(e.target.value)}
                  value={formCompany}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Email</label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormEmail(e.target.value)}
                  type="email"
                  value={formEmail}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Phone</label>
                <input
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:border-[var(--accent)] focus:outline-none"
                  onChange={(e) => setFormPhone(e.target.value)}
                  value={formPhone}
                />
              </div>
              {!isCleaningBusiness && (
                <label className="flex items-start gap-2.5 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
                  <input
                    checked={formLoyaltyEnabled}
                    className="mt-0.5 h-4 w-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    onChange={(e) => setFormLoyaltyEnabled(e.target.checked)}
                    type="checkbox"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">Enable loyalty card</span>
                    <span className="block text-xs text-[var(--muted)]">
                      Loyalty is not given to first-time customers. Turn this on once they qualify.
                    </span>
                  </span>
                </label>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="h-9 rounded-md border border-[var(--border)] px-4 text-sm font-medium transition hover:bg-[var(--background)]"
                  onClick={() => setModalOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  disabled={!formName.trim() || formSubmitting}
                  type="submit"
                >
                  {formSubmitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
