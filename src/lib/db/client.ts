import Database from '@tauri-apps/plugin-sql'
import {
  BUSINESSES,
  getActiveBusinessId,
  type BusinessId,
} from './business'

const SHARED_SEEDED_PASSWORD_HASH =
  'pbkdf2$sha256$120000$UmwJ+8Wp9zmA4V6P792Snw==$Woc8PjrCgqYy2PUjXzQcHo9G+Y5Nh1nbtpde4YNCEIU='

// One connection promise per business so switching tenants is instant after
// the first connect, and we never mix handles between the Laundry and
// Cleaning databases.
const databasePromises = new Map<BusinessId, Promise<Database>>()

const demoUsers = [
  {
    displayName: 'Operations Manager',
    roleName: 'manager',
    username: 'manager',
  },
  {
    displayName: 'Front Desk Staff',
    roleName: 'staff',
    username: 'staff',
  },
]

async function ensureDemoUsers(database: Database) {
  for (const user of demoUsers) {
    // These demo users are seeded at runtime (after migration v27), so we set a
    // deterministic sync uuid derived from the username. Without this the
    // uuid-autogen trigger would give each device a random uuid for the same
    // logical user, and they'd duplicate after the first sync. Mirrors the
    // 'seed:user:<username>' scheme the v27 backfill uses for admin/manager/staff.
    await database.execute(
      `
        INSERT OR IGNORE INTO users (username, password_hash, display_name, is_active, uuid)
        VALUES ($1, $2, $3, 1, $4)
      `,
      [user.username, SHARED_SEEDED_PASSWORD_HASH, user.displayName, `seed:user:${user.username}`],
    )

    await database.execute(
      `
        INSERT OR IGNORE INTO user_roles (user_id, role_id)
        SELECT users.id, roles.id
        FROM users
        JOIN roles ON roles.name = $2
        WHERE users.username = $1
      `,
      [user.username, user.roleName],
    )
  }
}

type SeededFlagRow = { demo_seeded: number }

async function isDemoSeeded(database: Database) {
  try {
    const rows = await database.select<SeededFlagRow[]>(
      'SELECT demo_seeded FROM app_state WHERE id = 1',
    )
    return Number(rows[0]?.demo_seeded ?? 0) === 1
  } catch {
    // Table may not exist yet on very first migration run; treat as not seeded.
    return false
  }
}

async function markDemoSeeded(database: Database) {
  await database.execute(
    `
      INSERT INTO app_state (id, demo_seeded) VALUES (1, 1)
      ON CONFLICT(id) DO UPDATE SET demo_seeded = 1
    `,
  )
}

async function ensureSeedData(database: Database) {
  if (await isDemoSeeded(database)) {
    return
  }

  await ensureDemoUsers(database)

  await markDemoSeeded(database)
}

// The Cleaning business doesn't use laundry loads/kg/loyalty at all, but the
// shared migration (v13) seeds every SALE category with is_loadable = 1. That
// flag drives backend validation (saveTransaction requires a positive loads
// value for loadable sale categories). So for the cleaning DB we clear the
// flag on every connect — idempotent and harmless if already 0.
async function ensureCleaningCategoriesNotLoadable(database: Database) {
  try {
    await database.execute(
      'UPDATE categories SET is_loadable = 0 WHERE is_loadable = 1',
    )
  } catch (error) {
    console.warn('[db] failed to normalize cleaning categories', error)
  }
}

// The tauri-plugin-sql crate creates SQLite databases with the default journal
// mode (DELETE), which causes readers and writers to block each other. Under
// the plugin's sqlx connection pool this easily hits the 5s busy timeout (e.g.
// saving attendance fails after a ~5s wait). Enabling WAL once persists the
// setting in the database header and removes reader/writer contention for
// every connection thereafter. We also switch synchronous to NORMAL (safe with
// WAL) and raise the busy timeout for added safety on the current connection.
async function applyPragmas(database: Database) {
  try {
    await database.execute('PRAGMA journal_mode = WAL')
    await database.execute('PRAGMA synchronous = NORMAL')
    await database.execute('PRAGMA busy_timeout = 15000')
    await database.execute('PRAGMA foreign_keys = ON')
  } catch (error) {
    // Pragmas are a best-effort performance tweak; never block startup.
    console.warn('[db] failed to apply pragmas', error)
  }
}

function loadBusinessDatabase(business: BusinessId) {
  const definition = BUSINESSES[business]
  return Database.load(definition.dbUrl).then(async (database) => {
    await applyPragmas(database)
    await ensureSeedData(database)
    if (business === 'cleaning') {
      await ensureCleaningCategoriesNotLoadable(database)
    }
    return database
  })
}

export function getDatabaseFor(business: BusinessId) {
  let promise = databasePromises.get(business)
  if (!promise) {
    promise = loadBusinessDatabase(business)
    databasePromises.set(business, promise)
  }
  return promise
}

export function getDatabase() {
  return getDatabaseFor(getActiveBusinessId())
}
