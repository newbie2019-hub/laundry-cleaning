import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  AlertTriangle,
  Minus,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  getCashAdvanceByTransactionId,
  getCustomerLoyaltyStatus,
  getLoyaltySettings,
  getTransactionById,
  listCategories,
  listCustomers,
  listInventoryItems,
  listInventoryMovementsByTransaction,
  listStaff,
  listTransactionLineItems,
  listTransactionTemplates,
  listTransactionTypes,
  saveCustomer,
  saveTransaction,
  type Category,
  type Customer,
  type CustomerDraft,
  type CustomerLoyaltyStatus,
  type InventoryItem,
  type LedgerTransaction,
  type LoyaltySettings,
  type Staff,
  type TransactionTemplateSummary,
  type TransactionType,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'
import { formatCurrency } from '../../../lib/format'

function ModalField({
  children,
  help,
  label,
  required,
}: {
  children: ReactNode
  help?: ReactNode
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
      {help ? <p className="text-[11px] text-gray-500">{help}</p> : null}
    </div>
  )
}

const inputClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition placeholder:text-gray-400'

const selectClass =
  'h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition'

const MEASURABLE_UNIT_TYPES = new Set(['liquid', 'weight', 'length'])

function lineItemQtyInputProps(unitType: string | undefined) {
  const measurable = unitType ? MEASURABLE_UNIT_TYPES.has(unitType) : false
  return measurable ? { step: '0.01', min: '0.01' } : { step: 'any', min: '0.01' }
}

type LineItemRow = {
  key: string
  inventoryItemId: number | null
  label: string
  quantityStr: string
  priceStr: string
  saleUnitLabel: string
  saleUnitFactor: number
  saleUnitId: number | null
}

type TemplatePreviewLine = {
  inventoryItemId: number
  isItemActive: boolean
  itemName: string
  key: string
  lowStockThreshold: number
  missingItem?: boolean
  quantityStr: string
  unitLabel: string
  unitPrice: number
  currentStock: number
  saleUnitLabel: string
  saleUnitFactor: number
  saleUnitId: number | null
}

interface EditTransactionModalProps {
  transactionId: number
  onClose: () => void
  onSaved: () => void
}

