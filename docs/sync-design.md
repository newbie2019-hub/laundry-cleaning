# Multi-Device Sync — Design Doc

Status: **Draft for review** · Owner: Yvan · Last updated: 2026-07-11

## Goal

Let multiple devices share the same business data. **Not** realtime — an
eventual, row-level sync that runs when the app opens and when the user taps a
"Sync now" button. Small data volumes. **No existing on-device data may be lost
by this change.**

### Decisions already made

| Question | Decision |
|---|---|
| Backend | **Supabase** (Postgres + Auth + RLS, generous free tier, relational fit) |
| Conflict model | **Last-write-wins per row** (workload is mostly *adding* new rows, rarely co-editing the same row) |
| Sync trigger | **Auto on app open + manual "Sync now" button** |
| Auth | **None — public anon key baked into the app**, no login. Isolation by `business_id`. Data protection is key-obscurity only (accepted for private use). |
| Scope | **Both** databases (Laundry + Cleaning), kept isolated |
| Foreign keys | **Bundle tightly-owned children with their parent** as one sync unit |
| Accounts | **Sync** users / roles / user_roles / role_permissions across devices |
| First merge | **One device is the seed** (primary); others bootstrap from it |

---

## Current architecture (what we're building on)

- Tauri desktop app, **SQLite** via `@tauri-apps/plugin-sql`.
- **Two separate databases**: `sqlite:business-ledger.db` (Laundry) and
  `sqlite:business-ledger-cleaning.db` (Cleaning). Identical schema, registered
  as two migration sets in [`src-tauri/src/db.rs`](../src-tauri/src/db.rs).
- Schema at migration **v26**. Integer `AUTOINCREMENT` primary keys everywhere.
- Most top-level tables already carry `created_at` / `updated_at`.
- Deletes are **hard deletes** today (e.g. `DELETE FROM transactions ...`).

### Three properties of the current schema that block sync

1. **Integer auto-increment IDs collide across devices.** Two offline devices
   both mint `transactions.id = 843` for two *different* real transactions.
   On merge they clash. → We need a **globally-unique `uuid`** per syncable row;
   integer IDs remain only for fast local joins.
2. **Hard deletes cannot propagate.** A gone row is indistinguishable from a
   never-existed row, so deletes either fail to sync or get resurrected. →
   Switch syncable tables to **soft delete** (`deleted_at` tombstone).
3. **Uneven change tracking.** Top-level tables have `updated_at` (good — this
   is how a device knows "what changed since last sync"); several child tables
   don't. → Children are **bundled with their parent** (see below), so they
   inherit the parent's change signal.

---

## Core design

### 1. Identity: `uuid` is the cross-device key

Every syncable row gets a `uuid TEXT` column, `UNIQUE`. The **cloud keys on
`uuid`**; all cloud foreign keys reference uuids, never integers. On pull, each
device resolves `uuid → its own local integer id` to stitch relationships.

#### The seed-data trap (important)

Seeded rows (default roles, permissions, the starter categories, income-share
rules) exist identically on **every** device because the migrations create them.
If we backfill them with *random* uuids independently per device, the same
logical "admin" role gets uuid `X` on one device and `Y` on another → sync sees
two rows → **duplicates**.

**Rule:** seed rows get a **deterministic uuid derived from their natural key**
(e.g. `uuidv5(namespace, business_id + 'roles' + 'admin')`), computed the same
way on every device. User-created rows get **random** uuids. Result: seeds
dedupe automatically; user rows sync normally.

### 2. Tenancy: one project, `business_id` discriminator

Both businesses live in one Supabase project. Every cloud table has
`business_id TEXT` (`'laundry'` | `'cleaning'`). The two local DBs each sync
only their own `business_id`.

**No cloud login.** The app ships with the project's **public anon key**
embedded and talks to Supabase directly with it — sync works the instant the app
is installed, with no sign-in. (This is separate from the app's existing in-app
*staff* login, which is unchanged.)

