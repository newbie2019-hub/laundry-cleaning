import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, UserPlus, X } from 'lucide-react'
import {
  listRolePermissionMatrix,
  listRoles,
  listUsers,
  saveUser,
  updateRolePermission,
  type Role,
  type RolePermissionMatrix,
  type UserListItem,
} from '../../../lib/db/repository'
import { useAuth } from '../../auth/use-auth'

type UsersState = {
  matrix: RolePermissionMatrix | null
  roles: Role[]
  users: UserListItem[]
}

const emptyState: UsersState = {
  matrix: null,
  roles: [],
  users: [],
}

export function UsersPage() {
  const { hasPermission } = useAuth()
  const [state, setState] = useState<UsersState>(emptyState)
  const [search, setSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([])
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canManageUsers = hasPermission('manage_users')

  const load = useCallback(async () => {
    const [users, roles, matrix] = await Promise.all([
      listUsers(),
      listRoles(),
      listRolePermissionMatrix(),
    ])
    setState({ matrix, roles, users })
  }, [])

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        await load()
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load users.')
        }
      }
    }

    void run()
    return () => { cancelled = true }
  }, [load])

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return state.users
    return state.users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.roles.some((r) => r.toLowerCase().includes(q)),
    )
  }, [state.users, search])

  function openCreateForm() {
    setSelectedUserId(null)
    setUsername('')
    setDisplayName('')
    setPassword('')
    setIsActive(true)
    setSelectedRoleIds([])
    setShowForm(true)
  }

  function openEditForm(user: UserListItem) {
    const roleIds = state.roles
      .filter((role) => user.roles.includes(role.name))
      .map((role) => role.id)

    setSelectedUserId(user.id)
    setUsername(user.username)
    setDisplayName(user.displayName)
    setPassword('')
    setIsActive(user.isActive)
    setSelectedRoleIds(roleIds)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setSelectedUserId(null)
  }

  async function handleSaveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canManageUsers) return

    await saveUser({
      displayName,
      id: selectedUserId ?? undefined,
      isActive,
      password: password || undefined,
      roleIds: selectedRoleIds,
      username,
    })

    await load()
    closeForm()
  }

  async function handlePermissionToggle(roleId: number, permissionId: number, allowed: boolean) {
    await updateRolePermission(roleId, permissionId, allowed)
    await load()
  }

  const inputClass =
    'h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40'

  return (
    <section className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users & Roles</h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Manage user accounts and role permissions
          </p>
        </div>
        {canManageUsers && (
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            onClick={openCreateForm}
            type="button"
          >
            <UserPlus className="h-4 w-4" />
            New user
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-red-400/50 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Users list */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        {/* Search bar */}
        <div className="border-b border-[var(--border)] p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, username, or role…"
              type="search"
              value={search}
            />
          </div>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_auto] items-center px-4 py-2.5 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">User</span>
          <span className="hidden text-xs font-medium uppercase tracking-wider text-[var(--muted)] sm:block">Roles</span>
          <span className="hidden text-xs font-medium uppercase tracking-wider text-[var(--muted)] sm:block">Status</span>
          <span className="sr-only">Actions</span>
        </div>

        {/* Rows */}
        <div className="divide-y divide-[var(--border)]">
          {filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-[var(--muted)]">
              <Search className="h-6 w-6 opacity-40" />
              <span>{search ? 'No users match your search.' : 'No users found.'}</span>
            </div>
          ) : (
            filteredUsers.map((user) => (
              <div
                key={user.id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3.5 transition hover:bg-[var(--background)] sm:grid-cols-[2fr_1fr_1fr_auto]"
              >
                {/* Identity */}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user.displayName}</p>
                  <p className="truncate text-xs text-[var(--muted)]">{user.username}</p>
                </div>

                {/* Roles */}
                <div className="hidden sm:flex sm:flex-wrap sm:gap-1">
                  {user.roles.length === 0 ? (
                    <span className="text-xs text-[var(--muted)]">—</span>
                  ) : (
                    user.roles.map((r) => (
                      <span
                        key={r}
                        className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent-strong)]"
                      >
                        {r}
                      </span>
                    ))
                  )}
                </div>

                {/* Status */}
                <div className="hidden sm:block">
                  <span
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                      user.isActive
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : 'bg-[var(--muted)]/10 text-[var(--muted)]',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'h-1.5 w-1.5 rounded-full',
                        user.isActive ? 'bg-emerald-500' : 'bg-[var(--muted)]',
                      ].join(' ')}
                    />
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Edit */}
                <button
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)] disabled:opacity-40"
                  disabled={!canManageUsers}
                  onClick={() => openEditForm(user)}
                  type="button"
                >
                  Edit
                </button>
              </div>
            ))
          )}
        </div>

        {filteredUsers.length > 0 && (
          <div className="border-t border-[var(--border)] px-4 py-2.5">
            <p className="text-xs text-[var(--muted)]">
              {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'}
              {search ? ` matching "${search}"` : ''}
            </p>
          </div>
        )}
      </div>

      {/* Role permissions */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold">Role permissions</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Changes apply immediately</p>
        </div>
        <div className="overflow-x-auto p-5">
          <table className="min-w-full border-separate border-spacing-y-1.5 text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="px-3 py-2 font-medium uppercase tracking-wider">Permission</th>
                {state.matrix?.roles.map((role) => (
                  <th key={role.id} className="px-3 py-2 font-medium uppercase tracking-wider">
                    {role.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.matrix?.permissions.map((permission) => (
                <tr key={permission.id}>
                  <td className="rounded-l-lg border border-[var(--border)] bg-[var(--background)] px-3 py-3">
                    <p className="font-medium text-sm">{permission.label}</p>
                    <p className="text-xs text-[var(--muted)]">{permission.key}</p>
                  </td>
                  {(state.matrix?.roles ?? []).map((role) => (
                    <td
                      key={`${role.id}-${permission.id}`}
                      className="border border-[var(--border)] bg-[var(--background)] px-3 py-3 text-center last:rounded-r-lg"
                    >
                      <input
                        checked={role.allowedPermissionIds.includes(permission.id)}
                        onChange={(e) => {
                          void handlePermissionToggle(role.id, permission.id, e.target.checked)
                        }}
                        type="checkbox"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over / modal form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            onClick={closeForm}
          />

          {/* Panel */}
          <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-[#1a1a1a]">
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {selectedUserId ? 'Edit user' : 'New user'}
              </h2>
              <button
                className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                onClick={closeForm}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <form
              className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5"
              onSubmit={(e) => { void handleSaveUser(e) }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Username</span>
                  <input
                    className={inputClass}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    value={username}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Display name</span>
                  <input
                    className={inputClass}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                    value={displayName}
                  />
                </label>
              </div>

              <label className="space-y-1.5">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Password{selectedUserId ? ' (leave blank to keep current)' : ''}
                </span>
                <input
                  className={inputClass}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  value={password}
                />
              </label>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Roles</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {state.roles.map((role) => (
                    <label
                      key={role.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 transition hover:border-gray-300 dark:border-gray-700 dark:text-gray-200"
                    >
                      <input
                        checked={selectedRoleIds.includes(role.id)}
                        className="accent-blue-500"
                        onChange={(e) =>
                          setSelectedRoleIds((current) =>
                            e.target.checked
                              ? [...current, role.id]
                              : current.filter((id) => id !== role.id),
                          )
                        }
                        type="checkbox"
                      />
                      {role.name}
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-800 dark:text-gray-200">
                <input
                  checked={isActive}
                  className="accent-blue-500"
                  onChange={(e) => setIsActive(e.target.checked)}
                  type="checkbox"
                />
                Active user
              </label>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Actions */}
              <div className="flex gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
                <button
                  className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                  onClick={closeForm}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="flex-1 rounded-lg bg-[var(--accent)] py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                  disabled={!canManageUsers}
                  type="submit"
                >
                  {selectedUserId ? 'Update' : 'Create user'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
