# Backup Import — Known Issues & Analysis

> Last updated: 2026-06-18  
> Covers: `src/features/backup/backup-import.ts`, `backup-export.ts`, `backup-types.ts`, `src/lib/db/repository.ts`

---

## How the Import Works (Quick Summary)

The backup format is a single **JSON file** containing all business data.  
Every row gets a **SHA-256 fingerprint** based on its natural keys (names, dates, amounts — never raw DB ids).  
On import, the planner compares each row in the file against the local DB snapshot and buckets it into one of:

| Bucket | Meaning |
|--------|---------|
| `insert` | No local match → will be inserted |
| `skipIdentical` | Exact match locally → nothing to do |
| `update` (conflict) | Same fingerprint, but fields differ → user picks Skip or Overwrite |
| `orphan` | Parent reference missing in both file and local DB → skipped |
| `invalid` | Failed schema validation → never applied |

Nothing is written to the DB until the user confirms.  
Apply order is always parents before children (e.g. inventory items before movements).

---

## What Was Already Fixed

### ✅ `transaction_id` not restored on imported movements (fixed 2026-06-18)

**Problem:**  
When saving a transaction normally, inventory OUT movements are created with `transaction_id` linked back to the parent transaction. On import, movements were inserted with `transaction_id = NULL`, breaking:
- The **"Ledger"** column on the Stock Movements page (showed `—` instead of a link)
- The **Inventory Movements** section on the Transaction Detail page (showed empty)
- Any future sync logic that relies on that link

