import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns'
import type {
  AssistantDateRange,
  AssistantIntent,
  CreateAttendanceIntent,
  CreateCustomerIntent,
  CreateExpenseIntent,
  CreateInventoryIntent,
  CreateSaleIntent,
  CreateStaffIntent,
  SaleLineItem,
} from '../types'

const DATE_FMT = 'yyyy-MM-dd'

function fmt(d: Date) {
  return format(d, DATE_FMT)
}

// ─── Date phrase resolution ────────────────────────────────────────────────────

function resolveDateRange(text: string): AssistantDateRange | null {
  const lower = text.toLowerCase()
  const now = new Date()

  if (/\btoday\b/.test(lower)) return { from: fmt(now), to: fmt(now) }
  if (/\byesterday\b/.test(lower)) {
    const d = subDays(now, 1)
    return { from: fmt(d), to: fmt(d) }
  }
  if (/\bthis week\b/.test(lower)) {
    return { from: fmt(startOfWeek(now, { weekStartsOn: 1 })), to: fmt(endOfWeek(now, { weekStartsOn: 1 })) }
  }
  if (/\blast week\b/.test(lower)) {
    const w = subWeeks(now, 1)
    return { from: fmt(startOfWeek(w, { weekStartsOn: 1 })), to: fmt(endOfWeek(w, { weekStartsOn: 1 })) }
  }
  if (/\bthis month\b/.test(lower)) {
    return { from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) }
  }
  if (/\blast month\b/.test(lower)) {
    const m = subMonths(now, 1)
    return { from: fmt(startOfMonth(m)), to: fmt(endOfMonth(m)) }
  }
  // "past N days" / "last N days"
  const pastDays = /(?:past|last)\s+(\d+)\s+days?/.exec(lower)
  if (pastDays) {
    const n = parseInt(pastDays[1], 10)
    return { from: fmt(subDays(now, n - 1)), to: fmt(now) }
  }
  // "past N weeks"
  const pastWeeks = /(?:past|last)\s+(\d+)\s+weeks?/.exec(lower)
  if (pastWeeks) {
    const n = parseInt(pastWeeks[1], 10)
    return { from: fmt(subWeeks(now, n)), to: fmt(now) }
  }
  // "this year"
  if (/\bthis year\b/.test(lower)) {
    return { from: fmt(new Date(now.getFullYear(), 0, 1)), to: fmt(new Date(now.getFullYear(), 11, 31)) }
  }
  return null
}

function todayStr() {
  return fmt(new Date())
}

// ─── Field extractors ─────────────────────────────────────────────────────────

function extractAmount(text: string): number | null {
  // ₱1,200 | 1200 pesos | 1,200.50 pesos
  const m =
    /₱\s*([\d,]+(?:\.\d{1,2})?)/.exec(text) ??
    /([\d,]+(?:\.\d{1,2})?)\s*(?:pesos?|php)/i.exec(text)
  if (!m) return null
  return parseFloat(m[1].replace(/,/g, ''))
}

function extractPhone(text: string): string {
  const m = /(?:phone|tel|contact|cp|number)[:\s]+([09]\d{9,10})/i.exec(text) ??
    /\b(09\d{9})\b/.exec(text)
  return m?.[1] ?? ''
}

function extractEmail(text: string): string {
  const m = /[\w.+-]+@[\w-]+\.\w+/.exec(text)
  return m?.[0] ?? ''
}

function extractDate(text: string): string | null {
  const lower = text.toLowerCase()
  if (/\btoday\b/.test(lower)) return todayStr()
  if (/\byesterday\b/.test(lower)) return fmt(subDays(new Date(), 1))
  // "June 21" / "June 21, 2025" / "2025-06-21"
  const isoDate = /(\d{4}-\d{2}-\d{2})/.exec(text)
  if (isoDate) return isoDate[1]
  const monthDay = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,?\s*(\d{4}))?\b/i.exec(text)
  if (monthDay) {
    const months: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    }
    const year = monthDay[3] ? parseInt(monthDay[3], 10) : new Date().getFullYear()
    const month = months[monthDay[1].toLowerCase()]
    const day = parseInt(monthDay[2], 10)
    return fmt(new Date(year, month, day))
  }
  return null
}

