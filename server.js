const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { db, init } = require('./db');

const app = express();

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

  app.post('/applications', async (req, res) => {
    await db.read();
    const { employeeId, type, from, to, reason } = req.body;
    const id = Date.now();
    const newApp = { id, employeeId, type, from, to, reason, status: 'pending' };
    db.data.applications.push(newApp);
    await db.write();
    res.status(201).json(newApp);
  });

  // ========== MANAGER: Approve/Reject Leave (NEW ENDPOINTS) ==========
  app.patch('/applications/:id/approve', async (req, res) => {
    await db.read();
    const appId = +req.params.id;
    const application = db.data.applications.find(a => a.id === appId);
    if (!application) return res.status(404).json({ error: 'Not found' });
    application.status = 'approved';
    application.approvedBy = req.body.approver || '';
    application.approverRemark = req.body.remark || '';
    application.approvedAt = new Date().toISOString();
    await db.write();
    res.json(application);
  });

  app.patch('/applications/:id/reject', async (req, res) => {
    await db.read();
    const appId = +req.params.id;
    const application = db.data.applications.find(a => a.id === appId);
    if (!application) return res.status(404).json({ error: 'Not found' });
    application.status = 'rejected';
    application.approvedBy = req.body.approver || '';
    application.approverRemark = req.body.remark || '';
    application.approvedAt = new Date().toISOString();

    // Optional: Credit back the leave days (implement if you want to update balances)
    const emp = db.data.employees.find(e => e.id == application.employeeId);
    if (emp && emp.leaveBalances && application.type && emp.leaveBalances[application.type] !== undefined) {
      const days = (new Date(application.to) - new Date(application.from)) / (1000 * 60 * 60 * 24) + 1;
      emp.leaveBalances[application.type] = (+emp.leaveBalances[application.type] || 0) + days;
    }

    await db.write();
    res.json(application);
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
        // Number of days
        const days = (new Date(app.to) - new Date(app.from)) / (1000 * 60 * 60 * 24) + 1;
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
