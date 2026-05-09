import type { FormEvent, ReactNode } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  LayoutTemplate,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import {
  deleteTransactionTemplate,
  listInventoryItems,
  listTransactionTemplates,
  saveTransactionTemplate,
  type InventoryItem,
  type TransactionTemplateDraft,
  type TransactionTemplateSummary,
} from "../../../lib/db/repository"
import { formatCurrency } from "../../../lib/format"
import { useAuth } from "../../auth/use-auth"

// Inventory unit types that can have fractional quantities (e.g. 1.5 kg).
const MEASURABLE_UNIT_TYPES = new Set(["liquid", "weight", "length"])

function qtyStepFor(unitType: string | undefined) {
  return unitType && MEASURABLE_UNIT_TYPES.has(unitType) ? "0.01" : "any"
}

function defaultPriceFor(item: InventoryItem | undefined): string {
  if (!item) return ""
  if (Number.isFinite(item.sellingPrice) && item.sellingPrice > 0) {
    return String(item.sellingPrice)
  }
  if (Number.isFinite(item.costPerUnit) && item.costPerUnit > 0) {
    return String(item.costPerUnit)
  }
  return ""
}

/**
 * Compute the suggested unit price for the chosen sale unit. When the alt
 * unit defines an explicit price it wins; otherwise we divide the inventory
 * item's selling/cost by the conversion factor.
 */
function defaultPriceForUnit(item: InventoryItem | undefined, saleUnitId: number | null): string {
  if (!item) return ""
  if (saleUnitId == null) return defaultPriceFor(item)
  const alt = item.altUnits.find((u) => u.id === saleUnitId)
  if (!alt) return defaultPriceFor(item)
  if (alt.unitPrice > 0) return String(alt.unitPrice)
  const base =
    Number.isFinite(item.sellingPrice) && item.sellingPrice > 0
      ? item.sellingPrice
      : Number.isFinite(item.costPerUnit) && item.costPerUnit > 0
        ? item.costPerUnit
        : 0
  if (base > 0 && alt.unitsPerBase > 0) {
    return String(Math.round((base / alt.unitsPerBase) * 100) / 100)
  }
  return ""
}