**Fix applied:**
- `backup-export.ts` — SQL for `inventory_movements` now includes `m.transaction_id`. A `Map<dbId, fingerprint>` is built from the transactions array so each exported movement carries a `transactionRef` (the parent transaction's fingerprint, not its raw DB id).
- `backup-types.ts` — `ExportInventoryMovement` gets an optional `transactionRef?: string | null` field (optional for backwards compat with old backup files).
- `backup-import.ts` — After all transactions are applied, a `txFingerprintToLocalId` map is built by calling `findTransactionByIdentity()` for each transaction in the file. When a movement is inserted, `transaction_id` is correctly resolved to the **local** device's id.

```
Export side:  movement.transactionRef = transactionFingerprintMap.get(movement.transaction_id)
Import side:  movement.transaction_id = txFingerprintToLocalId.get(movement.transactionRef)
```

---

## Remaining Issues

### 🔴 Issue 1 — Editing an imported transaction still double-deducts inventory (Critical)

**When it bites:** Any time a transaction is edited after being imported from another device.

**Root cause:**  
`transaction_id` is now correctly linked, but `line_item_id` and `template_id` are still `NULL` on imported movements.

`saveTransaction()` cleans up old movements in two ways:

1. **Template movements** — deleted by:
   ```sql
   DELETE FROM inventory_movements WHERE transaction_id = $1 AND template_id IS NOT NULL
   ```
   Imported movements have `template_id = NULL` → **this DELETE skips them**.

2. **Line-item movements** — deleted via `ON DELETE CASCADE` on `transaction_line_items`:
   ```sql
   -- schema (db.rs v19):
   ALTER TABLE inventory_movements ADD COLUMN line_item_id INTEGER
     REFERENCES transaction_line_items(id) ON DELETE CASCADE;
   ```
   Imported movements have `line_item_id = NULL` → **the CASCADE doesn't touch them**.

In both cases the old unlinked movement survives, then a new correctly-linked movement is created → **stock is deducted twice**.

**Suggested fix:**  
In `saveTransaction()` (`repository.ts`), before the line items are deleted/recreated, add a cleanup of "import-orphaned" movements:
```sql
DELETE FROM inventory_movements
WHERE transaction_id = $1
  AND line_item_id IS NULL
  AND template_id IS NULL
```
> ⚠️ Caveat: movements manually added from the Transaction Detail page also have `line_item_id = NULL, template_id = NULL`. Deleting them here would remove those too. A `source` or `is_auto_generated` column would be needed to distinguish them.

---

### 🔴 Issue 2 — Description case sensitivity = duplicate transactions + double deduction (High)

**When it bites:** Two devices record the same transaction but with different capitalisation (e.g. `"Normal wash"` vs `"normal wash"`).

**Root cause:**  
The transaction fingerprint trims the description but does **not** lowercase it:
```typescript
// backup-export.ts
asString(r.description).trim(),   // ← trimmed but NOT lowercased
```
So `"Normal wash"` and `"normal wash"` produce different fingerprints → **both are inserted** on Device C → duplicate transaction + duplicate OUT movements.

**Suggested fix:**  
Change to `lower(r.description)` (same pattern already used for `categoryLabel` and `customerRef.name`).  
> ⚠️ Bumping `BACKUP_FORMAT_VERSION` is required so old backup files (with the old fingerprints) are still recognised and handled gracefully instead of showing all transactions as new inserts.

---

### 🟠 Issue 3 — Movement fingerprint collision causes silent data loss (High)

**When it bites:** Multiple identical sales of the same item at the same price on the same day with the same notes (common in a laundry/cleaning context).

**Root cause:**  
Movement fingerprint is based on `(item name, date, type, quantity, unit cost, notes)`. If Device A records 2 such movements and Device B records 3, after merging into Device C:
- Import A → C has 2 movements ✓
- Import B → the planner's `localIndex` is a `Map<fingerprint, row>` — only **one entry** per fingerprint. All 3 from B hit `skipIdentical` against the single local entry → none inserted → **C ends up with 2 instead of 3** (one movement is silently dropped).

**Suggested fix:**  
Change the dedup strategy for movements to **count-based**: instead of checking existence, check that the local count of matching fingerprints ≥ incoming count. Insert the difference.

---

### 🟠 Issue 4 — Overwriting a conflict does not sync inventory (High)

**When it bites:** A transaction exists on both devices but has different line items (shows as a `conflict`). User chooses **Overwrite**.

**Root cause:**  
`updateTransactionWithLineItems()` in `backup-import.ts` updates `staff_count` and replaces line items, but does **not** call `syncSaleTemplateMovementsForTransaction` or create new OUT movements for the updated line items. The inventory stock is left in whatever state it was in before the import.

**Suggested fix:**  
After `updateTransactionWithLineItems()`, call the same movement-sync logic that `saveTransaction()` uses, using the updated line items.

---

### 🟡 Issue 5 — Phone number format = duplicate customers (Medium)

**When it bites:** One device stored `+63917...` and another stored `0917...` for the same customer.

**Root cause:**  
Customer identity is `LOWER(TRIM(name)) + TRIM(phone)`. Phone is only trimmed, not normalised. Different formats = two separate customer records, splitting their transaction history and loyalty points.

**Suggested fix:**  
Normalise phone numbers in the fingerprint (e.g. strip all non-digit characters, or consistently apply a country-code prefix rule).

---

### 🟡 Issue 6 — Import is not atomic (Medium)

**When it bites:** A crash, power cut, or unexpected error mid-import.

**Root cause:**  
The Tauri SQL plugin uses a connection pool and **cannot** span `BEGIN/COMMIT` across multiple `execute()` calls. Each row is applied independently. A failure after row 200 of 500 leaves the DB in a half-imported state with no rollback path.

**Current mitigation:**  
Per-row errors are collected into the summary (not thrown), and FK checks are disabled during apply. But there is no cleanup of already-applied rows on failure.

**Suggested fix:**  
Write all rows to a staging table first, then do a single SQL `INSERT … SELECT` from staging to live tables under one transaction. This is a significant refactor.

---

### 🟡 Issue 7 — Old backup files still produce unlinked movements (Low)

**When it bites:** Importing a backup file that was exported before the 2026-06-18 fix.

**Root cause:**  
Old backup files do not have `transactionRef` on their `inventoryMovements` rows. The importer treats a missing `transactionRef` as `null` → movements are inserted with `transaction_id = NULL` (the old broken behaviour).

**Workaround:**  
Re-export from the source device using the updated app version, then import the new file.

---

## Multi-Device Merge Cheat Sheet (Device A + Device B → Device C)

| Scenario | Transactions | Inventory Stock | Notes |
|----------|-------------|-----------------|-------|
| Devices have **completely different** data | Both sets inserted ✓ | Both sets of movements inserted, stock correct ✓ | Cleanest case |
| Devices recorded the **exact same** transaction (all fields match) | Deduplicated, 1 copy ✓ | Movement deduplicated, no double deduction ✓ | |
| Same transaction but **description differs in capitalisation** | **Both insert → duplicate** ⚠️ | **Double deduction** ⚠️ | Issue 2 |
| Same transaction but **other fields differ** (conflict) | User picks Skip or Overwrite | Overwrite: line items update but movements **not** synced ⚠️ | Issue 4 |
| Import succeeds, then **edit an imported transaction** in Device C | Updates fine | **Double deduction** (unlinked old movement survives) ⚠️ | Issue 1 |
| Re-importing the **exact same backup** twice | All `skipIdentical`, safe ✓ | All `skipIdentical`, no double deduction ✓ | |

---

## File Map

| File | Role |
|------|------|
| `src/features/backup/backup-export.ts` | Builds the backup JSON, fingerprints every row, denormalises FK ids to natural keys |
| `src/features/backup/backup-import.ts` | Validates, dry-run plans, and applies the import |
| `src/features/backup/backup-types.ts` | Shared types for export/import/planner |
| `src/features/backup/backup-import-dialog.tsx` | 5-step UI wizard (pick → validate → preview → resolve conflicts → summary) |
| `src/lib/db/repository.ts` | `saveTransaction()`, movement sync logic, `findTransactionByIdentity()` |
| `src-tauri/src/db.rs` | SQLite schema migrations |
