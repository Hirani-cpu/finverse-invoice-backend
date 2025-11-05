/**
 * Database utility - wrapper around sqlite3
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || './data/invoices.db';

let db;

function getDatabase() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Database connection error:', err);
        throw err;
      }
      console.log('✓ Database connected');
    });
  }
  return db;
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