**Security model — be clear-eyed:** the anon key lives inside the shipped app,
so it is effectively public. Keep **RLS enabled** with explicit policies that
grant the `anon` role `select/insert/update` on the syncable tables (not full
`service_role` power), so access is at least scoped to those tables. But anyone
who extracts the key + project URL from the installer can reach the data. This
is an accepted tradeoff for private, low-sensitivity, own-device distribution.
If sensitivity rises later, switch to the "baked-in silent login" variant (a
real account authenticated in the background) without changing the sync logic.

### 3. Deletes: tombstones

`deleted_at TEXT NULL` on every syncable table. App delete paths set it instead
of removing the row. Reads add `WHERE deleted_at IS NULL`. A tombstone syncs
like any other change; other devices soft-delete on pull. (We can hard-purge
tombstones older than N months later, out of scope for v1.)

### 4. Bundling: the sync unit is the aggregate

Tightly-owned children travel **with their parent** as one JSON bundle, so we
never have to worry about a child arriving before its parent or FK-ordering
across the wire:

| Parent (sync unit) | Bundled children |
|---|---|
| `transactions` | `transaction_line_items`, transaction-linked `inventory_movements` |
| `staff_payrolls` | `staff_payroll_items`, `staff_payroll_adjustments` |
| `transaction_templates` | `transaction_template_items` |
| `inventory_items` | `inventory_item_units` |

Standalone `inventory_movements` (manual stock in/out with no `transaction_id`)
sync as their own top-level unit.

### 5. Sync algorithm (per business, on open + button)

Runs against a Supabase clock as the time authority (avoids device-clock skew,
which LWW is sensitive to):

1. **Pull** — for each synced table/aggregate:
   `SELECT * FROM <cloud> WHERE business_id = ? AND updated_at > last_synced_at`.
   Upsert locally by `uuid`; if the incoming row's `updated_at` is newer, it
   wins; `deleted_at` set → soft-delete locally. Resolve FK uuids → local ids.
2. **Push** — local rows with `updated_at > last_synced_at` (and `dirty`)
   → upsert to cloud by `uuid`.
3. Advance `last_synced_at` to the server timestamp returned by the push.

A small local `sync_state` table tracks `last_synced_at` per (business, table)
and this device's id. A `dirty` flag (or "updated_at > last_synced_at") marks
rows needing push.

---

## Per-table sync classification

Legend — **Sync**: replicated. **Seed-only**: created identically by migrations,
never synced. **Local-only**: never leaves the device. **Child**: bundled with
its parent, not synced independently.

| Table | Class | Notes |
|---|---|---|
| `users` | Sync | Business's own accounts (incl. `password_hash`). |
| `roles` | Sync (seed = deterministic uuid) | Seeded roles dedupe; custom roles sync. |
| `permissions` | Seed-only | Fixed seed, identical everywhere. |
| `role_permissions` | Sync | The editable permission matrix. |
| `user_roles` | Sync | Assignments. |
| `transaction_types` | Sync (seed = deterministic uuid) | User can add custom types. |
| `categories` | Sync (seed = deterministic uuid) | Seeded + user-created. |
| `transactions` | **Sync (parent)** | Bundles line items + linked movements. |
| `transaction_line_items` | Child | With `transactions`. |
| `inventory_items` | **Sync (parent)** | Bundles `inventory_item_units`. |
| `inventory_item_units` | Child | With `inventory_items`. |
| `inventory_movements` | Sync | Bundled if `transaction_id` set, else top-level. |
| `inventory_categories` | Sync (seed = deterministic uuid) | Seeded + user-created. |
| `inventory_maintenance_records` | Sync | FK → inventory_items by uuid. |
| `customers` | Sync | Good first vertical slice — small, few FKs. |
| `staff` | Sync | |
| `staff_attendance` | Sync | FK → staff by uuid. |
| `staff_payrolls` | **Sync (parent)** | Bundles items + adjustments. |
| `staff_payroll_items` | Child | With `staff_payrolls`. |
| `staff_payroll_adjustments` | Child | With `staff_payrolls`. |
| `staff_cash_advances` | Sync | FK → staff, transaction, payroll by uuid. |
| `staff_recurring_adjustments` | Sync | FK → staff by uuid. |
| `transaction_templates` | **Sync (parent)** | Bundles template items. |
| `transaction_template_items` | Child | With `transaction_templates`. |
| `incident_reports` | Sync | |
| `income_share_rules` | Sync (seed = deterministic uuid) | Seeded + user edits. |
| `income_share_monthly_versions` | Sync | Per-month overrides. |
| `income_share_snapshots` | Sync | Historical allocations. |
| `payroll_settings` | Sync (singleton) | LWW on the `id=1` row. |
| `loyalty_settings` | Sync (singleton) | LWW on the `id=1` row. |
| `app_state` | Local-only | `demo_seeded` is device-local. |