function ModalField({
  label,
  children,
  required,
}: {
  children: ReactNode
  label: string
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputClass =
  "h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition"
const selectClass = inputClass

type FormLine = {
  inventoryItemId: string
  quantity: string
  /** Per-unit price stored on the template line. */
  priceStr: string
  /** '' = inventory base unit, otherwise an alt unit's label. */
  saleUnitLabel: string
  saleUnitFactor: number
  saleUnitId: number | null
  key: string
}

function newLineKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function InventoryTemplatesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission("manage_inventory")

  const [templates, setTemplates] = useState<TransactionTemplateSummary[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formActive, setFormActive] = useState(true)
  const [formLines, setFormLines] = useState<FormLine[]>([])
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tpls, items] = await Promise.all([
        listTransactionTemplates(),
        listInventoryItems({ includeInactive: true }),
      ])
      setTemplates(tpls)
      setInventoryItems(
        items.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        ),
      )
    } catch {
      setError("Unable to load templates.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const itemOptions = useMemo(() => inventoryItems, [inventoryItems])

  const comboTotal = useMemo(
    () =>
      formLines.reduce((sum, line) => {
        if (!line.inventoryItemId) return sum
        const q = Number(line.quantity)
        const p = Number(line.priceStr)
        if (!Number.isFinite(q) || q <= 0) return sum
        if (!Number.isFinite(p) || p < 0) return sum
        return sum + q * p
      }, 0),
    [formLines],
  )

  function openCreate() {
    setEditingId(null)
    setFormName("")
    setFormDescription("")
    setFormActive(true)
    setFormLines([
      {
        inventoryItemId: "",
        quantity: "1",
        priceStr: "",
        saleUnitLabel: "",
        saleUnitFactor: 1,
        saleUnitId: null,
        key: newLineKey(),
      },
    ])
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(t: TransactionTemplateSummary) {
    setEditingId(t.id)
    setFormName(t.name)
    setFormDescription(t.description)
    setFormActive(t.isActive)
    setFormLines(
      t.items.length > 0
        ? t.items.map((it) => ({
            inventoryItemId: String(it.inventoryItemId),
            quantity: String(it.quantity),
            priceStr: it.unitPrice > 0 ? String(it.unitPrice) : "",
            saleUnitLabel: it.saleUnitLabel,
            saleUnitFactor: it.saleUnitFactor > 0 ? it.saleUnitFactor : 1,
            saleUnitId: it.saleUnitId,
            key: newLineKey(),
          }))
        : [
            {
              inventoryItemId: "",
              quantity: "1",
              priceStr: "",
              saleUnitLabel: "",
              saleUnitFactor: 1,
              saleUnitId: null,
              key: newLineKey(),
            },
          ],
    )
    setFormError(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
    setFormError(null)
  }

  function addLine() {
    setFormLines((prev) => [
      ...prev,
      {
        inventoryItemId: "",
        quantity: "1",
        priceStr: "",
        saleUnitLabel: "",
        saleUnitFactor: 1,
        saleUnitId: null,
        key: newLineKey(),
      },
    ])
  }

  function removeLine(key: string) {
    setFormLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.key !== key),
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canManage) return
    const name = formName.trim()
    if (!name) {
      setFormError("Name is required.")
      return
    }

    const items: TransactionTemplateDraft["items"] = []
    for (const line of formLines) {
      if (!line.inventoryItemId) continue
      const q = Number(line.quantity)
      if (!Number.isFinite(q) || q <= 0) {
        setFormError("Each line needs a positive quantity.")
        return
      }
      const priceTrim = line.priceStr.trim()
      const unitPriceRaw = priceTrim === "" ? 0 : Number(priceTrim)
      if (!Number.isFinite(unitPriceRaw) || unitPriceRaw < 0) {
        setFormError("Each line needs a valid non-negative unit price.")
        return
      }
      items.push({
        inventoryItemId: Number(line.inventoryItemId),
        quantity: q,
        saleUnitFactor: line.saleUnitFactor > 0 ? line.saleUnitFactor : 1,
        saleUnitId: line.saleUnitId,
        saleUnitLabel: line.saleUnitLabel,
        unitPrice: unitPriceRaw,
      })
    }
    if (items.length === 0) {
      setFormError("Add at least one inventory item.")
      return
    }

    setFormSubmitting(true)
    setFormError(null)
    try {
      await saveTransactionTemplate({
        description: formDescription,
        id: editingId ?? undefined,
        isActive: formActive,
        items,
        name,
      })
      closeModal()
      await load()
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to save template.",
      )
    } finally {
      setFormSubmitting(false)
    }
  }

  async function handleDelete(id: number) {
    if (!canManage) return
    try {
      await deleteTransactionTemplate(id)
      setDeleteConfirmId(null)
      await load()
    } catch {
      setError("Unable to delete template.")
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <LayoutTemplate className="h-6 w-6 text-[var(--accent)]" />
            Sale stock-out templates
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Define reusable sets of inventory items and quantities. When
            recording a SALE transaction, you can apply a template to create
            linked stock-out movements automatically.
          </p>
        </div>
        {canManage ? (
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:opacity-90"
            onClick={openCreate}
            type="button"
          >
            <Plus className="h-4 w-4" />
            New template
          </button>
        ) : null}
      </header>

      {!canManage ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          You need the <strong>Manage inventory</strong> permission to edit
          templates.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--muted)]">
          Loading…
        </div>
      ) : templates.length === 0 ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          No templates yet.{" "}
          {canManage ? "Create one to speed up sale stock-outs." : ""}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--background)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Items</th>
                <th className="w-0 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-[var(--muted)]">
                    {t.description || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        "inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        t.isActive
                          ? "bg-emerald-500/15 text-emerald-600"
                          : "bg-gray-500/15 text-gray-500",
                      ].join(" ")}
                    >
                      {t.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {t.items.length}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canManage ? (
                        <>
                          <button
                            aria-label="Edit template"
                            className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                            onClick={() => openEdit(t)}
                            type="button"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {deleteConfirmId === t.id ? (
                            <span className="flex items-center gap-1">
                              <button
                                className="rounded bg-red-500 px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
                                onClick={() => void handleDelete(t.id)}
                                type="button"
                              >
                                Confirm
                              </button>
                              <button
                                className="rounded border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--background)]"
                                onClick={() => setDeleteConfirmId(null)}
                                type="button"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              aria-label="Delete template"
                              className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500"
                              onClick={() => setDeleteConfirmId(t.id)}
                              type="button"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">
                {editingId ? "Edit template" : "New template"}
              </h2>
              <button
                className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                onClick={closeModal}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={handleSubmit}
            >
              <div className="space-y-4 overflow-y-auto p-5">
                <ModalField
                  label="Name"
                  required
                >
                  <input
                    className={inputClass}
                    onChange={(e) => setFormName(e.target.value)}
                    value={formName}
                  />
                </ModalField>
                <ModalField label="Description">
                  <textarea
                    className="min-h-[72px] w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    onChange={(e) => setFormDescription(e.target.value)}
                    rows={3}
                    value={formDescription}
                  />
                </ModalField>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                  <input
                    checked={formActive}
                    className="rounded border-gray-300"
                    onChange={(e) => setFormActive(e.target.checked)}
                    type="checkbox"
                  />
                  Active (shown in transaction form)
                </label>

                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-gray-700">
                        Inventory lines
                      </span>
                      <p className="text-xs text-gray-500">
                        Quantity and unit price are stored on the template, so
                        the combo can keep its own price even when the inventory
                        item's selling price changes.
                      </p>
                    </div>
                    <button
                      className="text-xs! text-white px-5 py-2 rounded-md hover:bg-blue-500 text-nowrap bg-blue-600"
                      onClick={addLine}
                      type="button"
                    >
                      + Add line
                    </button>
                  </div>
                  <div className="space-y-2">
                    {formLines.map((line) => {
                      const inv = itemOptions.find(
                        (i) => String(i.id) === line.inventoryItemId,
                      )
                      const qtyNum = Number(line.quantity)
                      const unitNum = Number(line.priceStr)
                      const lineTotal =
                        Number.isFinite(qtyNum) &&
                        qtyNum > 0 &&
                        Number.isFinite(unitNum) &&
                        unitNum >= 0
                          ? qtyNum * unitNum
                          : null
                      const usingAlt =
                        line.saleUnitLabel !== "" && line.saleUnitFactor !== 1
                      const activeUnitLabel = usingAlt
                        ? line.saleUnitLabel
                        : inv?.unitLabel ?? ""
                      const activeAltUnits = (inv?.altUnits ?? []).filter(
                        (u) => u.isActive && u.unitsPerBase > 0,
                      )
                      const baseQtyForStock =
                        usingAlt &&
                        Number.isFinite(qtyNum) &&
                        qtyNum > 0 &&
                        line.saleUnitFactor > 0
                          ? qtyNum / line.saleUnitFactor
                          : null
                      return (
                        <div
                          className="space-y-1"
                          key={line.key}
                        >
                          <div className="flex flex-wrap items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <select
                                className={selectClass}
                                onChange={(e) => {
                                  const v = e.target.value
                                  const picked = itemOptions.find(
                                    (i) => String(i.id) === v,
                                  )
                                  setFormLines((prev) =>
                                    prev.map((l) => {
                                      if (l.key !== line.key) return l
                                      const isNewLink = l.inventoryItemId !== v
                                      // Auto-fill unit price from the picked item's selling price
                                      // (falling back to cost) when the field is empty or the item changed.
                                      const shouldAutoFill =
                                        v !== "" &&
                                        (l.priceStr.trim() === "" || isNewLink)
                                      return {
                                        ...l,
                                        inventoryItemId: v,
                                        priceStr: shouldAutoFill
                                          ? defaultPriceFor(picked)
                                          : l.priceStr,
                                        // Reset alt unit when inventory link changes.
                                        saleUnitLabel: isNewLink
                                          ? ""
                                          : l.saleUnitLabel,
                                        saleUnitFactor: isNewLink
                                          ? 1
                                          : l.saleUnitFactor,
                                        saleUnitId: isNewLink ? null : l.saleUnitId,
                                      }
                                    }),
                                  )
                                }}
                                value={line.inventoryItemId}
                              >
                                <option value="">Select item…</option>
                                {itemOptions.map((i) => (
                                  <option
                                    key={i.id}
                                    value={i.id}
                                  >
                                    {i.name}
                                    {!i.isActive ? " (inactive)" : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="w-20">
                              <input
                                aria-label="Quantity"
                                className={`${inputClass} text-center`}
                                min="0.001"
                                onChange={(e) => {
                                  const v = e.target.value
                                  setFormLines((prev) =>
                                    prev.map((l) =>
                                      l.key === line.key
                                        ? { ...l, quantity: v }
                                        : l,
                                    ),
                                  )
                                }}
                                placeholder="Qty"
                                step={usingAlt ? "any" : qtyStepFor(inv?.unitType)}
                                type="number"
                                value={line.quantity}
                              />
                            </div>
                            <span className="self-center text-xs text-gray-400">
                              ×
                            </span>
                            <div className="w-24">
                              <input
                                aria-label="Unit price"
                                className={`${inputClass} text-right`}
                                min="0"
                                onChange={(e) => {
                                  const v = e.target.value
                                  setFormLines((prev) =>
                                    prev.map((l) =>
                                      l.key === line.key
                                        ? { ...l, priceStr: v }
                                        : l,
                                    ),
                                  )
                                }}
                                placeholder="Unit price"
                                step="0.01"
                                type="number"
                                value={line.priceStr}
                              />
                            </div>
                            <div className="w-24">
                              {activeAltUnits.length > 0 ? (
                                <select
                                  aria-label="Sale unit"
                                  className={`${selectClass} px-2 text-xs`}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    setFormLines((prev) =>
                                      prev.map((l) => {
                                        if (l.key !== line.key) return l
                                        if (v === "") {
                                          // Revert to base unit; refresh price.
                                          return {
                                            ...l,
                                            priceStr:
                                              defaultPriceForUnit(inv, null) ||
                                              l.priceStr,
                                            saleUnitLabel: "",
                                            saleUnitFactor: 1,
                                            saleUnitId: null,
                                          }
                                        }
                                        const altId = Number(v)
                                        const alt = inv?.altUnits.find(
                                          (u) => u.id === altId,
                                        )
                                        if (!alt) return l
                                        return {
                                          ...l,
                                          priceStr:
                                            defaultPriceForUnit(inv, altId) ||
                                            l.priceStr,
                                          saleUnitLabel: alt.unitLabel,
                                          saleUnitFactor: alt.unitsPerBase,
                                          saleUnitId: alt.id,
                                        }
                                      }),
                                    )
                                  }}
                                  value={
                                    line.saleUnitId != null
                                      ? String(line.saleUnitId)
                                      : ""
                                  }
                                >
                                  <option value="">
                                    {inv?.unitLabel || "unit"}
                                  </option>
                                  {activeAltUnits.map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.unitLabel}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="flex h-10 items-center justify-center rounded-md border border-transparent px-2 text-xs text-gray-400">
                                  {inv?.unitLabel || "—"}
                                </div>
                              )}
                            </div>
                            <button
                              aria-label="Remove line"
                              className="mt-1 shrink-0 rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-40"
                              disabled={formLines.length <= 1}
                              onClick={() => removeLine(line.key)}
                              type="button"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-2 pl-1 pr-9 text-[11px] text-gray-500">
                            <span className="truncate">
                              {activeUnitLabel
                                ? `Priced per ${activeUnitLabel}`
                                : "Price is per unit"}
                              {baseQtyForStock != null && inv?.unitLabel
                                ? ` · stock −${baseQtyForStock
                                    .toFixed(3)
                                    .replace(/\.?0+$/, "")} ${inv.unitLabel}`
                                : ""}
                            </span>
                            <span className="tabular-nums text-gray-700">
                              {lineTotal != null
                                ? `= ${formatCurrency(lineTotal)}`
                                : "—"}
                            </span>
                          </div>
                          {inv && !inv.isActive ? (
                            <p className="flex w-full items-center gap-1 text-xs text-amber-700">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              Inactive item — it will be skipped when applying
                              this template to a sale if still inactive.
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                  {comboTotal > 0 ? (
                    <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-2 text-xs">
                      <span className="text-gray-600">Combo price</span>
                      <span className="font-semibold text-gray-900 tabular-nums">
                        {formatCurrency(comboTotal)}
                      </span>
                    </div>
                  ) : null}
                </div>

                {formError ? (
                  <p className="text-sm text-red-600">{formError}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-5 py-4">
                <button
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  onClick={closeModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={formSubmitting || !canManage}
                  type="submit"
                >
                  {formSubmitting ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
