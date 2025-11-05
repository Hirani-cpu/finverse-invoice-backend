/**
 * Database Migration Script
 * Reads schema.sql and creates all required tables
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './data/invoices.db';
const SCHEMA_PATH = path.join(__dirname, '../../../database/schema_clean.sql');

console.log('Starting database migration...');
console.log(`Database: ${DB_PATH}`);
console.log(`Schema: ${SCHEMA_PATH}`);

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`Created directory: ${dbDir}`);
}

// Connect to database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    process.exit(1);
  }
  console.log('Connected to database');
});

// Read schema file
let schema;
try {
  schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  console.log('Schema file loaded successfully');
} catch (err) {
  console.error('Error reading schema file:', err.message);
  process.exit(1);
}

// Split schema into individual statements
// Remove comments first
const schemaNoComments = schema
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');

const statements = schemaNoComments
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0);

console.log(`Found ${statements.length} SQL statements to execute`);

// Execute each statement
let completed = 0;
let failed = 0;

db.serialize(() => {
  statements.forEach((statement, index) => {
    db.run(statement + ';', (err) => {
      if (err) {
        // Ignore "table already exists" errors
        if (!err.message.includes('already exists')) {
          console.error(`Error executing statement ${index + 1}:`, err.message);
          failed++;
        }
      } else {
        completed++;
      }

      // Check if we're done
      if (completed + failed === statements.length) {
        console.log('\n=== Migration Summary ===');
        console.log(`✓ Completed: ${completed} statements`);
        if (failed > 0) {
          console.log(`✗ Failed: ${failed} statements`);
        }
        console.log('========================\n');

        // Insert default settings if not exists
        insertDefaultSettings();
      }
    });
  });
});

function insertDefaultSettings() {
  console.log('Checking for default settings...');

  db.get('SELECT COUNT(*) as count FROM invoice_settings', (err, row) => {
    if (err) {
      console.error('Error checking settings:', err);
      db.close();
      return;
    }

    if (row.count === 0) {
      console.log('Inserting default settings...');

      const defaultSettings = {
        email_enabled: 1,
        email_provider: 'sendgrid',
        email_from: process.env.EMAIL_FROM || 'noreply@example.com',
        email_from_name: process.env.EMAIL_FROM_NAME || 'Invoice System',
        email_subject_template: 'Invoice {{invoice_number}} from {{company_name}}',
        email_body_template: `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2>Invoice from {{company_name}}</h2>
  <p>Dear {{customer_name}},</p>
  <p>Your invoice <strong>{{invoice_number}}</strong> for <strong>{{amount_due}}</strong> is ready.</p>
  <p>
    <a href="{{invoice_link}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">View Invoice</a>
  </p>
  <p>Due Date: {{due_date}}</p>
  <p>Thank you for your business!</p>
  <p style="font-size: 12px; color: #666;">
    If you have any questions, please contact us at {{company_email}}
  </p>
</body>
</html>
        `.trim(),
        sms_enabled: 0,
        sms_provider: 'twilio',
        sms_template: 'Hi {{customer_name}}, invoice {{invoice_number}} ({{amount_due}}) is ready. View: {{invoice_link}}',
        auto_send_on_create: 1,
        signed_url_expiry_days: 7,
        max_retry_attempts: 3,
        retry_delay_minutes: 5
      };

      const sql = `
        INSERT INTO invoice_settings (
          email_enabled, email_provider, email_from, email_from_name,
          email_subject_template, email_body_template,
          sms_enabled, sms_provider, sms_template,
          auto_send_on_create, signed_url_expiry_days,
          max_retry_attempts, retry_delay_minutes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.run(sql, [
        defaultSettings.email_enabled,
        defaultSettings.email_provider,
        defaultSettings.email_from,
        defaultSettings.email_from_name,
        defaultSettings.email_subject_template,
        defaultSettings.email_body_template,
        defaultSettings.sms_enabled,
        defaultSettings.sms_provider,
        defaultSettings.sms_template,
        defaultSettings.auto_send_on_create,
        defaultSettings.signed_url_expiry_days,
        defaultSettings.max_retry_attempts,
        defaultSettings.retry_delay_minutes
      ], (err) => {
        if (err) {
          console.error('Error inserting default settings:', err);
        } else {
          console.log('✓ Default settings inserted');
        }

        db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
          } else {
            console.log('\n✓ Migration completed successfully!');
          }
          process.exit(0);
        });
      });
    } else {
      console.log('Settings already exist, skipping insert');
      db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('\n✓ Migration completed successfully!');
        }
        process.exit(0);
      });
    }
  });
}
