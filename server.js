// server.js

const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { db, init, getDatabase } = require('./db');
const { parse } = require('csv-parse/sync');
const {
  ensureIndexes: ensurePairingIndexes,
  createPairingRequest,
  leasePendingRequest,
  claimRequest: claimPairingRequest,
  getRequestById: getPairRequestById
} = require('./pairingStore');

const app = express();

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'session_token';
const SESSION_COOKIE_MAX_AGE = Number(
  process.env.SESSION_COOKIE_MAX_AGE || 7 * 24 * 60 * 60 * 1000
);
const SESSION_COOKIE_SAMESITE = (process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase();
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function isOriginAllowed(origin, origins) {
  if (!origins.length || origins.includes('*')) {
    return true;
  }

  return origins.some(allowed => {
    if (!allowed) return false;

    if (allowed.startsWith('*.')) {
      const domain = allowed.slice(1);
      return origin.endsWith(domain);
    }

    return allowed === origin;
  });
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin || isOriginAllowed(origin, allowedOrigins)) {
      return callback(null, true);
    }

    return callback(new Error('Origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length']
};

app.use(cors(corsOptions));
app.options(
  /.*/,
  cors(corsOptions),
  (req, res) => res.sendStatus(204)
);

// Default leave balance values assigned to new employees
const DEFAULT_LEAVE_BALANCES = { annual: 10, casual: 5, medical: 14 };

// Payload limit for incoming requests (default 3 MB to accommodate CV uploads)
const BODY_LIMIT = process.env.BODY_LIMIT || '3mb';

// Default admin credentials (can be overridden with env vars)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@brillar.io';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// ---- PAIRING CONFIG ----
const PAIR_REQUEST_TTL_MIN_SECONDS = Math.max(
  60,
  Number(process.env.PAIR_REQUEST_TTL_MIN_SECONDS || 60)
);
const PAIR_REQUEST_TTL_MAX_SECONDS = Math.max(
  PAIR_REQUEST_TTL_MIN_SECONDS,
  Number(process.env.PAIR_REQUEST_TTL_MAX_SECONDS || 120)
);
const PAIR_POLL_LEASE_SECONDS = Math.max(
  5,
  Number(process.env.PAIR_POLL_LEASE_SECONDS || 20)
);
const PAIR_AGENT_ID = process.env.PAIR_AGENT_ID || 'default-agent';
const PAIR_AGENT_SECRET = process.env.PAIR_AGENT_SECRET || '';
const PAIR_AGENT_SIGNATURE_TOLERANCE_MS = Number(
  process.env.PAIR_AGENT_SIGNATURE_TOLERANCE_MS || 2 * 60 * 1000
);
const PAIR_AGENT_REPLAY_WINDOW_MS = Number(
  process.env.PAIR_AGENT_REPLAY_WINDOW_MS || 5 * 60 * 1000
);
const PAIR_TOKEN_SCOPE = process.env.PAIR_TOKEN_SCOPE || 'pair:connect';
const PAIR_TOKEN_ISSUER = process.env.PAIR_TOKEN_ISSUER || 'brillar-hr-portal';
const PAIR_TOKEN_AUDIENCE = process.env.PAIR_TOKEN_AUDIENCE || 'agent-clients';
const PAIR_TOKEN_SECRET = process.env.PAIR_TOKEN_SECRET || '';
const PAIR_TOKEN_TTL_SECONDS = Math.max(
  60,
  Number(process.env.PAIR_TOKEN_TTL_SECONDS || 5 * 60)
);
const PAIR_TOKEN_ALGORITHM = process.env.PAIR_TOKEN_ALGORITHM || 'HS256';
const PAIR_INIT_RATE_LIMIT = Number(process.env.PAIR_INIT_RATE_LIMIT || 10);
const PAIR_INIT_RATE_WINDOW_MS = Number(
  process.env.PAIR_INIT_RATE_WINDOW_MS || 60 * 1000
);
const PAIR_POLL_RATE_LIMIT = Number(process.env.PAIR_POLL_RATE_LIMIT || 30);
const PAIR_POLL_RATE_WINDOW_MS = Number(
  process.env.PAIR_POLL_RATE_WINDOW_MS || 60 * 1000
);
const PAIR_CLAIM_RATE_LIMIT = Number(process.env.PAIR_CLAIM_RATE_LIMIT || 60);
const PAIR_CLAIM_RATE_WINDOW_MS = Number(
  process.env.PAIR_CLAIM_RATE_WINDOW_MS || 60 * 1000
);

// ---- MICROSOFT SSO CONFIG ----
const MS_CLIENT_ID = process.env.MS_CLIENT_ID || '';
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET || '';
const MS_TENANT = process.env.MS_TENANT || 'common';
const MS_REDIRECT_URI = process.env.MS_REDIRECT_URI ||
  'http://localhost:3000/auth/microsoft/callback';
// ---- EMAIL SETUP ----
const EMAIL_SETTINGS_CACHE_MS = 60 * 1000;

function getEnvEmailSettings() {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || user;
  const replyTo = process.env.SMTP_REPLY_TO || '';
  const recipientsEnv = process.env.SMTP_RECIPIENTS || '';
  const recipients = recipientsEnv
    ? recipientsEnv
        .split(/[,;]+/)
        .map(value => value && value.trim())
        .filter(Boolean)
    : [];
  return {
    enabled: Boolean(host),
    provider: host === 'smtp.office365.com' ? 'office365' : 'custom',
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure,
    user,
    pass,
    from,
    replyTo,
    recipients
  };
}

function normalizeEmailSettings(raw) {
  const defaults = {
    enabled: false,
    provider: 'custom',
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    from: '',
    replyTo: '',
    recipients: []
  };
  const envSettings = getEnvEmailSettings();
  const result = { ...defaults, ...envSettings };
  if (raw && typeof raw === 'object') {
    Object.entries(raw).forEach(([key, value]) => {
      if (value === undefined) return;
      result[key] = value;
    });
  }
  result.enabled = Boolean(result.enabled && result.host);
  result.host = typeof result.host === 'string' ? result.host.trim() : '';
  const numericPort = Number(result.port);
  result.port = Number.isFinite(numericPort) && numericPort > 0 ? numericPort : 587;
  result.secure = result.secure === true || result.secure === 'true';
  result.user = typeof result.user === 'string' ? result.user.trim() : '';
  result.from = typeof result.from === 'string' && result.from.trim()
    ? result.from.trim()
    : result.user || '';
  result.replyTo = typeof result.replyTo === 'string' ? result.replyTo.trim() : '';
  const recipientValues = Array.isArray(result.recipients)
    ? result.recipients
    : typeof result.recipients === 'string'
      ? result.recipients.split(/[,;]+/)
      : [];
  const recipientMap = new Map();
  recipientValues.forEach(value => {
    if (value === undefined || value === null) return;
    const trimmed = typeof value === 'string' ? value.trim() : String(value || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (!recipientMap.has(lower)) {
      recipientMap.set(lower, trimmed);
    }
  });
  result.recipients = Array.from(recipientMap.values());
  if (!result.host) {
    result.enabled = false;
  }
  if (result.host === 'smtp.office365.com') {
    result.provider = 'office365';
  } else if (!result.provider) {
    result.provider = 'custom';
  }
  return result;
}

let emailSettingsCache = { config: null, loadedAt: 0 };
let emailTransporterCache = { transporter: null, signature: null };

async function loadEmailSettings({ force = false } = {}) {
  const now = Date.now();
  if (
    !force &&
    emailSettingsCache.config &&
    now - emailSettingsCache.loadedAt < EMAIL_SETTINGS_CACHE_MS
  ) {
    return emailSettingsCache.config;
  }

  await init();
  const database = getDatabase();
  const doc = await database.collection('settings').findOne({ _id: 'email' });
  const stored = doc && doc.value && typeof doc.value === 'object' ? doc.value : null;
  const config = normalizeEmailSettings(stored);
  emailSettingsCache = { config, loadedAt: now };
  return config;
}

function transporterSignature(config) {
  if (!config) return '';
  return [config.host, config.port, config.secure, config.user, Boolean(config.pass)].join('|');
}

async function getMailTransporter({ config: providedConfig, forceReload = false } = {}) {
  const config = providedConfig || (await loadEmailSettings({ force: forceReload }));
  if (!config.enabled || !config.host) {
    return null;
  }
  const signature = transporterSignature(config);
  if (!forceReload && emailTransporterCache.signature === signature && emailTransporterCache.transporter) {
    return emailTransporterCache.transporter;
  }
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: Boolean(config.secure),
    auth: config.user
      ? {
          user: config.user,
          pass: config.pass
        }
      : undefined
  });
  emailTransporterCache = { transporter, signature };
  return transporter;
}

