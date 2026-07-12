# Sync, Row Counts & Tombstones — Explained

Status: **Reference** · Last updated: 2026-07-12 · Business analysed: **Laundry**

This doc explains how multi-device sync works, exactly what gets uploaded to
Supabase, what "tombstones" are, and reconciles a specific question:
**why the initial sync produced ~26k rows in Supabase when the real dataset is
~14.6k.** All numbers below were measured directly against the live Laundry
database (`business-ledger.db`) on 2026-07-12.

---

## TL;DR

| Question | Answer |
|---|---|
| Real business data in the DB | **14,649 live rows** (this is what *should* sync) |
| Rows seen in Supabase after initial sync | **26,869** |
| The difference (26,869 − 14,649) | **12,220 tombstones** — deletion markers, not data |
| Total deletion markers logged locally | **79,054**, all from **today** |
| Any actual data lost? | **No.** 0 collisions — no live row is marked deleted |
| Cause of the extra rows | A backup was **re-imported 5–6 times today**; each import deletes-and-replaces every row, and each delete is logged as a tombstone |

---

## 1. How sync works

- **Backend:** Supabase (Postgres). The app talks to it with a public anon key,
  no login. Isolation is by a `business_id` tag on every row.
- **Not realtime.** Sync runs on app open and when you press **Sync now**. It is
  an eventual, row-level merge.
- **One cloud table for everything.** Every local record from every synced table
  is stored as one row in a single `sync_rows` table, keyed by
  `(business_id, table_name, uuid)` with the record's data held as JSON.
- **Cross-device identity = `uuid`.** Local integer IDs collide across devices,
  so every syncable row carries a globally-unique `uuid`. The cloud keys on it;
  foreign keys travel as the parent's uuid and are resolved back to local IDs on
  the receiving device.
- **Conflict rule:** last-write-wins per row, by the record's `updated_at`.
- **Scope is per business.** As of the latest change, a sync touches **only the
  business you're currently viewing** — on Laundry you sync Laundry, on Cleaning
  you sync Cleaning. Each business is seeded/synced while it is open. (Both
  businesses still share the one `sync_rows` table, separated by `business_id`.)

### The push/pull loop

1. **Pull** — fetch cloud rows for this `business_id` changed since the last
   high-water mark; apply them locally by `uuid` (newer `updated_at` wins;
   `deleted_at` set → remove locally).
2. **Push** — upload local rows that changed since last sync (plus any pending
   tombstones) to `sync_rows`.
3. Advance the high-water mark.

**First sync (primary/source device):** push-only bootstrap — it uploads its
full dataset to the empty cloud, then pulls anything new.

### Progress toast

A persistent toast in the bottom-right shows live progress during any sync
(preparing → uploading/downloading → applying), tagged with the business name,
e.g. `Laundry · Uploading 8,500 / 14,649 (58%)`. It clears when the sync ends.

---

## 2. What gets synced

A table participates in sync **iff it has a `uuid` column** (added by migration
v27). That is exactly these **30 tables**:

`users`, `roles`, `permissions`, `role_permissions`, `user_roles`,
`transaction_types`, `categories`, `transactions`, `transaction_line_items`,
`income_share_rules`, `income_share_monthly_versions`, `income_share_snapshots`,
`incident_reports`, `inventory_categories`, `inventory_items`,
`inventory_item_units`, `inventory_movements`, `inventory_maintenance_records`,
`customers`, `staff`, `staff_attendance`, `staff_payrolls`,
`staff_payroll_items`, `staff_payroll_adjustments`, `staff_cash_advances`,
`staff_recurring_adjustments`, `transaction_templates`,
`transaction_template_items`, `payroll_settings`, `loyalty_settings`.

Notes:
- **Each row is uploaded individually** — including child rows like
  `transaction_line_items` and `staff_payroll_items`. They are *not* bundled into
  their parent, so they each count as their own row in `sync_rows`.
- **Every live row has a `uuid`** (backfilled by the migration; a trigger stamps
  one on every new insert), so nothing is skipped. Verified: **0 rows with a
  NULL uuid**, so no data is silently dropped on push.
- `app_state` is intentionally **not** synced (device-local).

---

## 3. What a "tombstone" is

Deletes must propagate across devices — otherwise a row deleted on one device
would be resurrected by the next sync. To handle that, every synced table has an
`AFTER DELETE` trigger that logs the removed row's uuid into a local
`sync_tombstones` table:

```sql
CREATE TRIGGER trg_inventory_movements_tomb
AFTER DELETE ON inventory_movements
FOR EACH ROW WHEN OLD.uuid IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO sync_tombstones (table_name, row_uuid)
  VALUES ('inventory_movements', OLD.uuid);
END;
```

On the next push, each pending tombstone is uploaded to `sync_rows` as a row
with `deleted_at` set. Other devices see it and remove their local copy.

**So "deleted" is not a judgment about your content — it literally means a
`DELETE` statement ran on that row and SQLite logged it.**

