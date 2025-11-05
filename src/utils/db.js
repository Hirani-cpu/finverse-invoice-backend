/**
 * Database utility - wrapper around sqlite3
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/invoices.db';

let db;

function getDatabase() {
  if (!db) {
    // Ensure database directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`✓ Created database directory: ${dbDir}`);
    }

    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Database connection error:', err);
        throw err;
      }
      console.log(`✓ Database connected: ${DB_PATH}`);
    });

    // Initialize tables immediately (synchronously)
    initializeTables();
  }
  return db;
}

function initializeTables() {
  const schemas = [
    // invoices table
    `CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoiceNumber TEXT NOT NULL UNIQUE,
      customerName TEXT NOT NULL,
      customerEmail TEXT,
      customerPhone TEXT,
      grandTotal REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      invoiceDate TEXT,
      dueDate TEXT,
      items TEXT,
      send_status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    // invoice_settings table
    `CREATE TABLE IF NOT EXISTS invoice_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_enabled INTEGER DEFAULT 1,
      email_provider TEXT DEFAULT 'sendgrid',
      email_from TEXT,
      email_from_name TEXT,
      email_subject_template TEXT,
      email_body_template TEXT,
      sms_enabled INTEGER DEFAULT 0,
      sms_provider TEXT DEFAULT 'twilio',
      sms_template TEXT,
      auto_send_on_create INTEGER DEFAULT 1,
      signed_url_expiry_days INTEGER DEFAULT 7,
      max_retry_attempts INTEGER DEFAULT 3,
      retry_delay_minutes INTEGER DEFAULT 5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    // send_logs table
    `CREATE TABLE IF NOT EXISTS send_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      send_type TEXT NOT NULL,
      recipient TEXT,
      status TEXT NOT NULL,
      provider TEXT,
      provider_message_id TEXT,
      provider_response TEXT,
      triggered_by TEXT,
      trigger_type TEXT,
      queued_at DATETIME,
      sent_at DATETIME,
      delivered_at DATETIME,
      opened_at DATETIME,
      failed_at DATETIME,
      error_message TEXT,
      error_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`,

    // invoice_files table
    `CREATE TABLE IF NOT EXISTS invoice_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      file_hash TEXT,
      storage_type TEXT DEFAULT 'local',
      signed_url TEXT,
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`
  ];

  // Use serialize to ensure all table creations complete before other queries
  db.serialize(() => {
    console.log('Initializing database tables...');

    schemas.forEach((schema, index) => {
      db.run(schema, (err) => {
        if (err && !err.message.includes('already exists')) {
          console.error(`Error creating table ${index + 1}:`, err);
        } else {
          console.log(`✓ Table ${index + 1} ready`);
        }
      });
    });

    // Insert default settings if not exists
    db.get('SELECT COUNT(*) as count FROM invoice_settings', (err, row) => {
      if (!err && row && row.count === 0) {
        const defaultSettings = `
          INSERT INTO invoice_settings (
            email_enabled, email_provider, email_from, email_from_name,
            email_subject_template, auto_send_on_create
          ) VALUES (
            1, 'sendgrid', 'noreply@finverse.info', 'Finverse',
            'Invoice {{invoice_number}}', 1
          )
        `;
        db.run(defaultSettings, (err) => {
          if (!err) {
            console.log('✓ Default settings inserted');
          }
        });
      }
    });

    console.log('✓ Database initialization complete');

    // Run migrations
    runMigrations();
  });
}

async function runMigrations() {
  const path = require('path');
  const fs = require('fs');
  const migrationsDir = path.join(__dirname, '../migrations');

  try {
    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found, skipping migrations');
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.js'))
      .sort();

    for (const file of migrationFiles) {
      console.log(`Running migration: ${file}`);
      const migration = require(path.join(migrationsDir, file));
      await migration.up(dbOperations);
    }

    console.log('✓ All migrations complete');
  } catch (err) {
    console.error('Migration error:', err);
  }
}

// Promisified database operations
const dbOperations = {
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      getDatabase().run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      getDatabase().get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      getDatabase().all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  close() {
    return new Promise((resolve, reject) => {
      if (db) {
        db.close((err) => {
          if (err) reject(err);
          else {
            db = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  },
};

module.exports = dbOperations;
