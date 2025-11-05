/**
 * Migration: Add missing columns to send_logs table
 */

async function up(db) {
  console.log('Running migration: Add send_logs columns...');

  const columns = [
    'recipient TEXT',
    'provider_response TEXT',
    'triggered_by TEXT',
    'trigger_type TEXT',
    'queued_at DATETIME',
    'failed_at DATETIME',
    'error_code TEXT',
  ];

  for (const column of columns) {
    const columnName = column.split(' ')[0];
    try {
      // Check if column exists
      const tableInfo = await db.all("PRAGMA table_info(send_logs)");
      const columnExists = tableInfo.some(col => col.name === columnName);

      if (!columnExists) {
        await db.run(`ALTER TABLE send_logs ADD COLUMN ${column}`);
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
  // SQLite doesn't support DROP COLUMN easily, so we skip down migration
  console.log('Down migration not implemented for SQLite');
}

module.exports = { up, down };
