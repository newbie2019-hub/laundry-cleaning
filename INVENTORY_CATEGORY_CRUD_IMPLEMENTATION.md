# Inventory Category CRUD - One-Go Implementation Spec

Implement dynamic CRUD for Inventory Categories and remove hardcoded category lists in inventory screens.

This must work for both businesses (Laundry and Cleaning). The app already uses two SQLite DBs with shared migrations in `src-tauri/src/db.rs`; migrations automatically run for both database URLs via the same `build_migrations()` list.

## Objective

Replace hardcoded inventory categories with DB-backed categories that can be created, edited, archived, and listed in-app, while preserving existing item behavior and analytics.

## Scope

- Add new `inventory_categories` master table.
- Migrate existing `inventory_items.category` string to `inventory_items.category_id`.
- Add repository CRUD for inventory categories.
- Update inventory UI pages to consume dynamic category options.
- Add a management page for inventory category CRUD.
- Keep compatibility during migration and support both businesses.

## Non-Goals

- No changes to transaction categories (`categories` table used by `transaction_types`).
- No redesign of existing inventory table layout.
- No destructive data reset.

---

## Required Files To Modify

- `src-tauri/src/db.rs`
- `src/lib/db/repository.ts`
- `src/features/inventory/pages/inventory-page.tsx`
- `src/features/inventory/pages/inventory-summary-page.tsx`
- `src/app/routes.tsx`
- `src/app/shell/app-shell.tsx` (if nav link/menu must expose new page)

## Required New Files

- `src/features/inventory/pages/inventory-categories-page.tsx`

---

## Data Model and Migration

### 1) Add new migration in `src-tauri/src/db.rs`

Append a new migration version (next integer after current latest) that:

1. Creates `inventory_categories`:
   - `id INTEGER PRIMARY KEY AUTOINCREMENT`
   - `code TEXT NOT NULL UNIQUE`
   - `label TEXT NOT NULL`
   - `is_system INTEGER NOT NULL DEFAULT 0`
   - `is_active INTEGER NOT NULL DEFAULT 1`
   - `sort_order INTEGER NOT NULL DEFAULT 0`
   - `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
   - `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

2. Seeds default categories as system rows (insert-or-ignore):
   - `consumable`, `Consumable`
   - `detergent_chemicals`, `Detergent & Chemicals`
   - `packaging`, `Packaging`
   - `cleaning_materials`, `Cleaning Materials`
   - `equipment`, `Equipment`
   - `other`, `Other`

3. Adds `category_id` to `inventory_items`:
   - `ALTER TABLE inventory_items ADD COLUMN category_id INTEGER REFERENCES inventory_categories(id)`
   - Add index: `CREATE INDEX IF NOT EXISTS idx_inventory_items_category_id ON inventory_items(category_id)`

4. Backfills `category_id` from legacy `inventory_items.category` string:
   - Match `inventory_items.category = inventory_categories.code`.
   - For any null/unknown values, map to `other`.

5. Do **not** drop legacy `inventory_items.category` yet.

This migration automatically applies to both business DBs because both URLs call the same `build_migrations()`.

---

## Repository Changes (`src/lib/db/repository.ts`)

### 2) Add inventory category types

Add:

- `InventoryCategory` type:
  - `id`, `code`, `label`, `isSystem`, `isActive`, `sortOrder`
- `InventoryCategoryDraft` type:
  - `code`, `label`, `isActive`, `sortOrder`

### 3) Add CRUD methods

Implement:

- `listInventoryCategories(includeInactive = false): Promise<InventoryCategory[]>`
  - Order by `sort_order`, then `label`.
- `saveInventoryCategory(input: InventoryCategoryDraft, id?: number): Promise<number>`
  - Normalize `code` to lowercase and trimmed.
  - Update `updated_at`.
- `deleteInventoryCategory(id: number): Promise<void>`
  - If referenced by `inventory_items`, soft-delete (`is_active = 0`) instead of hard delete.
  - If unreferenced and non-system, hard delete allowed.
  - System categories should not be hard deleted.

### 4) Update inventory item queries

