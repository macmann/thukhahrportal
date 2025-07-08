// leave-system/db.js
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const fs = require('fs');
const path = require('path');

// --- Database path setup ---
const DATA_DIR = path.join(__dirname, 'mnt', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'db.json');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Tell lowdb to use the persistent db.json file and provide default data
const adapter = new JSONFile(DB_PATH);
const defaultData = { employees: [], applications: [], users: [] };
const db = new Low(adapter, defaultData);

// Initialization function (reads the file and writes defaults if missing)
async function init() {
  await db.read();   // loads db.data (or defaultData if file was empty)
  // Ensure all collections exist
  if (!db.data.users) db.data.users = [];
  await db.write();  // ensures file exists with defaultData on first run
}

module.exports = { db, init, DB_PATH };