/** Parse "3 detergent powder", "2 soap", lines from text */
function extractSaleItems(text: string): SaleLineItem[] {
  const items: SaleLineItem[] = []
  // Match patterns like "3 detergent powder", "2x soap", "bought 2 soap"
  const lineRe = /\b(\d+)\s*x?\s+([a-zA-Z][\w\s]{1,40}?)(?=\n|,|and\b|$)/gi
  let m: RegExpExecArray | null
  while ((m = lineRe.exec(text)) !== null) {
    const qty = parseInt(m[1], 10)
    const name = m[2].trim().replace(/\s+/g, ' ')
    if (qty > 0 && name.length > 1) {
      items.push({ itemName: name, quantity: qty })
    }
  }
  return items
}

// ─── Detect create intent ─────────────────────────────────────────────────────

function detectCreateKind(lower: string): CreateIntent['entity'] | null {
  if (/\badd\s+(a\s+)?customer\b/.test(lower) || /\bnew\s+customer\b/.test(lower)) return 'customer'
  if (/\badd\s+(a\s+)?(?:inventory|item|product|stock)\b/.test(lower) || /\bnew\s+(?:inventory|item|product)\b/.test(lower)) return 'inventory'
  if (/\badd\s+(a\s+)?(?:expense|expense\s+transaction)\b/.test(lower) || /\bnew\s+expense\b/.test(lower)) return 'expense'
  if (/\badd\s+(a\s+)?(?:staff|employee|worker)\b/.test(lower) || /\bnew\s+(?:staff|employee)\b/.test(lower)) return 'staff'
  if (/\b(?:mark|log|record|add)\s+attendance\b/.test(lower)) return 'attendance'
  // "was present/absent today" pattern
  if (/\bwas\s+(?:present|absent|on\s+leave)\b/.test(lower)) return 'attendance'
  // "bought" implies a sale
  if (/\bbought\b|\bpurchased\b|\bsold\b/.test(lower) && !/(show|list|what|who|how|which)/i.test(lower)) return 'sale'
  return null
}

type CreateIntent = CreateCustomerIntent | CreateInventoryIntent | CreateSaleIntent | CreateExpenseIntent | CreateStaffIntent | CreateAttendanceIntent

// ─── Detect query intent ──────────────────────────────────────────────────────

