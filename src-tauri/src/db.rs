use tauri_plugin_sql::{Builder, Migration, MigrationKind};

// Each business gets its own SQLite database so that data is fully isolated
// between the Laundry and Cleaning operations. Both databases share the same
// schema — they register identical migrations — so switching between them at
// runtime gives the user an independent tenant with the same feature set.
const LAUNDRY_DB_URL: &str = "sqlite:business-ledger.db";
const CLEANING_DB_URL: &str = "sqlite:business-ledger-cleaning.db";

// Every table that participates in cross-device sync. Each of these gets a
// `uuid` (the globally-unique cross-device key), an `updated_at` change marker,
// and three triggers (uuid autogen, updated_at bump, tombstone-on-delete). The
// integer PKs stay untouched for fast local joins; sync keys purely on `uuid`.
// `app_state` is intentionally excluded — it is device-local (demo_seeded).
//
// This is the v27 table set. Tables added later (suppliers, purchase_orders,
// purchase_order_items in v29) get the same metadata via `build_sync_metadata_for`
// inside their own migration — they are NOT added here (v27 already ran). The
// runtime sync registry (src/lib/sync/registry.ts) discovers every table with a
// `uuid` column, so all of them participate regardless of this list.
const SYNC_TABLES: &[&str] = &[
  "users",
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "transaction_types",
  "categories",
  "transactions",
  "transaction_line_items",
  "income_share_rules",
  "income_share_monthly_versions",
  "income_share_snapshots",
  "incident_reports",
  "inventory_categories",
  "inventory_items",
  "inventory_item_units",
  "inventory_movements",
  "inventory_maintenance_records",
  "customers",
  "staff",
  "staff_attendance",
  "staff_payrolls",
  "staff_payroll_items",
  "staff_payroll_adjustments",
  "staff_cash_advances",
  "staff_recurring_adjustments",
  "transaction_templates",
  "transaction_template_items",
  "payroll_settings",
  "loyalty_settings",
];

// Syncable tables that do NOT already carry an `updated_at` column and therefore
// need one added so the sync engine has a reliable "changed since" signal.
const TABLES_NEEDING_UPDATED_AT: &[&str] = &[
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "transaction_types",
  "categories",
  "transaction_line_items",
  "income_share_rules",
  "income_share_monthly_versions",
  "income_share_snapshots",
  "inventory_item_units",
  "inventory_movements",
  "staff_payroll_items",
  "staff_payroll_adjustments",
  "transaction_template_items",
  "payroll_settings",
  "loyalty_settings",
];

// v27 is generated rather than hand-written: 30 tables x (add column, backfill,
// unique index, 3 triggers) is ~150 statements that must stay perfectly in sync
// with the table list above. Generating from one source of truth removes that
// whole class of copy-paste bug. The produced String is leaked to `'static`
// because `Migration.sql` requires it; the builder runs once at startup so this
// is a fixed, one-time allocation for the life of the process.
fn build_sync_metadata_sql() -> String {
  let mut sql = String::new();

  // --- Bookkeeping tables -------------------------------------------------
  // sync_state: simple key/value store (last_synced_at high-water mark per
  // table, this device's id, bootstrap-completed flag, primary-device flag).
  // sync_tombstones: every local hard-delete is recorded here by an AFTER
  // DELETE trigger, so deletions can be propagated to other devices without
  // converting the app's many delete paths (and their FK cascades) to soft
  // deletes. `pushed = 0` means "not yet uploaded to the cloud".
  sql.push_str(
    "CREATE TABLE IF NOT EXISTS sync_state (\n  key TEXT PRIMARY KEY,\n  value TEXT\n);\n\
     CREATE TABLE IF NOT EXISTS sync_tombstones (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  table_name TEXT NOT NULL,\n  row_uuid TEXT NOT NULL,\n  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  pushed INTEGER NOT NULL DEFAULT 0,\n  UNIQUE (table_name, row_uuid)\n);\n\
     CREATE INDEX IF NOT EXISTS idx_sync_tombstones_pushed ON sync_tombstones(pushed);\n\n",
  );

  // --- updated_at columns (only where missing) ----------------------------
  // ADD COLUMN cannot take a non-constant default (CURRENT_TIMESTAMP is
  // disallowed), so add it nullable then backfill in a separate UPDATE.
  for table in TABLES_NEEDING_UPDATED_AT {
    sql.push_str(&format!("ALTER TABLE {table} ADD COLUMN updated_at TEXT;\n"));
    sql.push_str(&format!(
      "UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;\n"
    ));
  }
  sql.push('\n');

  // --- uuid columns -------------------------------------------------------
  for table in SYNC_TABLES {
    sql.push_str(&format!("ALTER TABLE {table} ADD COLUMN uuid TEXT;\n"));
  }
  sql.push('\n');

  // --- synced_at columns --------------------------------------------------
  // "Last successfully uploaded" marker. A row needs pushing when
  // `updated_at > synced_at` (or synced_at IS NULL). The push step sets
  // synced_at = updated_at after a successful upload; the pull step sets both
  // to the cloud value when applying a remote row. This cleanly separates
  // genuine local edits from applied remote rows, so pulled rows never echo
  // back on the next push. Left NULL here so all pre-existing rows are treated
  // as dirty and uploaded on the very first sync.
  for table in SYNC_TABLES {
    sql.push_str(&format!("ALTER TABLE {table} ADD COLUMN synced_at TEXT;\n"));
  }
  sql.push('\n');

  // --- Deterministic uuids for seed rows ----------------------------------
  // Seed rows exist identically on every device (created by earlier
  // migrations). If they got random uuids per device, the same logical row
  // would appear twice after sync. Deriving the uuid from the row's natural
  // key makes every device compute the same value, so seeds dedupe. The value
  // need not look like a real UUID — it only needs to be stable + unique.
  sql.push_str(
    "UPDATE permissions SET uuid = 'seed:permission:' || key WHERE uuid IS NULL;\n\
     UPDATE roles SET uuid = 'seed:role:' || name WHERE is_system = 1 AND uuid IS NULL;\n\
     UPDATE transaction_types SET uuid = 'seed:txtype:' || code WHERE is_system = 1 AND uuid IS NULL;\n\
     UPDATE income_share_rules SET uuid = 'seed:income_rule:' || name WHERE uuid IS NULL;\n\
     UPDATE inventory_categories SET uuid = 'seed:inv_category:' || code WHERE is_system = 1 AND uuid IS NULL;\n\
     UPDATE categories SET uuid = 'seed:category:' || (SELECT tt.code FROM transaction_types tt WHERE tt.id = categories.transaction_type_id) || ':' || label WHERE is_seeded = 1 AND uuid IS NULL;\n\
     UPDATE users SET uuid = 'seed:user:' || username WHERE username IN ('admin', 'manager', 'staff') AND uuid IS NULL;\n\
     UPDATE payroll_settings SET uuid = 'seed:payroll_settings:1' WHERE uuid IS NULL;\n\
     UPDATE loyalty_settings SET uuid = 'seed:loyalty_settings:1' WHERE uuid IS NULL;\n\
     UPDATE role_permissions SET uuid = 'seed:roleperm:' || (SELECT name FROM roles WHERE roles.id = role_permissions.role_id) || ':' || (SELECT key FROM permissions WHERE permissions.id = role_permissions.permission_id) WHERE uuid IS NULL;\n\
     UPDATE user_roles SET uuid = 'seed:userrole:' || (SELECT username FROM users WHERE users.id = user_roles.user_id) || ':' || (SELECT name FROM roles WHERE roles.id = user_roles.role_id) WHERE uuid IS NULL;\n\n",
  );

  // --- Random uuids for everything else -----------------------------------
  // 16 random bytes as hex = a 32-char globally-unique key. Collision odds are
  // negligible and the UNIQUE index below would catch any anyway.
  for table in SYNC_TABLES {
    sql.push_str(&format!(
      "UPDATE {table} SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;\n"
    ));
  }
  sql.push('\n');

  // --- Unique index on uuid (after backfill so it can't fail) -------------
  for table in SYNC_TABLES {
    sql.push_str(&format!(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_uuid ON {table}(uuid);\n"
    ));
  }
  sql.push('\n');

  // --- Triggers -----------------------------------------------------------
  for table in SYNC_TABLES {
    // 1. Auto-assign a uuid to any row inserted without one, so the app's
    //    existing INSERT sites need zero changes.
    sql.push_str(&format!(
      "CREATE TRIGGER IF NOT EXISTS trg_{table}_uuid_ins AFTER INSERT ON {table} FOR EACH ROW WHEN NEW.uuid IS NULL BEGIN UPDATE {table} SET uuid = lower(hex(randomblob(16))) WHERE rowid = NEW.rowid; END;\n"
    ));
    // 2. Bump updated_at on any UPDATE that didn't already set it. The inner
    //    UPDATE changes updated_at, so on its re-fire NEW.updated_at differs
    //    from OLD.updated_at and the WHEN guard is false — no infinite loop.
    //    The `synced_at` guard means the push step writing synced_at alone does
    //    NOT re-bump updated_at (which would make the row perpetually dirty).
    sql.push_str(&format!(
      "CREATE TRIGGER IF NOT EXISTS trg_{table}_touch AFTER UPDATE ON {table} FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at AND NEW.synced_at IS OLD.synced_at BEGIN UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE rowid = NEW.rowid; END;\n"
    ));
    // 3. Record a tombstone on delete (incl. FK-cascade deletes) so the
    //    deletion can be pushed to other devices.
    sql.push_str(&format!(
      "CREATE TRIGGER IF NOT EXISTS trg_{table}_tomb AFTER DELETE ON {table} FOR EACH ROW WHEN OLD.uuid IS NOT NULL BEGIN INSERT OR IGNORE INTO sync_tombstones (table_name, row_uuid) VALUES ('{table}', OLD.uuid); END;\n"
    ));
  }

  sql
}

