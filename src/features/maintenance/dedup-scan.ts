// Duplicate scanner for the "Find & remove duplicates" maintenance tool.
//
// WHY THIS EXISTS
// The JSON import de-dupes rows by a content fingerprint (entry date + amount +
// description + …). When the SAME real record was edited differently on two
// devices — e.g. one device added a reference number to the description, the
// other left it blank — the fingerprints diverge and the importer inserts a
// second copy instead of recognising it as the same row. Manual entry has no
// de-dupe at all, so a double-tapped "Save" also produces exact copies. This
// scanner finds both, groups them into confidence tiers, and hands a review
// plan to the dialog. NOTHING is deleted here — the user selects and confirms.
//
// SAFETY MODEL — two high-precision tiers only:
//   • exact        identical in every user-visible field (a double-tapped save
//                  or an exact re-import). Pre-selected.
//   • blank-shadow a blank-description row shadowing a reference-numbered twin
//                  (same type+category+amount+customer within a date window).
//                  Pre-selected, but shown for review. This is the NMP case.
//
// A deliberately-omitted "near match" tier (same day + amount, different text)
// was tried and dropped: for rows whose identity lives in the free text — e.g.
// two different staff members' ₱500 cash advances on the same day — it produced
// mostly false positives. Better to miss a fuzzy dup than to suggest deleting a
// real record. Two blank rows never trigger blank-shadow (it needs a described
// twin), so legitimately-blank high-frequency rows like walk-in sales are safe.

import { getDatabase } from '../../lib/db/client'

export type DedupEntityKey =
  | 'transactions'
  | 'inventoryMovements'
  | 'staffAttendance'
  | 'incidentReports'
  | 'inventoryMaintenanceRecords'

export type DedupTier = 'exact' | 'blank-shadow'

/** One row proposed for removal, with a pointer to the twin that is kept. */
export interface DuplicateCandidate {
  entity: DedupEntityKey
  id: number
  tier: DedupTier
  /** Short headline for the row, e.g. "Feb 6, 2026 · NMP Training · ₱20,160". */
  label: string
  /** Why it is considered a duplicate, incl. the kept twin. */
  detail: string
  createdAt: string
}

export interface DedupPlan {
  candidates: DuplicateCandidate[]
  /** Rows scanned per entity (for the "scanned N, found M" summary). */
  scanned: Record<DedupEntityKey, number>
}

/** Human labels + icons live in the UI; keep the engine display-agnostic here. */
export const ENTITY_LABELS: Record<DedupEntityKey, string> = {
  transactions: 'Transactions',
  inventoryMovements: 'Inventory movements',
  staffAttendance: 'Attendance records',
  incidentReports: 'Incident reports',
  inventoryMaintenanceRecords: 'Maintenance records',
}