function extractQueryName(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

// ─── Civil status normalizer ──────────────────────────────────────────────────

function normalizeCivilStatus(text: string): string {
  const lower = text.toLowerCase()
  if (/\bsingle\b/.test(lower)) return 'Single'
  if (/\bmarried\b/.test(lower)) return 'Married'
  if (/\bwidow/.test(lower)) return 'Widowed'
  if (/\bseparated\b/.test(lower)) return 'Separated'
  return 'Single'
}

// ─── Main parse function ──────────────────────────────────────────────────────

export function parseLocal(raw: string): AssistantIntent {
  const lower = raw.toLowerCase().trim()

  // ── Detect create intents first ──
  const createKind = detectCreateKind(lower)
  if (createKind) {
    return buildCreateIntent(createKind, raw, lower)
  }

  // ── Detect query intents ──
  // We try query detection regardless of explicit question words —
  // keyword matches below provide sufficient specificity
  {
    // Sales queries
    if (/\bsale[s]?\b|\bsold\b|\brevenue\b|\bincome\b|\bearned\b/.test(lower)) {
      return {
        kind: 'query',
        category: 'sales',
        subtype: /\btop\b|\bbest\b|\bmost\b/.test(lower) ? 'top_selling'
          : /\baverage\b|\bavg\b/.test(lower) ? 'average_daily'
          : /\bcustomer\b/.test(lower) ? 'by_customer'
          : /\bitem\b|\bproduct\b/.test(lower) ? 'by_item'
          : /\brecent\b/.test(lower) ? 'recent'
          : 'total',
        dateRange: resolveDateRange(lower),
        customerName: extractQueryName(raw, [/(?:for|by|of)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/]),
        itemName: extractQueryName(raw, [/(?:item|product|bought)\s+([a-zA-Z][\w\s]{1,30}?)(?:\s+this|\s+last|\s+today|$)/i]),
      }
    }

    // Expense queries
    if (/\bexpense[s]?\b|\bspend\b|\bspent\b|\bcost[s]?\b/.test(lower)) {
      return {
        kind: 'query',
        category: 'expense',
        subtype: /\boperating\b/.test(lower) ? 'operating'
          : /\bbiggest\b|\blargest\b|\bhighest\b/.test(lower) ? 'largest'
          : /\bcategory\b/.test(lower) ? 'by_category'
          : /\brecent\b/.test(lower) ? 'recent'
          : 'total',
        dateRange: resolveDateRange(lower),
        categoryName: extractQueryName(raw, [/(?:for|on|about)\s+([a-zA-Z][\w\s]{1,30}?)(?:\s+this|\s+last|\s+today|,|$)/i]),
      }
    }

    // Customer queries
    if (/\bcustomer[s]?\b|\bclient[s]?\b/.test(lower)) {
      return {
        kind: 'query',
        category: 'customer',
        subtype: /\btop\b|\bmost\b|\bhighest\b/.test(lower) ? 'top'
          : /\bfrequent\b|\bregular\b/.test(lower) ? 'frequent'
          : /\bhistory\b|\btransaction\b|\bbought\b/.test(lower) ? 'purchase_history'
          : /\brecent\b|\bnew\b|\bladded\b/.test(lower) ? 'recent'
          : 'list',
        dateRange: resolveDateRange(lower),
        customerName: extractQueryName(raw, [
          /(?:customer|client|of)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/,
          /^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)'s\s+(?:purchase|history)/,
        ]),
      }
    }

    // Inventory queries
    if (/\binventor[y]?\b|\bstock\b|\bitem[s]?\b|\bproduct[s]?\b|\bsupply\b/.test(lower)) {
      return {
        kind: 'query',
        category: 'inventory',
        subtype: /\blow\b|\brestock\b|\brunning out\b/.test(lower) ? 'low_stock'
          : /\bfast[\s-]?mov\b|\bmost\s+sold\b|\btop\b/.test(lower) ? 'fast_moving'
          : /\bmovement\b|\bhistory\b/.test(lower) ? 'movement_history'
          : /\bstock\b/.test(lower) ? 'current_stock'
          : 'list',
        dateRange: resolveDateRange(lower),
        itemName: extractQueryName(raw, [/(?:item|product|of)\s+([a-zA-Z][\w\s]{1,30}?)(?:\s+this|\s+last|\s+today|,|$)/i]),
      }
    }

    // Staff / attendance queries
    if (/\bstaff\b|\battendance\b|\bpresent\b|\babsent\b|\bemployee[s]?\b|\bworker[s]?\b/.test(lower)) {
      return {
        kind: 'query',
        category: 'staff',
        subtype: /\bpresent\b/.test(lower) ? 'present'
          : /\babsent\b/.test(lower) ? 'absent'
          : /\brate\b|\bsalar[y]?\b/.test(lower) ? 'daily_rate'
          : /\bsummar[y]?\b/.test(lower) ? 'attendance_summary'
          : 'list',
        dateRange: resolveDateRange(lower),
        staffName: extractQueryName(raw, [/(?:staff|attendance\s+of|summary\s+of)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/]),
      }
    }

    // Payroll queries
    if (/\bpayroll\b|\bpay\b|\bsalary\b|\bwage\b/.test(lower)) {
      return {
        kind: 'query',
        category: 'payroll',
        subtype: /\bovertime\b/.test(lower) ? 'overtime'
          : /\bdeduction\b/.test(lower) ? 'deductions'
          : /\bhistory\b/.test(lower) ? 'history'
          : /\bemployee\b|\bstaff\b/.test(lower) ? 'by_employee'
          : 'summary',
        dateRange: resolveDateRange(lower),
        staffName: extractQueryName(raw, [/(?:payroll|salary|pay)\s+(?:of|for)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/]),
      }
    }
  }

  return { kind: 'unknown', raw }
}

