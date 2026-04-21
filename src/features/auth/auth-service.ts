import { getDatabase } from '../../lib/db/client'
import { verifyPasswordHash } from '../../lib/security/password'
import type { AuthUser } from './auth-types'

type AuthRow = {
  displayName: string
  id: number
  isActive: number
  passwordHash: string
  permissionKey: string | null
  roleName: string | null
  username: string
}

type SessionRow = Omit<AuthRow, 'passwordHash'>

function toAuthUser(row: SessionRow) {
  return {
    displayName: row.displayName,
    id: Number(row.id),
    isActive: Boolean(row.isActive),
    permissions: row.permissionKey ? [row.permissionKey] : [],
    roles: row.roleName ? [row.roleName] : [],
    username: row.username,
  } satisfies AuthUser
}

function buildUser(rows: SessionRow[]) {
  const [firstRow] = rows

  if (!firstRow) {
    return null
  }

  return {
    ...toAuthUser(firstRow),
    permissions: Array.from(
      new Set(rows.flatMap((row) => (row.permissionKey ? [row.permissionKey] : []))),
    ),
    roles: rows.flatMap((row) => (row.roleName ? [row.roleName] : [])),
  }
}

export async function loginWithCredentials(username: string, password: string) {
  const database = await getDatabase()
  const rows = await database.select<AuthRow[]>(
    `
      SELECT
        users.id AS id,
        users.username AS username,
        users.display_name AS displayName,
        users.password_hash AS passwordHash,
        users.is_active AS isActive,
        roles.name AS roleName,
        permissions.key AS permissionKey
      FROM users
      LEFT JOIN user_roles ON user_roles.user_id = users.id
      LEFT JOIN roles ON roles.id = user_roles.role_id
      LEFT JOIN role_permissions
        ON role_permissions.role_id = roles.id
       AND role_permissions.allowed = 1
      LEFT JOIN permissions ON permissions.id = role_permissions.permission_id
      WHERE users.username = $1
      ORDER BY roles.name, permissions.key
    `,
    [username],
  )

  const [firstRow] = rows

  if (!firstRow || !firstRow.isActive) {
    return null
  }

  const passwordMatches = await verifyPasswordHash(password, firstRow.passwordHash)

  if (!passwordMatches) {
    return null
  }

  return buildUser(rows)
}

export async function getUserSession(userId: number) {
  const database = await getDatabase()
  const rows = await database.select<SessionRow[]>(
    `
      SELECT
        users.id AS id,
        users.username AS username,
        users.display_name AS displayName,
        users.is_active AS isActive,
        roles.name AS roleName,
        permissions.key AS permissionKey
      FROM users
      LEFT JOIN user_roles ON user_roles.user_id = users.id
      LEFT JOIN roles ON roles.id = user_roles.role_id
      LEFT JOIN role_permissions
        ON role_permissions.role_id = roles.id
       AND role_permissions.allowed = 1
      LEFT JOIN permissions ON permissions.id = role_permissions.permission_id
      WHERE users.id = $1
      ORDER BY roles.name, permissions.key
    `,
    [userId],
  )

  const session = buildUser(rows)

  if (!session?.isActive) {
    return null
  }

  return session
}

// Used when switching active businesses (databases). Since each business has
// its own users table, a given user's numeric id may differ between databases
// — but seeded accounts share the same username, so we can re-resolve the
// session by username in the newly active database.
export async function getUserSessionByUsername(username: string) {
  const database = await getDatabase()
  const rows = await database.select<SessionRow[]>(
    `
      SELECT
        users.id AS id,
        users.username AS username,
        users.display_name AS displayName,
        users.is_active AS isActive,
        roles.name AS roleName,
        permissions.key AS permissionKey
      FROM users
      LEFT JOIN user_roles ON user_roles.user_id = users.id
      LEFT JOIN roles ON roles.id = user_roles.role_id
      LEFT JOIN role_permissions
        ON role_permissions.role_id = roles.id
       AND role_permissions.allowed = 1
      LEFT JOIN permissions ON permissions.id = role_permissions.permission_id
      WHERE users.username = $1
      ORDER BY roles.name, permissions.key
    `,
    [username],
  )

  const session = buildUser(rows)

  if (!session?.isActive) {
    return null
  }

  return session
}