// Generate the standard sync metadata (uuid/synced_at columns, updated_at where
// missing, unique index, and the three sync triggers) for tables introduced
// AFTER v27. This mirrors the generic portion of `build_sync_metadata_sql` but
// deliberately omits the one-time bookkeeping-table creation and the seed-uuid
// derivation, which only apply to the original v27 table set. New tables get a
// random uuid backfill (they have no cross-device seed rows). The produced
// String is leaked to `'static` by the caller.
fn build_sync_metadata_for(tables: &[&str], needing_updated_at: &[&str]) -> String {
  let mut sql = String::new();

  for table in needing_updated_at {
    sql.push_str(&format!("ALTER TABLE {table} ADD COLUMN updated_at TEXT;\n"));
    sql.push_str(&format!(
      "UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;\n"
    ));
  }

  for table in tables {
    sql.push_str(&format!("ALTER TABLE {table} ADD COLUMN uuid TEXT;\n"));
    sql.push_str(&format!("ALTER TABLE {table} ADD COLUMN synced_at TEXT;\n"));
  }
  sql.push('\n');

  for table in tables {
    sql.push_str(&format!(
      "UPDATE {table} SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;\n"
    ));
  }
  sql.push('\n');

  for table in tables {
    sql.push_str(&format!(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_uuid ON {table}(uuid);\n"
    ));
  }
  sql.push('\n');

  for table in tables {
    sql.push_str(&format!(
      "CREATE TRIGGER IF NOT EXISTS trg_{table}_uuid_ins AFTER INSERT ON {table} FOR EACH ROW WHEN NEW.uuid IS NULL BEGIN UPDATE {table} SET uuid = lower(hex(randomblob(16))) WHERE rowid = NEW.rowid; END;\n"
    ));
    sql.push_str(&format!(
      "CREATE TRIGGER IF NOT EXISTS trg_{table}_touch AFTER UPDATE ON {table} FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at AND NEW.synced_at IS OLD.synced_at BEGIN UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE rowid = NEW.rowid; END;\n"
    ));
    sql.push_str(&format!(
      "CREATE TRIGGER IF NOT EXISTS trg_{table}_tomb AFTER DELETE ON {table} FOR EACH ROW WHEN OLD.uuid IS NOT NULL BEGIN INSERT OR IGNORE INTO sync_tombstones (table_name, row_uuid) VALUES ('{table}', OLD.uuid); END;\n"
    ));
  }

  sql
}