async function sendEmail(to, subject, text) {
  const recipientValues = Array.isArray(to)
    ? to
    : typeof to === 'string'
      ? to.split(/[,;]+/)
      : to
        ? [to]
        : [];
  const recipientMap = new Map();
  recipientValues.forEach(value => {
    if (value === undefined || value === null) return;
    const trimmed = typeof value === 'string' ? value.trim() : String(value || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (!recipientMap.has(lower)) {
      recipientMap.set(lower, trimmed);
    }
  });
  if (!recipientMap.size) return;
  try {
    const config = await loadEmailSettings();
    if (!config.enabled || !config.host) return;
    const transporter = await getMailTransporter({ config });
    if (!transporter) return;
    const message = {
      from: config.from || config.user,
      to: Array.from(recipientMap.values()).join(', '),
      subject,
      text
    };
    if (config.replyTo) {
      message.replyTo = config.replyTo;
    }
    await transporter.sendMail(message);
  } catch (err) {
    console.error('Failed to send email', err);
  }
}

function findEmployeeKey(emp, matcher) {
  if (!emp || typeof emp !== 'object') return null;
  return Object.keys(emp).find(key => {
    if (typeof key !== 'string') return false;
    const normalized = key.toLowerCase();
    return matcher(normalized);
  }) || null;
}

function normalizeEmployeeEmail(emp) {
  if (!emp || typeof emp !== 'object') return false;
  let updated = false;
  const emailKeys = Object.keys(emp).filter(key => {
    if (typeof key !== 'string') return false;
    const normalized = key.toLowerCase();
    return normalized === 'email' || normalized.replace(/\s+/g, '') === 'email' || normalized.includes('email');
  });
  let canonical = '';
  emailKeys.forEach(key => {
    const raw = emp[key];
    if (raw === undefined || raw === null) return;
    const trimmed = typeof raw === 'string' ? raw.trim() : String(raw).trim();
    if (typeof raw === 'string' && raw !== trimmed) {
      emp[key] = trimmed;
      updated = true;
    } else if (typeof raw !== 'string' && emp[key] !== trimmed) {
      emp[key] = trimmed;
      updated = true;
    }
    if (!canonical && trimmed) {
      canonical = trimmed;
    }
  });
  return updated;
}

function getEmpEmail(emp) {
  if (!emp) return '';
  normalizeEmployeeEmail(emp);
  const key = findEmployeeKey(emp, normalized =>
    normalized === 'email' || normalized.replace(/\s+/g, '') === 'email' || normalized.includes('email')
  );
  if (!key) return '';
  const value = emp[key];
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function getEmpRole(emp) {
  if (!emp) return 'employee';
  const key = findEmployeeKey(emp, normalized => normalized === 'role' || normalized.includes('role'));
  const value = key ? String(emp[key] || '').trim().toLowerCase() : '';
  return value === 'manager' ? 'manager' : 'employee';
}

function buildRecipientOptions(data, extras = []) {
  const options = new Map();
  const employees = Array.isArray(data?.employees) ? data.employees : [];
  const users = Array.isArray(data?.users) ? data.users : [];

  const addOption = (email, name = '') => {
    if (!email) return;
    const trimmedEmail = typeof email === 'string' ? email.trim() : String(email || '').trim();
    if (!trimmedEmail) return;
    const lower = trimmedEmail.toLowerCase();
    const existing = options.get(lower);
    if (existing) {
      if (!existing.name && name) {
        existing.name = name;
      }
      return;
    }
    options.set(lower, { email: trimmedEmail, name: name || '' });
  };

  users
    .filter(user => user && user.role === 'manager')
    .forEach(user => {
      const email = user?.email ? String(user.email).trim() : '';
      if (!email) return;
      let name = '';
      if (user.employeeId) {
        const emp = employees.find(e => e && e.id == user.employeeId);
        if (emp && emp.name) {
          name = String(emp.name).trim();
        }
      }
      addOption(email, name);
    });

  employees
    .filter(emp => getEmpRole(emp) === 'manager')
    .forEach(emp => {
      const email = getEmpEmail(emp);
      const name = emp?.name ? String(emp.name).trim() : '';
      addOption(email, name);
    });

  const extraList = Array.isArray(extras) ? extras : [];
  extraList.forEach(email => addOption(email));

  if (ADMIN_EMAIL) {
    addOption(ADMIN_EMAIL, 'Administrator');
  }

  return Array.from(options.values()).sort((a, b) => {
    const nameA = a.name ? a.name.toLowerCase() : '';
    const nameB = b.name ? b.name.toLowerCase() : '';
    if (nameA && nameB) {
      const nameCompare = nameA.localeCompare(nameB);
      if (nameCompare !== 0) return nameCompare;
    } else if (nameA) {
      return -1;
    } else if (nameB) {
      return 1;
    }
    return a.email.toLowerCase().localeCompare(b.email.toLowerCase());
  });
}

function normalizeNumberKey(key = '') {
  if (typeof key !== 'string') return '';
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function findEmployeeNumberKey(emp) {
  if (!emp || typeof emp !== 'object') return null;
  return Object.keys(emp).find(key => normalizeNumberKey(key) === 'no') || null;
}

function getNextEmployeeNumber(employees = []) {
  if (!Array.isArray(employees) || !employees.length) return 1;
  let max = 0;
  employees.forEach(emp => {
    const numberKey = findEmployeeNumberKey(emp);
    if (!numberKey) return;
    const raw = emp[numberKey];
    const value = Number(raw);
    if (!Number.isNaN(value)) {
      max = Math.max(max, value);
    }
  });
  return max + 1;
}

function assignEmployeeNumber(employee, employees = []) {
  if (!employee || typeof employee !== 'object') return;
  let preferredKey = null;
  if (Array.isArray(employees)) {
    for (const existing of employees) {
      const key = findEmployeeNumberKey(existing);
      if (key) {
        preferredKey = key;
        break;
      }
    }
  }
  if (!preferredKey) {
    preferredKey = findEmployeeNumberKey(employee) || 'No';
  }
  const nextNumber = getNextEmployeeNumber(employees);
  employee[preferredKey] = nextNumber;
}

function ensureLeaveBalances(emp) {
  if (!emp) return false;
  if (!emp.leaveBalances || typeof emp.leaveBalances !== 'object') {
    emp.leaveBalances = { ...DEFAULT_LEAVE_BALANCES };
    return true;
  }

  let updated = false;
  Object.entries(DEFAULT_LEAVE_BALANCES).forEach(([key, defaultValue]) => {
    const current = emp.leaveBalances[key];
    if (current === undefined || current === null || current === '') {
      emp.leaveBalances[key] = defaultValue;
      updated = true;
      return;
    }

    const numericValue = Number(current);
    if (!Number.isFinite(numericValue)) {
      if (emp.leaveBalances[key] !== defaultValue) {
        emp.leaveBalances[key] = defaultValue;
        updated = true;
      }
    } else if (emp.leaveBalances[key] !== numericValue) {
      emp.leaveBalances[key] = numericValue;
      updated = true;
    }
  });

  return updated;
}

const PROFILE_SECTIONS = [
  {
    id: 'personal',
    title: 'Personal Information',
    keywords: ['personal', 'dob', 'date of birth', 'birth', 'birthday', 'nationality', 'citizen', 'address', 'city', 'state', 'country', 'postal', 'zip', 'marital', 'gender'],
    editable: true
  },
  {
    id: 'contact',
    title: 'Contact Information',
    keywords: ['contact', 'phone', 'mobile', 'whatsapp', 'telegram', 'skype', 'linkedin', 'email'],
    editable: true
  },
  {
    id: 'emergency',
    title: 'Emergency Contacts',
    keywords: ['emergency', 'next of kin', 'next-of-kin', 'kin', 'guardian'],
    editable: true
  },
  {
    id: 'employment',
    title: 'Employment History & Position',
    keywords: ['start', 'end', 'tenure', 'history', 'promotion', 'internship', 'probation', 'experience', 'full time', 'contract'],
    editable: false
  },
  {
    id: 'department',
    title: 'Department & Role Assignment',
    keywords: ['department', 'project', 'role', 'title', 'manager', 'supervisor', 'appraiser', 'reporting', 'team', 'current', 'position', 'status'],
    editable: false
  }
];

const PROFILE_EDITABLE_KEYWORDS = {
  personal: ['dob', 'date of birth', 'birth', 'birthday', 'nationality', 'citizen', 'address', 'city', 'state', 'country', 'postal', 'zip', 'marital', 'gender'],
  contact: ['contact', 'phone', 'mobile', 'whatsapp', 'telegram', 'skype', 'linkedin'],
  emergency: ['emergency', 'kin', 'guardian']
};

const PROFILE_EXCLUDED_KEYS = new Set(['id', '_id', 'leaveBalances']);

function normalizeProfileKey(key) {
  return typeof key === 'string' ? key.trim().toLowerCase() : '';
}

function formatProfileLabel(key) {
  if (!key) return 'Field';
  return String(key)
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)([a-z])/g, (_, space, char) => space + char.toUpperCase());
}

function determineProfileInputType(normalizedKey) {
  if (!normalizedKey) return 'text';
  if (normalizedKey.includes('address') || normalizedKey.includes('remarks')) return 'textarea';
  if (normalizedKey.includes('date')) return 'date';
  if (normalizedKey.includes('phone') || normalizedKey.includes('mobile') || normalizedKey.includes('contact')) return 'tel';
  return 'text';
}

function findValueByKeywords(employee, keywords = []) {
  if (!employee || typeof employee !== 'object') return '';
  const lowerKeywords = keywords.map(word => word.toLowerCase());
  return Object.entries(employee).reduce((acc, [key, value]) => {
    if (acc) return acc;
    const normalized = normalizeProfileKey(key);
    if (lowerKeywords.some(keyword => normalized.includes(keyword))) {
      if (value !== undefined && value !== null && value !== '') {
        return typeof value === 'string' ? value : String(value);
      }
    }
    return acc;
  }, '');
}

function buildEmployeeProfile(employee) {
  const sectionMap = new Map(
    PROFILE_SECTIONS.map(section => [section.id, { id: section.id, title: section.title, editable: section.editable, fields: [] }])
  );

  Object.entries(employee || {}).forEach(([key, value]) => {
    if (PROFILE_EXCLUDED_KEYS.has(key)) return;
    const normalizedKey = normalizeProfileKey(key);
    const sectionDef = PROFILE_SECTIONS.find(section =>
      section.keywords.some(keyword => normalizedKey.includes(keyword))
    ) || PROFILE_SECTIONS[0];
    const section = sectionMap.get(sectionDef.id);
    if (!section) return;
    const editableKeywords = PROFILE_EDITABLE_KEYWORDS[sectionDef.id] || [];
    const editable = sectionDef.editable && editableKeywords.some(keyword => normalizedKey.includes(keyword));
    const fieldValue = value === null || typeof value === 'undefined' ? '' : value;
    const inputType = determineProfileInputType(normalizedKey);
    section.fields.push({
      key,
      label: formatProfileLabel(key),
      value: typeof fieldValue === 'string' ? fieldValue : String(fieldValue),
      editable,
      type: inputType
    });
  });

  const sections = Array.from(sectionMap.values())
    .filter(section => section.fields.length > 0)
    .map(section => ({ id: section.id, title: section.title, fields: section.fields }));

  return {
    employeeId: employee?.id || null,
    name: employee?.name || '',
    email: getEmpEmail(employee),
    leaveBalances:
      employee?.leaveBalances && typeof employee.leaveBalances === 'object'
        ? employee.leaveBalances
        : { ...DEFAULT_LEAVE_BALANCES },
    summary: {
      title: findValueByKeywords(employee, ['title', 'position']),
      department: findValueByKeywords(employee, ['department', 'project']),
      manager: findValueByKeywords(employee, ['appraiser', 'manager', 'supervisor', 'reporting']),
      status:
        typeof employee?.status === 'string' && employee.status
          ? employee.status
          : findValueByKeywords(employee, ['status'])
    },
    sections
  };
}

function buildUserInfoOpenApiPath() {
  return {
    get: {
      summary: 'Retrieve detailed user information',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'string' },
          description: 'Unique identifier of the user or employee.'
        }
      ],
      responses: {
        200: {
          description: 'User information payload',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UserInformationResponse' }
            }
          }
        },
        403: { description: 'Forbidden' },
        404: { description: 'User not found' }
      }
    }
  };
}

function buildUserInfoOpenApiSchemas() {
  return {
    ManagerInformation: {
      type: ['object', 'null'],
      properties: {
        name: { type: 'string' },
        employeeId: { type: ['string', 'null'] },
        email: { type: ['string', 'null'], format: 'email' }
      }
    },
    UserInformationResponse: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        employeeId: { type: ['string', 'null'] },
        name: { type: ['string', 'null'] },
        email: { type: ['string', 'null'], format: 'email' },
        role: { type: 'string' },
        title: { type: ['string', 'null'] },
        department: { type: ['string', 'null'] },
        manager: { $ref: '#/components/schemas/ManagerInformation' }
      }
    }
  };
}

function upsertUserForEmployee(emp) {
  if (!emp) return false;
  normalizeEmployeeEmail(emp);
  const email = (getEmpEmail(emp) || '').trim();
  if (!email) return false;
  db.data.users = db.data.users || [];
  const normalizedEmail = email.toLowerCase();
  const existing = db.data.users.find(
    u => u.employeeId == emp.id || (u.email && u.email.toLowerCase() === normalizedEmail)
  );
  const role = getEmpRole(emp);
  if (existing) {
    let changed = false;
    if (existing.email !== email) {
      existing.email = email;
      changed = true;
    }
    if (existing.employeeId !== emp.id) {
      existing.employeeId = emp.id;
      changed = true;
    }
    if (existing.role !== role) {
      existing.role = role;
      changed = true;
    }
    if (!existing.password) {
      existing.password = 'brillar';
      changed = true;
    }
    return changed;
  }

  db.data.users.push({
    id: emp.id,
    email,
    password: 'brillar',
    role,
    employeeId: emp.id
  });
  return true;
}

const SESSION_TOKENS = {}; // token: userId
const WIDGET_JWT_SECRET = process.env.WIDGET_JWT_SECRET || process.env.JWT_SECRET || 'brillar-widget-secret';
const WIDGET_JWT_EXPIRES_IN = Number(process.env.WIDGET_JWT_EXPIRES_IN || 300);

function genToken() {
  return Math.random().toString(36).slice(2) + Date.now();
}

const CANDIDATE_STATUSES = [
  'New',
  'Selected for Interview',
  'Interview Completed',
  'Rejected',
  'Hired'
];

function computePairRequestTtlSeconds() {
  const span = PAIR_REQUEST_TTL_MAX_SECONDS - PAIR_REQUEST_TTL_MIN_SECONDS;
  if (span <= 0) {
    return PAIR_REQUEST_TTL_MIN_SECONDS;
  }
  return (
    PAIR_REQUEST_TTL_MIN_SECONDS + Math.floor(Math.random() * (span + 1))
  );
}

function generatePairRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return crypto.randomBytes(16).toString('hex');
}

function pruneExpiredEntries(map, now, windowMs) {
  for (const [key, entry] of map.entries()) {
    if (now - entry.windowStart >= windowMs) {
      map.delete(key);
    }
  }
}

function checkRateLimit(map, key, limit, windowMs) {
  if (!limit || limit <= 0) return true;
  const now = Date.now();
  const existing = map.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    map.set(key, { count: 1, windowStart: now });
    pruneExpiredEntries(map, now, windowMs * 5);
    return true;
  }
  if (existing.count < limit) {
    existing.count += 1;
    return true;
  }
  return false;
}

const initRateLimiter = new Map();
const pollRateLimiter = new Map();
const claimRateLimiter = new Map();

const agentSignatureCache = new Map();

function verifyAgentRequest(req) {
  if (!PAIR_AGENT_SECRET) {
    return {
      ok: false,
      status: 503,
      error: 'Agent authentication is not configured'
    };
  }

  const signatureHeader = (req.get('x-agent-signature') || '').trim().toLowerCase();
  const timestampHeader = (req.get('x-agent-timestamp') || '').trim();
  const agentIdHeader = (req.get('x-agent-id') || PAIR_AGENT_ID).trim();

  if (!signatureHeader || !timestampHeader) {
    return { ok: false, status: 401, error: 'Missing agent authentication headers' };
  }

  if (!/^[a-f0-9]+$/.test(signatureHeader)) {
    return { ok: false, status: 401, error: 'Invalid agent signature format' };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, status: 401, error: 'Invalid agent timestamp' };
  }

  const nowMs = Date.now();
  if (Math.abs(nowMs - timestamp) > PAIR_AGENT_SIGNATURE_TOLERANCE_MS) {
    return { ok: false, status: 401, error: 'Agent signature timestamp out of range' };
  }

  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
  const baseString = `${agentIdHeader}:${timestamp}:${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', PAIR_AGENT_SECRET)
    .update(baseString)
    .digest('hex');

  const providedBuffer = Buffer.from(signatureHeader, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return { ok: false, status: 401, error: 'Agent signature mismatch' };
  }

  for (const [cacheKey, seenAt] of agentSignatureCache.entries()) {
    if (nowMs - seenAt > PAIR_AGENT_REPLAY_WINDOW_MS) {
      agentSignatureCache.delete(cacheKey);
    }
  }

  const replayKey = `${agentIdHeader}:${timestamp}:${expectedSignature}`;
  if (agentSignatureCache.has(replayKey)) {
    return { ok: false, status: 401, error: 'Replay detected' };
  }

  agentSignatureCache.set(replayKey, nowMs);

  return { ok: true, agentId: agentIdHeader, timestamp };
}

function requireAgentAuth(req, res, next) {
  const verification = verifyAgentRequest(req);
  if (!verification.ok) {
    const status = verification.status || 401;
    return res.status(status).json({ error: verification.error || 'Unauthorized' });
  }
  req.agentAuth = {
    agentId: verification.agentId,
    timestamp: verification.timestamp
  };
  next();
}

function sanitizeComment(comment, currentUser) {
  if (!comment) return null;
  return {
    id: comment.id,
    text: comment.text,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: {
      id: comment.userId,
      email: comment.userEmail
    },
    canEdit: Boolean(currentUser && comment.userId === currentUser.id)
  };
}

function generateCommentId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const rawBodySaver = (req, res, buf) => {
  req.rawBody = buf && buf.length ? buf.toString('utf8') : '';
};

app.use(bodyParser.json({ limit: BODY_LIMIT, verify: rawBodySaver }));
app.use(bodyParser.urlencoded({ limit: BODY_LIMIT, extended: true, verify: rawBodySaver }));
app.use((req, res, next) => {
  if (typeof req.rawBody !== 'string') {
    req.rawBody = '';
  }
  next();
});
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function resolveToken(req) {
  const headerToken = req.headers.authorization?.split(' ')[1];
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  return headerToken || cookieToken || null;
}

async function resolveUserFromSession(token) {
  if (!token || !SESSION_TOKENS[token]) {
    return null;
  }
  const userId = SESSION_TOKENS[token];
  await db.read();
  let user = db.data.users?.find(u => u.id === userId);
  if (!user && userId === 'admin') {
    user = { id: 'admin', email: ADMIN_EMAIL, role: 'manager', employeeId: null };
  }
  if (!user) {
    delete SESSION_TOKENS[token];
    return null;
  }
  return user;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = ['lax', 'strict', 'none'].includes(SESSION_COOKIE_SAMESITE)
    ? SESSION_COOKIE_SAMESITE
    : 'lax';
  const cookieOptions = {
    httpOnly: true,
    secure: sameSite === 'none' ? true : secure,
    sameSite,
    maxAge: Number.isFinite(SESSION_COOKIE_MAX_AGE) && SESSION_COOKIE_MAX_AGE > 0
      ? SESSION_COOKIE_MAX_AGE
      : undefined
  };
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = ['lax', 'strict', 'none'].includes(SESSION_COOKIE_SAMESITE)
    ? SESSION_COOKIE_SAMESITE
    : 'lax';
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: sameSite === 'none' ? true : secure,
    sameSite
  });
}

// ---- AUTH ----
async function authRequired(req, res, next) {
  const token = resolveToken(req);
  const user = await resolveUserFromSession(token);
  if (user) {
    if (user.role !== 'manager') {
      const employees = Array.isArray(db.data.employees) ? db.data.employees : [];
      const emp = employees.find(e => e.id == user.employeeId);
      const status = (emp?.status || '').toString().toLowerCase();
      if (!emp || status === 'inactive' || status === 'deactivated' || status === 'disabled') {
        delete SESSION_TOKENS[token];
        if (req.cookies?.[SESSION_COOKIE_NAME]) {
          clearSessionCookie(res);
        }
        return res.status(403).json({ error: 'Employee account is inactive' });
      }
    }
    req.user = user;
    return next();
  }

  if (req.cookies?.[SESSION_COOKIE_NAME]) {
    clearSessionCookie(res);
  }

  req.user = {
    id: 'public-admin',
    email: ADMIN_EMAIL || 'public@brillar.io',
    role: 'manager',
    employeeId: null
  };

  next();
}

function managerOnly(req, res, next) {
  if (!req.user || req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

async function ensureUsersForExistingEmployees() {
  await db.read();
  db.data.employees = db.data.employees || [];
  db.data.users = db.data.users || [];
  if (!Array.isArray(db.data.holidays)) {
    db.data.holidays = [];
  }
  let changed = false;
  db.data.employees.forEach(emp => {
    if (normalizeEmployeeEmail(emp)) changed = true;
    if (ensureLeaveBalances(emp)) changed = true;
    if (upsertUserForEmployee(emp)) changed = true;
  });
  if (changed) {
    await db.write();
  }
}

init().then(async () => {
  await ensureUsersForExistingEmployees();
  await ensurePairingIndexes();
  // ========== MICROSOFT SSO ==========
  const oauthStates = new Set();

  app.get('/auth/microsoft', (req, res) => {
    if (!MS_CLIENT_ID) return res.status(500).send('SSO not configured');
    const state = genToken();
    oauthStates.add(state);
    const authUrl = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize` +
      `?client_id=${encodeURIComponent(MS_CLIENT_ID)}` +
      `&response_type=code` +
      `&response_mode=query` +
      `&redirect_uri=${encodeURIComponent(MS_REDIRECT_URI)}` +
      `&scope=openid%20profile%20email` +
      `&state=${state}`;
    res.redirect(authUrl);
  });

  app.get('/auth/microsoft/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || !oauthStates.has(state)) {
      return res.status(400).send('Invalid auth response');
    }
    oauthStates.delete(state);
    try {
      const tokenRes = await fetch(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: MS_CLIENT_ID,
          client_secret: MS_CLIENT_SECRET,
          code,
          redirect_uri: MS_REDIRECT_URI,
          grant_type: 'authorization_code',
          scope: 'openid profile email'
        })
      });
      const tokenData = await tokenRes.json();
      const idToken = tokenData.id_token;
      if (!idToken) throw new Error('No id_token');
      const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
      const email = payload.preferred_username || payload.email || payload.upn;
      await db.read();
      let user = db.data.users?.find(u => u.email === email);
      let userObj;
      if (user) {
        userObj = { id: user.id, email: user.email, role: user.role, employeeId: user.employeeId };
      } else if (email === ADMIN_EMAIL) {
        userObj = { id: 'admin', email: ADMIN_EMAIL, role: 'manager', employeeId: null };
      } else {
        return res.status(401).send('User not found');
      }
      const token = genToken();
      SESSION_TOKENS[token] = userObj.id;
      setSessionCookie(res, token);
      const redirect = `/?token=${token}&user=${encodeURIComponent(JSON.stringify(userObj))}`;
      res.redirect(redirect);
    } catch (err) {
      console.error('Microsoft auth failed', err);
      res.status(500).send('Authentication failed');
    }
  });

  // ========== PAIRING ENDPOINTS ==========
  app.post('/pair/init', authRequired, async (req, res) => {
    const { client_id: rawClientId, tab_id: rawTabId } = req.body || {};
    const clientId = typeof rawClientId === 'string' ? rawClientId.trim() : '';
    if (!clientId) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    const tabId =
      rawTabId === undefined || rawTabId === null
        ? null
        : String(rawTabId).trim() || null;

    const rateKey = `${req.user.id}:${clientId}`;
    if (
      !checkRateLimit(
        initRateLimiter,
        rateKey,
        PAIR_INIT_RATE_LIMIT,
        PAIR_INIT_RATE_WINDOW_MS
      )
    ) {
      return res.status(429).json({ error: 'Too many pairing attempts' });
    }

    const ttlSeconds = computePairRequestTtlSeconds();

    let created;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const requestId = generatePairRequestId();
      try {
        created = await createPairingRequest({
          requestId,
          userId: req.user.id,
          clientId,
          tabId,
          scope: PAIR_TOKEN_SCOPE,
          ttlSeconds
        });
        break;
      } catch (err) {
        if (err && err.code === 11000) {
          continue;
        }
        console.error('Failed to create pairing request', err);
        return res.status(500).json({ error: 'Failed to create pairing request' });
      }
    }

    if (!created) {
      return res.status(500).json({ error: 'Failed to create pairing request' });
    }

    res.status(201).json({
      request_id: created.requestId,
      client_id: created.clientId,
      tab_id: created.tabId,
      scope: created.scope,
      ttl_seconds: created.ttlSeconds,
      expires_at: created.expiresAt.toISOString()
    });
  });

  app.post('/pair/poll', requireAgentAuth, async (req, res) => {
    const { client_id: rawClientId, client_instance_id: rawInstanceId } = req.body || {};
    const clientId = typeof rawClientId === 'string' ? rawClientId.trim() : '';
    if (!clientId) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    const clientInstanceId =
      rawInstanceId === undefined || rawInstanceId === null
        ? null
        : String(rawInstanceId).trim() || null;

    const rateKey = `${clientId}:${clientInstanceId || 'default'}`;
    if (
      !checkRateLimit(
        pollRateLimiter,
        rateKey,
        PAIR_POLL_RATE_LIMIT,
        PAIR_POLL_RATE_WINDOW_MS
      )
    ) {
      return res.status(429).json({ error: 'Polling rate limit exceeded' });
    }

    try {
      const leased = await leasePendingRequest({
        clientId,
        agentId: req.agentAuth.agentId,
        clientInstanceId,
        leaseDurationMs: PAIR_POLL_LEASE_SECONDS * 1000
      });

      if (!leased) {
        return res.status(204).end();
      }

      return res.json({
        request_id: leased.requestId,
        claim_token: leased.claimToken,
        user_id: leased.userId,
        client_id: leased.clientId,
        tab_id: leased.tabId,
        scope: leased.scope,
        expires_at: leased.expiresAt.toISOString(),
        lease_expires_at: leased.leaseExpiresAt.toISOString()
      });
    } catch (err) {
      console.error('Failed to poll pairing requests', err);
      return res.status(500).json({ error: 'Failed to poll pairing requests' });
    }
  });

  app.post('/pair/claim', requireAgentAuth, async (req, res) => {
    const {
      request_id: rawRequestId,
      claim_token: rawClaimToken,
      client_instance_id: rawInstanceId
    } = req.body || {};

    const requestId = typeof rawRequestId === 'string' ? rawRequestId.trim() : '';
    const claimToken =
      typeof rawClaimToken === 'string' ? rawClaimToken.trim().toLowerCase() : '';

    if (!requestId) {
      return res.status(400).json({ error: 'request_id is required' });
    }
    if (!claimToken) {
      return res.status(400).json({ error: 'claim_token is required' });
    }

    const clientInstanceId =
      rawInstanceId === undefined || rawInstanceId === null
        ? null
        : String(rawInstanceId).trim() || null;

    const rateKey = `${req.agentAuth.agentId}:${requestId}`;
    if (
      !checkRateLimit(
        claimRateLimiter,
        rateKey,
        PAIR_CLAIM_RATE_LIMIT,
        PAIR_CLAIM_RATE_WINDOW_MS
      )
    ) {
      return res.status(429).json({ error: 'Claim rate limit exceeded' });
    }

    try {
      const claimed = await claimPairingRequest({
        requestId,
        claimToken,
        agentId: req.agentAuth.agentId,
        clientInstanceId
      });

      if (!claimed) {
        const existing = await getPairRequestById(requestId);
        if (!existing) {
          return res.status(404).json({ error: 'Pairing request not found' });
        }
        const expiration =
          existing.expiresAt instanceof Date
            ? existing.expiresAt
            : existing.expiresAt
              ? new Date(existing.expiresAt)
              : null;
        if (!expiration || expiration <= new Date()) {
          return res.status(410).json({ error: 'Pairing request expired' });
        }
        if (existing.status === 'claimed') {
          return res.status(410).json({ error: 'Pairing request already claimed' });
        }
        return res.status(410).json({ error: 'Pairing request lease expired' });
      }

      if (!PAIR_TOKEN_SECRET) {
        return res.status(503).json({ error: 'Pairing token signer not configured' });
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const expiresAtSeconds = nowSeconds + PAIR_TOKEN_TTL_SECONDS;
      const scope = claimed.scope || PAIR_TOKEN_SCOPE;
      const payload = {
        sub: String(claimed.userId),
        user_id: claimed.userId,
        aud: PAIR_TOKEN_AUDIENCE,
        iss: PAIR_TOKEN_ISSUER,
        jti: generatePairRequestId(),
        scope,
        iat: nowSeconds,
        exp: expiresAtSeconds
      };

      const token = jwt.sign(payload, PAIR_TOKEN_SECRET, {
        algorithm: PAIR_TOKEN_ALGORITHM
      });

      return res.json({
        token,
        token_type: 'Bearer',
        scope,
        expires_at: new Date(expiresAtSeconds * 1000).toISOString(),
        request: {
          request_id: claimed.requestId,
          client_id: claimed.clientId,
          tab_id: claimed.tabId
        },
        user: {
          id: claimed.userId
        }
      });
    } catch (err) {
      console.error('Failed to claim pairing request', err);
      return res.status(500).json({ error: 'Failed to claim pairing request' });
    }
  });

  // ========== LOGIN ==========
  app.post('/login', async (req, res) => {
    await db.read();
    const { email, password } = req.body;
    const user = db.data.users?.find(u => u.email === email && u.password === password);

    let userObj;
    if (user) {
      if (user.role !== 'manager') {
        const employees = Array.isArray(db.data.employees) ? db.data.employees : [];
        const emp = employees.find(e => e.id == user.employeeId);
        const status = (emp?.status || '').toString().toLowerCase();
        if (!emp || status === 'inactive' || status === 'deactivated' || status === 'disabled') {
          return res.status(403).json({ error: 'Employee account is inactive' });
        }
      }
      userObj = {
        id: user.id,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId
      };
    } else if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      userObj = {
        id: 'admin',
        email: ADMIN_EMAIL,
        role: 'manager',
        employeeId: null
      };
    } else {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = genToken();
    SESSION_TOKENS[token] = userObj.id;
    setSessionCookie(res, token);
    res.json({ token, user: userObj });
  });

  app.get('/api/widget/token', async (req, res) => {
    const sessionToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (!sessionToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await resolveUserFromSession(sessionToken);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (user.role !== 'manager') {
      const employees = Array.isArray(db.data.employees) ? db.data.employees : [];
      const emp = employees.find(e => e.id == user.employeeId);
      const status = (emp?.status || '').toString().toLowerCase();
      if (!emp || status === 'inactive' || status === 'deactivated' || status === 'disabled') {
        delete SESSION_TOKENS[sessionToken];
        clearSessionCookie(res);
        return res.status(403).json({ error: 'Employee account is inactive' });
      }
    }

    const expiresIn = Number.isFinite(WIDGET_JWT_EXPIRES_IN) && WIDGET_JWT_EXPIRES_IN > 0
      ? WIDGET_JWT_EXPIRES_IN
      : 300;
    const payload = {
      sub: user.id,
      role: user.role,
      email: user.email,
      employeeId: user.employeeId ?? null,
      aud: 'brillar-widget',
      iss: 'brillar-hr-portal'
    };
    const token = jwt.sign(payload, WIDGET_JWT_SECRET, { expiresIn });
    res.set('Cache-Control', 'no-store');
    res.json({ token, expires_in: expiresIn });
  });

  // ========== CHANGE PASSWORD ==========
  app.post('/change-password', authRequired, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    await db.read();
    const user = db.data.users?.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.password !== currentPassword) {
      return res.status(400).json({ error: 'Current password incorrect' });
    }
    user.password = newPassword;
    await db.write();
    res.json({ success: true });
  });

  // ========== MY PROFILE ==========
  app.get('/api/my-profile', authRequired, async (req, res) => {
    if (!req.user.employeeId) {
      return res.status(404).json({ error: 'Employee profile not linked to this account.' });
    }
    await db.read();
    db.data.employees = Array.isArray(db.data.employees)
      ? db.data.employees
      : [];
    const employee = db.data.employees.find(emp => emp.id == req.user.employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee profile not found.' });
    }
    const balancesUpdated = ensureLeaveBalances(employee);
    if (balancesUpdated) {
      await db.write();
    }
    res.json(buildEmployeeProfile(employee));
  });

  app.put('/api/my-profile', authRequired, async (req, res) => {
    if (!req.user.employeeId) {
      return res.status(404).json({ error: 'Employee profile not linked to this account.' });
    }
    await db.read();
    db.data.employees = Array.isArray(db.data.employees)
      ? db.data.employees
      : [];
    const employee = db.data.employees.find(emp => emp.id == req.user.employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee profile not found.' });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = payload.updates && typeof payload.updates === 'object'
      ? payload.updates
      : payload;

    const profileView = buildEmployeeProfile(employee);
    const editableKeys = new Set();
    profileView.sections.forEach(section => {
      section.fields.forEach(field => {
        if (field.editable) editableKeys.add(field.key);
      });
    });

    let applied = 0;
    let changed = false;
    Object.entries(updates || {}).forEach(([key, value]) => {
      if (!editableKeys.has(key)) return;
      applied += 1;
      const normalizedValue = value === null || typeof value === 'undefined'
        ? ''
        : typeof value === 'string'
          ? value.trim()
          : String(value);
      const currentValue = employee[key];
      const normalizedCurrent = currentValue === null || typeof currentValue === 'undefined'
        ? ''
        : typeof currentValue === 'string'
          ? currentValue
          : String(currentValue);
      if (normalizedCurrent !== normalizedValue) {
        employee[key] = normalizedValue;
        changed = true;
      }
    });

    if (changed) {
      await db.write();
    }

    const response = buildEmployeeProfile(employee);
    if (applied === 0) {
      response.message = 'No editable fields were updated.';
      response.messageType = 'info';
    } else if (!changed) {
      response.message = 'No changes detected.';
      response.messageType = 'info';
    } else {
      response.message = 'Profile updated successfully.';
      response.messageType = 'success';
    }
    res.json(response);
  });

  // ========== EMPLOYEES ==========
  app.get('/employees', authRequired, async (req, res) => {
    await db.read();
    let emps = db.data.employees || [];
    if (req.user.role !== 'manager') {
      emps = emps.filter(e => e.id == req.user.employeeId);
    }
    res.json(emps);
  });

  app.post('/employees', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const id = Date.now();
    const payload = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    delete payload._id;
    if (!Array.isArray(db.data.employees)) {
      db.data.employees = [];
    }
    const employee = { id, ...payload };
    delete employee._id;
    assignEmployeeNumber(employee, db.data.employees);
    ensureLeaveBalances(employee);
    normalizeEmployeeEmail(employee);
    const email = getEmpEmail(employee);
    if (!email) {
      return res.status(400).json({ error: 'Employee email is required to create login credentials.' });
    }
    db.data.employees.push(employee);
    if (upsertUserForEmployee(employee)) {
      // When upsert adds a new user, db.data.users is already updated.
    }
    await db.write();
    res.status(201).json(employee);
  });

  // ---- BULK CSV UPLOAD ----
  app.post('/employees/bulk', authRequired, managerOnly, express.text({ type: '*/*' }), async (req, res) => {
    await db.read();
    try {
      const rows = parse(req.body, { columns: true, skip_empty_lines: true });
      const start = Date.now();
      rows.forEach((row, idx) => {
        const id = start + idx;
        const nameKey = Object.keys(row).find(k => k.toLowerCase() === 'name');
        const statusKey = Object.keys(row).find(k => k.toLowerCase() === 'status');
        const annualKey = Object.keys(row).find(k => k.toLowerCase().includes('annual'));
        const casualKey = Object.keys(row).find(k => k.toLowerCase().includes('casual'));
        const medicalKey = Object.keys(row).find(k => k.toLowerCase().includes('medical'));
        const emailKey = Object.keys(row).find(k => k.toLowerCase() === 'email');
        const roleKey = Object.keys(row).find(k => k.toLowerCase() === 'role');
        const emp = {
          id,
          name: row[nameKey] || '',
          status: row[statusKey]?.toLowerCase() === 'inactive' ? 'inactive' : 'active',
          leaveBalances: {
            annual: Number(row[annualKey] ?? 10),
            casual: Number(row[casualKey] ?? 5),
            medical: Number(row[medicalKey] ?? 14)
          },
          ...row
        };
        delete emp._id;
        ensureLeaveBalances(emp);
        normalizeEmployeeEmail(emp);
        db.data.employees.push(emp);
        upsertUserForEmployee(emp);
      });
      await db.write();
      res.status(201).json({ added: rows.length });
    } catch (err) {
      console.error('CSV parse failed', err);
      res.status(400).json({ error: 'Invalid CSV' });
    }
  });

  app.put('/employees/:id', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const emp = db.data.employees.find(e => e.id == req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    const updates = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    delete updates._id;
    Object.assign(emp, updates);
    normalizeEmployeeEmail(emp);
    ensureLeaveBalances(emp);
    upsertUserForEmployee(emp);
    await db.write();
    res.json(emp);
  });

  app.patch('/employees/:id/status', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const emp = db.data.employees.find(e => e.id == req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    emp.status = req.body.status;
    await db.write();
    res.json(emp);
  });

  app.delete('/employees/:id', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const idx = db.data.employees.findIndex(e => e.id == req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const [removed] = db.data.employees.splice(idx, 1);
    if (removed) {
      db.data.users = db.data.users || [];
      const userIdx = db.data.users.findIndex(u => u.employeeId == removed.id);
      if (userIdx !== -1) {
        db.data.users.splice(userIdx, 1);
      }
    }
    await db.write();
    res.status(204).end();
  });

  // ========== RECRUITMENT PIPELINE ==========
  app.get('/recruitment/positions', authRequired, managerOnly, async (req, res) => {
    await db.read();
    db.data.positions = db.data.positions || [];
    res.json(db.data.positions);
  });

  app.post('/recruitment/positions', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const title = (req.body.title || '').trim();
    const department = (req.body.department || '').trim();
    const description = (req.body.description || '').trim();
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    db.data.positions = db.data.positions || [];
    const id = Date.now();
    const newPosition = {
      id,
      title,
      department,
      description,
      createdAt: new Date().toISOString()
    };
    db.data.positions.push(newPosition);
    await db.write();
    res.status(201).json(newPosition);
  });

  app.patch('/recruitment/positions/:id', authRequired, managerOnly, async (req, res) => {
    await db.read();
    db.data.positions = db.data.positions || [];
    const position = db.data.positions.find(p => p.id == req.params.id);
    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }
    const titleProvided = Object.prototype.hasOwnProperty.call(req.body, 'title');
    const departmentProvided = Object.prototype.hasOwnProperty.call(req.body, 'department');
    const descriptionProvided = Object.prototype.hasOwnProperty.call(req.body, 'description');
    const nextTitle = titleProvided ? String(req.body.title || '').trim() : position.title;
    if (!nextTitle) {
      return res.status(400).json({ error: 'Title is required' });
    }
    position.title = nextTitle;
    if (departmentProvided) {
      position.department = String(req.body.department || '').trim();
    }
    if (descriptionProvided) {
      position.description = String(req.body.description || '').trim();
    }
    position.updatedAt = new Date().toISOString();
    await db.write();
    res.json(position);
  });

  app.get('/recruitment/candidates', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const { positionId } = req.query;
    db.data.candidates = db.data.candidates || [];
    let list = db.data.candidates;
    if (positionId) {
      list = list.filter(c => c.positionId == positionId);
    }
    const sanitized = list.map(c => {
      const { cv, comments = [], ...rest } = c;
      return {
        ...rest,
        commentCount: comments.length,
        cv: cv ? { filename: cv.filename, contentType: cv.contentType } : null
      };
    });
    res.json(sanitized);
  });

  app.post('/recruitment/candidates', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const { positionId, name, contact, cv } = req.body;
    const status = CANDIDATE_STATUSES.includes(req.body.status) ? req.body.status : 'New';
    if (!positionId) return res.status(400).json({ error: 'Position is required' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!contact || !contact.trim()) return res.status(400).json({ error: 'Contact is required' });
    if (!cv || !cv.data || !cv.filename) {
      return res.status(400).json({ error: 'CV upload is required' });
    }
    db.data.positions = db.data.positions || [];
    const positionExists = db.data.positions.some(p => p.id == positionId);
    if (!positionExists) {
      return res.status(404).json({ error: 'Position not found' });
    }
    db.data.candidates = db.data.candidates || [];
    const id = Date.now();
    const now = new Date().toISOString();
    const candidate = {
      id,
      positionId: Number(positionId),
      name: name.trim(),
      contact: (contact || '').trim(),
      status,
      cv: {
        filename: cv.filename,
        contentType: cv.contentType || 'application/octet-stream',
        data: cv.data
      },
      comments: [],
      createdAt: now,
      updatedAt: now
    };
    db.data.candidates.push(candidate);
    await db.write();
    const { cv: storedCv, comments = [], ...rest } = candidate;
    res.status(201).json({
      ...rest,
      commentCount: comments.length,
      cv: { filename: storedCv.filename, contentType: storedCv.contentType }
    });
  });

  app.patch('/recruitment/candidates/:id', authRequired, managerOnly, async (req, res) => {
    await db.read();
    db.data.candidates = db.data.candidates || [];
    const candidate = db.data.candidates.find(c => c.id == req.params.id);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'positionId')) {
      const newPositionId = Number(req.body.positionId);
      if (!newPositionId || Number.isNaN(newPositionId)) {
        return res.status(400).json({ error: 'Valid position is required' });
      }
      db.data.positions = db.data.positions || [];
      const positionExists = db.data.positions.some(p => p.id == newPositionId);
      if (!positionExists) {
        return res.status(404).json({ error: 'Position not found' });
      }
      candidate.positionId = Number(newPositionId);
      updates.positionId = candidate.positionId;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      const newName = String(req.body.name || '').trim();
      if (!newName) {
        return res.status(400).json({ error: 'Name is required' });
      }
      candidate.name = newName;
      updates.name = candidate.name;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'contact')) {
      const newContact = String(req.body.contact || '').trim();
      if (!newContact) {
        return res.status(400).json({ error: 'Contact is required' });
      }
      candidate.contact = newContact;
      updates.contact = candidate.contact;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
      const nextStatus = String(req.body.status || '');
      if (!CANDIDATE_STATUSES.includes(nextStatus)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      candidate.status = nextStatus;
      updates.status = candidate.status;
    }
    if (req.body.cv && req.body.cv.data && req.body.cv.filename) {
      candidate.cv = {
        filename: req.body.cv.filename,
        contentType: req.body.cv.contentType || 'application/octet-stream',
        data: req.body.cv.data
      };
      updates.cv = candidate.cv;
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No changes provided' });
    }
    candidate.updatedAt = new Date().toISOString();
    await db.write();
    const { cv, comments = [], ...rest } = candidate;
    res.json({
      ...rest,
      commentCount: comments.length,
      cv: cv ? { filename: cv.filename, contentType: cv.contentType } : null
    });
  });

  app.delete('/recruitment/candidates/:id', authRequired, managerOnly, async (req, res) => {
    await db.read();
    db.data.candidates = db.data.candidates || [];
    const idx = db.data.candidates.findIndex(c => c.id == req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    db.data.candidates.splice(idx, 1);
    await db.write();
    res.status(204).end();
  });

  app.patch('/recruitment/candidates/:id/status', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const { status } = req.body;
    if (!CANDIDATE_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    db.data.candidates = db.data.candidates || [];
    const candidate = db.data.candidates.find(c => c.id == req.params.id);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    candidate.status = status;
    candidate.updatedAt = new Date().toISOString();
    await db.write();
    const { cv, comments = [], ...rest } = candidate;
    res.json({
      ...rest,
      commentCount: comments.length,
      cv: cv ? { filename: cv.filename, contentType: cv.contentType } : null
    });
  });

  app.get('/recruitment/candidates/:id/cv', authRequired, managerOnly, async (req, res) => {
    await db.read();
    db.data.candidates = db.data.candidates || [];
    const candidate = db.data.candidates.find(c => c.id == req.params.id);
    if (!candidate || !candidate.cv || !candidate.cv.data) {
      return res.status(404).json({ error: 'CV not found' });
    }
    const filename = (candidate.cv.filename || 'cv').replace(/"/g, '');
    const buffer = Buffer.from(candidate.cv.data, 'base64');
    res.setHeader('Content-Type', candidate.cv.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  app.get('/recruitment/candidates/search', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const term = (req.query.q || '').toString().trim();
    if (!term) {
      return res.json([]);
    }
    const query = term.toLowerCase();
    db.data.candidates = db.data.candidates || [];
    db.data.positions = db.data.positions || [];
    const positionMap = new Map(db.data.positions.map(pos => [String(pos.id), pos.title]));
    const matches = db.data.candidates
      .filter(candidate => {
        const name = (candidate.name || '').toString().toLowerCase();
        const contact = (candidate.contact || '').toString().toLowerCase();
        return name.includes(query) || contact.includes(query);
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
      .slice(0, 20)
      .map(candidate => ({
        id: candidate.id,
        name: candidate.name,
        contact: candidate.contact,
        status: candidate.status,
        positionId: candidate.positionId,
        positionTitle: positionMap.get(String(candidate.positionId)) || null,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        hasCv: !!(candidate.cv && candidate.cv.data),
        cvFilename: candidate.cv?.filename || null,
        cvContentType: candidate.cv?.contentType || null
      }));
    res.json(matches);
  });

  app.get('/recruitment/candidates/:id/comments', authRequired, managerOnly, async (req, res) => {
    await db.read();
    db.data.candidates = db.data.candidates || [];
    const candidate = db.data.candidates.find(c => c.id == req.params.id);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    candidate.comments = candidate.comments || [];
    const comments = candidate.comments.map(comment => sanitizeComment(comment, req.user));
    res.json(comments);
  });

  app.post('/recruitment/candidates/:id/comments', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const text = (req.body.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Comment text is required' });
    }
    db.data.candidates = db.data.candidates || [];
    const candidate = db.data.candidates.find(c => c.id == req.params.id);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    candidate.comments = candidate.comments || [];
    const now = new Date().toISOString();
    const comment = {
      id: generateCommentId(),
      text,
      userId: req.user.id,
      userEmail: req.user.email,
      createdAt: now,
      updatedAt: now
    };
    candidate.comments.push(comment);
    candidate.updatedAt = now;
    await db.write();
    res.status(201).json({
      comment: sanitizeComment(comment, req.user),
      commentCount: candidate.comments.length
    });
  });

  app.patch('/recruitment/candidates/:candidateId/comments/:commentId', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const text = (req.body.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Comment text is required' });
    }
    db.data.candidates = db.data.candidates || [];
    const candidate = db.data.candidates.find(c => c.id == req.params.candidateId);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    candidate.comments = candidate.comments || [];
    const comment = candidate.comments.find(c => c.id == req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.userId !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own comments' });
    }
    comment.text = text;
    comment.updatedAt = new Date().toISOString();
    candidate.updatedAt = comment.updatedAt;
    await db.write();
    res.json({
      comment: sanitizeComment(comment, req.user),
      commentCount: candidate.comments.length
    });
  });

  // ========== APPLICATIONS ==========
  app.get('/applications', authRequired, async (req, res) => {
    await db.read();
    let apps = db.data.applications || [];
    if (req.user.role !== 'manager') {
      apps = apps.filter(a => a.employeeId == req.user.employeeId);
    } else {
      if (req.query.employeeId) {
        apps = apps.filter(a => a.employeeId == req.query.employeeId);
      }
      if (req.query.status) {
        apps = apps.filter(a => a.status === req.query.status);
      }
    }
    res.json(apps);
  });

  // ---- BULK LEAVE IMPORT ----
  app.post(
    '/applications/bulk-import',
    authRequired,
    managerOnly,
    express.text({ type: '*/*' }),
    async (req, res) => {
      await db.read();
      db.data.applications = db.data.applications || [];
      db.data.employees = db.data.employees || [];

      const rawCsv = (req.body || '').trim();
      if (!rawCsv) {
        return res.status(400).json({ error: 'CSV file is empty.' });
      }

      try {
        const rows = parse(rawCsv, {
          columns: true,
          skip_empty_lines: true,
          trim: true
        });

        if (!Array.isArray(rows) || !rows.length) {
          return res.status(400).json({ error: 'No rows found in CSV file.' });
        }

        const normalizeKey = key =>
          key
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');

        function getColumnValue(row, candidates) {
          const entries = Object.entries(row || {});
          for (const candidate of candidates) {
            const normalizedCandidate = normalizeKey(candidate);
            for (const [key, value] of entries) {
              const normalizedKey = normalizeKey(key);
              if (
                normalizedKey === normalizedCandidate ||
                normalizedKey.includes(normalizedCandidate)
              ) {
                return typeof value === 'string' ? value.trim() : value;
              }
            }
          }
          return undefined;
        }

        function normalizeType(value) {
          if (!value) return null;
          const cleaned = value.toString().trim().toLowerCase();
          const map = {
            annual: 'annual',
            casual: 'casual',
            medical: 'medical',
            sick: 'medical',
            sickleave: 'medical',
            medicalleave: 'medical',
            annualleave: 'annual',
            casualleave: 'casual'
          };
          const normalized = cleaned.replace(/\s+/g, '');
          if (map[cleaned]) return map[cleaned];
          if (map[normalized]) return map[normalized];
          return ['annual', 'casual', 'medical'].find(type =>
            normalized.includes(type)
          );
        }

        function normalizeDate(value) {
          if (!value) return null;

          const toIso = (year, month, day) => {
            if (
              !Number.isInteger(year) ||
              !Number.isInteger(month) ||
              !Number.isInteger(day)
            ) {
              return null;
            }
            const date = new Date(Date.UTC(year, month - 1, day));
            if (
              date.getUTCFullYear() !== year ||
              date.getUTCMonth() !== month - 1 ||
              date.getUTCDate() !== day
            ) {
              return null;
            }
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          };

          if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return toIso(
              value.getUTCFullYear(),
              value.getUTCMonth() + 1,
              value.getUTCDate()
            );
          }

          const str = value.toString().trim();
          if (!str) return null;

          const isoMatch = str.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
          if (isoMatch) {
            const year = Number(isoMatch[1]);
            const month = Number(isoMatch[2]);
            const day = Number(isoMatch[3]);
            return toIso(year, month, day);
          }

          const altMatch = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
          if (altMatch) {
            let month = Number(altMatch[1]);
            let day = Number(altMatch[2]);
            let year = Number(altMatch[3]);
            if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) {
              return null;
            }
            if (year < 100) {
              year += 2000;
            }
            if (month > 12 && day <= 12) {
              [month, day] = [day, month];
            }
            return toIso(year, month, day);
          }

          const parsed = new Date(str);
          if (Number.isNaN(parsed.getTime())) return null;
          return toIso(
            parsed.getUTCFullYear(),
            parsed.getUTCMonth() + 1,
            parsed.getUTCDate()
          );
        }

        const employeesByName = new Map();
        db.data.employees.forEach(emp => {
          const name = (emp.name || '').toString().trim().toLowerCase();
          if (name && !employeesByName.has(name)) {
            employeesByName.set(name, emp);
          }
        });

        const existingKeys = new Set(
          db.data.applications
            .filter(app => app && app.employeeId && app.from && app.to && app.type)
            .map(
              app =>
                `${app.employeeId}__${app.from}__${app.to}__${String(app.type).toLowerCase()}`
            )
        );

        const now = Date.now();
        let added = 0;
        let skipped = 0;
        const errors = [];

        rows.forEach((row, index) => {
          const nameValue = getColumnValue(row, ['name', 'employee name']);
          const dateValue = getColumnValue(row, ['date', 'leave date']);
          const typeValue = getColumnValue(row, ['type', 'leave type', 'type name']);
          const reasonValue =
            getColumnValue(row, ['reason', 'remarks', 'remark']) || 'Imported via CSV upload';

          if (!nameValue || !dateValue || !typeValue) {
            skipped += 1;
            errors.push(
              `Row ${index + 1}: Missing ${
                !nameValue ? 'name' : !dateValue ? 'date' : 'type'
              }.`
            );
            return;
          }

          const employee = employeesByName.get(nameValue.toLowerCase());
          if (!employee) {
            skipped += 1;
            errors.push(`Row ${index + 1}: Employee "${nameValue}" not found.`);
            return;
          }

          const normalizedType = normalizeType(typeValue);
          if (!normalizedType) {
            skipped += 1;
            errors.push(`Row ${index + 1}: Unsupported leave type "${typeValue}".`);
            return;
          }

          const isoDate = normalizeDate(dateValue);
          if (!isoDate) {
            skipped += 1;
            errors.push(`Row ${index + 1}: Invalid date "${dateValue}".`);
            return;
          }

          const key = `${employee.id}__${isoDate}__${isoDate}__${normalizedType}`;
          if (existingKeys.has(key)) {
            skipped += 1;
            errors.push(
              `Row ${index + 1}: Duplicate leave entry for ${nameValue} on ${isoDate}.`
            );
            return;
          }

          const record = {
            id: now + index,
            employeeId: employee.id,
            type: normalizedType,
            from: isoDate,
            to: isoDate,
            reason: reasonValue,
            status: 'approved',
            approvedBy: req.user?.email || 'CSV Import',
            approvedAt: new Date().toISOString(),
            approverRemark: 'Imported via CSV upload',
            source: 'csv-import',
            skipBalanceDeduction: true
          };

          db.data.applications.push(record);
          existingKeys.add(key);
          added += 1;
        });

        if (added) {
          await db.write();
        }

        return res
          .status(added ? 201 : 200)
          .json({ added, skipped, errors });
      } catch (err) {
        console.error('Leave CSV import failed', err);
        return res.status(400).json({ error: 'Invalid CSV file.' });
      }
    }
  );

  // ---- EMAIL SETTINGS ----
  app.get('/settings/email', authRequired, managerOnly, async (req, res) => {
    try {
      const config = await loadEmailSettings({ force: true });
      const { pass, ...rest } = config;
      await db.read();
      const recipientOptions = buildRecipientOptions(db.data, rest.recipients);
      res.json({ ...rest, hasPassword: Boolean(pass), recipientOptions });
    } catch (err) {
      console.error('Failed to load email settings', err);
      res.status(500).json({ error: 'Unable to load email settings.' });
    }
  });

  app.put('/settings/email', authRequired, managerOnly, async (req, res) => {
    try {
      const payload = req.body || {};
      const providerRaw = typeof payload.provider === 'string' ? payload.provider.trim().toLowerCase() : 'custom';
      const provider = providerRaw === 'office365' ? 'office365' : 'custom';
      let host = typeof payload.host === 'string' ? payload.host.trim() : '';
      let secure = payload.secure === true || payload.secure === 'true';
      let port = Number(payload.port);
      const enabled = payload.enabled !== false;
      if (provider === 'office365') {
        host = 'smtp.office365.com';
        port = 587;
        secure = false;
      }
      if (!Number.isFinite(port) || port <= 0) {
        port = secure ? 465 : 587;
      }
      if (enabled && !host) {
        return res.status(400).json({ error: 'SMTP host is required when email notifications are enabled.' });
      }
      const user = typeof payload.user === 'string' ? payload.user.trim() : '';
      const from = typeof payload.from === 'string' ? payload.from.trim() : '';
      const replyTo = typeof payload.replyTo === 'string' ? payload.replyTo.trim() : '';
      const recipientsRaw = Array.isArray(payload.recipients)
        ? payload.recipients
        : typeof payload.recipients === 'string'
          ? payload.recipients.split(/[,;]+/)
          : [];
      const recipientMap = new Map();
      recipientsRaw.forEach(value => {
        if (value === undefined || value === null) return;
        const trimmed = typeof value === 'string' ? value.trim() : String(value || '').trim();
        if (!trimmed) return;
        const lower = trimmed.toLowerCase();
        if (!recipientMap.has(lower)) {
          recipientMap.set(lower, trimmed);
        }
      });
      const recipients = Array.from(recipientMap.values());
      const updatePassword = payload.updatePassword === true;
      const incomingPassword = typeof payload.password === 'string' ? payload.password : '';

      await db.read();
      db.data.settings = db.data.settings && typeof db.data.settings === 'object' ? db.data.settings : {};
      const existing = db.data.settings.email && typeof db.data.settings.email === 'object'
        ? db.data.settings.email
        : {};
      let pass = existing.pass || '';
      if (updatePassword) {
        pass = incomingPassword;
      }

      const storedConfig = {
        enabled: Boolean(enabled && host),
        provider,
        host,
        port,
        secure: Boolean(secure),
        user,
        pass,
        from: from || user,
        replyTo,
        recipients
      };

      db.data.settings.email = storedConfig;
      await db.write();

      const normalized = normalizeEmailSettings(storedConfig);
      emailSettingsCache = { config: normalized, loadedAt: Date.now() };
      emailTransporterCache = { transporter: null, signature: null };

      const { pass: _, ...safe } = normalized;
      const recipientOptions = buildRecipientOptions(db.data, safe.recipients);
      res.json({ ...safe, hasPassword: Boolean(storedConfig.pass), recipientOptions });
    } catch (err) {
      console.error('Failed to save email settings', err);
      res.status(500).json({ error: 'Unable to save email settings.' });
    }
  });

  // ---- HOLIDAY CONFIGURATION ----
  app.get('/holidays', authRequired, async (req, res) => {
    await db.read();
    const holidays = Array.isArray(db.data.holidays) ? db.data.holidays : [];
    const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
    res.json(sorted);
  });

  app.post('/holidays', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const dateValue = typeof req.body?.date === 'string' ? req.body.date.trim() : '';
    const nameValue = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!dateValue) {
      return res.status(400).json({ error: 'Holiday date is required.' });
    }
    if (!nameValue) {
      return res.status(400).json({ error: 'Holiday name is required.' });
    }

    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'Invalid holiday date.' });
    }
    const isoDate = parsed.toISOString().split('T')[0];

    db.data.holidays = Array.isArray(db.data.holidays) ? db.data.holidays : [];
    if (db.data.holidays.some(h => h.date === isoDate)) {
      return res.status(400).json({ error: 'A holiday already exists on this date.' });
    }

    const holiday = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      date: isoDate,
      name: nameValue
    };
    db.data.holidays.push(holiday);
    await db.write();
    res.status(201).json(holiday);
  });

  app.delete('/holidays/:id', authRequired, managerOnly, async (req, res) => {
    await db.read();
    db.data.holidays = Array.isArray(db.data.holidays) ? db.data.holidays : [];
    const index = db.data.holidays.findIndex(h => h.id === req.params.id);
    if (index < 0) {
      return res.status(404).json({ error: 'Holiday not found.' });
    }
    db.data.holidays.splice(index, 1);
    await db.write();
    res.json({ success: true });
  });

  // ---- LEAVE REPORT ----
  app.get('/leave-report', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;
    const emps = db.data.employees || [];
    const apps = db.data.applications || [];

    const report = emps.map(emp => {
      let empApps = apps.filter(a => a.employeeId == emp.id && a.status === 'approved');
      if (startDate || endDate) {
        empApps = empApps.filter(a => {
          const from = new Date(a.from);
          const to = new Date(a.to);
          if (startDate && to < startDate) return false;
          if (endDate && from > endDate) return false;
          return true;
        });
      }
      const totals = {};
      let totalDays = 0;
      empApps.forEach(a => {
        const days = startDate || endDate ? getLeaveDaysInRange(a, startDate, endDate) : getLeaveDays(a);
        if (days <= 0) return;
        totals[a.type] = (totals[a.type] || 0) + days;
        totalDays += days;
      });
      return {
        id: emp.id,
        name: emp.name || '',
        title: emp.Title || emp.title || '',
        location: emp['Country / City'] || emp.location || emp['country/city'] || '',
        totalDays,
        leaves: totals
      };
    }).filter(r => r.totalDays > 0);

    report.sort((a, b) => b.totalDays - a.totalDays);
    res.json(report);
  });

  // ---- LEAVE REPORT CSV EXPORT ----
  app.get('/leave-report/export', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const emps = db.data.employees || [];
    const apps = (db.data.applications || []).filter(a => a.status === 'approved');

    function escapeCsv(value) {
      if (!value) return '';
      const str = String(value);
      return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    }

    const rows = [];
    for (const app of apps) {
      const emp = emps.find(e => e.id == app.employeeId) || {};
      const name = emp.name || '';
      const start = new Date(app.from);
      const end = new Date(app.to);
      if (app.halfDay) {
        const dateStr = start.toISOString().split('T')[0];
        const period = app.halfDayType || app.halfDayPeriod || '';
        const type = `${app.type} (Half Day${period ? ' ' + period : ''})`;
        rows.push({ name, date: dateStr, type });
      } else {
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().split('T')[0];
          rows.push({ name, date: dateStr, type: app.type });
        }
      }
    }

    const csv = ['Name,Date,Type']
      .concat(rows.map(r => `${escapeCsv(r.name)},${escapeCsv(r.date)},${escapeCsv(r.type)}`))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="leave-report.csv"');
    res.send(csv);
  });

  // ---- LEAVE CALENDAR DATA ----
  app.get('/leave-calendar', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;
    const emps = db.data.employees || [];
    const apps = (db.data.applications || []).filter(a => a.status === 'approved');
    const map = {};
    for (const app of apps) {
      const emp = emps.find(e => e.id == app.employeeId) || {};
      const name = emp.name || '';
      const startD = new Date(app.from);
      const endD = new Date(app.to);
      for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
        if (startDate && d < startDate) continue;
        if (endDate && d > endDate) continue;
        const dateStr = d.toISOString().split('T')[0];
        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push({ name, type: app.type });
      }
    }
    const result = Object.entries(map).map(([date, entries]) => ({ date, entries }));
    res.json(result);
  });

  // ========== LEAVE LOGIC ==========

  // Helper: Holiday lookup
  function getHolidaySet() {
    const holidays = Array.isArray(db.data?.holidays) ? db.data.holidays : [];
    return new Set(holidays.map(h => h.date));
  }

  // Helper: Get leave days (with half day support)
  function getLeaveDays(app) {
    const from = new Date(app.from);
    const to = new Date(app.to);
    const holidaySet = getHolidaySet();
    if (app.halfDay) {
      const day = from.getDay();
      const iso = from.toISOString().split('T')[0];
      return day === 0 || day === 6 || holidaySet.has(iso) ? 0 : 0.5;
    }
    let days = 0;
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      const iso = d.toISOString().split('T')[0];
      if (day !== 0 && day !== 6 && !holidaySet.has(iso)) days++;
    }
    return days;
  }

  function getLeaveDaysInRange(app, startDate, endDate) {
    if (!startDate && !endDate) return getLeaveDays(app);
    const from = new Date(app.from);
    const to = new Date(app.to);
    const holidaySet = getHolidaySet();
    const start = startDate && from < startDate ? new Date(startDate) : from;
    const end = endDate && to > endDate ? new Date(endDate) : to;
    if (app.halfDay) {
      if (startDate && from < startDate) return 0;
      if (endDate && from > endDate) return 0;
      const day = from.getDay();
      const iso = from.toISOString().split('T')[0];
      return day === 0 || day === 6 || holidaySet.has(iso) ? 0 : 0.5;
    }
    if (end < start) return 0;
    let days = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      const iso = d.toISOString().split('T')[0];
      if (day !== 0 && day !== 6 && !holidaySet.has(iso)) days++;
    }
    return days;
  }

  async function createLeaveApplication(payload, currentUser) {
    const {
      employeeId,
      type,
      from,
      to,
      reason,
      halfDay,
      halfDayType
    } = payload || {};

    await db.read();
    db.data.applications = Array.isArray(db.data.applications)
      ? db.data.applications
      : [];
    db.data.employees = Array.isArray(db.data.employees)
      ? db.data.employees
      : [];
    db.data.users = Array.isArray(db.data.users) ? db.data.users : [];

    if (!employeeId) {
      return { status: 400, error: 'Employee ID is required.' };
    }

    if (
      currentUser.role !== 'manager' &&
      currentUser.employeeId != employeeId
    ) {
      return { status: 403, error: 'Cannot apply for another employee' };
    }

    const supportedTypes = Object.keys(DEFAULT_LEAVE_BALANCES);
    const normalizedType = typeof type === 'string' ? type.trim().toLowerCase() : '';
    if (!supportedTypes.includes(normalizedType)) {
      return { status: 400, error: 'Unsupported leave type.' };
    }

    if (!from || !to) {
      return { status: 400, error: 'Start and end dates are required.' };
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return { status: 400, error: 'Invalid date format.' };
    }

    if (toDate < fromDate) {
      return { status: 400, error: 'End date cannot be before start date.' };
    }

    const employees = db.data.employees;
    const employee = employees.find(e => e.id == employeeId);
    const status = (employee?.status || '').toString().toLowerCase();
    if (!employee || ['inactive', 'deactivated', 'disabled'].includes(status)) {
      return { status: 403, error: 'Employee account is inactive' };
    }

    const leaveBalances =
      employee.leaveBalances && typeof employee.leaveBalances === 'object'
        ? { ...employee.leaveBalances }
        : { ...DEFAULT_LEAVE_BALANCES };

    const normalizedFrom =
      typeof from === 'string' ? from.trim() : fromDate.toISOString();
    const normalizedTo = typeof to === 'string' ? to.trim() : toDate.toISOString();

    const newApp = {
      id: Date.now(),
      employeeId,
      type: normalizedType,
      from: normalizedFrom,
      to: normalizedTo,
      reason: reason || '',
      status: 'pending'
    };

    if (halfDay) {
      newApp.halfDay = true;
      if (halfDayType) {
        newApp.halfDayType = halfDayType;
      }
    }

    const days = getLeaveDays(newApp);
    const balance = Number(leaveBalances[normalizedType]) || 0;
    if (balance < days) {
      return { status: 400, error: 'Insufficient leave balance.' };
    }

    leaveBalances[normalizedType] = balance - days;
    employee.leaveBalances = leaveBalances;

    db.data.applications.push(newApp);
    await db.write();

    const emailConfig = await loadEmailSettings();
    let recipientEmails = Array.isArray(emailConfig?.recipients)
      ? emailConfig.recipients.filter(Boolean)
      : [];
    if (!recipientEmails.length) {
      const managers = db.data.users.filter(u => u.role === 'manager');
      recipientEmails = managers.map(m => m.email).filter(Boolean);
    }
    const empEmail = getEmpEmail(employee);
    const name = employee?.name || empEmail || `Employee ${employeeId}`;
    if (!recipientEmails.length && ADMIN_EMAIL) {
      recipientEmails = [ADMIN_EMAIL];
    }
    if (recipientEmails.length) {
      await sendEmail(
        recipientEmails,
        `Leave request from ${name}`,
        `${name} applied for ${normalizedType} leave from ${normalizedFrom} to ${normalizedTo}.`
      );
    }

    return { status: 201, application: newApp };
  }

  async function handleLeaveApplicationRequest(req, res) {
    const result = await createLeaveApplication(req.body, req.user);
    if (result.error) {
      return res
        .status(result.status)
        .json({ success: false, error: result.error });
    }

    return res
      .status(result.status)
      .json({ success: true, application: result.application });
  }

  // ---- APPLY FOR LEAVE ----
  app.post('/applications', authRequired, async (req, res) => {
    const result = await createLeaveApplication(req.body, req.user);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(result.status).json(result.application);
  });

  app.get('/api/me', authRequired, (req, res) => {
    res.json({
      userId: req.user.id,
      employeeId: req.user.employeeId ?? null,
      email: req.user.email || null,
      role: req.user.role
    });
  });

  app.get('/api/users/:id', authRequired, async (req, res) => {
    const { id } = req.params;
    await db.read();
    db.data.users = Array.isArray(db.data.users) ? db.data.users : [];
    db.data.employees = Array.isArray(db.data.employees) ? db.data.employees : [];

    const matchedUser = db.data.users.find(
      user => user && (user.id == id || user.employeeId == id)
    );
    const employeeId = matchedUser?.employeeId ?? id;
    const matchedEmployee = db.data.employees.find(emp => emp && emp.id == employeeId) ||
      db.data.employees.find(emp => emp && emp.id == id);

    if (!matchedUser && !matchedEmployee) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isSelf = Boolean(
      (matchedUser && (req.user.id == matchedUser.id || req.user.employeeId == matchedUser.employeeId)) ||
      (matchedEmployee && req.user.employeeId == matchedEmployee.id) ||
      req.user.id == id ||
      req.user.employeeId == id
    );

    if (req.user.role !== 'manager' && !isSelf) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const resolvedEmployee = matchedEmployee || (matchedUser?.employeeId
      ? db.data.employees.find(emp => emp && emp.id == matchedUser.employeeId)
      : null);
    const name = resolvedEmployee?.name ? String(resolvedEmployee.name).trim() : null;
    const email = matchedUser?.email || (resolvedEmployee ? getEmpEmail(resolvedEmployee) : '');
    const role = matchedUser?.role || getEmpRole(resolvedEmployee);

    let managerInfo = null;
    if (resolvedEmployee) {
      const rawManager = findValueByKeywords(resolvedEmployee, [
        'appraiser',
        'manager',
        'supervisor',
        'reporting'
      ]);
      const managerCandidates = rawManager
        ? rawManager
            .split(/[\\/,&]+/)
            .map(value => value && value.trim())
            .filter(Boolean)
        : [];
      const primaryManagerName = managerCandidates[0] || (rawManager ? rawManager.trim() : '');

      if (primaryManagerName) {
        const normalizedPrimary = primaryManagerName.trim().toLowerCase();
        const managerEmployee =
          db.data.employees.find(emp =>
            typeof emp?.name === 'string' && emp.name.trim().toLowerCase() === normalizedPrimary
          ) || null;
        const managerUser = managerEmployee
          ? db.data.users.find(user => user && user.employeeId == managerEmployee.id)
          : null;
        const managerEmail = managerUser?.email || (managerEmployee ? getEmpEmail(managerEmployee) : '');

        managerInfo = {
          name: primaryManagerName,
          employeeId: managerEmployee?.id ?? null,
          email: managerEmail ? managerEmail : null
        };
      }
    }

    const title = resolvedEmployee
      ? findValueByKeywords(resolvedEmployee, ['title', 'position'])
      : '';
    const department = resolvedEmployee
      ? findValueByKeywords(resolvedEmployee, ['department', 'project', 'team'])
      : '';

    res.json({
      id: matchedUser?.id || resolvedEmployee?.id || id,
      employeeId: resolvedEmployee?.id || matchedUser?.employeeId || null,
      name,
      email: email ? email : null,
      role,
      title: title || null,
      department: department || null,
      manager: managerInfo
    });
  });

  app.get('/api/leave-summary', authRequired, async (req, res) => {
    const targetEmployeeId =
      req.user.role === 'manager' && req.query.employeeId
        ? req.query.employeeId
        : req.user.employeeId;

    if (!targetEmployeeId) {
      return res.status(400).json({ error: 'Employee ID is required.' });
    }

    await db.read();
    db.data.employees = Array.isArray(db.data.employees)
      ? db.data.employees
      : [];
    db.data.applications = Array.isArray(db.data.applications)
      ? db.data.applications
      : [];

    const employee = db.data.employees.find(e => e.id == targetEmployeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const leaveBalances =
      employee.leaveBalances && typeof employee.leaveBalances === 'object'
        ? { ...employee.leaveBalances }
        : { ...DEFAULT_LEAVE_BALANCES };

    const now = new Date();
    const previousLeaveDays = db.data.applications
      .filter(app => app.employeeId == targetEmployeeId && app.status === 'approved')
      .filter(app => {
        const toDate = new Date(app.to);
        return !Number.isNaN(toDate.getTime()) && toDate < now;
      })
      .reduce((sum, app) => sum + getLeaveDays(app), 0);

    res.json({
      employeeId: employee.id,
      leaveBalances,
      previousLeaveDays
    });
  });

  app.get('/api/previous-leave-days', authRequired, async (req, res) => {
    const targetEmployeeId =
      req.user.role === 'manager' && req.query.employeeId
        ? req.query.employeeId
        : req.user.employeeId;

    if (!targetEmployeeId) {
      return res.status(400).json({ error: 'Employee ID is required.' });
    }

    await db.read();
    db.data.employees = Array.isArray(db.data.employees)
      ? db.data.employees
      : [];
    db.data.applications = Array.isArray(db.data.applications)
      ? db.data.applications
      : [];

    const employee = db.data.employees.find(e => e.id == targetEmployeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const now = new Date();
    const previousLeaveDays = db.data.applications
      .filter(app => app.employeeId == targetEmployeeId && app.status === 'approved')
      .filter(app => {
        const toDate = new Date(app.to);
        return !Number.isNaN(toDate.getTime()) && toDate < now;
      })
      .reduce((sum, app) => sum + getLeaveDays(app), 0);

    res.json({
      employeeId: employee.id,
      previousLeaveDays
    });
  });

  app.post('/api/leaves', authRequired, handleLeaveApplicationRequest);
  app.post('/api/apply-leave', authRequired, handleLeaveApplicationRequest);

  app.get('/api/openapi/user-info', authRequired, (req, res) => {
    const userInfoOpenApi = {
      openapi: '3.0.0',
      info: {
        title: 'User Information API',
        version: '1.0.0',
        description: 'Specification describing the user information endpoint.'
      },
      servers: [{ url: 'http://localhost:3000' }],
      paths: {
        '/api/users/{id}': buildUserInfoOpenApiPath()
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        },
        schemas: buildUserInfoOpenApiSchemas()
      }
    };

    res
      .type('application/json')
      .send(JSON.stringify(userInfoOpenApi, null, 2));
  });

  app.get('/api/openapi', authRequired, (req, res) => {
    const userInfoSchemas = buildUserInfoOpenApiSchemas();
    const openApiSpec = {
      openapi: '3.0.0',
      info: {
        title: 'Brillar HR Portal Leave APIs',
        version: '1.0.0',
        description:
          'API specification for leave management helper endpoints.'
      },
      servers: [{ url: 'http://localhost:3000' }],
      paths: {
        '/api/me': {
          get: {
            summary: 'Get current user identifier',
            security: [{ bearerAuth: [] }],
            responses: {
              200: {
                description: 'Authenticated user information',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/CurrentUserResponse' }
                  }
                }
              }
            }
          }
        },
        '/api/users/{id}': buildUserInfoOpenApiPath(),
        '/api/leave-summary': {
          get: {
            summary: 'Retrieve leave balances and historical usage',
            security: [{ bearerAuth: [] }],
            parameters: [
              {
                in: 'query',
                name: 'employeeId',
                schema: { type: 'string' },
                description:
                  'Optional employee identifier. Managers can view other employees.'
              }
            ],
            responses: {
              200: {
                description: 'Leave balances and usage metrics',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/LeaveSummaryResponse' }
                  }
                }
              }
            }
          }
        },
        '/api/previous-leave-days': {
          get: {
            summary: 'Retrieve total approved leave days in the past',
            security: [{ bearerAuth: [] }],
            parameters: [
              {
                in: 'query',
                name: 'employeeId',
                schema: { type: 'string' },
                description:
                  'Optional employee identifier. Managers can view other employees.'
              }
            ],
            responses: {
              200: {
                description: 'Total approved leave days prior to today',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/PreviousLeaveDaysResponse' }
                  }
                }
              },
              400: { description: 'Employee ID missing' },
              404: { description: 'Employee not found' }
            }
          }
        },
        '/api/leaves': {
          post: {
            summary: 'Apply for leave',
            security: [{ bearerAuth: [] }],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/LeaveApplicationRequest' }
                }
              }
            },
            responses: {
              201: {
                description: 'Leave application created',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/LeaveApplicationResponse' }
                  }
                }
              },
              400: { description: 'Validation error' },
              403: { description: 'Forbidden' }
            }
          }
        },
        '/api/apply-leave': {
          post: {
            summary: 'Apply for leave (alias of /api/leaves)',
            security: [{ bearerAuth: [] }],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/LeaveApplicationRequest' }
                }
              }
            },
            responses: {
              201: {
                description: 'Leave application created',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/LeaveApplicationResponse' }
                  }
                }
              },
              400: { description: 'Validation error' },
              403: { description: 'Forbidden' }
            }
          }
        },
        '/api/openapi': {
          get: {
            summary: 'Retrieve OpenAPI specification',
            security: [{ bearerAuth: [] }],
            responses: {
              200: {
                description: 'OpenAPI specification JSON string',
                content: {
                  'application/json': {
                    schema: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        },
        schemas: {
          CurrentUserResponse: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              employeeId: { type: ['string', 'null'] },
              email: { type: ['string', 'null'], format: 'email' },
              role: { type: 'string' }
            }
          },
          LeaveSummaryResponse: {
            type: 'object',
            properties: {
              employeeId: { type: 'string' },
              leaveBalances: {
                type: 'object',
                additionalProperties: { type: 'number' }
              },
              previousLeaveDays: { type: 'number' }
            }
          },
          PreviousLeaveDaysResponse: {
            type: 'object',
            properties: {
              employeeId: { type: 'string' },
              previousLeaveDays: { type: 'number' }
            }
          },
          LeaveApplicationRequest: {
            type: 'object',
            required: ['employeeId', 'type', 'from', 'to'],
            properties: {
              employeeId: { type: 'string' },
              type: {
                type: 'string',
                enum: Object.keys(DEFAULT_LEAVE_BALANCES)
              },
              from: { type: 'string', format: 'date' },
              to: { type: 'string', format: 'date' },
              reason: { type: 'string' },
              halfDay: { type: 'boolean' },
              halfDayType: { type: 'string' }
            }
          },
          LeaveApplicationResponse: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              application: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  employeeId: { type: 'string' },
                  type: { type: 'string' },
                  from: { type: 'string' },
                  to: { type: 'string' },
                  reason: { type: 'string' },
                  status: { type: 'string' },
                  halfDay: { type: 'boolean' },
                  halfDayType: { type: 'string' }
                }
              }
            }
          },
          ...userInfoSchemas
        }
      }
    };

    res
      .type('application/json')
      .send(JSON.stringify(openApiSpec, null, 2));
  });

  // ---- APPROVE LEAVE ----
  app.patch('/applications/:id/approve', authRequired, managerOnly, async (req, res) => {
    const { id } = req.params;
    const { approver, remark } = req.body;
    await db.read();
    const appIdx = db.data.applications.findIndex(x => x.id == id);
    if (appIdx < 0) return res.status(404).json({ error: 'Not found' });
    if (db.data.applications[appIdx].status !== 'pending')
      return res.status(400).json({ error: 'Already actioned' });

    db.data.applications[appIdx].status = 'approved';
    db.data.applications[appIdx].approvedBy = approver || '';
    db.data.applications[appIdx].approverRemark = remark || '';
    db.data.applications[appIdx].approvedAt = new Date().toISOString();
    await db.write();

    const emp = db.data.employees.find(e => e.id == db.data.applications[appIdx].employeeId);
    const email = getEmpEmail(emp);
    const name = emp?.name || email || `Employee ${db.data.applications[appIdx].employeeId}`;
    if (email) {
      await sendEmail(
        email,
        'Leave approved',
        `${name}, your leave from ${db.data.applications[appIdx].from} to ${db.data.applications[appIdx].to} has been approved.`
      );
    }

    res.json(db.data.applications[appIdx]);
  });

  // ---- REJECT LEAVE ----
  app.patch('/applications/:id/reject', authRequired, managerOnly, async (req, res) => {
    const { id } = req.params;
    const { approver, remark } = req.body;
    await db.read();
    const appIdx = db.data.applications.findIndex(x => x.id == id);
    if (appIdx < 0) return res.status(404).json({ error: 'Not found' });

    const app = db.data.applications[appIdx];
    if (app.status !== 'pending' && app.status !== 'approved')
      return res.status(400).json({ error: 'Already actioned' });

    // Credit back balance when rejecting (whether pending or already approved)
    const empIdx = db.data.employees.findIndex(x => x.id == app.employeeId);
    if (empIdx >= 0) {
      let days = getLeaveDays(app);
      db.data.employees[empIdx].leaveBalances[app.type] =
        Number(db.data.employees[empIdx].leaveBalances[app.type]) + days;
    }

    db.data.applications[appIdx].status = 'rejected';
    db.data.applications[appIdx].approvedBy = approver || '';
    db.data.applications[appIdx].approverRemark = remark || '';
    db.data.applications[appIdx].approvedAt = new Date().toISOString();
    await db.write();

    const emp = db.data.employees.find(e => e.id == app.employeeId);
    const email = getEmpEmail(emp);
    const name = emp?.name || email || `Employee ${app.employeeId}`;
    if (email) {
      await sendEmail(
        email,
        'Leave rejected',
        `${name}, your leave from ${app.from} to ${app.to} has been rejected.`
      );
    }

    res.json(db.data.applications[appIdx]);
  });

  // ---- CANCEL LEAVE ----
  app.patch('/applications/:id/cancel', authRequired, async (req, res) => {
    const { id } = req.params;
    await db.read();
    const appIdx = db.data.applications.findIndex(x => x.id == id);
    if (appIdx < 0) return res.status(404).json({ error: 'Not found' });

    const appObjApp = db.data.applications[appIdx];
    if (req.user.role !== 'manager' && appObjApp.employeeId != req.user.employeeId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (['cancelled', 'rejected'].includes(appObjApp.status)) {
      return res.status(400).json({ error: 'Already cancelled/rejected' });
    }

    // Only allow cancel if today is before leave "from" date
    const now = new Date();
    if (new Date(appObjApp.from) <= now) {
      return res.status(400).json({ error: 'Cannot cancel after leave started' });
    }

    // Credit back balance when cancelling (whether pending or approved)
    const empIdx = db.data.employees.findIndex(x => x.id == appObjApp.employeeId);
    if (empIdx >= 0) {
      let days = getLeaveDays(appObjApp);
      db.data.employees[empIdx].leaveBalances[appObjApp.type] =
        Number(db.data.employees[empIdx].leaveBalances[appObjApp.type]) + days;
    }

    db.data.applications[appIdx].status = 'cancelled';
    db.data.applications[appIdx].cancelledAt = new Date().toISOString();
    await db.write();

    const emp = db.data.employees.find(e => e.id == appObjApp.employeeId);
    const email = getEmpEmail(emp);
    const name = emp?.name || email || `Employee ${appObjApp.employeeId}`;
    if (email) {
      await sendEmail(
        email,
        'Leave cancelled',
        `${name}, your leave from ${appObjApp.from} to ${appObjApp.to} has been cancelled.`
      );
    }

    res.json(db.data.applications[appIdx]);
  });

  // (Legacy/optional: PATCH by status field)
  app.patch('/applications/:id/decision', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const { status } = req.body; // "approved" or "rejected"
    const appIdx = db.data.applications.findIndex(a => a.id == req.params.id);
    const app = db.data.applications[appIdx];
    if (!app) return res.status(404).json({ error: 'Not found' });
    if (status === 'rejected') {
      // Credit back leave
      const emp = db.data.employees.find(e => e.id == app.employeeId);
      if (emp && emp.leaveBalances[app.type] !== undefined) {
        let days = getLeaveDays(app);
        emp.leaveBalances[app.type] = (+emp.leaveBalances[app.type] || 0) + days;
      }
    }
    app.status = status;
    await db.write();
    res.json(app);
  });

  // ========== GLOBAL ERROR HANDLER ==========
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  });

  // ========== START SERVER ==========
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