---

## 4. Why the initial sync showed ~26k rows

Measured cloud total for Laundry: **26,869**. It breaks down as:

```
Cloud total (business_id = 'laundry'):   26,869
  − live data (deleted_at IS NULL):      14,649   ← your real records
  = tombstones (deleted_at set):         12,220   ← deletion markers, not data
```

### Where 79,054 tombstones came from

All 79,054 tombstones are timestamped **today (2026-07-12)** — this is not
lifetime history. They arrived in a handful of bulk bursts:

| Time  | Rows deleted | Tables |
|-------|-------------:|-------:|
| 00:13 |        6,164 |     15 |
| 00:24 |       14,576 |     15 |
| 00:29 |            4 |      1 |
| 00:35 |       14,576 |     15 |
| 10:18 |       14,578 |     15 |
| 10:35 |       14,578 |     15 |
| 10:47 |       14,578 |     15 |
| **Total** | **79,054** |    |

Each burst deleted **~14,578 rows** — essentially the *entire* dataset — across
15 tables, repeated 5–6 times. That is the signature of a **full backup
import/restore**: the import path deletes every row and re-inserts fresh ones,
and each import mints **new random uuids**, so each cycle's deleted uuids are
distinct and pile up. `6,164 + 14,576 + 4 + 14,576 + 14,578 + 14,578 + 14,578 =
79,054`.

~12,220 of those tombstones had been pushed to the cloud, which is exactly the
gap between 14,649 and 26,869.

### Tombstones by table

| Table | Tombstones |
|---|---:|
| inventory_movements | 53,082 |
| transactions | 12,648 |
| transaction_line_items | 7,464 |
| customers | 1,772 |
| staff_attendance | 1,536 |
| staff_payroll_items | 1,191 |
| staff_payrolls | 323 |
| staff_cash_advances | 244 |
| staff_payroll_adjustments | 183 |
| inventory_items | 176 |
| income_share_monthly_versions | 164 |
| categories | 124 |
| transaction_template_items | 78 |
| staff | 51 |
| transaction_templates | 18 |

### Was any real data lost?

**No.** A check for live rows whose uuid also appears as a tombstone returned
**0 collisions** across every table. The tombstones all reference *old,
replaced* copies; none of them touch a record you currently have. Your live
dataset is intact and safe to sync.

---

## 5. Current total that should sync (live rows)

The authoritative "expected rows in Supabase for Laundry" = **14,649**, broken
down per table:

| Table | Rows |
|---|---:|
| inventory_movements | 9,889 |
| transactions | 2,306 |
| transaction_line_items | 1,354 |
| customers | 315 |
| staff_attendance | 268 |
| staff_payroll_items | 208 |
| staff_payrolls | 56 |
| staff_cash_advances | 43 |
| categories | 39 |
| staff_payroll_adjustments | 33 |
| inventory_items | 31 |
| income_share_monthly_versions | 28 |
| role_permissions | 22 |
| transaction_template_items | 13 |
| permissions | 12 |
| staff | 9 |
| inventory_categories | 6 |
| income_share_rules | 4 |
| roles | 3 |
| transaction_types | 3 |
| transaction_templates | 3 |
| users | 1 |
| user_roles | 1 |
| payroll_settings | 1 |
| loyalty_settings | 1 |
| **TOTAL** | **14,649** |

> Tables with 0 live rows (no line above): `income_share_snapshots`,
> `incident_reports`, `inventory_item_units`, `inventory_maintenance_records`,
> `staff_recurring_adjustments`.

**A clean initial sync should therefore produce 14,649 live rows in Supabase for
Laundry** (plus whatever Cleaning holds, since both share `sync_rows`).

---

## 6. Recommended cleanup & fixes

1. **Clean slate** (still in setup, no secondary consuming data yet):
   - Purge the local `sync_tombstones` (all reference dead uuids — safe on the
     source device).
   - Wipe the cloud `sync_rows` table.
   - Re-seed live-only → cloud lands at a clean **14,649**.
2. **Prevent recurrence (code):**
   - Skip tombstones on the primary's **initial seed** — an empty cloud has no
     prior rows to delete.
   - **Suppress tombstone generation during backup import** (disable the triggers
     for the import transaction, or clear the tombstones an import creates), so
     restoring a backup is never again mistaken for a mass deletion.
3. **Ongoing hygiene:** consider periodically purging old tombstones, and review
   whether `inventory_movements` really needs delete-and-recreate churn (it
   dominates the tombstone volume).

### Handy verification queries

Local SQLite (per business DB):
```sql
-- expected live rows for this business (sum this across the 30 tables)
SELECT COUNT(*) FROM <table> WHERE uuid IS NOT NULL;
```

Supabase:
```sql
-- live vs. tombstone split
select (deleted_at is null) as live, count(*)
from sync_rows where business_id = 'laundry' group by live;
```
The `live = true` count must equal the local live sum (14,649). If it does,
nothing was missed.
