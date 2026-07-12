# Sync — Setup & Testing Guide

Everything for the multi-device sync feature is now implemented. This is the
one-page guide to turning it on and testing it. Design details live in
[sync-design.md](./sync-design.md); the plain-language overview is in
[sync-overview.md](./sync-overview.md).

---

## What was built

**Local database (Rust — [src-tauri/src/db.rs](../src-tauri/src/db.rs))**
- Migration **v27** (`add_sync_metadata`), additive and non-destructive: adds
  `uuid`, `updated_at`, `synced_at` to the 30 syncable tables; creates
  `sync_state` and `sync_tombstones`; backfills every existing row (deterministic
  uuids for seed rows, random for the rest); installs per-table triggers
  (uuid-autogen on insert, updated_at bump on update, tombstone on delete).

**Cloud transport (Supabase)**
- A single table `sync_rows` — see [supabase-schema.sql](./supabase-schema.sql).

**Sync engine (TypeScript — [src/lib/sync/](../src/lib/sync/))**
- `config.ts` — Supabase URL + anon key (already filled in with your project).
- `supabase.ts` — the client (no auth session, no realtime).
- `registry.ts` — introspects tables/columns/foreign-keys at runtime and orders
  them parent-before-child. No hardcoded schema.
- `state.ts` — `sync_state` accessors (device id, role, high-water marks).
- `engine.ts` — pull (apply cloud changes, resolve FK uuids, last-write-wins),
  push (dirty rows + tombstones), and first-sync bootstrap (primary/secondary).
- `index.ts` — public API: `runSync`, `runSyncOnStartup`, `chooseDeviceRole`,
  `getSyncOverview`.

**UI ([src/features/sync/](../src/features/sync/))**
- A sync widget in the sidebar (last-synced + "Sync now"), a first-run setup
  dialog (primary vs. secondary), and auto-sync ~1.5s after the app opens.

---

## One-time setup (do this once, ever)

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of [supabase-schema.sql](./supabase-schema.sql) and
   click **Run**. It creates the `sync_rows` table, the server-clock trigger, and
   the anon RLS policies. (Safe to re-run.)
3. That's it — the app already ships with your project URL and anon key baked in
   ([src/lib/sync/config.ts](../src/lib/sync/config.ts)). No login to create.

> If you ever rotate the key or use a different project, update the two constants
> in `config.ts`.

---

## Turning it on (per device)

1. Launch the app. The sidebar shows **"Set up sync."**
2. Click it and choose:
   - **Primary** — on the ONE device that currently holds the real data. It
     uploads everything to the cloud as the starting point.
   - **Secondary** — on every other device. It first writes a full backup
     (`sync-backup-<business>-<timestamp>.db` in the app config folder), then
     replaces its local data with the primary's.
3. After setup it syncs automatically on open and via the **Sync now** button.

**Order matters:** set up the **primary first**, let it finish, then set up the
secondaries.

---

## How to test locally (single machine)

You can prove the whole loop on one computer by running two separate app data
dirs so they act like two devices.

### 1. Run the app in dev
```bash
npm run tauri:dev
```
On first launch, migration v27 runs against your existing data. Verify nothing
was lost (your transactions/customers/etc. are all still there) — this is the
most important check.

### 2. Prove push (primary)
- Choose **Primary** in the setup dialog.
- In the Supabase dashboard → **Table Editor** → `sync_rows`, confirm rows
  appear (one per local record), tagged `business_id = 'laundry'` / `'cleaning'`.

### 3. Prove pull (a second "device")
Simulate a second device by launching a second instance with a different config
dir so it gets an empty database:
```bash
# macOS example — point the app at a fresh config dir
XDG_CONFIG_HOME="$HOME/sync-test-device-2" npm run tauri:dev
```
(Or install the built app on an actual second machine.)
- Choose **Secondary**. It backs up (empty) and pulls the primary's data.
- Confirm the primary's customers/transactions/staff now appear on device 2.

### 4. Prove incremental sync + LWW
- On device 1, add a customer → **Sync now**.
- On device 2 → **Sync now** → the new customer appears.
- Delete something on device 1 → sync both → it disappears on device 2.

### Inspecting sync state
```sql
-- in the app's SQLite (or via a SQLite browser on the .db file)
SELECT * FROM sync_state;                    -- device_id, role, high-water marks
SELECT COUNT(*) FROM sync_tombstones WHERE pushed = 0;  -- pending deletes
SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%';
```

---

## What to expect / known limitations (v1)

- **Not realtime.** Changes move on app-open and on "Sync now".
- **Last-write-wins per row.** If two devices edit the *same* record while both
  offline, the newer edit wins and the older is dropped. Fine for the
  "mostly add new records" workload; documented in the design.
- **Same-second edits** to one row bracketing a sync can be missed until the next
  edit — negligible for manual/on-open sync.
- **Rare natural-key clashes** (two devices independently creating the same
  master-data row — e.g. an identically-named category) are skipped with a
  console warning rather than aborting the sync; they can be reconciled manually.
- **Free-tier Supabase pauses** after ~1 week idle; the first sync after that may
  be slow until the project wakes.
- **Anon-key security:** the key ships in the app, so anyone with the installer +
  project URL can reach the data. Accepted tradeoff for private distribution; RLS
  scopes access to just the `sync_rows` table.

---

## If something goes wrong

- The sidebar widget turns amber and says "Last sync failed — tap to retry." The
  error is also stored in `sync_state` under `last_error` and logged to the
  console.
- Sync never throws into the app — a failure just means data hasn't moved yet;
  the app keeps working fully offline.
- A secondary device's pre-sync backup is in the app config dir
  (`sync-backup-*.db`) if you ever need to recover its original data.