export const TIER_LABELS: Record<DedupTier, string> = {
  exact: 'Exact copies',
  'blank-shadow': 'Blank copies of a labelled record',
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase()
const money = (v: unknown) => Number(v ?? 0).toFixed(2)
const str = (v: unknown) => (v == null ? '' : String(v))
/** Days between two YYYY-MM-DD dates (absolute). NaN-safe. */
function dayGap(a: string, b: string): number {
  const da = Date.parse(a)
  const db = Date.parse(b)
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY
  return Math.abs(Math.round((da - db) / 86_400_000))
}

/** Prettify YYYY-MM-DD → "Feb 6, 2026" without pulling date-fns into the engine. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function prettyDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  if (!m) return d
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`
}

const BLANK_SHADOW_WINDOW_DAYS = 7

/**
 * Within a set of rows sharing a content key, pick the "keeper" and classify
 * the rest. Shared by every entity via a small adapter.
 */
interface Groupable {
  id: number
  createdAt: string
  /** Full identity incl. text — identical key ⇒ exact copy. */
  exactKey: string
  /** Identity WITHOUT the free-text field and WITHOUT the date. */
  contentKey: string
  entryDate: string
  /** The free-text field (description/notes) — blank ⇒ shadow candidate. */
  text: string
  label: string
  amountLabel: string
}

// ─── entity loaders ────────────────────────────────────────────────────────────

interface TxnRow {
  id: number
  entryDate: string
  typeCode: string
  categoryLabel: string
  description: string | null
  amount: number
  customerName: string | null
  kg: number | null
  loads: number | null
  isLoyaltyReward: number
  createdAt: string
}

async function loadTransactions(): Promise<Groupable[]> {
  const db = await getDatabase()
  const rows = await db.select<TxnRow[]>(
    `SELECT t.id AS id, t.entry_date AS entryDate, tt.code AS typeCode,
            c.label AS categoryLabel, t.description AS description, t.amount AS amount,
            cust.name AS customerName, t.kg AS kg, t.loads AS loads,
            t.is_loyalty_reward AS isLoyaltyReward, t.created_at AS createdAt
       FROM transactions t
       JOIN transaction_types tt ON tt.id = t.transaction_type_id
       JOIN categories c ON c.id = t.category_id
       LEFT JOIN customers cust ON cust.id = t.customer_id
      ORDER BY t.id`,
  )
  return rows.map((r) => {
    const content = [
      r.typeCode,
      lower(r.categoryLabel),
      money(r.amount),
      lower(r.customerName),
      r.kg ?? '',
      r.loads ?? '',
      r.isLoyaltyReward ? '1' : '0',
    ].join('|')
    const text = str(r.description).trim()
    const amountLabel = `₱${Number(r.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
    const who = r.customerName ? ` · ${r.customerName}` : ''
    return {
      id: r.id,
      createdAt: str(r.createdAt),
      entryDate: r.entryDate,
      contentKey: content,
      exactKey: `${content}|${r.entryDate}|${text.toLowerCase()}`,
      text,
      amountLabel,
      label: `${prettyDate(r.entryDate)} · ${r.categoryLabel}${who} · ${amountLabel}`,
    }
  })
}

interface MovementRow {
  id: number
  itemName: string
  movementDate: string
  movementType: string
  quantity: number
  unitCost: number
  notes: string | null
  createdAt: string
}

async function loadInventoryMovements(): Promise<Groupable[]> {
  const db = await getDatabase()
  const rows = await db.select<MovementRow[]>(
    `SELECT m.id AS id, i.name AS itemName, m.movement_date AS movementDate,
            m.movement_type AS movementType, m.quantity AS quantity,
            m.unit_cost AS unitCost, m.notes AS notes, m.created_at AS createdAt
       FROM inventory_movements m
       JOIN inventory_items i ON i.id = m.item_id
      ORDER BY m.id`,
  )
  return rows.map((r) => {
    const content = [lower(r.itemName), r.movementType, Number(r.quantity), money(r.unitCost)].join('|')
    const text = str(r.notes).trim()
    return {
      id: r.id,
      createdAt: str(r.createdAt),
      entryDate: r.movementDate,
      contentKey: content,
      exactKey: `${content}|${r.movementDate}|${text.toLowerCase()}`,
      text,
      amountLabel: `${r.quantity} @ ₱${money(r.unitCost)}`,
      label: `${prettyDate(r.movementDate)} · ${r.itemName} · ${r.movementType} ${r.quantity}`,
    }
  })
}

interface AttendanceRow {
  id: number
  attendanceDate: string
  firstName: string
  middleName: string | null
  lastName: string
  birthdate: string | null
  createdAt: string
}

async function loadAttendance(): Promise<Groupable[]> {
  const db = await getDatabase()
  const rows = await db.select<AttendanceRow[]>(
    `SELECT a.id AS id, a.attendance_date AS attendanceDate,
            s.first_name AS firstName, s.middle_name AS middleName,
            s.last_name AS lastName, s.birthdate AS birthdate, a.created_at AS createdAt
       FROM staff_attendance a
       JOIN staff s ON s.id = a.staff_id
      ORDER BY a.id`,
  )
  return rows.map((r) => {
    const name = `${str(r.firstName)} ${str(r.lastName)}`.trim()
    const content = [lower(r.firstName), lower(r.middleName), lower(r.lastName), str(r.birthdate)].join('|')
    return {
      id: r.id,
      createdAt: str(r.createdAt),
      entryDate: r.attendanceDate,
      contentKey: content,
      exactKey: `${content}|${r.attendanceDate}`,
      text: '',
      amountLabel: '',
      label: `${prettyDate(r.attendanceDate)} · ${name}`,
    }
  })
}

interface IncidentRow {
  id: number
  incidentDate: string
  incidentTime: string | null
  incidentType: string | null
  customerName: string | null
  whatHappened: string | null
  createdAt: string
}

async function loadIncidentReports(): Promise<Groupable[]> {
  const db = await getDatabase()
  const rows = await db.select<IncidentRow[]>(
    `SELECT id, incident_date AS incidentDate, incident_time AS incidentTime,
            incident_type AS incidentType, customer_name AS customerName,
            what_happened AS whatHappened, created_at AS createdAt
       FROM incident_reports
      ORDER BY id`,
  )
  return rows.map((r) => {
    const content = [
      str(r.incidentTime),
      lower(r.incidentType),
      lower(r.customerName),
      str(r.whatHappened).trim().toLowerCase(),
    ].join('|')
    return {
      id: r.id,
      createdAt: str(r.createdAt),
      entryDate: r.incidentDate,
      contentKey: content,
      exactKey: `${content}|${r.incidentDate}`,
      text: '',
      amountLabel: '',
      label: `${prettyDate(r.incidentDate)} · ${str(r.incidentType) || 'Incident'}${r.customerName ? ` · ${r.customerName}` : ''}`,
    }
  })
}

interface MaintenanceRow {
  id: number
  itemName: string
  serviceDate: string
  serviceType: string | null
  performedBy: string | null
  createdAt: string
}

async function loadMaintenanceRecords(): Promise<Groupable[]> {
  const db = await getDatabase()
  const rows = await db.select<MaintenanceRow[]>(
    `SELECT mr.id AS id, i.name AS itemName, mr.service_date AS serviceDate,
            mr.service_type AS serviceType, mr.performed_by AS performedBy,
            mr.created_at AS createdAt
       FROM inventory_maintenance_records mr
       JOIN inventory_items i ON i.id = mr.item_id
      ORDER BY mr.id`,
  )
  return rows.map((r) => {
    const content = [lower(r.itemName), lower(r.serviceType), lower(r.performedBy)].join('|')
    return {
      id: r.id,
      createdAt: str(r.createdAt),
      entryDate: r.serviceDate,
      contentKey: content,
      exactKey: `${content}|${r.serviceDate}`,
      text: '',
      amountLabel: '',
      label: `${prettyDate(r.serviceDate)} · ${r.itemName} · ${str(r.serviceType) || 'Service'}`,
    }
  })
}

const LOADERS: Record<DedupEntityKey, () => Promise<Groupable[]>> = {
  transactions: loadTransactions,
  inventoryMovements: loadInventoryMovements,
  staffAttendance: loadAttendance,
  incidentReports: loadIncidentReports,
  inventoryMaintenanceRecords: loadMaintenanceRecords,
}

/** Entities that support the free-text blank-shadow / near tiers. Others are
 *  exact-copy only because they have no user-facing free-text field. */
const TEXT_TIER_ENTITIES = new Set<DedupEntityKey>(['transactions', 'inventoryMovements'])

// ─── classification ─────────────────────────────────────────────────────────

/** Keep the earliest-created row in a set; return it. */
function keeperOf(rows: Groupable[]): Groupable {
  return rows.reduce((keep, r) => (r.createdAt <= keep.createdAt ? r : keep), rows[0])
}

function classify(entity: DedupEntityKey, rows: Groupable[]): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = []
  const claimed = new Set<number>() // ids already marked as a duplicate

  // Tier 1 — exact copies: identical in every field.
  const byExact = new Map<string, Groupable[]>()
  for (const r of rows) {
    const arr = byExact.get(r.exactKey)
    if (arr) arr.push(r)
    else byExact.set(r.exactKey, [r])
  }
  for (const group of byExact.values()) {
    if (group.length < 2) continue
    const keep = keeperOf(group)
    for (const r of group) {
      if (r.id === keep.id || claimed.has(r.id)) continue
      claimed.add(r.id)
      out.push({
        entity,
        id: r.id,
        tier: 'exact',
        label: r.label,
        detail: `Identical copy — keeping the one created ${keep.createdAt || 'earlier'}.`,
        createdAt: r.createdAt,
      })
    }
  }

  if (TEXT_TIER_ENTITIES.has(entity)) {
    // Group remaining rows by content key (identity minus text & date).
    const byContent = new Map<string, Groupable[]>()
    for (const r of rows) {
      const arr = byContent.get(r.contentKey)
      if (arr) arr.push(r)
      else byContent.set(r.contentKey, [r])
    }

    for (const group of byContent.values()) {
      if (group.length < 2) continue
      const described = group.filter((r) => r.text !== '')
      const blanks = group.filter((r) => r.text === '')

      // Tier 2 — blank-shadow: a blank row that mirrors a described twin
      // (same content) within the window. Keep the described twin.
      for (const b of blanks) {
        if (claimed.has(b.id)) continue
        const twin = described.find((d) => dayGap(d.entryDate, b.entryDate) <= BLANK_SHADOW_WINDOW_DAYS)
        if (!twin) continue
        claimed.add(b.id)
        out.push({
          entity,
          id: b.id,
          tier: 'blank-shadow',
          label: b.label,
          detail: `Blank entry mirroring "${twin.text}" on ${prettyDate(twin.entryDate)}.`,
          createdAt: b.createdAt,
        })
      }
    }
  }

  return out
}

/**
 * Scan every supported entity for duplicates in the active business.
 * Read-only: returns a plan the caller previews and confirms.
 */
export async function scanForDuplicates(): Promise<DedupPlan> {
  const candidates: DuplicateCandidate[] = []
  const scanned = {} as Record<DedupEntityKey, number>
  for (const entity of Object.keys(LOADERS) as DedupEntityKey[]) {
    const rows = await LOADERS[entity]()
    scanned[entity] = rows.length
    candidates.push(...classify(entity, rows))
  }
  return { candidates, scanned }
}