export function EditTransactionModal({ transactionId, onClose, onSaved }: EditTransactionModalProps) {
  const { activeBusiness, user, hasPermission } = useAuth()
  const isCleaningBusiness = activeBusiness === 'cleaning'
  const canEdit = hasPermission('edit_transaction')
  const canManageInventory = hasPermission('manage_inventory')

  const customerContainerRef = useRef<HTMLDivElement>(null)
  const templateLoadGenRef = useRef(0)
  const lineItemListId = useId()

  // ── Data ──────────────────────────────────────────────────────────────────
  const [loadingData, setLoadingData] = useState(true)
  const [transactionTypes, setTransactionTypes] = useState<TransactionType[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings>({ freeAfterLoads: 9, kgPerLoad: 8 })
  const [formTransactionTemplates, setFormTransactionTemplates] = useState<TransactionTemplateSummary[]>([])
  const [formInventoryForTemplates, setFormInventoryForTemplates] = useState<InventoryItem[]>([])
  const [formInventoryOptions, setFormInventoryOptions] = useState<InventoryItem[]>([])

  // ── Form state ────────────────────────────────────────────────────────────
  const [formEntryDate, setFormEntryDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [formTypeId, setFormTypeId] = useState('')
  const [formCategoryId, setFormCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [staffCount, setStaffCount] = useState('')
  const [formCustomerId, setFormCustomerId] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false)
  const [formKg, setFormKg] = useState('')
  const [formLoads, setFormLoads] = useState('')
  const [showKgInput, setShowKgInput] = useState(false)
  const [formRedeemReward, setFormRedeemReward] = useState(false)
  const [formCashAdvanceStaffId, setFormCashAdvanceStaffId] = useState('')
  const [loyaltyStatus, setLoyaltyStatus] = useState<CustomerLoyaltyStatus | null>(null)
  const [formLineItems, setFormLineItems] = useState<LineItemRow[]>([])
  const [formTemplatePickerId, setFormTemplatePickerId] = useState('')
  const [formTemplatePreviewLines, setFormTemplatePreviewLines] = useState<TemplatePreviewLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedFormType = transactionTypes.find((t) => String(t.id) === formTypeId)
  const isSaleType = selectedFormType?.code === 'SALE'
  const isExpenseType = selectedFormType?.code === 'EXPENSE'
  const showStaffCountField = isSaleType || isExpenseType
  const showCustomerField = isSaleType

  const filteredCategories = useMemo(
    () => (formTypeId ? categories.filter((c) => String(c.transactionTypeId) === formTypeId) : []),
    [formTypeId, categories],
  )

  const selectedFormCategory = useMemo(
    () => categories.find((c) => String(c.id) === formCategoryId),
    [formCategoryId, categories],
  )

  const showLoadFields = Boolean(!isCleaningBusiness && isSaleType && selectedFormCategory?.isLoadable)

  const isCashAdvanceCategory = Boolean(
    isExpenseType &&
      selectedFormCategory &&
      selectedFormCategory.label.trim().toLowerCase() === 'cash advance',
  )

  const activeStaffForForm = useMemo(() => staff.filter((s) => !s.isArchived), [staff])

  const activeCustomersForForm = useMemo(() => customers.filter((c) => !c.isArchived), [customers])

  const filteredCustomersForForm = useMemo(() => {
    const q = customerSearch.toLowerCase().trim()
    if (!q) return activeCustomersForForm
    return activeCustomersForForm.filter((c) => {
      const label = c.company ? `${c.name} (${c.company})` : c.name
      return label.toLowerCase().includes(q)
    })
  }, [customerSearch, activeCustomersForForm])

  const selectedCustomerLabel = useMemo(() => {
    if (!formCustomerId) return ''
    const c = customers.find((c) => String(c.id) === formCustomerId)
    if (!c) return ''
    return c.company ? `${c.name} (${c.company})` : c.name
  }, [formCustomerId, customers])

  const canQuickCreateCustomer =
    customerSearch.trim().length > 0 &&
    !activeCustomersForForm.some(
      (c) => c.name.toLowerCase() === customerSearch.toLowerCase().trim(),
    )

  const templatesForPicker = useMemo(() => {
    const pick = formTemplatePickerId ? Number(formTemplatePickerId) : Number.NaN
    return formTransactionTemplates.filter((t) => t.isActive || t.id === pick)
  }, [formTransactionTemplates, formTemplatePickerId])

  const lineItemsTotal = useMemo(() => {
    return formLineItems.reduce((sum, li) => {
      const qty = Number(li.quantityStr)
      const unit = Number(li.priceStr)
      const valid =
        li.label.trim() !== '' &&
        Number.isFinite(qty) && qty > 0 &&
        Number.isFinite(unit) && unit >= 0
      return sum + (valid ? qty * unit : 0)
    }, 0)
  }, [formLineItems])

  const templatePreviewComboTotal = useMemo(() => {
    return formTemplatePreviewLines.reduce((sum, line) => {
      if (line.missingItem) return sum
      const qty = Number(line.quantityStr)
      if (!Number.isFinite(qty) || qty <= 0) return sum
      if (!Number.isFinite(line.unitPrice) || line.unitPrice <= 0) return sum
      return sum + qty * line.unitPrice
    }, 0)
  }, [formTemplatePreviewLines])

  const baseAmountNum = useMemo(() => {
    const n = Number(amount)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }, [amount])

  const grandTotal = useMemo(() => baseAmountNum + lineItemsTotal, [baseAmountNum, lineItemsTotal])

  // ── Load initial data ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadingData(true)
      try {
        const gen = ++templateLoadGenRef.current
        const [tx, txTypes, cats, custs, loyalSet, staffList, lineItems, invOpts] = await Promise.all([
          getTransactionById(transactionId),
          listTransactionTypes(),
          listCategories(),
          listCustomers({ includeArchived: true }),
          getLoyaltySettings(),
          listStaff({ includeArchived: true }),
          listTransactionLineItems(transactionId),
          listInventoryItems(),
        ])
        if (cancelled || gen !== templateLoadGenRef.current) return

        setTransactionTypes(txTypes)
        setCategories(cats)
        setCustomers(custs)
        setLoyaltySettings(loyalSet)
        setStaff(staffList)
        setFormInventoryOptions(invOpts)

        if (tx) {
          setFormEntryDate(tx.entryDate)
          setFormTypeId(String(tx.transactionTypeId))
          setFormCategoryId(String(tx.categoryId))
          setDescription(tx.description)
          setFormCustomerId(tx.customerId != null ? String(tx.customerId) : '')
          setFormKg(tx.kg != null ? String(tx.kg) : '')
          setFormLoads(tx.loads != null ? String(tx.loads) : '')
          setShowKgInput(tx.kg != null)
          setFormRedeemReward(tx.isLoyaltyReward)
          setStaffCount(tx.staffCount ? String(tx.staffCount) : '')

          if (lineItems.length > 0) {
            const sum = lineItems.reduce(
              (acc, li) => acc + (Number.isFinite(li.price) ? li.price : 0),
              0,
            )
            const base = Math.max(0, tx.amount - sum)
            setAmount(String(Math.round(base * 100) / 100))
            setFormLineItems(
              lineItems.map((li) => ({
                key: `edit-li-${li.id}-${Math.random().toString(36).slice(2, 7)}`,
                inventoryItemId: li.inventoryItemId,
                label: li.label,
                quantityStr: String(li.quantity),
                priceStr: String(li.unitPrice),
                saleUnitFactor: li.saleUnitFactor > 0 ? li.saleUnitFactor : 1,
                saleUnitId: li.saleUnitId,
                saleUnitLabel: li.saleUnitLabel,
              })),
            )
          } else {
            setAmount(String(tx.amount))
            setFormLineItems([])
          }

          // Cash advance
          if (
            tx.transactionTypeCode === 'EXPENSE' &&
            tx.categoryLabel.trim().toLowerCase() === 'cash advance'
          ) {
            void (async () => {
              try {
                const advance = await getCashAdvanceByTransactionId(tx.id)
                if (cancelled) return
                if (advance && advance.status !== 'void') {
                  setFormCashAdvanceStaffId(String(advance.staffId))
                }
              } catch {
                /* ignore */
              }
            })()
          }

          // Template/inventory data for sale transactions
          if (canManageInventory) {
            void (async () => {
              try {
                const fetchMovs = tx.transactionTypeCode === 'SALE'
                  ? listInventoryMovementsByTransaction(tx.id)
                  : Promise.resolve(null)
                const [movs, invItems, tpls] = await Promise.all([
                  fetchMovs,
                  listInventoryItems({ includeInactive: true }),
                  listTransactionTemplates(),
                ])
                if (cancelled) return
                setFormInventoryForTemplates(invItems)
                setFormTransactionTemplates(tpls)

                if (movs) {
                  const tmplMovs = movs.filter((m) => m.movementType === 'OUT' && m.templateId != null)
                  if (tmplMovs.length > 0) {
                    const tid = tmplMovs[0]!.templateId!
                    setFormTemplatePickerId(String(tid))
                    const tpl = tpls.find((t) => t.id === tid)
                    const itemById = new Map(invItems.map((i) => [i.id, i]))
                    const tplPriceByItemId = new Map<number, number>()
                    const tplSnapshotByItemId = new Map<
                      number,
                      { saleUnitLabel: string; saleUnitFactor: number; saleUnitId: number | null }
                    >()
                    if (tpl) {
                      for (const it of tpl.items) {
                        if (Number.isFinite(it.unitPrice) && it.unitPrice > 0) {
                          tplPriceByItemId.set(it.inventoryItemId, it.unitPrice)
                        }
                        tplSnapshotByItemId.set(it.inventoryItemId, {
                          saleUnitFactor: it.saleUnitFactor > 0 ? it.saleUnitFactor : 1,
                          saleUnitId: it.saleUnitId,
                          saleUnitLabel: it.saleUnitLabel,
                        })
                      }
                    }
                    const previewLines: TemplatePreviewLine[] = tmplMovs.map((m) => {
                      const inv = itemById.get(m.itemId)
                      const tplPrice = tplPriceByItemId.get(m.itemId) ?? 0
                      const invPrice =
                        inv && Number.isFinite(inv.sellingPrice) && inv.sellingPrice > 0
                          ? inv.sellingPrice
                          : inv && Number.isFinite(inv.costPerUnit) && inv.costPerUnit > 0
                            ? inv.costPerUnit
                            : 0
                      const price = tplPrice > 0 ? tplPrice : invPrice
                      const snap = tplSnapshotByItemId.get(m.itemId) ?? {
                        saleUnitFactor: 1,
                        saleUnitId: null,
                        saleUnitLabel: '',
                      }
                      const altQty =
                        snap.saleUnitFactor > 0
                          ? m.quantity * snap.saleUnitFactor
                          : m.quantity
                      const displayUnitLabel =
                        snap.saleUnitLabel !== ''
                          ? snap.saleUnitLabel
                          : (inv?.unitLabel ?? m.unitLabel)
                      return {
                        currentStock: inv?.currentStock ?? 0,
                        inventoryItemId: m.itemId,
                        isItemActive: inv?.isActive ?? false,
                        itemName: inv?.name ?? m.itemName,
                        key: `edit-${m.id}-${Math.random().toString(36).slice(2, 9)}`,
                        lowStockThreshold: inv?.lowStockThreshold ?? 0,
                        missingItem: inv == null,
                        quantityStr: String(altQty),
                        saleUnitFactor: snap.saleUnitFactor,
                        saleUnitId: snap.saleUnitId,
                        saleUnitLabel: snap.saleUnitLabel,
                        unitLabel: displayUnitLabel,
                        unitPrice: price,
                      }
                    })
                    setFormTemplatePreviewLines(previewLines)
                  }
                }
              } catch {
                /* ignore */
              }
            })()
          }
        }
      } finally {
        if (!cancelled) setLoadingData(false)
      }
    })()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId])

  // ── Side effects ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!formTypeId) return
    const stillValid = filteredCategories.some((c) => String(c.id) === formCategoryId)
    if (!stillValid) {
      setFormCategoryId(filteredCategories[0] ? String(filteredCategories[0].id) : '')
    }
  }, [filteredCategories, formCategoryId, formTypeId])

  useEffect(() => {
    if (!showCustomerField) setFormCustomerId('')
  }, [showCustomerField])

  useEffect(() => {
    if (!isCashAdvanceCategory) setFormCashAdvanceStaffId('')
  }, [isCashAdvanceCategory])

  useEffect(() => {
    if (!showLoadFields) {
      setFormRedeemReward(false)
      setFormKg('')
      setFormLoads('')
      setShowKgInput(false)
      return
    }
    setFormLoads((prev) => (prev.trim() === '' ? '1' : prev))
  }, [showLoadFields])

  useEffect(() => {
    if (!isSaleType) {
      setFormTemplatePickerId('')
      setFormTemplatePreviewLines([])
    }
  }, [isSaleType])

  useEffect(() => {
    if (isCleaningBusiness || !showCustomerField || !formCustomerId) {
      setLoyaltyStatus(null)
      return
    }
    let cancelled = false
    void getCustomerLoyaltyStatus(Number(formCustomerId)).then((s) => {
      if (!cancelled) setLoyaltyStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [formCustomerId, isCleaningBusiness, showCustomerField])

  useEffect(() => {
    if (!customerDropdownOpen) return
    function handleMouseDown(e: MouseEvent) {
      if (customerContainerRef.current && !customerContainerRef.current.contains(e.target as Node)) {
        setCustomerDropdownOpen(false)
        setCustomerSearch('')
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [customerDropdownOpen])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // ── Helpers ───────────────────────────────────────────────────────────────
  function handleKgChange(value: string) {
    setFormKg(value)
    if (!showLoadFields || formRedeemReward) return
    const k = Number(value)
    if (Number.isFinite(k) && k > 0) {
      const next = Math.round((k / loyaltySettings.kgPerLoad) * 100) / 100
      setFormLoads(String(next))
    }
  }

  const makeLineItemKey = useCallback(
    () => `li-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    [],
  )

  const addLineItem = useCallback(() => {
    setFormLineItems((prev) => [
      ...prev,
      {
        key: makeLineItemKey(),
        inventoryItemId: null,
        label: '',
        quantityStr: '1',
        priceStr: '',
        saleUnitLabel: '',
        saleUnitFactor: 1,
        saleUnitId: null,
      },
    ])
  }, [makeLineItemKey])

  const removeLineItem = useCallback((key: string) => {
    setFormLineItems((prev) => prev.filter((l) => l.key !== key))
  }, [])

  const updateLineItemLabel = useCallback(
    (key: string, label: string) => {
      setFormLineItems((prev) =>
        prev.map((l) => {
          if (l.key !== key) return l
          const match = formInventoryOptions.find(
            (inv) => inv.name.toLowerCase() === label.trim().toLowerCase(),
          )
          const isNewLink = match ? l.inventoryItemId !== match.id : false
          let nextPriceStr = l.priceStr
          if (match && (l.priceStr.trim() === '' || isNewLink)) {
            const autoFill =
              Number.isFinite(match.sellingPrice) && match.sellingPrice > 0
                ? match.sellingPrice
                : Number.isFinite(match.costPerUnit) && match.costPerUnit > 0
                  ? match.costPerUnit
                  : null
            if (autoFill != null) nextPriceStr = String(autoFill)
          }
          return {
            ...l,
            label,
            inventoryItemId: match ? match.id : null,
            priceStr: nextPriceStr,
            saleUnitLabel: isNewLink || match == null ? '' : l.saleUnitLabel,
            saleUnitFactor: isNewLink || match == null ? 1 : l.saleUnitFactor,
            saleUnitId: isNewLink || match == null ? null : l.saleUnitId,
          }
        }),
      )
    },
    [formInventoryOptions],
  )

  const updateLineItemQuantity = useCallback((key: string, quantityStr: string) => {
    setFormLineItems((prev) => prev.map((l) => (l.key === key ? { ...l, quantityStr } : l)))
  }, [])

  const updateLineItemPrice = useCallback((key: string, priceStr: string) => {
    setFormLineItems((prev) => prev.map((l) => (l.key === key ? { ...l, priceStr } : l)))
  }, [])

  const updateLineItemUnit = useCallback(
    (key: string, unitId: string) => {
      setFormLineItems((prev) =>
        prev.map((l) => {
          if (l.key !== key) return l
          const inv =
            l.inventoryItemId != null
              ? formInventoryOptions.find((i) => i.id === l.inventoryItemId)
              : undefined
          if (unitId === '') {
            const basePrice =
              inv && Number.isFinite(inv.sellingPrice) && inv.sellingPrice > 0
                ? inv.sellingPrice
                : inv && Number.isFinite(inv.costPerUnit) && inv.costPerUnit > 0
                  ? inv.costPerUnit
                  : null
            return {
              ...l,
              priceStr: basePrice != null ? String(basePrice) : l.priceStr,
              saleUnitLabel: '',
              saleUnitFactor: 1,
              saleUnitId: null,
            }
          }
          if (!inv) return l
          const altId = Number(unitId)
          const alt = inv.altUnits.find((u) => u.id === altId)
          if (!alt) return l
          const altDefaultPrice =
            alt.unitPrice > 0
              ? alt.unitPrice
              : inv.sellingPrice > 0
                ? inv.sellingPrice / alt.unitsPerBase
                : inv.costPerUnit > 0
                  ? inv.costPerUnit / alt.unitsPerBase
                  : null
          return {
            ...l,
            priceStr:
              altDefaultPrice != null
                ? String(Math.round(altDefaultPrice * 100) / 100)
                : l.priceStr,
            saleUnitLabel: alt.unitLabel,
            saleUnitFactor: alt.unitsPerBase,
            saleUnitId: alt.id,
          }
        }),
      )
    },
    [formInventoryOptions],
  )

  function updateTemplatePreviewQuantity(key: string, quantityStr: string) {
    setFormTemplatePreviewLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantityStr } : l)),
    )
  }

  function handleTemplatePickerChange(value: string) {
    setFormTemplatePickerId(value)
    if (!value) {
      setFormTemplatePreviewLines([])
      return
    }
    const tid = Number(value)
    const tpl = formTransactionTemplates.find((t) => t.id === tid)
    if (!tpl) return
    const stockById = new Map(formInventoryForTemplates.map((i) => [i.id, i]))
    const lines: TemplatePreviewLine[] = []
    for (const it of tpl.items) {
      const inv = stockById.get(it.inventoryItemId)
      const key = `${tpl.id}-${it.inventoryItemId}-${Math.random().toString(36).slice(2, 9)}`
      const tplUnit = Number.isFinite(it.unitPrice) && it.unitPrice > 0 ? it.unitPrice : 0
      const altFactor =
        Number.isFinite(it.saleUnitFactor) && it.saleUnitFactor > 0 ? it.saleUnitFactor : 1
      const usingAlt = it.saleUnitLabel !== '' && altFactor !== 1
      const baseInvPrice =
        inv && Number.isFinite(inv.sellingPrice) && inv.sellingPrice > 0
          ? inv.sellingPrice
          : inv && Number.isFinite(inv.costPerUnit) && inv.costPerUnit > 0
            ? inv.costPerUnit
            : 0
      const invFallback = usingAlt && altFactor > 0 ? baseInvPrice / altFactor : baseInvPrice
      const unitPrice = tplUnit > 0 ? tplUnit : invFallback
      const displayUnitLabel = usingAlt ? it.saleUnitLabel : (inv?.unitLabel ?? it.unitLabel)
      if (!inv) {
        lines.push({
          currentStock: 0,
          inventoryItemId: it.inventoryItemId,
          isItemActive: false,
          itemName: it.itemName,
          key,
          lowStockThreshold: 0,
          missingItem: true,
          quantityStr: String(it.quantity),
          saleUnitFactor: altFactor,
          saleUnitId: it.saleUnitId,
          saleUnitLabel: it.saleUnitLabel,
          unitLabel: displayUnitLabel,
          unitPrice,
        })
        continue
      }
      lines.push({
        currentStock: inv.currentStock,
        inventoryItemId: it.inventoryItemId,
        isItemActive: inv.isActive,
        itemName: inv.name,
        key,
        lowStockThreshold: inv.lowStockThreshold,
        missingItem: false,
        quantityStr: String(it.quantity),
        saleUnitFactor: altFactor,
        saleUnitId: it.saleUnitId,
        saleUnitLabel: it.saleUnitLabel,
        unitLabel: displayUnitLabel,
        unitPrice,
      })
    }
    setFormTemplatePreviewLines(lines)
    const comboTotal = lines.reduce((sum, l) => {
      if (l.missingItem) return sum
      const q = Number(l.quantityStr)
      if (!Number.isFinite(q) || q <= 0) return sum
      if (!Number.isFinite(l.unitPrice) || l.unitPrice <= 0) return sum
      return sum + q * l.unitPrice
    }, 0)
    if (comboTotal > 0) setAmount(String(Math.round(comboTotal * 100) / 100))
  }

  async function handleQuickCreateCustomer() {
    const name = customerSearch.trim()
    if (!name || !user) return
    setIsCreatingCustomer(true)
    try {
      const draft: CustomerDraft = { company: '', email: '', name, phone: '' }
      await saveCustomer(draft, user.id)
      const updatedCustomers = await listCustomers({ includeArchived: true })
      setCustomers(updatedCustomers)
      const created = updatedCustomers.find(
        (c) => !c.isArchived && c.name.toLowerCase() === name.toLowerCase(),
      )
      if (created) setFormCustomerId(String(created.id))
      setCustomerSearch('')
      setCustomerDropdownOpen(false)
    } catch {
      // leave dropdown open so user can retry
    } finally {
      setIsCreatingCustomer(false)
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !canEdit) {
      setError('You do not have permission to edit transactions.')
      return
    }

    const redeem = showLoadFields && formRedeemReward

    if (!formTypeId || !formCategoryId || !formEntryDate) {
      setError('Date, type, and category are required.')
      return
    }
    if (!redeem && (amount === '' || amount.trim() === '')) {
      setError('Date, type, category, and amount are required.')
      return
    }
    if (showLoadFields && redeem && !formCustomerId) {
      setError('Customer is required to redeem a loyalty reward.')
      return
    }
    if (isCashAdvanceCategory && !formCashAdvanceStaffId) {
      setError('Select the staff member who received this cash advance.')
      return
    }
    if (showLoadFields && !redeem) {
      const loadsNum = Number(formLoads.trim())
      if (!Number.isFinite(loadsNum) || loadsNum <= 0) {
        setError('Enter a positive number of loads (or enter kg to calculate loads).')
        return
      }
    }

    const baseAmount = redeem ? 0 : Number(amount)
    if (!redeem && (!Number.isFinite(baseAmount) || baseAmount < 0)) {
      setError('Amount must be a valid non-negative number.')
      return
    }

    const normalizedLineItems: Array<{
      inventoryItemId: number | null
      label: string
      price: number
      quantity: number
      unitPrice: number
      saleUnitLabel: string
      saleUnitFactor: number
      saleUnitId: number | null
    }> = []
    for (const li of formLineItems) {
      const label = li.label.trim()
      const priceTrim = li.priceStr.trim()
      const qtyTrim = li.quantityStr.trim()
      if (label === '' && priceTrim === '' && (qtyTrim === '' || qtyTrim === '1')) continue
      if (label === '') {
        setError('Additional item name is required.')
        return
      }
      const quantity = qtyTrim === '' ? 1 : Number(qtyTrim)
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(`Enter a quantity greater than 0 for "${label}".`)
        return
      }
      const unitPrice = Number(priceTrim)
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        setError(`Enter a valid unit price for "${label}".`)
        return
      }
      normalizedLineItems.push({
        inventoryItemId: li.inventoryItemId,
        label,
        price: quantity * unitPrice,
        quantity,
        saleUnitFactor: li.saleUnitFactor > 0 ? li.saleUnitFactor : 1,
        saleUnitId: li.saleUnitId,
        saleUnitLabel: li.saleUnitLabel,
        unitPrice,
      })
    }

    const lineItemsSum = normalizedLineItems.reduce((acc, li) => acc + li.price, 0)
    const amountNum = redeem ? 0 : baseAmount + lineItemsSum

    let resolvedStaffCount: number | null = null
    if (showStaffCountField) {
      const trimmed = staffCount.trim()
      if (trimmed !== '') {
        const n = Number(trimmed)
        if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
          setError('Number of staff must be a whole number of at least 1, or leave blank.')
          return
        }
        resolvedStaffCount = n
      }
    }

    let resolvedKg: number | null = null
    if (showLoadFields) {
      const kgTrim = formKg.trim()
      if (kgTrim !== '') {
        const kgNum = Number(kgTrim)
        resolvedKg = Number.isFinite(kgNum) && kgNum >= 0 ? kgNum : null
      }
    }

    let resolvedLoads: number | null = null
    if (showLoadFields) {
      if (redeem) {
        const n = Number(formLoads.trim())
        resolvedLoads = Number.isFinite(n) && n > 0 ? n : 1
      } else {
        const n = Number(formLoads.trim())
        resolvedLoads = Number.isFinite(n) && n > 0 ? n : null
      }
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const baseDraft = {
        amount: amountNum,
        cashAdvanceStaffId:
          isCashAdvanceCategory && formCashAdvanceStaffId ? Number(formCashAdvanceStaffId) : null,
        categoryId: Number(formCategoryId),
        customerId: showCustomerField && formCustomerId ? Number(formCustomerId) : null,
        description: description.trim(),
        entryDate: formEntryDate,
        isLoyaltyReward: redeem,
        kg: showLoadFields ? resolvedKg : null,
        lineItems: redeem ? [] : normalizedLineItems,
        loads: showLoadFields ? resolvedLoads : null,
        staffCount: showStaffCountField ? resolvedStaffCount : null,
        transactionTypeId: Number(formTypeId),
      }

      let templatePatch: {
        templateId?: number | null
        templateItems?: Array<{
          inventoryItemId: number
          quantity: number
          saleUnitLabel?: string
          saleUnitFactor?: number
          saleUnitId?: number | null
        }> | null
      } = {}

      if (canManageInventory) {
        if (isSaleType) {
          const templateItems = formTemplatePreviewLines
            .filter((l) => !l.missingItem)
            .map((l) => ({
              inventoryItemId: l.inventoryItemId,
              quantity: Number(l.quantityStr.trim()),
              saleUnitFactor: l.saleUnitFactor > 0 ? l.saleUnitFactor : 1,
              saleUnitId: l.saleUnitId,
              saleUnitLabel: l.saleUnitLabel,
            }))
            .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0)
          templatePatch = {
            templateId:
              templateItems.length > 0 && formTemplatePickerId
                ? Number(formTemplatePickerId)
                : null,
            templateItems: templateItems.length > 0 ? templateItems : null,
          }
        } else {
          templatePatch = { templateId: null, templateItems: null }
        }
      }

      await saveTransaction(
        canManageInventory ? { ...baseDraft, ...templatePatch } : baseDraft,
        user.id,
        transactionId,
      )
      onSaved()
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error ? submitError.message : 'Unable to save transaction.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        className={`relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ${isSaleType && canManageInventory ? 'max-w-xl' : 'max-w-lg'}`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-900">Edit transaction</h2>
          </div>
          <button
            className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loadingData ? (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-gray-400">
            Loading…
          </div>
        ) : (
          <form className="flex min-h-0 flex-1 flex-col overflow-hidden" onSubmit={handleSubmit}>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {/* Date */}
              <ModalField label="Date" required>
                <input
                  className={inputClass}
                  onChange={(e) => setFormEntryDate(e.target.value)}
                  type="date"
                  value={formEntryDate}
                />
              </ModalField>

              {/* Transaction type */}
              <ModalField label="Transaction type" required>
                <select
                  className={selectClass}
                  onChange={(e) => setFormTypeId(e.target.value)}
                  value={formTypeId}
                >
                  <option value="">Select a type</option>
                  {transactionTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code}
                    </option>
                  ))}
                </select>
              </ModalField>

              {/* Category */}
              <ModalField label="Category" required>
                <select
                  className={selectClass}
                  disabled={!formTypeId}
                  onChange={(e) => setFormCategoryId(e.target.value)}
                  value={formCategoryId}
                >
                  <option value="">{formTypeId ? 'Select a category' : 'Select a type first'}</option>
                  {filteredCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </ModalField>

              {/* Loads */}
              {showLoadFields ? (
                <div className="space-y-2">
                  <div className={showKgInput ? 'grid grid-cols-2 gap-3' : ''}>
                    <ModalField label="Loads" required={!formRedeemReward}>
                      <input
                        className={inputClass}
                        min="0"
                        onChange={(e) => setFormLoads(e.target.value)}
                        placeholder="e.g. 1"
                        step="0.01"
                        type="number"
                        value={formLoads}
                      />
                    </ModalField>
                    {showKgInput ? (
                      <ModalField label="Kilograms (optional)">
                        <input
                          className={inputClass}
                          min="0"
                          onChange={(e) => handleKgChange(e.target.value)}
                          placeholder={`e.g. ${loyaltySettings.kgPerLoad}`}
                          step="0.01"
                          type="number"
                          value={formKg}
                        />
                      </ModalField>
                    ) : null}
                  </div>
                  <button
                    className="text-xs font-medium text-(--accent) underline decoration-(--accent)/40 hover:decoration-(--accent)"
                    onClick={() => {
                      setShowKgInput((prev) => {
                        const next = !prev
                        if (!next) setFormKg('')
                        return next
                      })
                    }}
                    type="button"
                  >
                    {showKgInput ? 'Hide kilograms' : 'Specify kilograms'}
                  </button>
                </div>
              ) : null}

              {/* Cash advance staff */}
              {isCashAdvanceCategory ? (
                <ModalField
                  label="Staff (cash advance)"
                  required
                  help="The expense will be linked to this staff member as an outstanding cash advance, so it can be deducted from their next payroll."
                >
                  <select
                    className={selectClass}
                    onChange={(e) => setFormCashAdvanceStaffId(e.target.value)}
                    value={formCashAdvanceStaffId}
                  >
                    <option value="">Select a staff member</option>
                    {formCashAdvanceStaffId &&
                    !activeStaffForForm.some((s) => String(s.id) === formCashAdvanceStaffId)
                      ? staff
                          .filter((s) => String(s.id) === formCashAdvanceStaffId)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.displayName}
                              {s.isArchived ? ' (archived)' : ''}
                            </option>
                          ))
                      : null}
                    {activeStaffForForm.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName}
                      </option>
                    ))}
                  </select>
                </ModalField>
              ) : null}

              {/* Sale template */}
              {isSaleType && canManageInventory ? (
                <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/80 p-3">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <ModalField label="Sale template (optional)">
                      <select
                        className={selectClass}
                        onChange={(e) => handleTemplatePickerChange(e.target.value)}
                        value={formTemplatePickerId}
                      >
                        <option value="">None</option>
                        {templatesForPicker.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {!t.isActive ? ' (inactive)' : ''}
                          </option>
                        ))}
                      </select>
                    </ModalField>
                    {formTemplatePreviewLines.length > 0 ? (
                      <button
                        className="mb-0.5 shrink-0 text-xs font-medium text-gray-600 underline decoration-gray-400 hover:text-gray-900"
                        onClick={() => {
                          setFormTemplatePickerId('')
                          setFormTemplatePreviewLines([])
                        }}
                        type="button"
                      >
                        Clear template
                      </button>
                    ) : null}
                  </div>
                  <p className="text-xs text-gray-500">
                    Applies stock-out movements when you save and auto-fills the Amount with the
                    template&apos;s combo total. Manage templates under{' '}
                    <span className="font-medium text-gray-700">Inventory → Sale templates</span>.
                  </p>
                  {formTemplatePreviewLines.length > 0 ? (
                    <div className="mt-2 overflow-x-auto rounded-md border border-gray-200 bg-white">
                      <table className="w-full min-w-[320px] text-xs">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            <th className="px-2 py-1.5">Item</th>
                            <th className="px-2 py-1.5 text-right">Stock</th>
                            <th className="px-2 py-1.5 text-right">Qty out</th>
                            <th className="px-2 py-1.5 text-right">Unit price</th>
                            <th className="px-2 py-1.5 text-right">Line total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {formTemplatePreviewLines.map((line) => {
                            const q = Number(line.quantityStr.trim())
                            const baseQ =
                              line.saleUnitFactor > 0 ? q / line.saleUnitFactor : q
                            const projected = Number.isFinite(baseQ)
                              ? line.currentStock - baseQ
                              : line.currentStock
                            const lowWarn =
                              !line.missingItem &&
                              Number.isFinite(q) &&
                              q > 0 &&
                              (projected < 0 || projected <= line.lowStockThreshold)
                            const lineTotal =
                              Number.isFinite(q) && q > 0 &&
                              Number.isFinite(line.unitPrice) && line.unitPrice >= 0
                                ? q * line.unitPrice
                                : null
                            return (
                              <tr key={line.key}>
                                <td className="px-2 py-1.5">
                                  <div className="font-medium text-gray-900">{line.itemName}</div>
                                  <div className="text-[10px] text-gray-500">{line.unitLabel}</div>
                                  {line.missingItem ? (
                                    <div className="mt-0.5 flex items-center gap-1 text-amber-700">
                                      <AlertTriangle className="h-3 w-3 shrink-0" />
                                      Item missing — skipped on save
                                    </div>
                                  ) : !line.isItemActive ? (
                                    <div className="mt-0.5 flex items-center gap-1 text-amber-700">
                                      <AlertTriangle className="h-3 w-3 shrink-0" />
                                      Inactive item
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">
                                  {line.missingItem ? '—' : line.currentStock}
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  <input
                                    className="w-20 rounded border border-gray-300 bg-white px-1.5 py-1 text-right tabular-nums text-gray-900 outline-none focus:border-blue-500"
                                    disabled={line.missingItem}
                                    min="0"
                                    onChange={(e) =>
                                      updateTemplatePreviewQuantity(line.key, e.target.value)
                                    }
                                    step="any"
                                    type="number"
                                    value={line.quantityStr}
                                  />
                                  {lowWarn ? (
                                    <div className="mt-0.5 text-[10px] font-medium text-amber-700">
                                      Low / over stock
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">
                                  {line.unitPrice > 0 ? formatCurrency(line.unitPrice) : '—'}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-gray-900">
                                  {lineTotal != null && lineTotal > 0
                                    ? formatCurrency(lineTotal)
                                    : '—'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        {templatePreviewComboTotal > 0 ? (
                          <tfoot>
                            <tr className="border-t border-gray-200 bg-gray-50 text-[11px]">
                              <td
                                className="px-2 py-1.5 font-medium text-gray-700"
                                colSpan={4}
                              >
                                Combo total
                              </td>
                              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-gray-900">
                                {formatCurrency(templatePreviewComboTotal)}
                              </td>
                            </tr>
                          </tfoot>
                        ) : null}
                      </table>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Customer */}
              {showCustomerField ? (
                <ModalField label="Customer">
                  <div className="relative" ref={customerContainerRef}>
                    <div className="relative">
                      <input
                        className={`${inputClass} pr-8`}
                        onChange={(e) => {
                          setCustomerSearch(e.target.value)
                          if (!customerDropdownOpen) setCustomerDropdownOpen(true)
                        }}
                        onFocus={() => {
                          setCustomerSearch('')
                          setCustomerDropdownOpen(true)
                        }}
                        placeholder="Search or type a name…"
                        type="text"
                        value={customerDropdownOpen ? customerSearch : selectedCustomerLabel}
                      />
                      {formCustomerId ? (
                        <button
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          onClick={() => {
                            setFormCustomerId('')
                            setCustomerSearch('')
                          }}
                          tabIndex={-1}
                          type="button"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    {customerDropdownOpen ? (
                      <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                        <button
                          className="w-full px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setFormCustomerId('')
                            setCustomerSearch('')
                            setCustomerDropdownOpen(false)
                          }}
                          type="button"
                        >
                          No customer
                        </button>
                        {filteredCustomersForForm.length > 0 ? (
                          filteredCustomersForForm.map((c) => (
                            <button
                              className={[
                                'w-full px-3 py-2 text-left text-sm',
                                String(c.id) === formCustomerId
                                  ? 'bg-blue-50 font-medium text-blue-700'
                                  : 'text-gray-900 hover:bg-gray-50',
                              ].join(' ')}
                              key={c.id}
                              onMouseDown={(e) => {
                                e.preventDefault()
                                setFormCustomerId(String(c.id))
                                setCustomerSearch('')
                                setCustomerDropdownOpen(false)
                              }}
                              type="button"
                            >
                              {c.company ? `${c.name} (${c.company})` : c.name}
                            </button>
                          ))
                        ) : customerSearch.trim() ? (
                          <div className="px-3 py-2 text-xs text-gray-400">No matches found</div>
                        ) : null}
                        {canQuickCreateCustomer ? (
                          <button
                            className="w-full border-t border-gray-100 px-3 py-2 text-left text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                            disabled={isCreatingCustomer}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              void handleQuickCreateCustomer()
                            }}
                            type="button"
                          >
                            {isCreatingCustomer
                              ? 'Saving…'
                              : `+ Save "${customerSearch.trim()}" as new customer`}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </ModalField>
              ) : null}

              {/* Loyalty status */}
              {!isCleaningBusiness && loyaltyStatus && formCustomerId && showCustomerField ? (
                <p className="text-xs text-gray-600">
                  {loyaltyStatus.isEligibleForReward ? (
                    <span className="font-medium text-violet-600">
                      Free load available — check &quot;Redeem loyalty reward&quot; below.
                    </span>
                  ) : (
                    <>
                      {loyaltyStatus.paidLoadsSinceLastReward.toFixed(2)} /{' '}
                      {loyaltyStatus.freeAfterLoads} paid loads toward next reward.
                    </>
                  )}
                </p>
              ) : null}

              {/* Loyalty redeem */}
              {showLoadFields &&
              formCustomerId &&
              (loyaltyStatus?.isEligibleForReward || formRedeemReward) ? (
                <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800">
                  <input
                    checked={formRedeemReward}
                    className="mt-1 rounded border-gray-300"
                    onChange={(e) => {
                      const checked = e.target.checked
                      setFormRedeemReward(checked)
                      if (checked) {
                        setAmount('0')
                        setFormLoads((prev) => (prev.trim() === '' ? '1' : prev))
                      }
                    }}
                    type="checkbox"
                  />
                  <span>Redeem loyalty reward (free load — amount will be 0)</span>
                </label>
              ) : null}

              {/* Amount */}
              <ModalField label="Amount" required>
                <input
                  className={inputClass}
                  disabled={showLoadFields && formRedeemReward}
                  min="0"
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  step="any"
                  type="number"
                  value={amount}
                />
              </ModalField>

              {/* Line items */}
              {!(showLoadFields && formRedeemReward) ? (
                <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        Additional items (optional)
                      </p>
                      <p className="text-xs text-gray-500">
                        Pick from inventory or type a custom name. Enter quantity and unit price —
                        line totals add to the amount.
                      </p>
                    </div>
                    <button
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50"
                      onClick={addLineItem}
                      type="button"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add item
                    </button>
                  </div>

                  {formLineItems.length > 0 ? (
                    <>
                      <datalist id={lineItemListId}>
                        {formInventoryOptions.map((inv) => (
                          <option key={inv.id} value={inv.name} />
                        ))}
                      </datalist>
                      <div className="hidden gap-2 px-1 text-[10px] font-medium uppercase tracking-wider text-gray-400 sm:flex">
                        <span className="flex-1">Item</span>
                        <span className="shrink-0 text-center" style={{ width: '11rem' }}>
                          Qty &amp; unit
                        </span>
                        <span className="w-4 shrink-0" />
                        <span className="w-24 shrink-0 text-right">Unit price</span>
                        <span className="w-7 shrink-0" />
                      </div>
                      <div className="space-y-2">
                        {formLineItems.map((li) => {
                          const linkedInv =
                            li.inventoryItemId != null
                              ? formInventoryOptions.find((inv) => inv.id === li.inventoryItemId)
                              : undefined
                          const usingAlt = li.saleUnitLabel !== '' && li.saleUnitFactor !== 1
                          const qtyProps = usingAlt
                            ? { step: 'any', min: '0.01' }
                            : lineItemQtyInputProps(linkedInv?.unitType)
                          const baseUnitLabel = linkedInv?.unitLabel?.trim() || ''
                          const activeUnitLabel = usingAlt
                            ? li.saleUnitLabel
                            : baseUnitLabel || ''
                          const qtyNum = Number(li.quantityStr)
                          const unitNum = Number(li.priceStr)
                          const lineTotal =
                            Number.isFinite(qtyNum) && qtyNum > 0 &&
                            Number.isFinite(unitNum) && unitNum >= 0
                              ? qtyNum * unitNum
                              : null
                          const activeAltUnits = (linkedInv?.altUnits ?? []).filter(
                            (u) => u.isActive && u.unitsPerBase > 0,
                          )
                          const showUnitPicker = activeAltUnits.length > 0
                          const baseQtyForStock =
                            usingAlt && Number.isFinite(qtyNum) && qtyNum > 0 && li.saleUnitFactor > 0
                              ? qtyNum / li.saleUnitFactor
                              : null
                          return (
                            <div className="space-y-1" key={li.key}>
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <input
                                    className={inputClass}
                                    list={lineItemListId}
                                    onChange={(e) => updateLineItemLabel(li.key, e.target.value)}
                                    placeholder="Item name"
                                    type="text"
                                    value={li.label}
                                  />
                                </div>
                                {showUnitPicker ? (
                                  <div
                                    aria-label="Quantity and sale unit"
                                    className="flex h-10 shrink-0 items-stretch overflow-hidden rounded-md border border-gray-300 bg-white focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200"
                                    style={{ width: '11rem' }}
                                  >
                                    <button
                                      aria-label="Decrease quantity"
                                      className="flex w-7 shrink-0 items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-300"
                                      disabled={
                                        !Number.isFinite(qtyNum) ||
                                        qtyNum <= Number(qtyProps.min)
                                      }
                                      onClick={() => {
                                        const stepNum =
                                          qtyProps.step === '0.01' ? 0.01 : 1
                                        const current = Number.isFinite(qtyNum) ? qtyNum : 0
                                        const minNum = Number(qtyProps.min) || 0
                                        const next = Math.max(minNum, current - stepNum)
                                        const rounded =
                                          stepNum < 1
                                            ? Math.round(next * 100) / 100
                                            : Math.round(next)
                                        updateLineItemQuantity(li.key, String(rounded))
                                      }}
                                      type="button"
                                    >
                                      <Minus className="h-3.5 w-3.5" />
                                    </button>
                                    <input
                                      aria-label="Quantity"
                                      className="w-12 shrink-0 border-0 bg-transparent px-1 text-center text-sm focus:outline-none focus:ring-0"
                                      min={qtyProps.min}
                                      onChange={(e) =>
                                        updateLineItemQuantity(li.key, e.target.value)
                                      }
                                      placeholder="1"
                                      step={qtyProps.step}
                                      type="number"
                                      value={li.quantityStr}
                                    />
                                    <select
                                      aria-label="Sale unit"
                                      className="min-w-0 flex-1 border-0 border-l border-gray-200 bg-transparent px-2 text-xs focus:outline-none focus:ring-0"
                                      onChange={(e) => updateLineItemUnit(li.key, e.target.value)}
                                      value={
                                        li.saleUnitId != null ? String(li.saleUnitId) : ''
                                      }
                                    >
                                      <option value="">{baseUnitLabel || 'unit'}</option>
                                      {activeAltUnits.map((u) => (
                                        <option key={u.id} value={u.id}>
                                          {u.unitLabel}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      aria-label="Increase quantity"
                                      className="flex w-7 shrink-0 items-center justify-center border-l border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                                      onClick={() => {
                                        const stepNum =
                                          qtyProps.step === '0.01' ? 0.01 : 1
                                        const current = Number.isFinite(qtyNum) ? qtyNum : 0
                                        const next = current + stepNum
                                        const rounded =
                                          stepNum < 1
                                            ? Math.round(next * 100) / 100
                                            : Math.round(next)
                                        updateLineItemQuantity(li.key, String(rounded))
                                      }}
                                      type="button"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <div
                                    className="flex h-10 shrink-0 items-stretch gap-2"
                                    style={{ width: '11rem' }}
                                  >
                                    <div className="w-16 shrink-0">
                                      <input
                                        aria-label="Quantity"
                                        className={`${inputClass} px-2 text-center`}
                                        min={qtyProps.min}
                                        onChange={(e) =>
                                          updateLineItemQuantity(li.key, e.target.value)
                                        }
                                        placeholder="1"
                                        step={qtyProps.step}
                                        type="number"
                                        value={li.quantityStr}
                                      />
                                    </div>
                                    <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
                                      {baseUnitLabel || '—'}
                                    </div>
                                  </div>
                                )}
                                <span className="w-4 shrink-0 self-center text-center text-xs text-gray-400">
                                  ×
                                </span>
                                <div className="w-24 shrink-0">
                                  <input
                                    aria-label="Unit price"
                                    className={`${inputClass} text-right`}
                                    min="0"
                                    onChange={(e) => updateLineItemPrice(li.key, e.target.value)}
                                    placeholder="0.00"
                                    step="any"
                                    type="number"
                                    value={li.priceStr}
                                  />
                                </div>
                                <button
                                  aria-label="Remove item"
                                  className="mt-1 shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                                  onClick={() => removeLineItem(li.key)}
                                  type="button"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                              <div className="flex items-center justify-between gap-2 pl-1 pr-9 text-[11px] text-gray-500">
                                <span className="truncate">
                                  {activeUnitLabel
                                    ? `Priced per ${activeUnitLabel}`
                                    : 'Price is per unit'}
                                  {baseQtyForStock != null && baseUnitLabel
                                    ? ` · stock −${baseQtyForStock.toFixed(3).replace(/\.?0+$/, '')} ${baseUnitLabel}`
                                    : ''}
                                </span>
                                <span className="tabular-nums text-gray-700">
                                  {lineTotal != null ? `= ${formatCurrency(lineTotal)}` : '—'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  ) : null}

                  {formLineItems.length > 0 ? (
                    <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-xs">
                      <span className="text-gray-600">
                        Base {formatCurrency(baseAmountNum)} + Items {formatCurrency(lineItemsTotal)}
                      </span>
                      <span className="font-semibold text-gray-900">
                        Total: {formatCurrency(grandTotal)}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Description */}
              <ModalField label="Description">
                <textarea
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition resize-none placeholder:text-gray-400"
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional note…"
                  rows={2}
                  value={description}
                />
              </ModalField>

              {/* Staff count */}
              {showStaffCountField ? (
                <ModalField label="Number of staff">
                  <input
                    className={inputClass}
                    min="1"
                    onChange={(e) => setStaffCount(e.target.value)}
                    placeholder="Optional"
                    type="number"
                    value={staffCount}
                  />
                </ModalField>
              ) : null}

              {error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
                  {error}
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-5 py-4">
              <p className="text-xs text-gray-400">
                <span className="text-red-500">*</span> Required fields
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
                  onClick={onClose}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                  disabled={!canEdit || isSubmitting}
                  type="submit"
                >
                  {isSubmitting ? 'Saving…' : 'Update'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
