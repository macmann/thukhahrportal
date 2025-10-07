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

async function syncCollection(name, docs = []) {
  await init();
  const collection = database.collection(name);
  const documents = Array.isArray(docs)
    ? docs.filter(doc => doc && typeof doc === 'object')
    : [];

  if (!documents.length) {
    await collection.deleteMany({});
    return;
  }

  const docsWithId = [];
  const docsWithoutId = [];

  documents.forEach(doc => {
    if (doc && doc._id) {
      docsWithId.push(doc);
    } else if (doc) {
      docsWithoutId.push(doc);
    }
  });

  if (docsWithId.length) {
    const operations = docsWithId.map(doc => ({
      replaceOne: {
        filter: { _id: doc._id },
        replacement: doc,
        upsert: true
      }
    }));
    if (operations.length) {
      await collection.bulkWrite(operations, { ordered: true });
    }
  }

  if (docsWithoutId.length) {
    const docsToInsert = docsWithoutId.map(doc => {
      const copy = { ...doc };
      delete copy._id;
      return copy;
    });
    if (docsToInsert.length) {
      const insertResult = await collection.insertMany(docsToInsert);
      const insertedIds = insertResult.insertedIds || {};
      docsWithoutId.forEach((doc, idx) => {
        const insertedId = insertedIds[idx] || insertedIds[String(idx)];
        if (insertedId) {
          doc._id = insertedId;
        }
      });
    }
  }

  const idsToKeep = documents
    .map(doc => (doc && doc._id ? doc._id : null))
    .filter(Boolean);

  if (idsToKeep.length) {
    await collection.deleteMany({ _id: { $nin: idsToKeep } });
  } else {
    await collection.deleteMany({});
  }
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

    const {
      employees = [],
      applications = [],
      users = [],
      positions = [],
      candidates = [],
      holidays = []
    } = this.data;

    await Promise.all([
      syncCollection('employees', employees),
      syncCollection('applications', applications),
      syncCollection('users', users),
      syncCollection('positions', positions),
      syncCollection('candidates', candidates),
      syncCollection('holidays', holidays)
    ]);
  }
};

module.exports = { db, init, getDatabase };
