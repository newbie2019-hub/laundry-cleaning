# Phase 3 — Inventory cluster (polish)

Pages: `inventory-page.tsx`, `inventory-summary-page.tsx`,
`inventory-movements-page.tsx`, `inventory-templates-page.tsx`,
`inventory-categories-page.tsx`, `suppliers-page.tsx`, `item-detail-page.tsx`,
`purchase-orders-page.tsx`, `purchase-order-detail-page.tsx`, `stock-take-page.tsx`.

> Assumes Phase 1 fixed the clipping tables (categories, suppliers, purchase-orders),
> the no-wrapper movements table, search inputs, and modal grid pairs. This is what's
> left per page.

## inventory-page.tsx

- Stats grid `grid-cols-2 lg:grid-cols-4` (`:592`) already fine.
- **Add-item modal alt-units rows** (`:1104-1145`): `flex items-start gap-2` with fixed
  `w-24 shrink-0` (×2) + `w-7 shrink-0` button + `flex-1` label. Header row is
  `hidden sm:flex` (`:1104`). At 375px the two 96px columns + button crowd the label.
  - Fix: below `sm`, stack — `flex flex-col gap-2 sm:flex-row sm:items-start`, inputs
    `w-full sm:w-24`. The `sm:`-hidden header already implies a mobile-stacked intent.
- Description cell `truncate max-w-xs` (`:806`) — fine.

## inventory-summary-page.tsx

- **Item breakdown table** (`:1020`) is the widest in the app: `min-w-[960px]`, 11–12
  columns. Scrolls (good) after Phase 1, but consider R6 card-stacking or a
  column-toggle default that hides less-used columns on first load for mobile.
- All the KPI/chart/section grids are already responsive (`:435, :575, :728, :762, :820`).
- Charts: Phase 5 (per-item `YAxis width={90}` at `:791`).

## inventory-movements-page.tsx

- Phase 1 added the missing scroll wrapper + `min-w`. 
- **Movement modal + filter dialog use hardcoded gray/white** (report noted `:90-93`,
  `:577+`) instead of `var(--…)` tokens → wrong in dark mode. Optional cleanup while here.
- Modal qty/cost + filter date/number pairs handled in Phase 1d.

## inventory-templates-page.tsx

- **Line-editor row** (`:583`): `flex flex-wrap items-start gap-2` with fixed `w-20`
  (`:633`), `w-24` (`:657`), `w-24` (`:678`) + `flex-1` select + × + trash. `flex-wrap`
  stops overflow but the wrap looks broken.
  - Fix: stack below `sm` (`flex-col sm:flex-row`), inputs `w-full sm:w-24`.
- Table `min-w-[640px]` at `:385` scrolls (Phase 1). Footer `pr-9` (`:748`) is cosmetic.

## inventory-categories-page.tsx

- Clip bug fixed in Phase 1a. Editable Label input is `w-full` (`:209`) — fine. Nothing else.

## suppliers-page.tsx

- Clip bug fixed in Phase 1a. Phone/email pair `:301` stacked in Phase 1d. Email cell
  `max-w-[14rem] truncate` (`:207`) fine. Nothing else.

## item-detail-page.tsx

- Stats grid `grid-cols-1 sm:grid-cols-3` (`:219`) already good.
- Movement table (`:270`) has **no `min-w`** → 7 cols squash. Add `min-w-[720px]`
  (called out in Phase 1b). Nothing else.

## purchase-orders-page.tsx

- Clip bug fixed in Phase 1a. Status pills `flex-wrap` (`:145`) fine. Supplier `<select>`
  (`:162`) has no width cap — fine, it's `h-9` and flexes. Long "Create from reorder
  suggestions" button label (`:130`) wraps via `flex-wrap` (`:122`) — acceptable.

## purchase-order-detail-page.tsx

- Header-fields form already `grid-cols-1 sm:grid-cols-2` (`:373`) — good.
- Lines table `min-w-[640px]` (`:466`) scrolls. Editable cells use full-width
  `modalInputClass`/`modalSelectClass` — fine. Receive-modal input `w-28` (`:615`) fine.
- No work beyond Phase 1 edge-bleed.

## stock-take-page.tsx

- Table `min-w-[560px]` (`:178`, narrowest) scrolls. Date picker `w-40` (`:128`) and
  counted input `w-24` (`:202`) fine. Search fixed in Phase 1. No work.

## Done when

Alt-unit and line-editor rows stack cleanly at 375px; item-detail and movements tables
scroll instead of squashing; inventory modals render in dark mode.
