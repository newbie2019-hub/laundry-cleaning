# Sync Feature — What's Happening & What You Need To Do

A plain-language companion to [`sync-design.md`](./sync-design.md). This file
answers four questions: what changes for the app, what we're building, what
happens to your existing data, and what **you** need to set up.

Last updated: 2026-07-11

---

## 1. What will happen to the app

Today the app is **single-device**: each computer has its own private data and
they never talk to each other. After this feature, multiple devices share the
same data.

**From a user's point of view:**

- **No sign-in for sync.** The moment the app is installed it starts sharing the
  same customers, transactions, staff, payroll, and inventory across devices —
  nothing to log into, nothing to set up. (Your existing in-app *staff* login is
  unchanged and unrelated to this.)
- Sync is **not instant**. Data moves between devices:
  - automatically **when the app opens**, and
  - when you tap the new **"Sync now"** button.
- A small indicator shows **"last synced X minutes ago"** so you know how fresh
  the data is.
- The app **keeps working fully offline**. Changes you make with no internet are
  saved locally and uploaded next time you sync.
- **Laundry and Cleaning stay completely separate**, just like now — each syncs
  its own data.

**The one rule to know:** if two devices edit *the very same record* while both
offline, the **last save wins** and the earlier edit is dropped. This is fine
because in practice devices mostly *add* new records rather than editing the
same one at the same time.

---

## 2. What changes will be done (in the app)

Grouped so you can see the shape of the work. Full detail is in the design doc.

**A. Database changes (invisible to users):**
- Every synced table gets two new hidden columns:
  - a `uuid` — a permanent, globally-unique ID so the same record can be matched
    across devices (your existing numeric IDs stay for internal use).
  - a `deleted_at` — so deletions can travel between devices instead of leaving
    a record "gone here but still there."
- A new internal `sync_state` table remembers when each device last synced.
- Deleting something now **marks it deleted** instead of erasing it (needed so
  the deletion syncs everywhere).

**B. Cloud setup (new):**
- A **Supabase** project (free tier) becomes the shared "meeting point" where
  devices push and pull changes.
- The app connects using a single **public key baked into the app** — no login.
  It syncs automatically on install. (Tradeoff: anyone with the app installer
  and the project address could reach the data. Accepted for private, low-
  sensitivity business use.)
- Laundry vs. Cleaning data is kept apart by a `business_id` tag on every row.

**C. New app behavior:**
- A **"Sync now"** button and **auto-sync when the app opens**.
- A **"last synced"** status indicator.
- Sensible handling when offline or when sync fails (retry, no crash).

**D. Rollout order (so nothing breaks):**
1. Add the hidden columns + fill them in (users notice nothing).
2. Switch deletes to the new safe method.
3. Set up Supabase and prove it end-to-end on **one** table (customers).
4. Extend to the rest of the tables.
5. Add the button, auto-sync, and status indicator.

---

## 3. What happens to your existing data

**Nothing is lost. This is the top priority and the plan is built around it.**

- The first database change **only adds columns** — it never deletes, drops, or
  rewrites your data. Every existing record stays exactly as it is and simply
  gets its new permanent `uuid` filled in automatically.
- When sync is first switched on, **you pick one device as the "primary"** — the
  one holding the real, correct data. That device uploads everything to the
  cloud as the starting point.
- Other ("secondary") devices, on their first sync:
  1. **make a full backup** of their current local data first (safety net), then
  2. pull the primary device's data so everyone starts from the same source.
- After that first setup, all devices are equal — each keeps its offline changes
  and shares them on the next sync.

> In short: the **primary device's data is preserved as-is**, and secondary
> devices are **backed up before** they adopt the shared data — so even replaced
> records remain recoverable.

---

## 4. What YOU need to set up

These are the things only you can do (accounts, keys). I'll handle all the code.

### Step 1 — Create a Supabase account & project
1. Go to <https://supabase.com> and sign up (free).
2. Create a **new project**. Give it a name (e.g. `business-apps-sync`) and a
   strong database password (save it somewhere safe).
3. Pick the region closest to you (e.g. Sydney / Southeast Asia) for speed.

### Step 2 — Send me two values from the project
From the project's **Settings → API** page, share:
- the **Project URL** (looks like `https://xxxxx.supabase.co`), and
- the **anon / public API key**.

These get baked into the app so it syncs with no login. (Do **not** share the
`service_role` key or your database password — I don't need those, and they must
never go in the app.)

That's the only account setup — there is **no login to create**.

### Step 3 — Point out the "primary" device
- Tell me **which physical device currently has the correct, complete data.**
  That one becomes the source of truth for the first sync.

### Step 4 (optional, later) — Paid tier
- The free tier is enough to start. Free projects **pause after ~1 week of no
  activity**; if that ever becomes annoying, the $25/month tier removes it. No
  action needed now.

---

## Quick checklist for you

- [ ] Create Supabase account + project
- [ ] Send me the **Project URL** + **anon key**
- [ ] Tell me which device is the **primary** (has the real data)
- [ ] (Later) consider paid tier if free-tier pausing gets annoying

Once I have the URL and anon key, I can start building — beginning with the
safe, invisible database change that adds the sync columns. No login accounts to
create; the app authenticates with the baked-in key automatically.
