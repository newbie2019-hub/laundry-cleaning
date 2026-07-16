import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Building2,
  ChevronDown,
  ClipboardCheck,
  FileDown,
  HelpCircle,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  Package,
  PieChart,
  Settings,
  ShoppingCart,
  Tags,
  Truck,
  UserCog,
  UserRound,
  Users,
  Wallet,
  WalletCards,
  X,
} from "lucide-react"
import { AssistantProvider } from "../../features/assistant/assistant-provider"
import { AssistantLauncher } from "../../features/assistant/components/assistant-launcher"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { loadAppSettings, type AppSettings } from "../../lib/app-settings"
import { BUSINESSES } from "../../lib/db/business"
import { useAuth } from "../../features/auth/use-auth"
import { useLowStockCount } from "../../features/inventory/lib/use-low-stock-count"
import { useTour } from "../../features/onboarding/use-tour"
import { SyncWidget } from "../../features/sync/components/sync-widget"
import { runSyncOnStartup } from "../../lib/sync"

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed"

type NavChild = { to: string; label: string; icon: LucideIcon; requiredPermission?: string }

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  requiredPermission?: string
  children?: NavChild[]
}

const navigationItems: NavItem[] = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    to: "/transactions",
    label: "Transactions",
    icon: WalletCards,
    children: [
      { to: "/transactions-summary", label: "Summary", icon: BarChart3 },
      { to: "/categories", label: "Categories", icon: Tags },
      { to: "/income-share", label: "Income Share", icon: PieChart },
    ],
  },
  {
    to: "/inventory",
    label: "Inventory",
    icon: Package,
    children: [
      { to: "/inventory-movements", label: "Movements", icon: ArrowLeftRight },
      { to: "/purchase-orders", label: "Purchase orders", icon: ShoppingCart },
      { to: "/suppliers", label: "Suppliers", icon: Truck },
      { to: "/inventory/stock-take", label: "Stock take", icon: ClipboardCheck },
      { to: "/inventory-summary", label: "Summary", icon: BarChart3 },
      { to: "/inventory-categories", label: "Categories", icon: Tags },
      { to: "/inventory-templates", label: "Sale templates", icon: LayoutTemplate },
    ],
  },
  {
    to: "/staff",
    label: "Staff",
    icon: UserCog,
  },
  {
    to: "/payroll",
    label: "Payroll",
    icon: Wallet,
    requiredPermission: "process_payroll",
  },
  {
    to: "/customers",
    label: "Customers",
    icon: UserRound,
  },
  {
    to: "/incident-reports",
    label: "Incident Reports",
    icon: AlertTriangle,
  },
  {
    to: "/users",
    label: "Users & Roles",
    icon: Users,
  },
  {
    to: "/exports",
    label: "Export",
    icon: FileDown,
    requiredPermission: "export_data",
  },
  {
    to: "/settings",
    label: "Settings",
    icon: Settings,
  },
]

function navClassName(isActive: boolean, collapsed: boolean) {
  return [
    "flex items-center rounded-md py-2.5 text-sm font-medium transition-all",
    collapsed ? "justify-center px-2.5" : "gap-3 px-3",
    isActive
      ? "bg-[var(--accent)] text-white! shadow-sm"
      : "text-[var(--muted)]/90 hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]",
  ].join(" ")
}

function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-strong)]">
      {initials}
    </div>
  )
}

function NavBadge({ count, className = '' }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <span
      className={[
        'flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-none text-white',
        className,
      ].join(' ')}
      title={`${count} item${count === 1 ? '' : 's'} low or out of stock`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/**
 * Hover tooltip anchored to the right of its child. Renders through a portal
 * with fixed positioning so it is never clipped by the sidebar's overflow.
 */
function SidebarTooltip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  return (
    <div
      className="relative"
      onMouseEnter={(e) => setRect(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setRect(null)}
    >
      {children}
      {rect &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[200] -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--foreground)] px-2 py-1 text-xs font-medium text-[var(--background)] shadow-lg"
            style={{ top: rect.top + rect.height / 2, left: rect.right + 10 }}
          >
            {label}
          </div>,
          document.body,
        )}
    </div>
  )
}

