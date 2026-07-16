# Phase 0 — Foundation: burger + full-width slide-in drawer

**File:** `src/app/shell/app-shell.tsx` (single file — everything here lives in `AppShell`).

## What exists today

- Desktop sidebar `<aside>` is `hidden … lg:flex` (`:539-561`) — only ≥1024px.
- Mobile top bar with the burger already exists: `lg:hidden`, `Menu` button at
  `:566-573`, `onClick={() => setMobileMenuOpen(true)}`. **The burger is done.**
- Mobile drawer already exists (`:591-667`), gated on `mobileMenuOpen`:
  - Backdrop `absolute inset-0 bg-black/50` (`:593-596`).
  - Panel `absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col` (`:597`).
  - Closes on route change (`useEffect` on `location.pathname`, `:346-348`),
    backdrop click, X button, and nav click (`onNavigate`).

So the only gaps vs the ask are: **not full-width**, **no slide animation**, no
body-scroll-lock, no Esc-to-close.

## Changes

### 1. Full-width panel + slide-in-from-left (the ask)

`:597` — replace the panel width and add a transform transition. Drop
`w-72 max-w-[85%]`:
```jsx
{/* was: absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-[var(--panel)] shadow-xl */}
<div className="absolute inset-y-0 left-0 flex w-full max-w-none flex-col bg-[var(--panel)] shadow-xl animate-[slide-in-left_0.2s_ease-out]">
```

Add the keyframe to `src/index.css` (there's already a `slide-in-right` at
`:~/* @keyframes slide-in-right */`; mirror it):
```css
@keyframes slide-in-left {
  from { transform: translateX(-100%); }
  to   { transform: translateX(0); }
}
```

> If you want a fade-in on the backdrop too, add `animate-[fade-in_0.2s_ease-out]`
> to `:593` and a trivial `@keyframes fade-in { from{opacity:0} to{opacity:1} }`.

> **Full-width vs 85%:** the ask is full-width, so `w-full`. Tradeoff: no peek of
> the page behind, and the backdrop is no longer tappable to close (it's covered),
> so the **X button + Esc + route-change close become the only exits** — all three
> already exist / are added below, so this is fine. Keep the backdrop div anyway
> (harmless, and covers the animation gap).

### 2. Lock body scroll while the drawer is open

Add near the other effects in `AppShell` (after `:348`):
```jsx
useEffect(() => {
  if (!mobileMenuOpen) return
  const prev = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  return () => { document.body.style.overflow = prev }
}, [mobileMenuOpen])
```

### 3. Esc closes the drawer

Fold into the same effect or add:
```jsx
useEffect(() => {
  if (!mobileMenuOpen) return
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileMenuOpen(false) }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [mobileMenuOpen])
```

### 4. (Optional) collapsible groups in the drawer

The drawer reuses `NavItemEntry` with `collapsed={false}` (`:632-637`), so
Transactions/Inventory sub-menus already expand/collapse via the chevron — no
change needed. Sub-items navigate and `onNavigate` closes the drawer. Leave as is.

## Skipped

- **Swipe-to-open/close gesture** — YAGNI; burger + backdrop cover it. Add later
  if users ask.
- **Focus trap inside the drawer** — nice a11y touch but the drawer is a full-screen
  nav that closes on any nav; add only if accessibility audit requires it.

## Done when

Burger opens a full-width panel that slides in from the left, body doesn't scroll
behind it, and it closes on nav / X / Esc. Desktop (≥1024px) untouched.
