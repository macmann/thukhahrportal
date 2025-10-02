// server.js

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const { db, init } = require('./db');
const { parse } = require('csv-parse/sync');

const app = express();

// Payload limit for incoming requests (default 1 MB)
const BODY_LIMIT = process.env.BODY_LIMIT || '1mb';

// Default admin credentials (can be overridden with env vars)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@brillar.io';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// ---- MICROSOFT SSO CONFIG ----
const MS_CLIENT_ID = process.env.MS_CLIENT_ID || '';
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET || '';
const MS_TENANT = process.env.MS_TENANT || 'common';
const MS_REDIRECT_URI = process.env.MS_REDIRECT_URI ||
  'http://localhost:3000/auth/microsoft/callback';




// ---- EMAIL SETUP ----
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  } : undefined
});

async function sendEmail(to, subject, text) {
  if (!to || !process.env.SMTP_HOST) return;
  try {
    await mailTransporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text
    });
  } catch (err) {
    console.error('Failed to send email', err);
  }
}

function getEmpEmail(emp) {
  if (!emp) return '';
  const key = Object.keys(emp).find(k => k.toLowerCase() === 'email');
  return emp[key];
}

const SESSION_TOKENS = {}; // token: userId

function genToken() {
  return Math.random().toString(36).slice(2) + Date.now();
}

const CANDIDATE_STATUSES = [
  'New',
  'Selected for Interview',
  'Rejected',
  'Hired'
];

app.use(bodyParser.json({ limit: BODY_LIMIT }));
app.use(bodyParser.urlencoded({ limit: BODY_LIMIT, extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- AUTH ----
async function authRequired(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || !SESSION_TOKENS[token]) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = SESSION_TOKENS[token];
  await db.read();
  let user = db.data.users?.find(u => u.id === userId);
  if (!user && userId === 'admin') {
    user = { id: 'admin', email: ADMIN_EMAIL, role: 'manager', employeeId: null };
  }
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

function managerOnly(req, res, next) {
  if (!req.user || req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

init().then(() => {
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
      const redirect = `/?token=${token}&user=${encodeURIComponent(JSON.stringify(userObj))}`;
      res.redirect(redirect);
    } catch (err) {
      console.error('Microsoft auth failed', err);
      res.status(500).send('Authentication failed');
    }
  });
  // ========== LOGIN ==========
  app.post('/login', async (req, res) => {
    await db.read();
    const { email, password } = req.body;
    const user = db.data.users?.find(u => u.email === email && u.password === password);

    let userObj;
    if (user) {
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
    res.json({ token, user: userObj });
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
    const payload = req.body;
    db.data.employees.push({ id, ...payload });
    const emailKey = Object.keys(payload).find(k => k.toLowerCase() === 'email');
    const roleKey = Object.keys(payload).find(k => k.toLowerCase() === 'role');
    const email = emailKey ? payload[emailKey] : undefined;
    if (email) {
      const role = payload[roleKey]?.toLowerCase() === 'manager' ? 'manager' : 'employee';
      db.data.users.push({
        id,
        email,
        password: 'brillar',
        role,
        employeeId: id
      });
    }
    await db.write();
    res.status(201).json({ id, ...payload });
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
        db.data.employees.push(emp);
        const email = emailKey ? row[emailKey] : undefined;
        if (email) {
          const role = row[roleKey]?.toLowerCase() === 'manager' ? 'manager' : 'employee';
          db.data.users.push({
            id,
            email,
            password: 'brillar',
            role,
            employeeId: id
          });
        }
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
    Object.assign(emp, req.body);
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
    db.data.employees.splice(idx, 1);
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

  app.get('/recruitment/candidates', authRequired, managerOnly, async (req, res) => {
    await db.read();
    const { positionId } = req.query;
    db.data.candidates = db.data.candidates || [];
    let list = db.data.candidates;
    if (positionId) {
      list = list.filter(c => c.positionId == positionId);
    }
    const sanitized = list.map(c => {
      const { cv, ...rest } = c;
      return {
        ...rest,
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
      createdAt: now,
      updatedAt: now
    };
    db.data.candidates.push(candidate);
    await db.write();
    const { cv: storedCv, ...rest } = candidate;
    res.status(201).json({ ...rest, cv: { filename: storedCv.filename, contentType: storedCv.contentType } });
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
    const { cv, ...rest } = candidate;
    res.json({ ...rest, cv: cv ? { filename: cv.filename, contentType: cv.contentType } : null });
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

  // Helper: Get leave days (with half day support)
  function getLeaveDays(app) {
    const from = new Date(app.from);
    const to = new Date(app.to);
    if (app.halfDay) {
      return (from.getDay() === 0 || from.getDay() === 6) ? 0 : 0.5;
    }
    let days = 0;
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) days++;
    }
    return days;
  }

  function getLeaveDaysInRange(app, startDate, endDate) {
    if (!startDate && !endDate) return getLeaveDays(app);
    const from = new Date(app.from);
    const to = new Date(app.to);
    const start = startDate && from < startDate ? new Date(startDate) : from;
    const end = endDate && to > endDate ? new Date(endDate) : to;
    if (app.halfDay) {
      if (startDate && from < startDate) return 0;
      if (endDate && from > endDate) return 0;
      return (from.getDay() === 0 || from.getDay() === 6) ? 0 : 0.5;
    }
    if (end < start) return 0;
    let days = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) days++;
    }
    return days;
  }

  // ---- APPLY FOR LEAVE ----
  app.post('/applications', authRequired, async (req, res) => {
    await db.read();
    if (req.user.role !== 'manager' && req.user.employeeId != req.body.employeeId) {
      return res.status(403).json({ error: 'Cannot apply for another employee' });
    }
    const { employeeId, type, from, to, reason, halfDay, halfDayType } = req.body;
    const id = Date.now();
    const newApp = {
      id,
      employeeId,
      type,
      from,
      to,
      reason,
      status: 'pending',
      ...(halfDay ? { halfDay: true, halfDayType } : {})
    };

    // Deduct balance immediately (pending means leave already deducted)
    const emp = db.data.employees.find(e => e.id == employeeId);
    if (emp && emp.leaveBalances[type] !== undefined) {
      let bal = Number(emp.leaveBalances[type]) || 0;
      let days = getLeaveDays(newApp);
      if (bal < days) {
        return res.status(400).json({ error: 'Insufficient leave balance.' });
      }
      emp.leaveBalances[type] = bal - days;
    }

    db.data.applications.push(newApp);
    await db.write();

    // Notify managers of new application
    const managers = (db.data.users || []).filter(u => u.role === 'manager');
    const managerEmails = managers.map(m => m.email).filter(Boolean);
    const empEmail = getEmpEmail(emp);
    const name = emp?.name || empEmail || `Employee ${employeeId}`;
    if (managerEmails.length) {
      await sendEmail(
        managerEmails.join(','),
        `Leave request from ${name}`,
        `${name} applied for ${type} leave from ${from} to ${to}.`
      );
    }

    res.status(201).json(newApp);
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
