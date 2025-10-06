// leave-system/db.js
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'brillarhrportal';

const client = new MongoClient(MONGODB_URI);
let database;

async function init() {
  if (!database) {
    await client.connect();
    database = client.db(DB_NAME);
  }
}

function getDatabase() {
  if (!database) {
    throw new Error('Database connection has not been initialized');
  }
  return database;
}

const db = {
  data: null,
  async read() {
    await init();
    const [employees, applications, users, positions, candidates, holidays] = await Promise.all([
      database.collection('employees').find().toArray(),
      database.collection('applications').find().toArray(),
      database.collection('users').find().toArray(),
      database.collection('positions').find().toArray(),
      database.collection('candidates').find().toArray(),
      database.collection('holidays').find().toArray()
    ]);
    this.data = { employees, applications, users, positions, candidates, holidays };
  },
  async write() {
    if (!this.data) return;
    await init();
    const {
      employees = [],
      applications = [],
      users = [],
      positions = [],
      candidates = [],
      holidays = []
    } = this.data;
    await Promise.all([
      database.collection('employees').deleteMany({}),
      database.collection('applications').deleteMany({}),
      database.collection('users').deleteMany({}),
      database.collection('positions').deleteMany({}),
      database.collection('candidates').deleteMany({}),
      database.collection('holidays').deleteMany({})
    ]);
    if (employees.length) await database.collection('employees').insertMany(employees);
    if (applications.length) await database.collection('applications').insertMany(applications);
    if (users.length) await database.collection('users').insertMany(users);
    if (positions.length) await database.collection('positions').insertMany(positions);
    if (candidates.length) await database.collection('candidates').insertMany(candidates);
    if (holidays.length) await database.collection('holidays').insertMany(holidays);
  }
};

module.exports = { db, init, getDatabase };