function buildCreateIntent(entity: CreateIntent['entity'], raw: string, lower: string): CreateIntent {
  switch (entity) {
    case 'customer': {
      // "Add customer Juan Dela Cruz phone 09123 email..."
      const nameMatch = /(?:add|new)\s+(?:a\s+)?customer\s+([\w\s]+?)(?:\s+phone|\s+email|\s+company|\s*$)/i.exec(raw)
      return {
        kind: 'create',
        entity: 'customer',
        fields: {
          name: nameMatch?.[1]?.trim() ?? '',
          phone: extractPhone(raw),
          email: extractEmail(raw),
          company: (/(?:company|business)\s+([\w\s]+?)(?:\s+phone|\s+email|\s*$)/i.exec(raw)?.[1] ?? '').trim(),
        },
      } satisfies CreateCustomerIntent
    }

    case 'inventory': {
      const nameMatch = /(?:add|new)\s+(?:a\s+)?(?:inventory|item|product|stock)\s+([\w\s]+?)(?:\s+category|\s+unit|\s+cost|\s+selling|\s+initial|\s*$)/i.exec(raw)
      const amount = extractAmount(raw)
      const sellingMatch = /(?:selling\s+price|price)\s+(?:is\s+)?(?:₱)?([\d,]+(?:\.\d{1,2})?)/i.exec(raw)
      const costMatch = /(?:cost|cost\s+per\s+unit)\s+(?:is\s+)?(?:₱)?([\d,]+(?:\.\d{1,2})?)/i.exec(raw)
      const stockMatch = /(?:initial\s+stock|stock)\s+(?:is\s+)?(\d+)/i.exec(raw)
      const catMatch = /category\s+([\w\s]+?)(?:\s+unit|\s+cost|\s+selling|\s+initial|\s*$)/i.exec(raw)
      const unitMatch = /unit\s+([\w]+)/i.exec(raw)
      return {
        kind: 'create',
        entity: 'inventory',
        fields: {
          name: nameMatch?.[1]?.trim() ?? '',
          category: catMatch?.[1]?.trim() ?? '',
          unitType: unitMatch?.[1]?.toLowerCase() ?? 'piece',
          unitLabel: unitMatch?.[1] ?? 'pc',
          costPerUnit: costMatch ? parseFloat(costMatch[1].replace(/,/g, '')) : amount,
          sellingPrice: sellingMatch ? parseFloat(sellingMatch[1].replace(/,/g, '')) : null,
          initialStock: stockMatch ? parseInt(stockMatch[1], 10) : null,
          lowStockThreshold: null,
          supplier: (/(?:supplier|brand)\s+([\w\s]+?)(?:\s+category|\s+unit|\s*$)/i.exec(raw)?.[1] ?? '').trim(),
          description: '',
        },
      } satisfies CreateInventoryIntent
    }

    case 'sale': {
      const customerMatch = /^([\w\s]+?)\s+(?:bought|purchased)/i.exec(raw)
      const items = extractSaleItems(raw)
      const catMatch = /category\s+([\w\s]+?)(?:\s+|$)/i.exec(raw)
      return {
        kind: 'create',
        entity: 'sale',
        fields: {
          customerName: customerMatch?.[1]?.trim() ?? '',
          items,
          amount: extractAmount(raw),
          date: extractDate(raw),
          description: '',
          categoryName: catMatch?.[1]?.trim() ?? 'Sale',
        },
      } satisfies CreateSaleIntent
    }

    case 'expense': {
      const catMatch = /(?:for|on)\s+([\w\s]+?)(?:\s+(?:today|yesterday|last|this|₱|\d)|$)/i.exec(raw)
      return {
        kind: 'create',
        entity: 'expense',
        fields: {
          amount: extractAmount(raw),
          categoryName: catMatch?.[1]?.trim() ?? '',
          description: raw.replace(/add\s+expense\s*/i, '').trim(),
          date: extractDate(raw),
        },
      } satisfies CreateExpenseIntent
    }

    case 'staff': {
      const nameMatch = /(?:add|new)\s+(?:a\s+)?(?:staff|employee|worker)\s+([\w]+)\s+([\w]+)?(?:\s+([\w]+))?/i.exec(raw)
      return {
        kind: 'create',
        entity: 'staff',
        fields: {
          firstName: nameMatch?.[1]?.trim() ?? '',
          middleName: nameMatch?.[3] ? nameMatch[2].trim() : '',
          lastName: nameMatch?.[3] ? nameMatch[3].trim() : (nameMatch?.[2]?.trim() ?? ''),
          defaultRate: extractAmount(raw) ?? null,
          civilStatus: normalizeCivilStatus(lower),
          birthdate: extractDate(raw) ?? '',
          address: (/(?:address|lives?\s+at)\s+([\w\s,]+?)(?:\s+daily|\s+rate|\s*$)/i.exec(raw)?.[1] ?? '').trim(),
          emergencyContactName: '',
          emergencyContactNumber: extractPhone(raw),
        },
      } satisfies CreateStaffIntent
    }

    case 'attendance': {
      // "Mark Reyes was present today multiplier 1.5"
      const nameMatch = /^([\w\s]+?)\s+(?:was|is)\s+(?:present|absent|on\s+leave)/i.exec(raw) ??
        /(?:mark|log|record)\s+attendance\s+(?:of|for)\s+([\w\s]+?)(?:\s+(?:present|absent|on\s+leave)|$)/i.exec(raw)
      const status = /\bpresent\b/.test(lower) ? 'present'
        : /\babsent\b/.test(lower) ? 'absent'
        : /\bhalf\b/.test(lower) ? 'half'
        : /\bovertime\b/.test(lower) ? 'overtime'
        : /\bholiday\b/.test(lower) ? 'holiday'
        : 'present'
      const multMatch = /(?:multiplier|mult)[:\s]+(\d+(?:\.\d+)?)/i.exec(raw)
      const rateMatch = /(?:rate\s+override|rate)[:\s]+(?:₱)?([\d,]+(?:\.\d{1,2})?)/i.exec(raw)
      return {
        kind: 'create',
        entity: 'attendance',
        fields: {
          staffName: (nameMatch?.[1] ?? '').trim(),
          date: extractDate(raw),
          status,
          multiplier: multMatch ? parseFloat(multMatch[1]) : null,
          rateOverride: rateMatch ? parseFloat(rateMatch[1].replace(/,/g, '')) : null,
          notes: (/(?:notes?|note)[:\s]+([\w\s]+?)(?:\s*$)/i.exec(raw)?.[1] ?? '').trim(),
        },
      } satisfies CreateAttendanceIntent
    }
  }
}

// Add today as default date range if null and intent is query with no date
export function ensureDefaultDateRange(intent: AssistantIntent): AssistantIntent {
  if (intent.kind !== 'query') return intent
  if (intent.dateRange) return intent
  // Default: today
  const today = todayStr()
  return { ...intent, dateRange: { from: today, to: today } }
}

// Re-export addDays for use in the default range helper
export { addDays }
