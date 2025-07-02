// server.js

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { db, init } = require('./db');

const app = express();

const DB_PATH = path.join(__dirname, 'db.json');

// Utility: Load and Save DB
function loadDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

const SESSION_TOKENS = {}; // token: userId

function genToken() {
  return Math.random().toString(36).slice(2) + Date.now();
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- AUTH ----
function authRequired(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || !SESSION_TOKENS[token]) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.userId = SESSION_TOKENS[token];
  next();
}

init().then(() => {
  // ========== LOGIN ==========
  app.post('/login', async (req, res) => {
    await db.read();
    const { email, password } = req.body;
    const user = db.data.users?.find(u => u.email === email && u.password === password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const token = genToken();
    SESSION_TOKENS[token] = user.id;
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId
      }
    });
  });

  // ========== EMPLOYEES ==========
  app.get('/employees', async (req, res) => {
    await db.read();
    res.json(db.data.employees);
  });

  app.post('/employees', async (req, res) => {
    await db.read();
    const id = Date.now();
    const payload = req.body;
    db.data.employees.push({ id, ...payload });
    await db.write();
    res.status(201).json({ id, ...payload });
  });

  app.put('/employees/:id', async (req, res) => {
    await db.read();
    const emp = db.data.employees.find(e => e.id == req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    Object.assign(emp, req.body);
    await db.write();
    res.json(emp);
  });

  app.patch('/employees/:id/status', async (req, res) => {
    await db.read();
    const emp = db.data.employees.find(e => e.id == req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    emp.status = req.body.status;
    await db.write();
    res.json(emp);
  });

  app.delete('/employees/:id', async (req, res) => {
    await db.read();
    const idx = db.data.employees.findIndex(e => e.id == req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    db.data.employees.splice(idx, 1);
    await db.write();
    res.status(204).end();
  });

  // ========== APPLICATIONS ==========
  app.get('/applications', async (req, res) => {
    await db.read();
    let apps = db.data.applications || [];
    if (req.query.employeeId) {
      apps = apps.filter(a => a.employeeId == req.query.employeeId);
    }
    if (req.query.status) {
      apps = apps.filter(a => a.status === req.query.status);
    }
    res.json(apps);
  });

  // ========== LEAVE LOGIC ==========

  // Helper: Get leave days (with half day support)
  function getLeaveDays(app) {
    if (app.halfDay) return 0.5;
    return (
      (new Date(app.to) - new Date(app.from)) / (1000 * 60 * 60 * 24) + 1
    );
  }

  // ---- APPLY FOR LEAVE ----
  app.post('/applications', async (req, res) => {
    await db.read();
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
      let days = halfDay ? 0.5 : ((new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24) + 1);
      if (bal < days) {
        return res.status(400).json({ error: 'Insufficient leave balance.' });
      }
      emp.leaveBalances[type] = bal - days;
    }

    db.data.applications.push(newApp);
    await db.write();
    res.status(201).json(newApp);
  });

  // ---- APPROVE LEAVE ----
  app.patch('/applications/:id/approve', (req, res) => {
    const { id } = req.params;
    const { approver, remark } = req.body;
    const dbObj = loadDB();
    const appIdx = dbObj.applications.findIndex(x => x.id == id);
    if (appIdx < 0) return res.status(404).json({ error: 'Not found' });
    if (dbObj.applications[appIdx].status !== 'pending')
      return res.status(400).json({ error: 'Already actioned' });

    dbObj.applications[appIdx].status = 'approved';
    dbObj.applications[appIdx].approvedBy = approver || '';
    dbObj.applications[appIdx].approverRemark = remark || '';
    dbObj.applications[appIdx].approvedAt = new Date().toISOString();
    saveDB(dbObj);
    res.json(dbObj.applications[appIdx]);
  });

  // ---- REJECT LEAVE ----
  app.patch('/applications/:id/reject', (req, res) => {
    const { id } = req.params;
    const { approver, remark } = req.body;
    const dbObj = loadDB();
    const appIdx = dbObj.applications.findIndex(x => x.id == id);
    if (appIdx < 0) return res.status(404).json({ error: 'Not found' });

    const app = dbObj.applications[appIdx];
    if (app.status !== 'pending' && app.status !== 'approved')
      return res.status(400).json({ error: 'Already actioned' });

    // Credit back balance when rejecting (whether pending or already approved)
    const empIdx = dbObj.employees.findIndex(x => x.id == app.employeeId);
    if (empIdx >= 0) {
      let days = app.halfDay ? 0.5 : ((new Date(app.to) - new Date(app.from)) / (1000 * 60 * 60 * 24) + 1);
      dbObj.employees[empIdx].leaveBalances[app.type] =
        Number(dbObj.employees[empIdx].leaveBalances[app.type]) + days;
    }

    dbObj.applications[appIdx].status = 'rejected';
    dbObj.applications[appIdx].approvedBy = approver || '';
    dbObj.applications[appIdx].approverRemark = remark || '';
    dbObj.applications[appIdx].approvedAt = new Date().toISOString();
    saveDB(dbObj);
    res.json(dbObj.applications[appIdx]);
  });

  // ---- CANCEL LEAVE ----
  app.patch('/applications/:id/cancel', (req, res) => {
    const { id } = req.params;
    const dbObj = loadDB();
    const appIdx = dbObj.applications.findIndex(x => x.id == id);
    if (appIdx < 0) return res.status(404).json({ error: 'Not found' });

    const appObjApp = dbObj.applications[appIdx];
    if (['cancelled', 'rejected'].includes(appObjApp.status)) {
      return res.status(400).json({ error: 'Already cancelled/rejected' });
    }

    // Only allow cancel if today is before leave "from" date
    const now = new Date();
    if (new Date(appObjApp.from) <= now) {
      return res.status(400).json({ error: 'Cannot cancel after leave started' });
    }

    // Credit back balance when cancelling (whether pending or approved)
    const empIdx = dbObj.employees.findIndex(x => x.id == appObjApp.employeeId);
    if (empIdx >= 0) {
      let days = appObjApp.halfDay ? 0.5 : ((new Date(appObjApp.to) - new Date(appObjApp.from)) / (1000 * 60 * 60 * 24) + 1);
      dbObj.employees[empIdx].leaveBalances[appObjApp.type] =
        Number(dbObj.employees[empIdx].leaveBalances[appObjApp.type]) + days;
    }

    dbObj.applications[appIdx].status = 'cancelled';
    dbObj.applications[appIdx].cancelledAt = new Date().toISOString();
    saveDB(dbObj);
    res.json(dbObj.applications[appIdx]);
  });

  // (Legacy/optional: PATCH by status field)
  app.patch('/applications/:id/decision', async (req, res) => {
    await db.read();
    const { status } = req.body; // "approved" or "rejected"
    const appIdx = db.data.applications.findIndex(a => a.id == req.params.id);
    const app = db.data.applications[appIdx];
    if (!app) return res.status(404).json({ error: 'Not found' });
    if (status === 'rejected') {
      // Credit back leave
      const emp = db.data.employees.find(e => e.id == app.employeeId);
      if (emp && emp.leaveBalances[app.type] !== undefined) {
        let days = app.halfDay ? 0.5 : ((new Date(app.to) - new Date(app.from)) / (1000 * 60 * 60 * 24) + 1);
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
