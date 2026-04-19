use tauri_plugin_sql::{Builder, Migration, MigrationKind};

const DB_URL: &str = "sqlite:business-ledger.db";

pub fn builder() -> Builder {
  let migrations = vec![
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
  ];

  Builder::default().add_migrations(DB_URL, migrations)
}
