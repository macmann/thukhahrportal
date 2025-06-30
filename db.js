// leave-system/db.js
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

// 1. Tell lowdb to use your db.json file, and give it default data:
const adapter = new JSONFile('db.json');
const defaultData = { employees: [], applications: [] };
const db = new Low(adapter, defaultData);

// 2. Initialization function (reads the file and writes defaults if missing):
async function init() {
  await db.read();   // loads db.data (or defaultData if file was empty)
  await db.write();  // ensures file exists with defaultData on first run
}

module.exports = { db, init };
