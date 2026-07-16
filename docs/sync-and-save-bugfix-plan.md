# Sync & Save Bug — Diagnosis and Fix Plan

> **Status:** Diagnosed, not yet implemented. This document is a self-contained
> handoff. Everything needed to implement the fixes is here — file paths, line
> numbers, root causes, reproduction, and the exact changes.
>
> **App:** Tauri + React + SQLite (via `tauri-plugin-sql`, sqlx pool) with a
> Supabase-backed offline sync layer. Two business databases: `laundry` and
> `cleaning`.

---

## TL;DR

There are **two separate, unrelated bugs**:

1. **Bug 1 — A secondary (cloned) device cannot save transactions** ("Unable to
   save transaction."). Root cause: after the "Copy the data (Secondary)" setup
   wipes and re-pulls, the logged-in user's local integer `id` changes, but the
   in-memory/localStorage session still holds the **old** id. New rows are
   written with `created_by = <stale id>`, which is a dangling foreign key.

2. **Bug 2 — Transactions multiply (x2, x3 … July went from ~80k to 1M+).** Root
   cause: the JSON importer inserts rows **without a stable `uuid`**, so the
   uuid-autogen trigger gives every imported row a fresh **random** uuid. Sync
   reconciles **only by uuid**, never by content. So the same logical
   transaction can exist under multiple uuids across the fleet, and sync treats
   each as a distinct row and re-inserts it. It compounds every sync/import.

Neither is a reporting/aggregation bug — every `SUM(transactions.amount)` query
was audited and none fans out via a JOIN. The inflated totals are **real
duplicate rows**.

---

## How the system works (context you need)

- Every syncable table has a `uuid TEXT` column with a **unique index**
  (`idx_<table>_uuid`). Sync keys entirely on `uuid`. The local integer `id`
  primary keys are **per-device** and are never shipped across devices.
  - Schema, triggers, and the sync-table list live in
    `src-tauri/src/db.rs`.
- Three triggers per syncable table (`src-tauri/src/db.rs`):
  - `trg_<table>_uuid_ins` — `AFTER INSERT ... WHEN NEW.uuid IS NULL` assigns a
    **random** uuid (`lower(hex(randomblob(16)))`). (`db.rs:171`)
  - `trg_<table>_touch` — bumps `updated_at` on edits. (`db.rs:179`)
  - `trg_<table>_tomb` — writes a row to `sync_tombstones` on delete. (`db.rs:184`)
- **Seed/master rows** get *deterministic* content-derived uuids
  (e.g. `seed:user:admin`, `seed:txtype:SALE`) so they converge across devices
  (`db.rs:135-145`). **Operational rows** (transactions, movements, etc.) get
  random uuids (`db.rs:148-156`).
- Sync engine: `src/lib/sync/engine.ts`
  - `push()` (line ~131): uploads dirty rows (`updated_at > synced_at`). FK
    columns are shipped as the parent row's **uuid** in a `refs` map; the local
    integer id never travels (`buildPayload`, line ~90; `payloadColumns`
    excludes `id`, `uuid`, `synced_at`, `current_stock`).
  - `pull()` (line ~399) + `applyCloudRows()` + `applyOneRow()` (line ~329):
    applies remote rows with `INSERT ... ON CONFLICT(uuid) DO UPDATE`. FK uuids
    are resolved back to local ids. **A remote row whose uuid is not found
    locally is always INSERTed as a brand-new row.** This is the only place a
    duplicate can be created — and it only happens on a uuid miss.
  - `runBootstrap()` (line ~459): primary = push-all then pull; secondary =
    backup, **wipe local data**, then pull (adopt the cloud dataset).
  - `forceFullResync()` (line ~502): mark everything dirty + rewind pull
    high-water, then sync.
- Top-level orchestration: `src/lib/sync/index.ts` (`runSync`, `runSyncOnStartup`).
  Sync is scoped to the **active** business only.
- Sync state (per-business key/value): `src/lib/sync/state.ts`
  (`role`, `bootstrapped`, `last_pulled_at`, `reset_pending`, …).
- JSON import: `src/features/backup/backup-import.ts`. Export:
  `src/features/backup/backup-export.ts`.
- Auth/session: `src/features/auth/auth-provider.tsx`,
  `src/features/auth/auth-service.ts`.
- DB connection + pragmas: `src/lib/db/client.ts`.
- Duplicate-cleanup tool (already in the working tree, WIP):
  `src/features/maintenance/` + `deleteDuplicateRecords` in
  `src/lib/db/repository.ts`.

**Golden rule to remember:** `applyOneRow` can only ever *insert* a duplicate
when an incoming `uuid` is absent locally. If a logical row always kept ONE
uuid fleet-wide, duplication would be impossible. Every fix below serves that
invariant.

---

## Bug 1 — Secondary device: "Unable to save transaction."

### Symptom
On a device set up via **Settings → Device sync → "Copy the data (Secondary)"**,
saving a NEW transaction fails with **"Unable to save transaction."** The same
account (admin) saves fine on the source/primary device.

### Why the message is the *generic* one
`src/features/transactions/pages/transactions-page.tsx:1327-1328`:
```ts
} catch (submitError: unknown) {
  setError(submitError instanceof Error ? submitError.message : 'Unable to save transaction.')
}
```
`tauri-plugin-sql` rejects SQL failures as **plain strings**, not `Error`
instances, so a raw SQLite constraint failure falls through to the generic
message. (A JS guard like `throw new Error('Category not found.')` would show its
own text.) → The failure is a **SQLite-level constraint violation in the
INSERT**, not a JS validation guard, and it is not a permissions problem (admin
short-circuits `hasPermission`).

### Root cause (confirmed)
1. New-transaction INSERT is at
   `src/lib/db/repository.ts:932-963` — `VALUES (..., $11, $11)` where
   `$11 = userId`, used for **both** `created_by` and `updated_by`. `userId`
   comes from `user.id` (`transactions-page.tsx:1321`).
2. The transactions table (`src-tauri/src/db.rs:408-424`) has:
   `FOREIGN KEY (created_by) REFERENCES users (id)` and same for `updated_by`.
3. The secondary bootstrap wipes and re-pulls (`engine.ts:467-484`).
   `wipeLocalData` does `DELETE FROM users` (`engine.ts:420-423`); `pull`
   re-inserts each user via `applyOneRow` with `AUTOINCREMENT` assigning **new**
   local ids. The admin's `uuid` (`seed:user:admin`) is preserved but its
   integer `id` changes.
   - **The id change is guaranteed, not just likely:** `users` has an
     `AFTER DELETE` trigger (`trg_users_tomb`), so `DELETE FROM users` does NOT
     get SQLite's truncate optimization, so `sqlite_sequence` is NOT reset →
     re-inserted rows get ids strictly greater than the old max. The admin can
     never get its old id back. (This also rules out a PK collision.)
4. Nothing re-resolves the session after bootstrap. `user.id` in memory and in
   `localStorage` still holds the OLD id (`auth-provider.tsx:100/113`).
   `refreshSession()` (`auth-provider.tsx:71-75`) looks up by the **stale id**
   (`getUserSession(user.id)`) → returns `null` → keeps the stale user.
5. Saving therefore writes `created_by = <stale id>` → **FK violation**.

### Why it's *intermittent* and why it can silently corrupt
`PRAGMA foreign_keys = ON` is set once per connection in `applyPragmas`
(`src/lib/db/client.ts:117`). Unlike `journal_mode = WAL` (persisted in the DB
header), `foreign_keys` is **per-connection and NOT persisted**. Because
`tauri-plugin-sql` uses an sqlx **connection pool**, only the single pooled
connection that ran `applyPragmas` enforces FKs.
- INSERT on the FK-ON connection → constraint error (what the user sees).
- INSERT on an FK-OFF connection → **succeeds and silently writes a dangling
  `created_by`** (quiet corruption).

The source device never wipes, so its ids never change; `created_by` stays valid.

### Fix (small, root-cause)
**Fix 1a — re-resolve the session by the stable username, not the stale id.**
`src/features/auth/auth-provider.tsx:71-75`, change `refreshSession`:
```ts
async refreshSession() {
  if (!user) return
  const refreshed = await getUserSessionByUsername(user.username)
  if (refreshed) {
    setUser(refreshed)
    window.localStorage.setItem(SESSION_STORAGE_KEY, String(refreshed.id))
  }
},
```
- `getUserSessionByUsername` already exists for exactly this "id differs across
  DBs" case (`auth-service.ts:117-152`) and is already imported.
- This is strictly better than the by-id version, which is also broken after a
  username-independent id change.

**Fix 1b — call `refreshSession()` after a successful secondary bootstrap.**
The role is chosen in `chooseRole` (`src/features/sync/use-sync.ts`) via
`chooseDeviceRole` + `runSync`. After that first sync succeeds for a
`secondary` role, refresh the session so `user.id` matches the new local id.
Two options:
- In `SyncSettingsSection.handleChoose` (`src/features/sync/components/sync-settings-section.tsx`),
  pull `refreshSession` from `useAuth()` and, after `await chooseRole(role)`
  resolves without error and `role === 'secondary'`, `await refreshSession()`.
- OR (cleaner) have `useSync().chooseRole` accept/notify so the auth layer
  refreshes. The component-level call is the smallest change.

**Fix 1c (hardening, separate) — make `foreign_keys` reliable across the pool.**
Right now FK-OFF connections silently write dangling refs. Making FK ON reliable
turns silent corruption into a consistent, catchable error. Options:
- Configure the sqlx pool with an `after_connect` hook that runs
  `PRAGMA foreign_keys = ON` on **every** connection (Rust side, in
  `src-tauri/src/`). This is the correct fix but touches Rust/pool setup.
- Do **Fix 1a/1b first** — with a valid `created_by`, the FK passes regardless of
  the pragma. If you enable pool-wide FK enforcement *before* fixing the stale
  id, every secondary save fails deterministically instead of intermittently.

### Verifying Bug 1
1. Set up a secondary device via "Copy the data (Secondary)". Do NOT re-login.
2. Before fix: creating a transaction fails (intermittently) with "Unable to
   save transaction."
3. After fix: confirm `user.id` equals the current `SELECT id FROM users WHERE
   username='admin'` in the secondary DB, and the save succeeds.

---

## Bug 2 — Transactions multiply (80k → 1M+)

### Symptom
On the **source/primary** device, after importing the JSON backup and clicking
**Sync** several times, transaction rows multiplied (x2, x3 …). July on the
`cleaning` business went from the correct ~80k to 1M+. The user did **not**
re-import and did **not** intentionally cause it via reset — the growth happened
on the source device across repeated syncs. (Other devices "just relied on
sync" for their data.)

### Not a reporting bug
Every transaction-amount aggregation in `src/lib/db/repository.ts` was audited
(`buildKpis`, `buildKpisByRange`, `getDashboardData`, `getDashboardDataByRange`,
`getTransactionsSummary`, `getTopCustomersForMonth`, customer stats,
income-share). **None** joins `transactions` to a one-to-many child inside a
`SUM`; they only join to many-to-one parents (`transaction_types`, `categories`,
`customers`). No JOIN fan-out. The inflated total scales linearly with row count
→ **real duplicate rows.**

### Root cause (confirmed)
Duplication requires the same logical transaction to exist under **multiple
uuids** (the only way `applyOneRow`'s `ON CONFLICT(uuid)` inserts instead of
upserts). Two things combine to produce that:

1. **Import mints new random uuids.**
   `insertTransactionWithLineItems` (`backup-import.ts:2047-2068`) inserts
   `INSERT INTO transactions (entry_date, ...)` with **no `uuid` column**. The
   word `uuid` appears nowhere in `src/features/backup/` (neither export nor
   import). So each imported row's uuid comes from `trg_transactions_uuid_ins`
   (`db.rs:171`) = **random**. The same is true for the other blind-insert
   entities the exporter/importer handle:
   - transactions (`backup-import.ts:2047`)
   - inventory_movements (`backup-import.ts:~1457-1497`)
   - staff_attendance, incident_reports, inventory_maintenance_records
     (search `backup-import.ts` for their `INSERT INTO`)

2. **Import de-dupes only against the LOCAL DB, by a fragile content
   fingerprint — and sync never reconciles by content at all.**
   - The import planner buckets each file row into insert/update/skip by matching
     a content `fingerprint` against a snapshot of the **local** DB
     (`backup-import.ts:563-596`, `loadLocalSnapshot` ~388-427). It has no
     knowledge of what already exists in the **cloud** under a different uuid.
   - The export fingerprint is content-only and fragile:
     `entryDate + typeCode + category + amount + description + customer + kg +
     loads + isLoyaltyReward` (`backup-export.ts:1075-1087`). If a row's content
     diverged on any device (e.g. someone edited a description / added a
     reference number), the fingerprint no longer matches, so import treats it as
     new and INSERTs a fresh-uuid copy. This is exactly what the WIP dedup tool
     documents as its reason to exist (`src/features/maintenance/dedup-scan.ts:4-11`).
   - `applyOneRow` (`engine.ts:353-359`) looks up local rows `WHERE uuid = $1`
     only. No content fallback. A pulled row whose uuid isn't local is always
     inserted, even if an identical-content row already exists under another
     uuid.

### How it compounds on the source device
Because the fleet ends up with the same logical transaction under multiple uuids
(from imports on/across devices, or content divergence), every sync pull that
brings back a uuid the source doesn't have INSERTs another copy. Repeated syncs
keep surfacing not-yet-seen uuids → the source's own table grows. Each
import/sync round can add a full copy (x2, x3 …), reaching 12x+ over enough
cycles.

**Secondary amplifier — Reset + Import + Sync (documented for completeness; not
the user's specific path, but a real trap):**
- `resetAllData` (`repository.ts:8111-8230`) empties the DB, purges tombstones,
  rewinds `last_pulled_at → NULL`, sets `reset_pending = 1`, and resets
  `sqlite_sequence`. Intended next sync is **pull-only** (repopulate from cloud
  without pushing emptiness up) — safe *only if you don't import in between*.
- If you **import between reset and sync**: import inserts all rows with fresh
  random uuids (call them G2). Then sync (`engine.ts:537-549`) pulls first with
  the rewound high-water and re-downloads the **entire** cloud (the original
  rows under uuids G1) — none match locally → all inserted → instant 2x. Push is
  skipped by the reset guard, so G2 stays local & dirty; the *next* sync pushes
  those to the cloud, and all devices pull them.

### Fixes

Implement all four for a durable fix (the user approved "everything incl. sync
heal"). Ordered from most-fundamental to hardening.

**Fix 2a — Make import idempotent: give imported rows deterministic uuids.**
Instead of relying on the random trigger, set the `uuid` explicitly on import,
derived from the stable content fingerprint the exporter already computes.
- In `insertTransactionWithLineItems` (`backup-import.ts:2047`) and the other
  blind-insert entities, add a `uuid` column to the INSERT:
  `INSERT INTO transactions (uuid, entry_date, ...) VALUES ($0, $1, ...)` with
  `$0 = 'txn:' + row.fingerprint` (use a distinct prefix per entity, e.g.
  `mov:`, `att:`, `inc:`, `maint:`).
- Effect: re-import and reset+import become **idempotent**
  (`ON CONFLICT(uuid)` collapses them) and the same logical row converges to one
  uuid across devices going forward.
- **Caveat (why 2a alone is not enough):** rows already in the cloud carry
  *legacy random* uuids (created via the app UI or earlier imports). A
  deterministic import uuid won't match those, so existing duplicates won't
  collapse and a reset_pending pull could still duplicate against legacy rows.
  Fix 2b closes that.

**Fix 2b — Heal diverged uuids in the sync apply path (repairs an already-broken
fleet AND prevents recurrence).**
In `applyOneRow` (`engine.ts:353-359`), when the incoming `uuid` is **not found
locally**, before INSERTing, do a **content-identity** lookup for an existing
local row of the same logical content; if found, **adopt the incoming uuid onto
it** (`UPDATE <table> SET uuid = <incoming>, ... WHERE id = <existing>`) instead
of inserting a new row.
- Reuse the identity logic that already exists:
  - `findTransactionByIdentity` (`repository.ts:~8035-8097`) for transactions.
  - The content-key logic in `src/features/maintenance/dedup-scan.ts` (its
    `contentKey`, ~line 141-149) as the model for other entities.
- This must be **per-entity** (each has a different natural key). Start with
  transactions (highest volume / the reported symptom), then add movements,
  attendance, incidents, maintenance as needed.
- **Convergence caveat:** when two rows collapse to one uuid, last-write-wins by
  `updated_at` decides the surviving content. That's acceptable, but log/skip
  carefully so the adopt path can't create a uuid clash (the target uuid must not
  already exist on another local row — if it does, prefer delete-and-merge or
  skip).
- Note: `dedup-scan.ts` warns its content key deliberately excludes description
  for the "blank-shadow" tier; for the heal, match on
  `entry_date, amount, category_id, customer_id, kg, loads, is_loyalty_reward`
  (and type) — i.e., not description-sensitive — so description edits don't
  defeat it.

**Fix 2c — Guard the reset+import combination (cheap, stops the exponential
trap).**
`reset_pending` assumes "wipe then re-download from cloud" (pull-only).
Importing between reset and sync violates that. Add a one-line guard: **block
JSON import while `reset_pending = 1`** (read `isResetPending` at the import
entry point, e.g. in the import dialog / `backup-import.ts` apply entry, and
refuse with a clear message: "Finish syncing after a reset before importing").

**Fix 2d — Data cleanup for the already-corrupted databases.**
The duplicates already in `laundry` and `cleaning` need removing. Use the WIP
dedup tool (`src/features/maintenance/` + `deleteDuplicateRecords` in
`repository.ts:1259-1300`) — it deletes via the per-entity delete paths so
tombstones are recorded and the removals propagate to other devices on the next
sync. Run it on **both** businesses, on the source device, then sync so the
deletions fan out.
- **Order matters:** deploy Fix 2a/2b/2c FIRST, then clean up. If you clean up
  before fixing the cause, the next import/sync re-duplicates.

### Confirming the duplication on a live DB
```sql
-- Total rows vs distinct logical rows for July (cleaning DB):
SELECT COUNT(*) AS total, COUNT(DISTINCT id) AS distinct_ids
FROM transactions WHERE substr(entry_date,1,7)='2026-07';

-- Per-record multiplier (description-insensitive, to catch diverged copies):
SELECT entry_date, amount, category_id, customer_id, COUNT(*) AS copies
FROM transactions WHERE substr(entry_date,1,7)='2026-07'
GROUP BY entry_date, amount, category_id, customer_id
HAVING copies > 1 ORDER BY copies DESC;
```
If the `copies` values cluster near the observed multiplier (~12), the 80k→1M is
confirmed as pure duplication.

---

## Recommended implementation order

1. **Fix 1a + 1b** (session id) — smallest, unblocks secondary devices. Low risk.
2. **Fix 2a** (deterministic import uuids) — stops the primary duplication source.
3. **Fix 2c** (reset+import guard) — one-line safety net.
4. **Fix 2b** (sync-apply content heal) — durable, repairs existing dupes. Highest
   risk (touches the sync hot path handling financial data) — implement and test
   carefully, per-entity, with a self-check.
5. **Fix 2d** (run the dedup cleanup) — after 1–4 are deployed to the source.
6. **Fix 1c** (pool-wide `foreign_keys = ON`) — hardening, only after 1a/1b.

---

## Testing / verification checklist

- [ ] **Bug 1:** Fresh secondary via "Copy the data (Secondary)"; create a
      transaction without re-login → succeeds. `user.id` matches
      `SELECT id FROM users WHERE username='admin'` in the secondary DB.
- [ ] **Import idempotency:** Import the same JSON twice into the same DB → row
      count unchanged the second time (uuids collide via `ON CONFLICT`).
- [ ] **Cross-device import:** Import on device A, let device B pull → B shows
      the same count as A, no duplicates.
- [ ] **Reset trap:** With `reset_pending = 1`, import is refused (Fix 2c).
- [ ] **Heal:** With a DB that already has content-duplicates under different
      uuids, run a sync round → duplicates collapse to one row each (Fix 2b).
- [ ] **Cleanup:** After running the dedup tool on both businesses and syncing,
      July `cleaning` returns to ~80k across all devices.
- [ ] **No regressions in totals:** dashboard/KPI/monthly totals match the
      de-duplicated row set.
- [ ] `npm run build` / typecheck passes; add the ponytail self-checks noted
      below for the non-trivial logic (uuid derivation, content-heal match).

## Suggested self-checks (keep them minimal)
- A tiny test that `'txn:' + fingerprint` is stable for identical content and
  differs for different content (guards Fix 2a).
- A tiny test for the content-heal matcher: two rows, same natural key, different
  uuid → matcher returns the existing row (guards Fix 2b).

---

## File / line reference index

| Area | File | Lines |
|---|---|---|
| New-transaction INSERT | `src/lib/db/repository.ts` | 932-963 |
| Save error catch (generic msg) | `src/features/transactions/pages/transactions-page.tsx` | 1319-1332 |
| `refreshSession` (stale-id bug) | `src/features/auth/auth-provider.tsx` | 71-75, 100, 113 |
| `getUserSessionByUsername` | `src/features/auth/auth-service.ts` | 117-152 |
| `PRAGMA foreign_keys` (per-conn) | `src/lib/db/client.ts` | 117 |
| transactions schema + FKs | `src-tauri/src/db.rs` | 408-424 |
| uuid triggers / seeding | `src-tauri/src/db.rs` | 135-156, 171, 179, 184 |
| Sync push / buildPayload | `src/lib/sync/engine.ts` | 90-203 |
| Sync pull / applyOneRow | `src/lib/sync/engine.ts` | 329-412 |
| Bootstrap / wipe / reset path | `src/lib/sync/engine.ts` | 459-492, 537-549 |
| Import: transaction insert | `src/features/backup/backup-import.ts` | 2028-2073 |
| Import: local snapshot / dedup | `src/features/backup/backup-import.ts` | 388-427, 563-596 |
| Export fingerprint | `src/features/backup/backup-export.ts` | 1075-1087 |
| Reset all data | `src/lib/db/repository.ts` | 8111-8230 |
| Transaction identity resolver | `src/lib/db/repository.ts` | ~8035-8097 |
| Dedup tool (cleanup) | `src/features/maintenance/dedup-scan.ts`, `src/lib/db/repository.ts` | (whole), 1259-1300 |

> Line numbers are from the working tree at diagnosis time; re-grep if the files
> have since changed (`git blame` / search by the quoted identifiers above).