Update `listInventoryItems`, `saveInventoryItem`, and related summary queries to use `category_id` join:

- In item selects, include:
  - `category_id AS categoryId`
  - `c.code AS categoryCode`
  - `c.label AS categoryLabel`
- Keep temporary fallback behavior for old rows:
  - If `category_id` null, derive from legacy string or map to `other`.
- In save/update item:
  - Persist `category_id`.
  - Keep writing legacy `category` string for compatibility during transition (set to selected category code).

### 5) Update all inventory analytics helpers that use category string

Any SQL filtering/grouping like:
- `i.category = 'equipment'`
- `i.category != 'equipment'`
- `GROUP BY i.category`

must migrate to joined category code (`c.code`) with null-safe fallback.

---

## UI Changes

### 6) Inventory item page (`src/features/inventory/pages/inventory-page.tsx`)

Replace hardcoded `ITEM_CATEGORIES` source with DB categories:

- Load categories on page load.
- Use categories for:
  - Add/Edit item category dropdown
  - Category filter dropdown
  - Category badge label rendering
- Keep color mapping by category `code`; unknown codes use default gray style.
- Save item with `categoryId` (not just category string).
- Preserve equipment-specific behavior by checking selected category code equals `equipment`.

### 7) Inventory summary page (`src/features/inventory/pages/inventory-summary-page.tsx`)

- Remove hardcoded category constant usage for labels.
- Use category metadata from DB/repository where category filters and labels are displayed.
- Ensure grouped summaries still display correctly for both businesses.

### 8) Add inventory categories management page

Create `src/features/inventory/pages/inventory-categories-page.tsx`:

- Permission gate: `manage_inventory`.
- Features:
  - List categories (active + optional inactive toggle)
  - Create category (code, label)
  - Edit label and active flag
  - Delete category (with safe behavior from repository)
- UX can follow existing `CategoriesPage` CRUD style.

### 9) Route and navigation wiring

- Add route in `src/app/routes.tsx` for `/inventory-categories`.
- Add navigation entry in `src/app/shell/app-shell.tsx` under inventory section.

---

## Validation and Business Rules

- `code` unique and normalized (`lowercase_snake_case`).
- `label` required.
- System categories (`is_system = 1`) cannot be hard deleted.
- Categories in use by inventory items cannot be hard deleted.
- Inactive categories:
  - Hidden by default in selectors and lists unless explicitly included.
  - Existing items with inactive categories still render.

---

## Compatibility and Rollout Rules

Implement as a backward-compatible rollout:

1. Add table + `category_id` + backfill.
2. Read from joined category metadata, fallback safely.
3. Write both `category_id` and legacy `category` string.
4. After stabilization (future PR), remove legacy column usage.

No data loss. Existing inventory items must remain visible and editable after migration in both businesses.

---

## Acceptance Checklist

Implementation is complete only if all are true:

- [ ] App boots and migrations run successfully for both DB files.
- [ ] Existing items in both businesses resolve to valid category metadata.
- [ ] Add/Edit item uses dynamic categories from DB.
- [ ] Category filter and summary category labels are dynamic.
- [ ] Inventory category CRUD page exists and is reachable from nav.
- [ ] Create, edit, archive, and delete behaviors work with safety rules.
- [ ] Equipment workflows still function when category code is `equipment`.
- [ ] No TypeScript errors in edited files.

---

## Suggested Verification Steps

1. Start app and open each business tenant.
2. Visit inventory page in each tenant:
   - Create item in new category.
   - Edit item category.
   - Filter by category.
3. Visit inventory categories page:
   - Add category, rename it, archive it.
   - Try deleting a used category (should soft-delete / prevent hard delete).
4. Visit inventory summary page and confirm labels/filter behavior.
5. Confirm equipment items still show status/maintenance logic.

---

## Implementation Notes for AI

- Keep edits minimal and local; do not refactor unrelated modules.
- Reuse existing repository and page patterns from current codebase.
- Follow existing coding style and UI classes.
- After edits, run type/lint checks for touched files and fix straightforward issues.
