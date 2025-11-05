/**
 * Migration: Add email/SMS tracking columns to invoices table
 */

async function up(db) {
  console.log('Running migration: Add invoices email/SMS columns...');

  const columns = [
    'email_sent INTEGER DEFAULT 0',
    'email_sent_at DATETIME',
    'sms_sent INTEGER DEFAULT 0',
    'sms_sent_at DATETIME',
  ];

  for (const column of columns) {
    const columnName = column.split(' ')[0];
    try {
      // Check if column exists
      const tableInfo = await db.all("PRAGMA table_info(invoices)");
      const columnExists = tableInfo.some(col => col.name === columnName);

      if (!columnExists) {
        await db.run(`ALTER TABLE invoices ADD COLUMN ${column}`);
        console.log(`✓ Added column: ${columnName}`);
      } else {
        console.log(`- Column already exists: ${columnName}`);
      }
    } catch (err) {
      console.error(`Failed to add column ${columnName}:`, err.message);
    }
  }

  console.log('Migration complete!');
}

async function down(db) {
  console.log('Down migration not implemented for SQLite');
}

module.exports = { up, down };
