import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, ArrowLeftRight, BarChart3, ChevronDown, LayoutDashboard, LogOut, Package, PieChart, Settings, SunMoon, Tags, Users, WalletCards } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { loadAppSettings, type AppSettings } from '../../lib/app-settings'
import { useAuth } from '../../features/auth/use-auth'

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed'

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  children?: Array<{ to: string; label: string; icon: LucideIcon }>
}

const navigationItems: NavItem[] = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    to: '/transactions',
    label: 'Transactions',
    icon: WalletCards,
    children: [
      { to: '/categories', label: 'Categories', icon: Tags },
      { to: '/income-share', label: 'Income Share', icon: PieChart },
    ],
  },
  {
    to: '/inventory',
    label: 'Inventory',
    icon: Package,
    children: [
      { to: '/inventory-movements', label: 'Movements', icon: ArrowLeftRight },
      { to: '/inventory-summary', label: 'Summary', icon: BarChart3 },
    ],
  },
  {
    to: '/incident-reports',
    label: 'Incident Reports',
    icon: AlertTriangle,
  },
  {
    to: '/users',
    label: 'Users & Roles',
    icon: Users,
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: Settings,
  },
]

const allMobileItems = navigationItems.flatMap((item) =>
  item.children ? [item, ...item.children] : [item],
)

function navClassName(isActive: boolean, collapsed: boolean) {
  return [
    'flex items-center rounded-md py-2.5 text-sm font-medium transition-all',
    collapsed ? 'justify-center px-2.5' : 'gap-3 px-3',
    isActive
      ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'
      : 'text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]',
  ].join(' ')
}

function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-strong)]">
      {initials}
    </div>
  )
}

function NavItemEntry({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation()
  const parentActive = location.pathname === item.to
  const childActive = item.children?.some((child) => location.pathname.startsWith(child.to)) ?? false
  const anyActive = parentActive || childActive
  const [expanded, setExpanded] = useState(anyActive)

  useEffect(() => {
    if (anyActive) setExpanded(true)
  }, [anyActive])

  const Icon = item.icon

  if (!item.children) {
    return (
      <NavLink
        className={({ isActive }) => navClassName(isActive, collapsed)}
        title={collapsed ? item.label : undefined}
        to={item.to}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    )
  }

  if (collapsed) {
    return (
      <>
        <NavLink
          className={({ isActive }) => navClassName(isActive || childActive, true)}
          title={item.label}
          to={item.to}
        >
          <Icon className="h-4 w-4 shrink-0" />
        </NavLink>
        {item.children.map((child) => {
          const ChildIcon = child.icon
          return (
            <NavLink
              key={child.to}
              className={({ isActive }) => navClassName(isActive, true)}
              title={child.label}
              to={child.to}
            >
              <ChildIcon className="h-4 w-4 shrink-0" />
            </NavLink>
          )
        })}
      </>
    )
  }

  return (
    <div>
      <div className="flex items-center">
        <NavLink
          className={({ isActive }) => [
            navClassName(isActive, false),
            'flex-1 min-w-0',
          ].join(' ')}
          to={item.to}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </NavLink>
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
          onClick={() => setExpanded((prev) => !prev)}
          type="button"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
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
  const { resolvedTheme, setTheme } = useTheme()
  const { signOut, user } = useAuth()
  const navigate = useNavigate()
  const isDark = resolvedTheme === 'dark'
  const [appSettings, setAppSettings] = useState<AppSettings>(loadAppSettings)
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true',
  )

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
    window.addEventListener('app-settings-updated', handleSettingsUpdate)
    return () => window.removeEventListener('app-settings-updated', handleSettingsUpdate)
  }, [])

  function handleSignOut() {
    signOut()
    navigate('/login', { replace: true })
  }

  const displayName = user?.displayName ?? user?.username ?? ''
  const roleLabel = user?.roles?.[0]
    ? user.roles[0].charAt(0).toUpperCase() + user.roles[0].slice(1)
    : 'User'

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {/* Sidebar */}
      <aside
        className={`relative hidden flex-col bg-[var(--panel)] transition-[width] duration-200 ease-in-out lg:flex ${
          collapsed ? 'w-[68px]' : 'w-60'
        }`}
      >
        {/* Logo */}
        <div className="flex h-16 shrink-0 items-center border-b border-[var(--border)] px-3">
          <div className={`flex items-center overflow-hidden ${collapsed ? 'justify-center w-full' : 'gap-2.5 px-2'}`}>
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
        <nav className="flex-1 overflow-y-auto px-2 py-4">
          <div className="space-y-0.5">
            {navigationItems.map((item) => (
              <NavItemEntry
                key={item.to}
                collapsed={collapsed}
                item={item}
              />
            ))}
          </div>
        </nav>

        {/* Bottom section */}
        <div className="shrink-0 border-t border-[var(--border)] p-2 space-y-1">
          {/* Theme toggle */}
          <button
            className={`flex w-full items-center rounded-md py-2.5 text-sm text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] ${
              collapsed ? 'justify-center px-2.5' : 'gap-3 px-3'
            }`}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            title={collapsed ? (isDark ? 'Light mode' : 'Dark mode') : undefined}
            type="button"
          >
            <SunMoon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{isDark ? 'Light mode' : 'Dark mode'}</span>}
          </button>

          {/* User info */}
          {collapsed ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <UserAvatar name={displayName} />
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
                <p className="truncate text-sm font-medium leading-tight">{displayName}</p>
                <p className="truncate text-xs text-[var(--muted)] leading-tight mt-0.5">{roleLabel}</p>
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
          )}
        </div>

        {/* Edge toggle handle */}
        <button
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-px top-0 z-10 h-full w-1 cursor-col-resize border-r border-[var(--border)] bg-transparent transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)]/20 active:bg-[var(--accent)]/30"
          onClick={toggleCollapsed}
          type="button"
        />
      </aside>

      {/* Mobile top bar */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-4 lg:hidden">
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
          <div className="flex items-center gap-1">
            {allMobileItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  className={({ isActive }) =>
                    [
                      'flex items-center justify-center rounded-lg p-2 text-sm transition',
                      isActive
                        ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                        : 'text-[var(--muted)] hover:bg-[var(--background)]',
                    ].join(' ')
                  }
                  to={item.to}
                >
                  <Icon className="h-4 w-4" />
                </NavLink>
              )
            })}
            <button
              className="flex items-center justify-center rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--background)]"
              onClick={handleSignOut}
              type="button"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-5 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