function NavItemEntry({
  item,
  collapsed,
  badge = 0,
  onNavigate,
}: {
  item: NavItem
  collapsed: boolean
  badge?: number
  onNavigate?: () => void
}) {
  const location = useLocation()
  const parentActive =
    location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  const childActive =
    item.children?.some((child) => location.pathname.startsWith(child.to)) ??
    false
  const anyActive = parentActive || childActive
  const [expanded, setExpanded] = useState(anyActive)

  useEffect(() => {
    if (anyActive) setExpanded(true)
  }, [anyActive])

  const Icon = item.icon

  if (!item.children) {
    const link = (
      <NavLink
        className={({ isActive }) => navClassName(isActive, collapsed)}
        onClick={onNavigate}
        to={item.to}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    )
    return collapsed ? (
      <SidebarTooltip label={item.label}>{link}</SidebarTooltip>
    ) : (
      link
    )
  }

  if (collapsed) {
    return (
      <>
        <SidebarTooltip label={item.label}>
          <NavLink
            className={({ isActive }) =>
              [navClassName(isActive || childActive, true), 'relative'].join(' ')
            }
            onClick={onNavigate}
            to={item.to}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {badge > 0 && <NavBadge count={badge} className="absolute right-1 top-1" />}
          </NavLink>
        </SidebarTooltip>
        {item.children.map((child) => {
          const ChildIcon = child.icon
          return (
            <SidebarTooltip key={child.to} label={child.label}>
              <NavLink
                className={({ isActive }) => navClassName(isActive, true)}
                onClick={onNavigate}
                to={child.to}
              >
                <ChildIcon className="h-4 w-4 shrink-0" />
              </NavLink>
            </SidebarTooltip>
          )
        })}
      </>
    )
  }

  return (
    <div>
      <div className="flex items-center">
        <NavLink
          className={({ isActive }) =>
            [
              navClassName(isActive || childActive, false),
              "flex-1 min-w-0",
            ].join(" ")
          }
          onClick={onNavigate}
          to={item.to}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.label}</span>
          {badge > 0 && <NavBadge count={badge} className="ml-auto" />}
        </NavLink>
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
          onClick={() => setExpanded((prev) => !prev)}
          type="button"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? "rotate-0" : "-rotate-90"}`}
          />
        </button>
      </div>

      {expanded && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-2">
          {item.children.map((child) => {
            const ChildIcon = child.icon
            return (
              <NavLink
                key={child.to}
                className={({ isActive }) => navClassName(isActive, false)}
                onClick={onNavigate}
                to={child.to}
              >
                <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{child.label}</span>
              </NavLink>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function AppShell() {
  const { activeBusiness, hasPermission, signOut, user } = useAuth()
  const { restart: restartTour } = useTour()
  const navigate = useNavigate()
  const currentBusiness = BUSINESSES[activeBusiness]
  const canSwitchBusiness = user?.roles.includes("admin") ?? false
  const { lowCount: lowStockCount } = useLowStockCount()

  function handleSwitchBusiness() {
    navigate("/select-business")
  }
  const [appSettings, setAppSettings] = useState<AppSettings>(loadAppSettings)
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
  )
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  // While the full-screen mobile drawer is open, lock body scroll and close on Esc.
  useEffect(() => {
    if (!mobileMenuOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener("keydown", onKey)
    }
  }, [mobileMenuOpen])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }, [])

  useEffect(() => {
    function handleSettingsUpdate() {
      setAppSettings(loadAppSettings())
    }
    window.addEventListener("app-settings-updated", handleSettingsUpdate)
    return () =>
      window.removeEventListener("app-settings-updated", handleSettingsUpdate)
  }, [])

  // Auto-sync shortly after the shell mounts (app open), then keep syncing in
  // the background so rows added on any device propagate to the others while
  // online. Each run both pushes local changes and pulls remote ones, and
  // runSync() dedupes concurrent runs, so a plain interval covers both
  // directions. Also re-sync as soon as the network comes back. Silent if the
  // device isn't set up for sync or sync isn't configured.
  // ponytail: 30s poll, not realtime. Move to Supabase realtime if instant
  // cross-device updates are needed.
  useEffect(() => {
    const timer = setTimeout(() => void runSyncOnStartup(), 1500)
    const interval = window.setInterval(() => void runSyncOnStartup(), 30_000)
    const onOnline = () => void runSyncOnStartup()
    window.addEventListener("online", onOnline)
    return () => {
      clearTimeout(timer)
      window.clearInterval(interval)
      window.removeEventListener("online", onOnline)
    }
  }, [])

  function handleSignOut() {
    signOut()
    navigate("/login", { replace: true })
  }

  const displayName = user?.displayName ?? user?.username ?? ""
  const roleLabel = user?.roles?.[0]
    ? user.roles[0].charAt(0).toUpperCase() + user.roles[0].slice(1)
    : "User"

  return (
    <AssistantProvider>
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {/* Sidebar */}
      <aside
        className={`relative hidden flex-col bg-[var(--panel)] transition-[width] duration-200 ease-in-out lg:flex ${
          collapsed ? "w-[68px]" : "w-60"
        }`}
      >
        {/* Logo */}
        <div className="flex h-16 shrink-0 items-center border-b border-[var(--border)] px-3">
          <div
            className={`flex items-center overflow-hidden ${collapsed ? "justify-center w-full" : "gap-2.5 px-2"}`}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] overflow-hidden">
              {appSettings.logoDataUrl ? (
                <img
                  alt="logo"
                  className="h-full w-full object-contain"
                  src={appSettings.logoDataUrl}
                />
              ) : (
                <WalletCards className="h-4 w-4 text-white" />
              )}
            </div>
            {!collapsed && (
              <span className="truncate text-sm font-semibold tracking-tight">
                {appSettings.name}
              </span>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav
          className="flex-1 overflow-y-auto px-2 py-4"
          data-tour="sidebar-nav"
        >
          <div className="space-y-0.5">
            {navigationItems
              .filter((item) => !item.requiredPermission || hasPermission(item.requiredPermission))
              .map((item) => (
                <NavItemEntry
                  key={item.to}
                  badge={item.to === '/inventory' ? lowStockCount : 0}
                  collapsed={collapsed}
                  item={item}
                />
              ))}
          </div>
        </nav>

        {/* Bottom section */}
        <div className="shrink-0 border-t border-[var(--border)] p-2 space-y-1">
          {/* Sync status + control */}
          <SyncWidget collapsed={collapsed} />

          {/* Active business badge */}
          {collapsed ? (
            <button
              aria-label={`Active business: ${currentBusiness.name}${canSwitchBusiness ? ". Click to switch." : ""}`}
              className="flex w-full items-center justify-center rounded-md py-2 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]"
              data-tour="business-switcher"
              disabled={!canSwitchBusiness}
              onClick={canSwitchBusiness ? handleSwitchBusiness : undefined}
              title={`${currentBusiness.name}${canSwitchBusiness ? " (click to switch)" : ""}`}
              type="button"
            >
              <div
                className="flex h-7 w-7 items-center justify-center rounded-md text-white"
                style={{ backgroundColor: currentBusiness.accent }}
              >
                <Building2 className="h-3.5 w-3.5" />
              </div>
            </button>
          ) : (
            <div
              className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-2"
              data-tour="business-switcher"
            >
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white"
                style={{ backgroundColor: currentBusiness.accent }}
              >
                <Building2 className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-medium uppercase tracking-wide text-[var(--muted)] leading-tight">
                  Active business
                </p>
                <p className="truncate text-xs font-semibold leading-tight mt-0.5">
                  {currentBusiness.shortName}
                </p>
              </div>
              {canSwitchBusiness && (
                <button
                  className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-medium text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
                  onClick={handleSwitchBusiness}
                  type="button"
                >
                  Switch
                </button>
              )}
            </div>
          )}

          {/* User info */}
          {collapsed ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <UserAvatar name={displayName} />
              <button
                aria-label="Replay tutorial"
                className="rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
                onClick={restartTour}
                title="Replay tutorial"
                type="button"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
              <button
                aria-label="Sign out"
                className="rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                onClick={handleSignOut}
                title="Sign out"
                type="button"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
              <UserAvatar name={displayName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-tight">
                  {displayName}
                </p>
                <p className="truncate text-xs text-[var(--muted)] leading-tight mt-0.5">
                  {roleLabel}
                </p>
              </div>
              <button
                aria-label="Replay tutorial"
                className="shrink-0 rounded p-1.5 text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
                onClick={restartTour}
                title="Replay tutorial"
                type="button"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
              <button
                aria-label="Sign out"
                className="shrink-0 rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                onClick={handleSignOut}
                type="button"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Edge toggle handle */}
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-px top-0 z-10 h-full w-1 cursor-col-resize border-r border-[var(--border)] bg-transparent transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)]/20 active:bg-[var(--accent)]/30"
          onClick={toggleCollapsed}
          type="button"
        />
      </aside>

      {/* Mobile top bar */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-4 lg:hidden">
          <button
            aria-label="Open menu"
            className="flex items-center justify-center rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
            onClick={() => setMobileMenuOpen(true)}
            type="button"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] overflow-hidden">
              {appSettings.logoDataUrl ? (
                <img
                  alt="logo"
                  className="h-full w-full object-contain"
                  src={appSettings.logoDataUrl}
                />
              ) : (
                <WalletCards className="h-3.5 w-3.5 text-white" />
              )}
            </div>
            <span className="text-sm font-semibold">{appSettings.name}</span>
          </div>
        </div>

        {/* Mobile drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-full max-w-none flex-col bg-[var(--panel)] shadow-xl animate-[slide-in-left_0.2s_ease-out]">
              {/* Drawer header */}
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] overflow-hidden">
                    {appSettings.logoDataUrl ? (
                      <img
                        alt="logo"
                        className="h-full w-full object-contain"
                        src={appSettings.logoDataUrl}
                      />
                    ) : (
                      <WalletCards className="h-4 w-4 text-white" />
                    )}
                  </div>
                  <span className="truncate text-sm font-semibold tracking-tight">
                    {appSettings.name}
                  </span>
                </div>
                <button
                  aria-label="Close menu"
                  className="flex items-center justify-center rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                  onClick={() => setMobileMenuOpen(false)}
                  type="button"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Drawer nav */}
              <nav className="flex-1 overflow-y-auto px-2 py-4">
                <div className="space-y-0.5">
                  {navigationItems
                    .filter((item) => !item.requiredPermission || hasPermission(item.requiredPermission))
                    .map((item) => (
                      <NavItemEntry
                        key={item.to}
                        badge={item.to === '/inventory' ? lowStockCount : 0}
                        collapsed={false}
                        item={item}
                        onNavigate={() => setMobileMenuOpen(false)}
                      />
                    ))}
                </div>
              </nav>

              {/* Drawer footer */}
              <div className="shrink-0 border-t border-[var(--border)] p-2">
                <div className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
                  <UserAvatar name={displayName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">
                      {displayName}
                    </p>
                    <p className="truncate text-xs text-[var(--muted)] leading-tight mt-0.5">
                      {roleLabel}
                    </p>
                  </div>
                  <button
                    aria-label="Sign out"
                    className="shrink-0 rounded p-1.5 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                    onClick={handleSignOut}
                    type="button"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-5 lg:p-8">
          <Outlet />
        </main>
      </div>
      <AssistantLauncher />
    </div>
    </AssistantProvider>
  )
}
