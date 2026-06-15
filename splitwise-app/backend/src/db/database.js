const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Allow override of data directory (useful for persistent disks on hosts like Render)
let DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  if (process.env.DATA_DIR) {
    console.warn(`Warning: Failed to create DATA_DIR (${process.env.DATA_DIR}): ${err.message}. Falling back to local directory.`);
    DATA_DIR = path.join(__dirname, '../../data');
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } else {
    throw err;
  }
}
const DB_PATH = path.join(DATA_DIR, 'expenses.db');


const db = new DatabaseSync(DB_PATH);

// Enable WAL and foreign keys
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS group_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    joined_at TEXT NOT NULL,
    left_at TEXT
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES groups(id),
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    amount_inr REAL NOT NULL,
    exchange_rate REAL NOT NULL DEFAULT 1.0,
    paid_by_user_id INTEGER REFERENCES users(id),
    paid_by_name TEXT,
    expense_date TEXT NOT NULL,
    split_type TEXT NOT NULL,
    is_settlement INTEGER NOT NULL DEFAULT 0,
    imported INTEGER NOT NULL DEFAULT 0,
    import_row INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expense_splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER NOT NULL REFERENCES expenses(id),
    user_id INTEGER REFERENCES users(id),
    user_name TEXT NOT NULL,
    owed_amount REAL NOT NULL,
    share_units REAL,
    percentage REAL
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES groups(id),
    from_user_id INTEGER REFERENCES users(id),
    to_user_id INTEGER REFERENCES users(id),
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    settlement_date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS import_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    imported_at TEXT DEFAULT (datetime('now')),
    total_rows INTEGER,
    imported_rows INTEGER,
    skipped_rows INTEGER,
    anomalies TEXT
  );

  CREATE TABLE IF NOT EXISTS exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL DEFAULT 'INR',
    rate REAL NOT NULL,
    effective_date TEXT NOT NULL
  );
`);

// Seed exchange rate
try {
  db.prepare("INSERT INTO exchange_rates (from_currency, to_currency, rate, effective_date) VALUES (?, ?, ?, ?)")
    .run('USD', 'INR', 83.5, '2026-03-01');
} catch {}

// Seed users
const hash = bcrypt.hashSync('password123', 10);
['Aisha','Rohan','Priya','Meera','Sam','Dev'].forEach(name => {
  try {
    db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
      .run(name, `${name.toLowerCase()}@flat.com`, hash);
  } catch {}
});

// Seed group
try {
  db.prepare("INSERT INTO groups (id, name) VALUES (1, 'Flat 4B')").run();
} catch {}

// Seed memberships
const addMember = (name, joined, left) => {
  try {
    const u = db.prepare("SELECT id FROM users WHERE name = ?").get(name);
    if (u) db.prepare("INSERT INTO group_memberships (group_id, user_id, joined_at, left_at) VALUES (1, ?, ?, ?)").run(u.id, joined, left || null);
  } catch {}
};
addMember('Aisha', '2026-02-01', null);
addMember('Rohan', '2026-02-01', null);
addMember('Priya', '2026-02-01', null);
addMember('Meera', '2026-02-01', '2026-03-31');
addMember('Sam',   '2026-04-15', null);

module.exports = db;