// v29 — inventory overhaul groundwork:
//   * current_stock cache on inventory_items (maintained by triggers), so the
//     catalogue list stops recomputing SUM(IN)-SUM(OUT) on every read. The
//     column is derived + device-local and is EXCLUDED from the sync payload
//     (RESERVED_COLUMNS in src/lib/sync/registry.ts) — pulled movements rebuild
//     it locally via the triggers rather than a stale snapshot double-counting.
//   * category_id backfill so it becomes the single source of truth (legacy
//     `category` text column kept for backup/sync compatibility).
//   * suppliers table + inventory_items.supplier_id (seeded from the existing
//     free-text supplier names).
//   * purchase_orders + purchase_order_items (draft -> ordered -> received).
// Additive/non-destructive. The generated String is leaked to `'static`.
fn build_v29_sql() -> String {
  let mut sql = String::new();

  // 1. Stock cache + backfill + supporting index.
  sql.push_str(
    "ALTER TABLE inventory_items ADD COLUMN current_stock REAL NOT NULL DEFAULT 0;\n\
     UPDATE inventory_items SET current_stock = COALESCE((\n\
       SELECT SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity\n\
                       WHEN m.movement_type = 'OUT' THEN -m.quantity\n\
                       ELSE 0 END)\n\
       FROM inventory_movements m WHERE m.item_id = inventory_items.id), 0);\n\
     CREATE INDEX IF NOT EXISTS idx_inv_mov_item_type_date ON inventory_movements(item_id, movement_type, movement_date);\n\n",
  );

  // Stock-cache triggers. The UPDATE trigger reverses the OLD delta and applies
  // the NEW one via two statements, so a changed item_id is handled correctly.
  sql.push_str(
    "CREATE TRIGGER IF NOT EXISTS trg_inv_mov_stock_ins AFTER INSERT ON inventory_movements FOR EACH ROW BEGIN UPDATE inventory_items SET current_stock = current_stock + (CASE WHEN NEW.movement_type = 'IN' THEN NEW.quantity WHEN NEW.movement_type = 'OUT' THEN -NEW.quantity ELSE 0 END) WHERE id = NEW.item_id; END;\n\
     CREATE TRIGGER IF NOT EXISTS trg_inv_mov_stock_del AFTER DELETE ON inventory_movements FOR EACH ROW BEGIN UPDATE inventory_items SET current_stock = current_stock - (CASE WHEN OLD.movement_type = 'IN' THEN OLD.quantity WHEN OLD.movement_type = 'OUT' THEN -OLD.quantity ELSE 0 END) WHERE id = OLD.item_id; END;\n\
     CREATE TRIGGER IF NOT EXISTS trg_inv_mov_stock_upd AFTER UPDATE ON inventory_movements FOR EACH ROW BEGIN UPDATE inventory_items SET current_stock = current_stock - (CASE WHEN OLD.movement_type = 'IN' THEN OLD.quantity WHEN OLD.movement_type = 'OUT' THEN -OLD.quantity ELSE 0 END) WHERE id = OLD.item_id; UPDATE inventory_items SET current_stock = current_stock + (CASE WHEN NEW.movement_type = 'IN' THEN NEW.quantity WHEN NEW.movement_type = 'OUT' THEN -NEW.quantity ELSE 0 END) WHERE id = NEW.item_id; END;\n\n",
  );

  // 2. Category backfill — only where a legacy code maps to a known category.
  sql.push_str(
    "UPDATE inventory_items SET category_id = (\n\
       SELECT id FROM inventory_categories WHERE inventory_categories.code = inventory_items.category\n\
     ) WHERE category_id IS NULL\n\
       AND EXISTS (SELECT 1 FROM inventory_categories WHERE inventory_categories.code = inventory_items.category);\n\n",
  );

  // 3. Suppliers + item.supplier_id (seed from existing free-text names).
  sql.push_str(
    "CREATE TABLE IF NOT EXISTS suppliers (\n\
       id INTEGER PRIMARY KEY AUTOINCREMENT,\n\
       name TEXT NOT NULL,\n\
       contact_name TEXT NOT NULL DEFAULT '',\n\
       phone TEXT NOT NULL DEFAULT '',\n\
       email TEXT NOT NULL DEFAULT '',\n\
       notes TEXT NOT NULL DEFAULT '',\n\
       is_active INTEGER NOT NULL DEFAULT 1,\n\
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n\
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n\
     );\n\
     INSERT INTO suppliers (name)\n\
       SELECT DISTINCT TRIM(supplier) FROM inventory_items\n\
       WHERE TRIM(COALESCE(supplier, '')) <> ''\n\
         AND TRIM(supplier) NOT IN (SELECT name FROM suppliers);\n\
     ALTER TABLE inventory_items ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);\n\
     UPDATE inventory_items SET supplier_id = (\n\
       SELECT id FROM suppliers WHERE suppliers.name = TRIM(inventory_items.supplier)\n\
     ) WHERE TRIM(COALESCE(supplier, '')) <> '';\n\n",
  );

  // 4. Purchase orders.
  sql.push_str(
    "CREATE TABLE IF NOT EXISTS purchase_orders (\n\
       id INTEGER PRIMARY KEY AUTOINCREMENT,\n\
       supplier_id INTEGER REFERENCES suppliers(id),\n\
       status TEXT NOT NULL DEFAULT 'draft',\n\
       reference TEXT NOT NULL DEFAULT '',\n\
       order_date TEXT NOT NULL DEFAULT '',\n\
       expected_date TEXT NOT NULL DEFAULT '',\n\
       received_date TEXT NOT NULL DEFAULT '',\n\
       notes TEXT NOT NULL DEFAULT '',\n\
       created_by INTEGER REFERENCES users(id),\n\
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n\
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n\
     );\n\
     CREATE TABLE IF NOT EXISTS purchase_order_items (\n\
       id INTEGER PRIMARY KEY AUTOINCREMENT,\n\
       purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,\n\
       item_id INTEGER NOT NULL REFERENCES inventory_items(id),\n\
       quantity REAL NOT NULL DEFAULT 0,\n\
       unit_cost REAL NOT NULL DEFAULT 0,\n\
       received_quantity REAL NOT NULL DEFAULT 0,\n\
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n\
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n\
     );\n\
     CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);\n\n",
  );

  // 5. Sync metadata for the new tables (uuid/synced_at/index/triggers). They
  //    were created with updated_at already, so none need it added.
  sql.push_str(&build_sync_metadata_for(
    &["suppliers", "purchase_orders", "purchase_order_items"],
    &[],
  ));

  sql
}

