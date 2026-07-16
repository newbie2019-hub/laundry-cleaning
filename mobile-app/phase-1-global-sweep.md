# Phase 1 — Global sweep (mechanical R1–R4 across all pages)

These are low-risk, find-and-fix edits. Do them all in one pass; they touch many
files but each edit is one or two class strings. **Line numbers are from the audit
snapshot — verify by searching the class string, since earlier edits shift lines.**

---

## 1a. Table clipping bugs (R1) — MUST FIX, broken today

These three tables use `overflow-hidden` with a `min-w-[…]`, so on mobile they are
**clipped with no way to scroll** — columns are simply unreachable:

| Page | File:line | Fix |
|------|-----------|-----|
| Inventory categories | `inventory-categories-page.tsx:186` | `overflow-hidden` → `overflow-x-auto` (table `min-w-[700px]` at `:187` stays) |
| Suppliers | `suppliers-page.tsx:185` | `overflow-hidden` → `overflow-x-auto` (table `min-w-[820px]` at `:186` stays) |
| Purchase orders | `purchase-orders-page.tsx:176` | `overflow-hidden` → `overflow-x-auto` (table `min-w-[820px]` at `:194` stays) |

And one table has **no scroll wrapper at all** — it squashes columns instead of scrolling:

| Page | File:line | Fix |
|------|-----------|-----|
| Inventory movements | `inventory-movements-page.tsx:467` (up to 10 cols) | Wrap the `<table className="w-full text-sm">` in `<div className="-mx-4 overflow-x-auto sm:mx-0">…</div>` and add `min-w-[900px]` to the table so it scrolls cleanly. |

## 1b. Edge-bleed the existing scroll tables (R1, polish)

All these already scroll correctly (`overflow-x-auto` + `min-w`); optionally add
`-mx-4 sm:mx-0` to the wrapper so the scroll area reaches the screen edge on mobile
(feels much better under a thumb). Low priority, do in bulk if time:

`inventory-page.tsx:776`, `inventory-summary-page.tsx:1019`,
`inventory-templates-page.tsx:382`, `item-detail-page.tsx:270` (also **add** a
`min-w-[720px]` — it has none, so 7 cols squash), `purchase-order-detail-page.tsx:465`,
`stock-take-page.tsx:177`, `staff-page.tsx:540`, `staff-detail-page.tsx:300`,
`payroll-date-page.tsx:310`, `bulk-payroll-page.tsx:162`, `customers-page.tsx:640`,
`customer-detail-page.tsx:306`, `transaction-detail-page.tsx:422`,
`incident-reports-page.tsx:547`, `users-page.tsx:271`, `dashboard-page.tsx:726`.

> The three summary tables at `transactions-summary-page.tsx:664/1060/1143` have
> **no `min-w`**, so they compress (many numeric columns get cramped) rather than
> scroll. Add a `min-w-[560px]` (or card-stack later) if the squash looks bad.

## 1c. Fluid search inputs (R2)

Fixed-width search inputs that don't shrink → `w-full sm:w-56` (or `sm:w-64` to
match current). Also confirm the toolbar row has `flex-wrap`:

| Page | File:line | Current | → |
|------|-----------|---------|---|
| Transactions | `transactions-page.tsx:1716` | `relative w-64` | `relative w-full sm:w-64`; parent row `:1695` add `flex-wrap` + `sm:flex-row` |
| Inventory | `inventory-page.tsx:681` | `w-56` | `w-full sm:w-56` |
| Inventory movements | `inventory-movements-page.tsx:414` | `w-56` | `w-full sm:w-56` |
| Inventory summary | `inventory-summary-page.tsx:993` | `w-48` | `w-full sm:w-48` |
| Suppliers | `suppliers-page.tsx:154` | `w-64` | `w-full sm:w-64` |
| Stock take | `stock-take-page.tsx:141` | `w-56` | `w-full sm:w-56` |
| Staff | `staff-page.tsx:509` | `w-64` | `w-full sm:w-64` |
| Customers | `customers-page.tsx:484` | `w-56` | `w-full sm:w-56` |
| Incident reports | `incident-reports-page.tsx:516` | `w-64`, row `:512` has **no wrap** | `w-full sm:w-64`; row `:512` → `flex flex-wrap items-center justify-end gap-2` |

## 1d. Modal / filter field pairs stack (R3)

Add `grid-cols-1 sm:` to these `grid grid-cols-2` field pairs (real inputs — dates,
qty/price — that are cramped side-by-side at 375px):

| Page | File:line(s) |
|------|--------------|
| Transactions | `transactions-page.tsx:2082` (filter dates), `:2263` (loads/kg) |
| Transactions summary | `transactions-summary-page.tsx:1237` (custom range) |
| Transaction detail | `transaction-detail-page.tsx:566` (qty + unit cost) |
| Inventory | `inventory-page.tsx:940, 958, 985, 1188` |
| Inventory movements | `inventory-movements-page.tsx:629` (modal), `:746, :797, :822` (filter) |
| Suppliers | `suppliers-page.tsx:301` (phone/email) |
| Incident reports | `incident-reports-page.tsx:912` (filter dates), `:1050, :1104, :1155` (form) |

**Leave as 2-up (tiny inputs, they fit):** min/max number pairs and column-visibility
checkbox grids — `staff-page.tsx:920/949`, `customers-page.tsx:831/858`,
`inventory-movements-page.tsx:850`, `inventory-page.tsx:1340`,
`transactions-summary-page.tsx:1218` (3-up preset buttons).

## 1e. Section headers that don't stack (R4)

| Page | File:line | Note |
|------|-----------|------|
| Income share | `income-share-page.tsx:158` (Rules) and `:253` (Monthly) | `flex items-center justify-between` → add `flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`. These are the weakest headers in the app. |

Everything else already stacks — spot-check but expect no change.

---

## Done when

At 375px: every table either scrolls inside its box or stacks (none clip); search
bars fill the width and the Filters button stays reachable; modal date/number pairs
stack; income-share headers no longer crush. Nothing on desktop changed except the
added `sm:` prefixes.