> **Decided:** accounts (`users`, `roles`, `user_roles`, `role_permissions`)
> **do** sync, so a login created on one device works everywhere. Password
> hashes are part of the business's own data and travel with the row.

---

## Accepted tradeoff (LWW)

If two devices edit the **same existing row** while both offline, the later
`updated_at` wins and the earlier edit is silently dropped. Given the confirmed
"mostly add new records" workload this is acceptable for v1. If co-editing later
becomes common we can add field-level merge or conflict flagging without
redoing the foundation.

---

## Migration & data-safety plan

The first migration is **additive and invisible to users** — it must be safe to
ship on its own, before any cloud code exists.

**Migration v27 — `add_sync_metadata`:**
1. `ALTER TABLE ... ADD COLUMN uuid TEXT` on every syncable table.
2. `ALTER TABLE ... ADD COLUMN deleted_at TEXT` on every syncable table.
3. Backfill `uuid` for **all existing rows**:
   - Seed rows → deterministic uuid from natural key.
   - Everything else → random uuid.
4. Add `UNIQUE` index on `uuid` per table (after backfill, so it can't fail).
5. Create `sync_state` bookkeeping table.

No `DELETE`, no `DROP`, no data rewrite → existing data is preserved and simply
becomes "the first payload uploaded on first sync."

Application-code follow-ups (can land alongside or just after v27):
- Convert delete paths (`deleteTransaction`, `archiveCustomer` is already soft,
  etc.) to set `deleted_at`.
- Add `WHERE deleted_at IS NULL` to read queries.
- Stamp `uuid` on every new row at insert time.

---

## First-sync bootstrap (primary-device model)

Because the first merge uses **one device as the seed**, the very first sync is
special and must still honor "no data lost":

1. The user **designates the primary device** (the one holding the real data).
2. **Primary's first sync = push-only**: it uploads its full dataset to the
   empty cloud. Nothing is pulled or discarded.
3. **Each secondary device's first sync = bootstrap**:
   - First, **export a full local backup** of that device's SQLite file (a
     safety net, so even discarded rows are recoverable — this is how we keep
     the "no data loss" guarantee for secondaries).
   - Then clear its operational data and **pull the primary's dataset** so it
     starts from the shared source of truth.
4. After bootstrap, every device switches to the **normal incremental** pull/push
   loop described above and stays equal peers from then on.

A `sync_state` flag records whether a device has completed bootstrap, so this
only happens once per device.

## Phasing

1. **v27 migration** — add `uuid` + `deleted_at`, backfill, `sync_state`. Ship
   solo; de-risks everything. (User-invisible.)
2. **Soft-delete conversion** — flip delete paths + read filters.
3. **Supabase setup** — project, one shared login per business, RLS, cloud
   schema for `customers`.
4. **Vertical slice** — sync `customers` end-to-end (pull + push + LWW). Prove
   the loop.
5. **Roll out** — remaining tables in dependency order (master data → top-level
   → bundled aggregates).
6. **UX** — "Sync now" button, sync-on-open, "last synced Xm ago" indicator,
   error/offline handling.

---

## Open questions before implementation

1. **Supabase free-tier project pausing** — free projects pause after ~1 week of
   inactivity. For a low-traffic business this can bite; worth confirming a
   device opens often enough, or planning the paid tier ($25/mo) eventually.
2. **Attendance uniqueness.** `staff_attendance` has `UNIQUE(staff_id,
   attendance_date)`. Two devices adding attendance for the same staff/day
   offline will collide on pull. Resolution: LWW by `updated_at`, keeping one.
   Confirm that's acceptable (vs. summing/merging).