fn build_migrations() -> Vec<Migration> {
  let mut migrations = vec![
    Migration {
      version: 1,
      description: "create_core_tables",
      sql: r#"
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          is_system INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS permissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS role_permissions (
          role_id INTEGER NOT NULL,
          permission_id INTEGER NOT NULL,
          allowed INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (role_id, permission_id),
          FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
          FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_roles (
          user_id INTEGER NOT NULL,
          role_id INTEGER NOT NULL,
          PRIMARY KEY (user_id, role_id),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS transaction_types (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL,
          is_system INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_type_id INTEGER NOT NULL,
          label TEXT NOT NULL,
          is_seeded INTEGER NOT NULL DEFAULT 0,
          is_archived INTEGER NOT NULL DEFAULT 0,
          UNIQUE (transaction_type_id, label),
          FOREIGN KEY (transaction_type_id) REFERENCES transaction_types (id)
        );

        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entry_date TEXT NOT NULL,
          transaction_type_id INTEGER NOT NULL,
          category_id INTEGER NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          amount REAL NOT NULL CHECK (amount >= 0),
          staff_count INTEGER CHECK (staff_count IS NULL OR staff_count >= 0),
          created_by INTEGER,
          updated_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (transaction_type_id) REFERENCES transaction_types (id),
          FOREIGN KEY (category_id) REFERENCES categories (id),
          FOREIGN KEY (created_by) REFERENCES users (id),
          FOREIGN KEY (updated_by) REFERENCES users (id)
        );

        CREATE TABLE IF NOT EXISTS income_share_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          percentage REAL NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS income_share_monthly_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          month_key TEXT NOT NULL,
          rule_id INTEGER NOT NULL,
          percentage REAL NOT NULL,
          UNIQUE (month_key, rule_id),
          FOREIGN KEY (rule_id) REFERENCES income_share_rules (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS income_share_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          period_type TEXT NOT NULL CHECK (period_type IN ('day', 'month')),
          period_key TEXT NOT NULL,
          rule_id INTEGER NOT NULL,
          base_amount REAL NOT NULL,
          allocated_amount REAL NOT NULL,
          FOREIGN KEY (rule_id) REFERENCES income_share_rules (id) ON DELETE CASCADE
        );
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "seed_core_master_data",
      sql: r#"
        INSERT OR IGNORE INTO roles (name, is_system)
        VALUES
          ('admin', 1),
          ('manager', 1),
          ('staff', 1);

        INSERT OR IGNORE INTO permissions (key, label)
        VALUES
          ('view_dashboard', 'View dashboard'),
          ('manage_transactions', 'Create transactions'),
          ('edit_transaction', 'Edit transactions'),
          ('delete_transaction', 'Delete transactions'),
          ('export_data', 'Export data'),
          ('manage_users', 'Manage users'),
          ('manage_master_data', 'Manage master data'),
          ('edit_income_share', 'Edit income share setup');

        INSERT OR IGNORE INTO transaction_types (code, label, is_system)
        VALUES
          ('SALE', 'Sale', 1),
          ('EXPENSE', 'Expense', 1),
          ('OPERATING EXPENSE', 'Operating Expense', 1);

        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Walk-in', 1 FROM transaction_types WHERE code = 'SALE';
        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Regular Customer', 1 FROM transaction_types WHERE code = 'SALE';
        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Dorm', 1 FROM transaction_types WHERE code = 'SALE';

        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Staff Salary', 1 FROM transaction_types WHERE code = 'EXPENSE';
        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Food', 1 FROM transaction_types WHERE code = 'EXPENSE';
        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Gasoline', 1 FROM transaction_types WHERE code = 'EXPENSE';
        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Supplies', 1 FROM transaction_types WHERE code = 'EXPENSE';
        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Other', 1 FROM transaction_types WHERE code = 'EXPENSE';

        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Wage', 1 FROM transaction_types WHERE code = 'OPERATING EXPENSE';
        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Food', 1 FROM transaction_types WHERE code = 'OPERATING EXPENSE';
        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Gasoline', 1 FROM transaction_types WHERE code = 'OPERATING EXPENSE';
        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Supplies', 1 FROM transaction_types WHERE code = 'OPERATING EXPENSE';
        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Other', 1 FROM transaction_types WHERE code = 'OPERATING EXPENSE';
        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Rent', 1 FROM transaction_types WHERE code = 'OPERATING EXPENSE';

        INSERT OR IGNORE INTO income_share_rules (name, percentage, is_active)
        VALUES
          ('Share A', 35.00, 1),
          ('Share B', 27.00, 1),
          ('Share C', 20.00, 1),
          ('Share D', 15.00, 1);

        INSERT OR IGNORE INTO role_permissions (role_id, permission_id, allowed)
        SELECT roles.id, permissions.id, 1
        FROM roles
        CROSS JOIN permissions
        WHERE roles.name = 'admin';

        INSERT OR IGNORE INTO role_permissions (role_id, permission_id, allowed)
        SELECT roles.id, permissions.id, 1
        FROM roles
        JOIN permissions
          ON permissions.key IN (
            'view_dashboard',
            'manage_transactions',
            'edit_transaction',
            'export_data',
            'edit_income_share'
          )
        WHERE roles.name = 'manager';

        INSERT OR IGNORE INTO role_permissions (role_id, permission_id, allowed)
        SELECT roles.id, permissions.id, 1
        FROM roles
        JOIN permissions
          ON permissions.key IN (
            'view_dashboard',
            'manage_transactions'
          )
        WHERE roles.name = 'staff';
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 3,
      description: "seed_initial_admin_user",
      sql: r#"
        INSERT OR IGNORE INTO users (
          username,
          password_hash,
          display_name,
          is_active
        )
        VALUES (
          'admin',
          'pbkdf2$sha256$120000$UmwJ+8Wp9zmA4V6P792Snw==$Woc8PjrCgqYy2PUjXzQcHo9G+Y5Nh1nbtpde4YNCEIU=',
          'System Administrator',
          1
        );

        INSERT OR IGNORE INTO user_roles (user_id, role_id)
        SELECT users.id, roles.id
        FROM users
        JOIN roles ON roles.name = 'admin'
        WHERE users.username = 'admin';
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 4,
      description: "create_incident_reports_table",
      sql: r#"
        CREATE TABLE IF NOT EXISTS incident_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          incident_date TEXT NOT NULL,
          incident_time TEXT NOT NULL DEFAULT '',
          staff_on_duty TEXT NOT NULL DEFAULT '',
          incident_type TEXT NOT NULL DEFAULT '',
          what_happened TEXT NOT NULL DEFAULT '',
          customer_name TEXT NOT NULL DEFAULT '',
          contact_number TEXT NOT NULL DEFAULT '',
          action_taken TEXT NOT NULL DEFAULT '',
          handled_by TEXT NOT NULL DEFAULT '',
          estimated_loss REAL NOT NULL DEFAULT 0,
          quantity REAL NOT NULL DEFAULT 0,
          items_involved TEXT NOT NULL DEFAULT '',
          remarks TEXT NOT NULL DEFAULT '',
          created_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users (id)
        );
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 5,
      description: "create_inventory_tables",
      sql: r#"
        CREATE TABLE IF NOT EXISTS inventory_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          unit_type TEXT NOT NULL DEFAULT 'per_pc',
          unit_label TEXT NOT NULL DEFAULT 'pcs',
          cost_per_unit REAL NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS inventory_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL,
          movement_type TEXT NOT NULL,
          quantity REAL NOT NULL,
          unit_cost REAL NOT NULL DEFAULT 0,
          notes TEXT NOT NULL DEFAULT '',
          movement_date TEXT NOT NULL,
          created_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (item_id) REFERENCES inventory_items (id),
          FOREIGN KEY (created_by) REFERENCES users (id)
        );

        INSERT OR IGNORE INTO permissions (key, label)
        VALUES
          ('manage_inventory', 'Manage inventory'),
          ('delete_inventory', 'Delete inventory entries');

        INSERT OR IGNORE INTO role_permissions (role_id, permission_id, allowed)
        SELECT roles.id, permissions.id, 1
        FROM roles
        CROSS JOIN permissions
        WHERE roles.name = 'admin'
          AND permissions.key IN ('manage_inventory', 'delete_inventory');

        INSERT OR IGNORE INTO role_permissions (role_id, permission_id, allowed)
        SELECT roles.id, permissions.id, 1
        FROM roles
        JOIN permissions ON permissions.key = 'manage_inventory'
        WHERE roles.name = 'manager';
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 6,
      description: "add_low_stock_threshold_to_inventory_items",
      sql: r#"
        ALTER TABLE inventory_items ADD COLUMN low_stock_threshold REAL NOT NULL DEFAULT 10;
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 7,
      description: "enhance_inventory_items_for_laundry",
      sql: r#"
        ALTER TABLE inventory_items ADD COLUMN category TEXT NOT NULL DEFAULT 'consumable';
        ALTER TABLE inventory_items ADD COLUMN supplier TEXT NOT NULL DEFAULT '';
        ALTER TABLE inventory_items ADD COLUMN status TEXT NOT NULL DEFAULT '';
        ALTER TABLE inventory_items ADD COLUMN last_maintenance_date TEXT NOT NULL DEFAULT '';
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 8,
      description: "create_inventory_maintenance_records",
      sql: r#"
        CREATE TABLE IF NOT EXISTS inventory_maintenance_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL,
          service_date TEXT NOT NULL,
          service_type TEXT NOT NULL DEFAULT 'preventive',
          performed_by TEXT NOT NULL DEFAULT '',
          cost REAL NOT NULL DEFAULT 0,
          description TEXT NOT NULL DEFAULT '',
          next_service_date TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'completed',
          created_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (item_id) REFERENCES inventory_items (id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users (id)
        );

        CREATE INDEX IF NOT EXISTS idx_maintenance_item ON inventory_maintenance_records(item_id);
        CREATE INDEX IF NOT EXISTS idx_maintenance_date ON inventory_maintenance_records(service_date);
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 9,
      description: "create_customers",
      sql: r#"
        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          company TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_by INTEGER,
          updated_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users (id),
          FOREIGN KEY (updated_by) REFERENCES users (id)
        );

        CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name COLLATE NOCASE);
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 10,
      description: "add_customer_to_transactions",
      sql: r#"
        ALTER TABLE transactions ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;

        CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(customer_id);
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 11,
      description: "create_staff_and_payroll",
      sql: r#"
        CREATE TABLE IF NOT EXISTS payroll_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          cutoff_day INTEGER NOT NULL DEFAULT 6,
          holiday_default_multiplier REAL NOT NULL DEFAULT 1.0
        );

        INSERT OR IGNORE INTO payroll_settings (id, cutoff_day, holiday_default_multiplier)
        VALUES (1, 6, 1.0);

        CREATE TABLE IF NOT EXISTS staff (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          first_name TEXT NOT NULL,
          middle_name TEXT NOT NULL DEFAULT '',
          last_name TEXT NOT NULL,
          address TEXT NOT NULL DEFAULT '',
          birthdate TEXT NOT NULL DEFAULT '',
          civil_status TEXT NOT NULL DEFAULT 'Single',
          emergency_contact_name TEXT NOT NULL DEFAULT '',
          emergency_contact_number TEXT NOT NULL DEFAULT '',
          spouse_name TEXT NOT NULL DEFAULT '',
          default_rate REAL NOT NULL DEFAULT 0 CHECK (default_rate >= 0),
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_by INTEGER,
          updated_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users (id),
          FOREIGN KEY (updated_by) REFERENCES users (id)
        );

        CREATE INDEX IF NOT EXISTS idx_staff_names ON staff(last_name COLLATE NOCASE, first_name COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS staff_attendance (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          staff_id INTEGER NOT NULL,
          attendance_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'present',
          multiplier REAL NOT NULL DEFAULT 1.0,
          rate_override REAL,
          computed_pay REAL NOT NULL DEFAULT 0,
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (staff_id) REFERENCES staff (id) ON DELETE CASCADE,
          UNIQUE (staff_id, attendance_date)
        );

        CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff_date ON staff_attendance(staff_id, attendance_date);

        CREATE TABLE IF NOT EXISTS staff_payrolls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          staff_id INTEGER NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          pay_date TEXT NOT NULL,
          cutoff_day INTEGER NOT NULL,
          gross_pay REAL NOT NULL DEFAULT 0,
          total_adjustments REAL NOT NULL DEFAULT 0,
          net_pay REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'void')),
          transaction_id INTEGER,
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (staff_id) REFERENCES staff (id) ON DELETE CASCADE,
          FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_staff_payrolls_staff ON staff_payrolls(staff_id, period_end DESC);

        CREATE TABLE IF NOT EXISTS staff_payroll_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payroll_id INTEGER NOT NULL,
          attendance_id INTEGER NOT NULL,
          entry_date TEXT NOT NULL,
          status TEXT NOT NULL,
          rate_used REAL NOT NULL,
          multiplier REAL NOT NULL,
          pay_amount REAL NOT NULL,
          FOREIGN KEY (payroll_id) REFERENCES staff_payrolls (id) ON DELETE CASCADE,
          FOREIGN KEY (attendance_id) REFERENCES staff_attendance (id) ON DELETE CASCADE,
          UNIQUE (attendance_id)
        );

        CREATE INDEX IF NOT EXISTS idx_staff_payroll_items_payroll ON staff_payroll_items(payroll_id);

        CREATE TABLE IF NOT EXISTS staff_payroll_adjustments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payroll_id INTEGER NOT NULL,
          label TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bonus', 'deduction')),
          amount REAL NOT NULL CHECK (amount >= 0),
          FOREIGN KEY (payroll_id) REFERENCES staff_payrolls (id) ON DELETE CASCADE
        );

        INSERT OR IGNORE INTO permissions (key, label)
        VALUES
          ('manage_staff', 'Manage staff'),
          ('process_payroll', 'Process payroll');

        INSERT OR IGNORE INTO role_permissions (role_id, permission_id, allowed)
        SELECT roles.id, permissions.id, 1
        FROM roles
        CROSS JOIN permissions
        WHERE roles.name IN ('admin', 'manager')
          AND permissions.key IN ('manage_staff', 'process_payroll');
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 12,
      description: "link_inventory_movements_to_transactions",
      sql: r#"
        ALTER TABLE inventory_movements ADD COLUMN transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE;

        CREATE INDEX IF NOT EXISTS idx_inventory_movements_transaction_id ON inventory_movements (transaction_id);
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 13,
      description: "loyalty_loads_and_category_flags",
      sql: r#"
        ALTER TABLE categories ADD COLUMN is_loadable INTEGER NOT NULL DEFAULT 0;

        ALTER TABLE transactions ADD COLUMN kg REAL;
        ALTER TABLE transactions ADD COLUMN loads REAL;
        ALTER TABLE transactions ADD COLUMN is_loyalty_reward INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS loyalty_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          kg_per_load REAL NOT NULL DEFAULT 8,
          free_after_loads INTEGER NOT NULL DEFAULT 9
        );

        INSERT OR IGNORE INTO loyalty_settings (id, kg_per_load, free_after_loads)
        VALUES (1, 8, 9);

        UPDATE categories
        SET is_loadable = 1
        WHERE transaction_type_id = (SELECT id FROM transaction_types WHERE code = 'SALE');
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 14,
      description: "customers_loyalty_enabled_flag",
      sql: r#"
        ALTER TABLE customers ADD COLUMN is_loyalty_enabled INTEGER NOT NULL DEFAULT 0;
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 15,
      description: "staff_cash_advances",
      sql: r#"
        ALTER TABLE payroll_settings
          ADD COLUMN auto_deduct_cash_advances INTEGER NOT NULL DEFAULT 1;

        INSERT OR IGNORE INTO categories (transaction_type_id, label, is_seeded)
        SELECT id, 'Cash Advance', 1 FROM transaction_types WHERE code = 'EXPENSE';

        CREATE TABLE IF NOT EXISTS staff_cash_advances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          staff_id INTEGER NOT NULL,
          advance_date TEXT NOT NULL,
          amount REAL NOT NULL CHECK (amount > 0),
          notes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'outstanding'
            CHECK (status IN ('outstanding', 'settled', 'void')),
          transaction_id INTEGER,
          settled_payroll_id INTEGER,
          settled_at TEXT,
          created_by INTEGER,
          updated_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (staff_id) REFERENCES staff (id) ON DELETE CASCADE,
          FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE SET NULL,
          FOREIGN KEY (settled_payroll_id) REFERENCES staff_payrolls (id) ON DELETE SET NULL,
          FOREIGN KEY (created_by) REFERENCES users (id),
          FOREIGN KEY (updated_by) REFERENCES users (id)
        );

        CREATE INDEX IF NOT EXISTS idx_cash_advances_staff
          ON staff_cash_advances(staff_id, status, advance_date);
        CREATE INDEX IF NOT EXISTS idx_cash_advances_payroll
          ON staff_cash_advances(settled_payroll_id);
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 16,
      description: "transaction_inventory_templates",
      sql: r#"
        CREATE TABLE IF NOT EXISTS transaction_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS transaction_template_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          template_id INTEGER NOT NULL REFERENCES transaction_templates(id) ON DELETE CASCADE,
          inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
          quantity REAL NOT NULL CHECK (quantity > 0),
          sort_order INTEGER NOT NULL DEFAULT 0,
          UNIQUE (template_id, inventory_item_id)
        );

        CREATE INDEX IF NOT EXISTS idx_transaction_template_items_template
          ON transaction_template_items(template_id);

        ALTER TABLE inventory_movements ADD COLUMN template_id INTEGER
          REFERENCES transaction_templates(id);

        CREATE INDEX IF NOT EXISTS idx_inventory_movements_template_id
          ON inventory_movements(template_id);
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 17,
      description: "app_state_demo_seeded_flag",
      sql: r#"
        CREATE TABLE IF NOT EXISTS app_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          demo_seeded INTEGER NOT NULL DEFAULT 0
        );

        INSERT OR IGNORE INTO app_state (id, demo_seeded)
        SELECT 1, CASE
          WHEN EXISTS (SELECT 1 FROM transactions LIMIT 1) THEN 1
          ELSE 0
        END;
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 18,
      description: "transaction_line_items",
      sql: r#"
        CREATE TABLE IF NOT EXISTS transaction_line_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
          label TEXT NOT NULL,
          price REAL NOT NULL CHECK (price >= 0),
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_transaction_line_items_transaction
          ON transaction_line_items(transaction_id);

        CREATE INDEX IF NOT EXISTS idx_transaction_line_items_inventory_item
          ON transaction_line_items(inventory_item_id);
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 19,
      description: "link_inventory_movements_to_line_items",
      sql: r#"
        ALTER TABLE inventory_movements ADD COLUMN line_item_id INTEGER
          REFERENCES transaction_line_items(id) ON DELETE CASCADE;

        CREATE INDEX IF NOT EXISTS idx_inventory_movements_line_item_id
          ON inventory_movements(line_item_id);
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 20,
      description: "inventory_categories_master_and_item_category_id",
      sql: r#"
        CREATE TABLE IF NOT EXISTS inventory_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL,
          is_system INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT OR IGNORE INTO inventory_categories (code, label, is_system, is_active, sort_order)
        VALUES
          ('consumable', 'Consumable', 1, 1, 0),
          ('detergent_chemicals', 'Detergent & Chemicals', 1, 1, 1),
          ('packaging', 'Packaging', 1, 1, 2),
          ('cleaning_materials', 'Cleaning Materials', 1, 1, 3),
          ('equipment', 'Equipment', 1, 1, 4),
          ('other', 'Other', 1, 1, 99);

        ALTER TABLE inventory_items
          ADD COLUMN category_id INTEGER REFERENCES inventory_categories(id);

        CREATE INDEX IF NOT EXISTS idx_inventory_items_category_id
          ON inventory_items(category_id);

        UPDATE inventory_items
        SET category_id = (
          SELECT c.id
          FROM inventory_categories c
          WHERE c.code = inventory_items.category
          LIMIT 1
        )
        WHERE category_id IS NULL;

        UPDATE inventory_items
        SET category_id = (
          SELECT c.id
          FROM inventory_categories c
          WHERE c.code = 'other'
          LIMIT 1
        )
        WHERE category_id IS NULL;
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 21,
      description: "line_item_quantity_and_inventory_selling_price",
      sql: r#"
        -- Quantity + unit price on transaction line items.
        -- The existing `price` column continues to mean "line total" so
        -- existing read sites keep working without changes.
        ALTER TABLE transaction_line_items
          ADD COLUMN quantity REAL NOT NULL DEFAULT 1;

        ALTER TABLE transaction_line_items
          ADD COLUMN unit_price REAL NOT NULL DEFAULT 0;

        -- Backfill: legacy rows had no quantity, so the stored `price` was
        -- effectively the unit price for a single unit.
        UPDATE transaction_line_items
        SET unit_price = price
        WHERE unit_price = 0;

        -- Selling price for inventory items, used to auto-fill the unit price
        -- of additional items on a sale. Default to 0; we backfill from cost
        -- so first-time auto-fill behaves like before.
        ALTER TABLE inventory_items
          ADD COLUMN selling_price REAL NOT NULL DEFAULT 0;

        UPDATE inventory_items
        SET selling_price = cost_per_unit
        WHERE selling_price = 0;
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 22,
      description: "transaction_template_items_unit_price",
      sql: r#"
        -- Per-line unit price on sale templates so a combo can lock in a
        -- price that differs from the inventory item's default selling price.
        ALTER TABLE transaction_template_items
          ADD COLUMN unit_price REAL NOT NULL DEFAULT 0;

        -- Backfill: prefer the inventory item's selling price, fall back to
        -- cost-per-unit so existing templates start with a sensible price.
        UPDATE transaction_template_items
        SET unit_price = (
          SELECT
            CASE
              WHEN i.selling_price > 0 THEN i.selling_price
              ELSE i.cost_per_unit
            END
          FROM inventory_items i
          WHERE i.id = transaction_template_items.inventory_item_id
        )
        WHERE unit_price = 0;
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 23,
      description: "alt_selling_units_for_inventory",
      sql: r#"
        -- Multiple alternate selling units per item (e.g. "cup" with 31 per
        -- gallon, "sachet" with 64 per gallon). Stock is kept in the base
        -- unit of the inventory item; alt units are display + sale shortcuts.
        CREATE TABLE IF NOT EXISTS inventory_item_units (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
          unit_label TEXT NOT NULL,
          units_per_base REAL NOT NULL CHECK (units_per_base > 0),
          unit_price REAL NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(item_id, unit_label)
        );

        CREATE INDEX IF NOT EXISTS idx_inventory_item_units_item
          ON inventory_item_units(item_id);

        -- Snapshot the chosen sale unit on each line item so historical
        -- transactions display correctly even if alt unit definitions change.
        --   sale_unit_label  : '' (base unit) or e.g. 'cup'
        --   sale_unit_factor : 1 (base) or e.g. 31 (cups per gallon)
        --   sale_unit_id     : informational FK; ON DELETE SET NULL so
        --                      removing an alt unit doesn't break history.
        ALTER TABLE transaction_line_items
          ADD COLUMN sale_unit_label TEXT NOT NULL DEFAULT '';

        ALTER TABLE transaction_line_items
          ADD COLUMN sale_unit_factor REAL NOT NULL DEFAULT 1;

        ALTER TABLE transaction_line_items
          ADD COLUMN sale_unit_id INTEGER
            REFERENCES inventory_item_units(id) ON DELETE SET NULL;

        -- Same snapshot fields on template items so a template remembers
        -- which unit it was authored in.
        ALTER TABLE transaction_template_items
          ADD COLUMN sale_unit_label TEXT NOT NULL DEFAULT '';

        ALTER TABLE transaction_template_items
          ADD COLUMN sale_unit_factor REAL NOT NULL DEFAULT 1;

        ALTER TABLE transaction_template_items
          ADD COLUMN sale_unit_id INTEGER
            REFERENCES inventory_item_units(id) ON DELETE SET NULL;
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 24,
      description: "staff_recurring_adjustments",
      sql: r#"
        -- Standing earnings/deductions defined on a staff member that
        -- auto-populate every payroll (e.g. SSS, a loan repayment, a monthly
        -- transport allowance). `kind` mirrors the per-payroll line items:
        -- 'earning' adds to gross, 'deduction' subtracts from net.
        --
        -- Optional balance tracking (has_balance = 1) models a fixed-total
        -- obligation such as a loan: `remaining_balance` is decremented each
        -- time the item is applied and the item auto-deactivates at zero.
        CREATE TABLE IF NOT EXISTS staff_recurring_adjustments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          staff_id INTEGER NOT NULL,
          label TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('earning', 'deduction')),
          category TEXT NOT NULL DEFAULT 'other',
          amount REAL NOT NULL CHECK (amount >= 0),
          taxable INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          has_balance INTEGER NOT NULL DEFAULT 0,
          original_balance REAL,
          remaining_balance REAL,
          start_date TEXT NOT NULL DEFAULT '',
          end_date TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          created_by INTEGER,
          updated_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (staff_id) REFERENCES staff (id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users (id),
          FOREIGN KEY (updated_by) REFERENCES users (id)
        );

        CREATE INDEX IF NOT EXISTS idx_recurring_adjustments_staff
          ON staff_recurring_adjustments(staff_id, is_active);
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 25,
      description: "generalize_payroll_adjustments",
      sql: r#"
        -- Rebuild staff_payroll_adjustments to a general, categorized
        -- earning/deduction line-item table. SQLite cannot alter a CHECK
        -- constraint in place, so we create the new shape, copy + map the
        -- legacy rows ('bonus' -> earning/bonus, cash-advance labels ->
        -- deduction/cash_advance), then swap it in.
        CREATE TABLE staff_payroll_adjustments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payroll_id INTEGER NOT NULL,
          label TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('earning', 'deduction')),
          category TEXT NOT NULL DEFAULT 'other',
          amount REAL NOT NULL CHECK (amount >= 0),
          taxable INTEGER NOT NULL DEFAULT 0,
          quantity REAL,
          rate REAL,
          source TEXT NOT NULL DEFAULT 'manual'
            CHECK (source IN ('manual', 'recurring', 'cash_advance', 'overtime')),
          recurring_id INTEGER,
          FOREIGN KEY (payroll_id) REFERENCES staff_payrolls (id) ON DELETE CASCADE,
          FOREIGN KEY (recurring_id) REFERENCES staff_recurring_adjustments (id) ON DELETE SET NULL
        );

        INSERT INTO staff_payroll_adjustments_new
          (id, payroll_id, label, kind, category, amount, taxable, quantity, rate, source, recurring_id)
        SELECT
          id,
          payroll_id,
          label,
          CASE WHEN kind = 'bonus' THEN 'earning' ELSE 'deduction' END,
          CASE
            WHEN kind = 'bonus' THEN 'bonus'
            WHEN label LIKE 'Cash advance%' THEN 'cash_advance'
            ELSE 'other'
          END,
          amount,
          0,
          NULL,
          NULL,
          CASE WHEN label LIKE 'Cash advance%' THEN 'cash_advance' ELSE 'manual' END,
          NULL
        FROM staff_payroll_adjustments;

        DROP TABLE staff_payroll_adjustments;
        ALTER TABLE staff_payroll_adjustments_new RENAME TO staff_payroll_adjustments;

        CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_payroll
          ON staff_payroll_adjustments(payroll_id);
        CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_recurring
          ON staff_payroll_adjustments(recurring_id);
      "#,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 26,
      description: "payroll_overtime_and_totals",
      sql: r#"
        -- Overtime is now an hours-based earning line; derive an hourly rate
        -- from the day rate using standard_day_hours, priced at
        -- overtime_multiplier.
        ALTER TABLE payroll_settings ADD COLUMN standard_day_hours REAL NOT NULL DEFAULT 8;
        ALTER TABLE payroll_settings ADD COLUMN overtime_multiplier REAL NOT NULL DEFAULT 1.25;

        -- Split the payslip header into base pay (attendance days) + earnings
        -- (bonus/allowance/overtime) − deductions. gross_pay now means
        -- base_pay + total_earnings; net_pay = gross_pay − total_deductions.
        ALTER TABLE staff_payrolls ADD COLUMN base_pay REAL NOT NULL DEFAULT 0;
        ALTER TABLE staff_payrolls ADD COLUMN total_earnings REAL NOT NULL DEFAULT 0;
        ALTER TABLE staff_payrolls ADD COLUMN total_deductions REAL NOT NULL DEFAULT 0;

        -- Backfill historical rows. Legacy gross_pay was attendance-only, so it
        -- is the base. Fold earnings into gross to match the new convention;
        -- net_pay and total_adjustments stay numerically identical.
        UPDATE staff_payrolls SET base_pay = gross_pay;
        UPDATE staff_payrolls SET total_earnings = (
          SELECT COALESCE(SUM(amount), 0) FROM staff_payroll_adjustments a
          WHERE a.payroll_id = staff_payrolls.id AND a.kind = 'earning'
        );
        UPDATE staff_payrolls SET total_deductions = (
          SELECT COALESCE(SUM(amount), 0) FROM staff_payroll_adjustments a
          WHERE a.payroll_id = staff_payrolls.id AND a.kind = 'deduction'
        );
        UPDATE staff_payrolls SET gross_pay = base_pay + total_earnings;
      "#,
      kind: MigrationKind::Up,
    },
  ];

  // v27 — sync metadata. Additive and non-destructive: only ADD COLUMN,
  // backfills, indexes, and triggers. No DROP/DELETE, so existing data is
  // preserved and simply becomes the first payload uploaded on first sync.
  // The generated SQL is leaked to `'static` as required by Migration.sql.
  migrations.push(Migration {
    version: 27,
    description: "add_sync_metadata",
    sql: Box::leak(build_sync_metadata_sql().into_boxed_str()),
    kind: MigrationKind::Up,
  });

  // v28 — one-time recurring items. A one-time earning/deduction seeds into the
  // next payroll like a recurring one, but is auto-deactivated when that payroll
  // is finalized (and reactivated if it is voided). Additive, non-destructive.
  migrations.push(Migration {
    version: 28,
    description: "recurring_adjustments_one_time",
    sql: r#"
      ALTER TABLE staff_recurring_adjustments
        ADD COLUMN one_time INTEGER NOT NULL DEFAULT 0;
    "#,
    kind: MigrationKind::Up,
  });

  // v29 — inventory overhaul: stock-cache column + triggers, category_id
  // backfill, suppliers table, and purchase orders. See build_v29_sql. Generated
  // (leaked to 'static) because it mixes static DDL with per-table sync metadata.
  migrations.push(Migration {
    version: 29,
    description: "inventory_stock_cache_suppliers_purchase_orders",
    sql: Box::leak(build_v29_sql().into_boxed_str()),
    kind: MigrationKind::Up,
  });

  migrations
}

pub fn builder() -> Builder {
  Builder::default()
    .add_migrations(LAUNDRY_DB_URL, build_migrations())
    .add_migrations(CLEANING_DB_URL, build_migrations())
}
