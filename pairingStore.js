const { randomBytes } = require('crypto');
const { getDatabase } = require('./db');

const REQUESTS_COLLECTION = 'pair_requests';
const AUDIT_COLLECTION = 'pair_audit_logs';

function now() {
  return new Date();
}

function generateId() {
  return randomBytes(16).toString('hex');
}

async function ensureIndexes() {
  const database = getDatabase();
  const requests = database.collection(REQUESTS_COLLECTION);
  await Promise.all([
    requests.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    requests.createIndex({ clientId: 1, status: 1, expiresAt: 1 }),
    requests.createIndex({ pollLeaseExpiresAt: 1 }),
    requests.createIndex({ createdAt: 1 })
  ]);

  const audits = database.collection(AUDIT_COLLECTION);
  await Promise.all([
    audits.createIndex({ requestId: 1, createdAt: 1 }),
    audits.createIndex({ createdAt: 1 })
  ]);
}

async function logAuditEvent(event) {
  const database = getDatabase();
  const audits = database.collection(AUDIT_COLLECTION);
  const entry = {
    ...event,
    createdAt: event.createdAt || now()
  };
  await audits.insertOne(entry);
  return entry;
}

async function createPairingRequest({ requestId, userId, clientId, tabId = null, scope, ttlSeconds }) {
  const database = getDatabase();
  const requests = database.collection(REQUESTS_COLLECTION);
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
  const doc = {
    _id: requestId,
    requestId,
    userId,
    clientId,
    tabId,
    scope,
    status: 'pending',
    ttlSeconds,
    createdAt,
    expiresAt
  };
  await requests.insertOne(doc);
  await logAuditEvent({
    requestId,
    event: 'request.init',
    actor: { type: 'user', userId },
    metadata: { clientId, tabId, ttlSeconds }
  });
  return doc;
}

async function leasePendingRequest({ clientId, agentId, clientInstanceId, leaseDurationMs }) {
  const database = getDatabase();
  const requests = database.collection(REQUESTS_COLLECTION);
  const current = now();
  const leaseExpiresAt = new Date(current.getTime() + leaseDurationMs);
  const claimToken = generateId();
  const result = await requests.findOneAndUpdate(
    {
      clientId,
      expiresAt: { $gt: current },
      $or: [
        { status: 'pending' },
        { status: 'polled', pollLeaseExpiresAt: { $lte: current } }
      ]
    },
    {
      $set: {
        status: 'polled',
        polledAt: current,
        pollLeaseExpiresAt: leaseExpiresAt,
        claimToken,
        polledBy: {
          agentId,
          clientInstanceId: clientInstanceId || null,
          at: current
        }
      }
    },
    {
      sort: { createdAt: 1 },
      returnDocument: 'after'
    }
  );

  if (!result.value) {
    return null;
  }

  await logAuditEvent({
    requestId: result.value.requestId,
    event: 'request.polled',
    actor: { type: 'agent', agentId, clientInstanceId: clientInstanceId || null },
    metadata: { leaseExpiresAt }
  });

  return { ...result.value, claimToken, leaseExpiresAt };
}

async function getRequestById(requestId) {
  const database = getDatabase();
  const requests = database.collection(REQUESTS_COLLECTION);
  return requests.findOne({ _id: requestId });
}

async function claimRequest({ requestId, claimToken, agentId, clientInstanceId }) {
  const database = getDatabase();
  const requests = database.collection(REQUESTS_COLLECTION);
  const current = now();
  const result = await requests.findOneAndUpdate(
    {
      _id: requestId,
      claimToken,
      expiresAt: { $gt: current },
      status: 'polled',
      pollLeaseExpiresAt: { $gt: current }
    },
    {
      $set: {
        status: 'claimed',
        claimedAt: current,
        claimedBy: {
          agentId,
          clientInstanceId: clientInstanceId || null,
          at: current
        }
      },
      $unset: { pollLeaseExpiresAt: '' }
    },
    {
      returnDocument: 'after'
    }
  );

  if (!result.value) {
    return null;
  }

  await logAuditEvent({
    requestId,
    event: 'request.claimed',
    actor: { type: 'agent', agentId, clientInstanceId: clientInstanceId || null }
  });

  return result.value;
}

module.exports = {
  ensureIndexes,
  createPairingRequest,
  leasePendingRequest,
  claimRequest,
  getRequestById,
  logAuditEvent
};
