// public/index.js

let currentUser = null;
let calendarCurrent = new Date();
let empFilters = {};

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('token')) {
    localStorage.setItem('brillar_token', params.get('token'));
    try {
      currentUser = JSON.parse(decodeURIComponent(params.get('user')));
      localStorage.setItem('brillar_user', JSON.stringify(currentUser));
    } catch {}
    window.history.replaceState({}, document.title, '/');
  }
  if (!localStorage.getItem('brillar_token')) {
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('logoutBtn').classList.add('hidden');
    document.getElementById('changePassBtn').classList.add('hidden');
    document.getElementById('mainApp').classList.add('hidden');
  } else {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('logoutBtn').classList.remove('hidden');
    document.getElementById('changePassBtn').classList.remove('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    try {
      currentUser = JSON.parse(localStorage.getItem('brillar_user'));
    } catch {}
    toggleTabsByRole();
    init();
  }
});

// Login form logic
document.getElementById('loginForm').onsubmit = async function(ev) {
  ev.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) throw new Error('Login failed');
    const data = await res.json();
    localStorage.setItem('brillar_token', data.token);
    currentUser = data.user;
    localStorage.setItem('brillar_user', JSON.stringify(currentUser));
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('logoutBtn').classList.remove('hidden');
    document.getElementById('changePassBtn').classList.remove('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    toggleTabsByRole();
    init();
  } catch (e) {
    document.getElementById('loginError').textContent = 'Invalid email or password';
    document.getElementById('loginError').classList.remove('hidden');
  }
};

// Microsoft SSO button
const msBtn = document.getElementById('msLoginBtn');
if (msBtn) msBtn.onclick = () => {
  window.location.href = '/auth/microsoft';
};

// Logout logic
function logout() {
  localStorage.removeItem('brillar_token');
  localStorage.removeItem('brillar_user');
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('logoutBtn').classList.add('hidden');
  document.getElementById('changePassBtn').classList.add('hidden');
  document.getElementById('mainApp').classList.add('hidden');
  document.getElementById('tabManage').classList.add('hidden');
  document.getElementById('tabManagerApps').classList.add('hidden');
  location.reload();
}
window.logout = logout;

const API = window.location.origin;

function apiFetch(path, options = {}) {
  const token = localStorage.getItem('brillar_token');
  options.headers = options.headers || {};
  if (token) options.headers['Authorization'] = 'Bearer ' + token;
  return fetch(API + path, options);
}

// Tab switching logic
function showPanel(name) {
  const portalBtn   = document.getElementById('tabPortal');
  const manageBtn   = document.getElementById('tabManage');
  const managerBtn  = document.getElementById('tabManagerApps');
  const reportBtn   = document.getElementById('tabLeaveReport');
  const portalPanel = document.getElementById('portalPanel');
  const managePanel = document.getElementById('managePanel');
  const managerPanel = document.getElementById('managerAppsPanel');
  const reportPanel  = document.getElementById('leaveReportPanel');

  [portalBtn, manageBtn, managerBtn, reportBtn].forEach(btn => btn && btn.classList.remove('bg-gray-200'));

  portalPanel.classList.add('hidden');
  managePanel.classList.add('hidden');
  managerPanel.classList.add('hidden');
  reportPanel.classList.add('hidden');

  if (name === 'portal') {
    portalPanel.classList.remove('hidden');
    portalBtn.classList.add('bg-gray-200');
  }
  if (name === 'manage') {
    managePanel.classList.remove('hidden');
    manageBtn.classList.add('bg-gray-200');
  }
  if (name === 'managerApps') {
    managerPanel.classList.remove('hidden');
    managerBtn.classList.add('bg-gray-200');
    loadManagerApplications();
  }
  if (name === 'leaveReport') {
    reportPanel.classList.remove('hidden');
    reportBtn.classList.add('bg-gray-200');
    loadLeaveReport();
    calendarCurrent = new Date();
    loadLeaveCalendar();
    const cards = document.getElementById('leaveRangeCards');
    if (cards) cards.innerHTML = '';
  }
}

// Role-based tab display
function toggleTabsByRole() {
  if (currentUser && currentUser.role === 'manager') {
    document.getElementById('tabManage').classList.remove('hidden');
    document.getElementById('tabManagerApps').classList.remove('hidden');
    document.getElementById('tabLeaveReport').classList.remove('hidden');
  } else {
    document.getElementById('tabManage').classList.add('hidden');
    document.getElementById('tabManagerApps').classList.add('hidden');
    document.getElementById('tabLeaveReport').classList.add('hidden');
  }
}

let pendingApply = null;
let editId = null;
let drawerEditId = null;

async function init() {
  document.getElementById('employeeSelect').addEventListener('change', onEmployeeChange);
  document.getElementById('applyForm').addEventListener('submit', onApplySubmit);
  document.getElementById('modalCloseBtn').onclick = closeReasonModal;
  document.getElementById('reasonForm').onsubmit = onReasonSubmit;

  document.getElementById('tabPortal').onclick = () => showPanel('portal');
  document.getElementById('tabManage').onclick = () => showPanel('manage');
  const managerTab = document.getElementById('tabManagerApps');
  if (managerTab) managerTab.onclick = () => showPanel('managerApps');
  const reportTab = document.getElementById('tabLeaveReport');
  if (reportTab) reportTab.onclick = () => showPanel('leaveReport');
  showPanel('portal');

  document.getElementById('empTableBody').addEventListener('click', onEmpTableClick);

  document.getElementById('addEmployeeBtn').onclick = async () => {
    const fields = await getDynamicEmployeeFields();
    openEmpDrawer({title: 'Add Employee', fields});
  };
  const csvBtn = document.getElementById('csvUploadBtn');
  const csvInput = document.getElementById('csvInput');
  if (csvBtn && csvInput) {
    csvBtn.onclick = () => csvInput.click();
    csvInput.onchange = async ev => {
      const file = ev.target.files[0];
      if (!file) return;
      const text = await file.text();
      await fetch(API + '/employees/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text
      });
      ev.target.value = '';
      await loadEmployeesManage();
      await loadEmployeesPortal();
    };
  }
  const exportBtn = document.getElementById('exportLeavesBtn');
  if (exportBtn) {
    exportBtn.onclick = async () => {
      try {
        const res = await apiFetch('/leave-report/export');
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'leave-report.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('Failed to export leave report');
      }
    };
  }
  const reportApply = document.getElementById('reportApply');
  const reportWeek = document.getElementById('reportWeek');
  const reportMonth = document.getElementById('reportMonth');
  if (reportApply) {
    reportApply.onclick = () => {
      const s = document.getElementById('reportStart').value;
      const e = document.getElementById('reportEnd').value;
      loadLeaveRange(s, e);
    };
  }
  if (reportWeek) {
    reportWeek.onclick = () => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 7);
      document.getElementById('reportStart').value = start.toISOString().substring(0,10);
      document.getElementById('reportEnd').value = end.toISOString().substring(0,10);
      loadLeaveRange(document.getElementById('reportStart').value, document.getElementById('reportEnd').value);
    };
  }
  if (reportMonth) {
    reportMonth.onclick = () => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 30);
      document.getElementById('reportStart').value = start.toISOString().substring(0,10);
      document.getElementById('reportEnd').value = end.toISOString().substring(0,10);
      loadLeaveRange(document.getElementById('reportStart').value, document.getElementById('reportEnd').value);
    };
  }
  document.getElementById('drawerCancelBtn').onclick = closeEmpDrawer;
  document.getElementById('drawerCloseBtn').onclick = closeEmpDrawer;
  document.getElementById('empDrawerForm').onsubmit = onEmpDrawerSubmit;

  // Change password handlers
  document.getElementById('changePassBtn').onclick = openChangePassModal;
  document.getElementById('passModalClose').onclick = closeChangePassModal;
  document.getElementById('cancelPassChange').onclick = closeChangePassModal;
  document.getElementById('changePassForm').onsubmit = onChangePassSubmit;

  const empCancelBtn = document.getElementById('empCancelBtn');
  if (empCancelBtn) empCancelBtn.onclick = onEmpCancel;
  const empForm = document.getElementById('empForm');
  if (empForm) empForm.onsubmit = onEmpFormSubmit;

  await loadEmployeesPortal();
  await loadEmployeesManage();
  await onEmployeeChange();
}

// ----------- LEAVE PORTAL & REPORTS -----------
async function getJSON(path) {
  const res = await apiFetch(path);
  if (!res.ok) return [];
  return await res.json();
}

async function loadEmployeesPortal() {
  const emps = await getJSON('/employees');
  let filteredEmps = emps;
  if (currentUser && currentUser.role !== 'manager') {
    filteredEmps = emps.filter(e => e.id == currentUser.employeeId);
  }
  ['employeeSelect', 'reportSelect'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">-- choose --</option>';
    filteredEmps.forEach(e => sel.add(new Option(e.name, e.id)));
  });
  if (filteredEmps.length === 1) {
    document.getElementById('employeeSelect').value = filteredEmps[0].id;
    document.getElementById('employeeSelect').dispatchEvent(new Event('change'));
    document.getElementById('reportSelect').value = filteredEmps[0].id;
    document.getElementById('reportSelect').dispatchEvent(new Event('change'));
  }
}

async function onEmployeeChange() {
  const empId = document.getElementById('employeeSelect').value;
  const balAnnual = document.getElementById('balAnnual');
  const balCasual = document.getElementById('balCasual');
  const balMedical = document.getElementById('balMedical');
  const typeSel = document.getElementById('type');
  if (!empId) {
    balAnnual.textContent = balCasual.textContent = balMedical.textContent = '-';
    typeSel.innerHTML = '<option value="">-- select leave type --</option>';
    document.getElementById('prevLeaves').innerHTML = '';
    return;
  }
  // Fetch employee and applications
  const [emps, apps] = await Promise.all([
    getJSON('/employees'),
    getJSON(`/applications?employeeId=${empId}`)
  ]);
  const emp = emps.find(e => e.id == empId);
  if (!emp) return;

  // === NEW: Show current leave balances (no deduction here, backend handles it) ===
  balAnnual.textContent = emp.leaveBalances.annual;
  balCasual.textContent = emp.leaveBalances.casual;
  balMedical.textContent = emp.leaveBalances.medical;

  // Set leave type options
  typeSel.innerHTML = `
    <option value="annual">Annual (${emp.leaveBalances.annual} days)</option>
    <option value="casual">Casual (${emp.leaveBalances.casual} days)</option>
    <option value="medical">Medical (${emp.leaveBalances.medical} days)</option>
  `;

  // Show previous leaves
  renderPreviousLeaves(apps, emp);
}

// ----------- LEAVE APPLICATION SUBMISSION -----------
function onApplySubmit(ev) {
  ev.preventDefault();
  const empId = document.getElementById('employeeSelect').value;
  const type = document.getElementById('type').value;
  const from = document.getElementById('from').value;
  const to = document.getElementById('to').value;
  const halfDay = document.getElementById('halfDay').checked;
  const halfDayPeriod = halfDay ? document.getElementById('halfDayPeriod').value : null;
  if (!empId || !type || !from || !to) {
    alert('Fill all fields!');
    return;
  }
  pendingApply = { employeeId: +empId, type, from, to, halfDay, halfDayPeriod };
  openReasonModal();
}

function openReasonModal() {
  document.getElementById('reasonInput').value = '';
  document.getElementById('reasonModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('reasonInput').focus(), 100);
}
function closeReasonModal() {
  document.getElementById('reasonModal').classList.add('hidden');
  pendingApply = null;
}

function openChangePassModal() {
  document.getElementById('changePassForm').reset();
  document.getElementById('changePassModal').classList.remove('hidden');
}

function closeChangePassModal() {
  document.getElementById('changePassModal').classList.add('hidden');
}

async function onChangePassSubmit(ev) {
  ev.preventDefault();
  const current = document.getElementById('currentPassword').value.trim();
  const np = document.getElementById('newPassword').value.trim();
  const cp = document.getElementById('confirmPassword').value.trim();
  if (np !== cp) {
    alert('Passwords do not match');
    return;
  }
  const res = await apiFetch('/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ currentPassword: current, newPassword: np })
  });
  if (res.ok) {
    alert('Password changed successfully');
    closeChangePassModal();
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Error changing password');
  }
}
async function onReasonSubmit(ev) {
  ev.preventDefault();
  const reason = document.getElementById('reasonInput').value.trim();
  if (!pendingApply || !reason) return;
  const payload = { ...pendingApply, reason };
  const res = await apiFetch('/applications', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  if (res.ok) {
    alert('Leave applied.');
    document.getElementById('applyForm').reset();
    closeReasonModal();
    await onEmployeeChange();
  } else {
    alert('Error applying leave.');
  }
  pendingApply = null;
}

function renderPreviousLeaves(apps, emp) {
  const container = document.getElementById('prevLeaves');
  if (!apps.length) {
    container.innerHTML = '<div class="text-gray-500 italic">No leave applications yet.</div>';
    return;
  }
  const typeIcon = { annual: '🌴', casual: '🏖️', medical: '🏥' };
  container.innerHTML = apps.sort((a,b)=>new Date(b.from)-new Date(a.from)).map(app => {
    let days = (new Date(app.to) - new Date(app.from)) / (1000*60*60*24) + 1;
    let daysText = days;
    let typeLabel = capitalize(app.type) + ' Leave';
    if (app.halfDay) {
      daysText = '0.5';
      typeLabel += ` (Half Day${app.halfDayPeriod ? ' ' + app.halfDayPeriod : ''})`;
    }
    return `
      <div class="bg-white border border-gray-200 rounded-lg shadow-sm p-4 w-64">
        <div class="flex items-center gap-2 mb-2 font-semibold">
          <span class="text-lg">${typeIcon[app.type]||''}</span>
          <span>${typeLabel}</span>
        </div>
        <div class="mb-1 text-gray-700"><b>From:</b> ${app.from}</div>
        <div class="mb-1 text-gray-700"><b>To:</b> ${app.to}</div>
        <div class="mb-1 text-gray-700"><b>Days:</b> ${daysText}</div>
        <div class="mb-1 text-gray-700"><b>Reason:</b> <span class="italic">${app.reason||'-'}</span></div>
        <div class="mt-2">
          <span class="text-xs rounded px-2 py-1 ${app.status==='pending'?'bg-yellow-100 text-yellow-800':app.status==='rejected'?'bg-red-100 text-red-800':'bg-green-100 text-green-800'}">
            ${capitalize(app.status||'pending')}
          </span>
          ${app.approvedBy ? `<span class="ml-2 text-xs text-gray-500">By: ${app.approvedBy}</span>` : ''}
          ${app.approverRemark ? `<span class="ml-2 text-xs italic text-gray-600">Remark: ${app.approverRemark}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ========== MANAGER LEAVE APPLICATIONS TAB LOGIC ==========

async function loadManagerApplications() {
  // Get all pending applications
  const apps = await getJSON('/applications?status=pending');
  const emps = await getJSON('/employees');
  const list = document.getElementById('managerAppsList');
  if (!apps.length) {
    list.innerHTML = `<div class="text-gray-500 italic">No pending leave applications.</div>`;
  } else {
    list.innerHTML = apps.map(app => {
      const emp = emps.find(e => e.id == app.employeeId);
      let days = (new Date(app.to) - new Date(app.from)) / (1000*60*60*24) + 1;
      let daysText = days;
      let typeLabel = capitalize(app.type) + ' Leave';
      if (app.halfDay) {
        daysText = '0.5';
        typeLabel += ` (Half Day${app.halfDayPeriod ? ' ' + app.halfDayPeriod : ''})`;
      }
      // Calculate cancel eligibility: current date before "from" date
      const now = new Date();
      const canCancel = new Date(app.from) > now;
      return `
        <div class="bg-gray-50 border rounded-lg shadow p-4 flex flex-col md:flex-row md:items-center gap-4">
          <div class="flex-1">
            <div class="flex items-center font-semibold mb-1">
              <span class="text-orange-500 mr-2">📝</span>
              <span>${emp ? emp.name : 'Unknown'}</span>
              <span class="ml-3 px-2 rounded text-xs bg-blue-100 text-blue-700">${typeLabel}</span>
            </div>
            <div class="text-sm mb-1 text-gray-700"><b>From:</b> ${app.from} <b>To:</b> ${app.to} <b>Days:</b> ${daysText}</div>
            <div class="text-sm mb-1 text-gray-700"><b>Reason:</b> <span class="italic">${app.reason||'-'}</span></div>
          </div>
          <div class="flex flex-col items-end gap-2">
            <textarea id="remark-${app.id}" placeholder="Optional remark…" class="border rounded p-1 text-sm min-w-[150px]"></textarea>
            <div class="flex gap-2">
              <button class="px-3 py-1 bg-green-500 text-white rounded" onclick="approveApp(${app.id}, true)">Approve</button>
              <button class="px-3 py-1 bg-red-500 text-white rounded" onclick="approveApp(${app.id}, false)">Reject</button>
              ${canCancel ? `<button class="px-3 py-1 bg-gray-700 text-white rounded" onclick="cancelApp(${app.id})">Cancel</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
  // show today leave employees
  await loadOnLeaveToday();  // <== 👈 keep this call

  // === NEW: Upcoming Approved Leaves (next 1 month) ===
  await loadManagerUpcomingLeaves();

  // Show cancel for future approved as well
  await loadManagerUpcomingLeaves(true);
}


async function loadOnLeaveToday() {
  const list = document.getElementById('onLeaveTodayList');
  list.innerHTML = `<div class="text-gray-500">Loading...</div>`;
  try {
    const [emps, apps] = await Promise.all([
      getJSON('/employees'),
      getJSON('/applications')
    ]);
    const today = new Date().toISOString().slice(0, 10);

    // Filter apps: status=approved AND today in [from, to]
    const onLeave = apps.filter(app =>
      app.status === 'approved' &&
      new Date(app.from) <= new Date(today) &&
      new Date(app.to) >= new Date(today)
    );

    if (!onLeave.length) {
      list.innerHTML = `<div class="text-gray-400 py-2">No one is on leave today.</div>`;
      return;
    }

    list.innerHTML = onLeave.map(app => {
      const emp = emps.find(e => e.id == app.employeeId);
      let typeLabel = capitalize(app.type) + ' Leave';
      if (app.halfDay) {
        typeLabel += ` (Half Day${app.halfDayPeriod ? ' ' + app.halfDayPeriod : ''})`;
      }
      return `
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg shadow-sm p-4 w-full flex flex-col md:flex-row md:items-center gap-2 mb-2">
          <div class="flex-1">
            <div class="flex items-center font-semibold mb-1">
              <span class="text-yellow-600 mr-2">🟧</span>
              <span>${emp ? emp.name : 'Unknown'}</span>
              <span class="ml-3 px-2 rounded text-xs bg-blue-100 text-blue-700">${emp && emp.Project ? emp.Project : ''}</span>
              <span class="ml-3 px-2 rounded text-xs bg-green-100 text-green-700">${typeLabel}</span>
            </div>
            <div class="text-gray-700"><b>From:</b> ${app.from}</div>
            <div class="text-gray-700"><b>To:</b> ${app.to}</div>
            <div class="text-gray-700"><b>Reason:</b> <span class="italic">${app.reason || '-'}</span></div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="text-red-400">Failed to load on-leave data.</div>`;
    console.error(err);
  }
}

async function loadManagerUpcomingLeaves(showCancel = false) {
  const list = document.getElementById('managerUpcomingList');
  if (!list) return;
  const allApproved = await getJSON('/applications?status=approved');
  const emps = await getJSON('/employees');
  const now = new Date();
  const oneMonthLater = new Date();
  oneMonthLater.setMonth(now.getMonth() + 1);

  const filtered = allApproved.filter(app => {
    const from = new Date(app.from);
    const to = new Date(app.to);
    return (
      (from >= now && from <= oneMonthLater) ||
      (to >= now && to <= oneMonthLater) ||
      (from <= now && to >= now)
    );
  });

  if (!filtered.length) {
    list.innerHTML = `<div class="text-gray-500 italic">No upcoming approved leaves in the next 1 month.</div>`;
    return;
  }

  const typeIcon = { annual: '🌴', casual: '🏖️', medical: '🏥' };

  list.innerHTML = filtered.sort((a, b) => new Date(a.from) - new Date(b.from)).map(app => {
    const emp = emps.find(e => e.id == app.employeeId);
    let days = (new Date(app.to) - new Date(app.from)) / (1000*60*60*24) + 1;
    let daysText = days;
    let typeLabel = capitalize(app.type) + ' Leave';
    if (app.halfDay) {
      daysText = '0.5';
      typeLabel += ` (Half Day${app.halfDayPeriod ? ' ' + app.halfDayPeriod : ''})`;
    }
    // Show cancel if approved leave in future
    const canCancel = new Date(app.from) > now;
    return `
      <div class="bg-white border border-green-100 rounded-lg shadow-sm p-4 w-full flex flex-col md:flex-row md:items-center gap-2">
        <div class="flex-1">
          <div class="flex items-center gap-2 font-semibold mb-1">
            <span class="text-green-600">${typeIcon[app.type]||''}</span>
            <span>${typeLabel}</span>
            <span class="ml-2 px-2 rounded text-xs bg-green-100 text-green-700">Approved</span>
          </div>
          <div class="text-gray-700"><b>Name:</b> ${emp ? emp.name : 'Unknown'}</div>
          <div class="text-gray-700"><b>From:</b> ${app.from}</div>
          <div class="text-gray-700"><b>To:</b> ${app.to}</div>
          <div class="text-gray-700"><b>Days:</b> ${daysText}</div>
          <div class="text-gray-700"><b>Reason:</b> <span class="italic">${app.reason||'-'}</span></div>
        </div>
        <div class="flex flex-col gap-1 min-w-[160px]">
          <span class="text-xs text-gray-500">By: ${app.approvedBy||'-'}</span>
          ${app.approverRemark ? `<span class="text-xs italic text-gray-600">Remark: ${app.approverRemark}</span>` : ''}
          <span class="text-xs text-gray-400">${app.approvedAt ? `Approved At: ${app.approvedAt.substring(0,10)}` : ''}</span>
          ${canCancel ? `<button class="px-3 py-1 mt-2 bg-gray-700 text-white rounded" onclick="cancelApp(${app.id})">Cancel</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.approveApp = async function(id, approve) {
  const remark = document.getElementById(`remark-${id}`)?.value || '';
  const res = await apiFetch(`/applications/${id}/${approve?'approve':'reject'}`, {
    method: 'PATCH',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      approver: currentUser ? currentUser.email : '',
      remark: remark
    })
  });
  if (res.ok) {
    alert(approve ? 'Leave approved.' : 'Leave rejected.');
    await loadManagerApplications();
  } else {
    alert('Error updating leave.');
  }
};

// NEW: Cancel Leave Functionality for Manager
window.cancelApp = async function(appId) {
  if (!confirm("Are you sure to cancel this leave application?")) return;
  const res = await apiFetch(`/applications/${appId}/cancel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      manager: currentUser ? currentUser.email : ''
    })
  });
  if (res.ok) {
    alert('Leave cancelled.');
    await loadManagerApplications();
    await onEmployeeChange();
  } else {
    alert('Failed to cancel leave.');
  }
};

// ======== EMPLOYEE MANAGEMENT LOGIC ========

async function loadEmployeesManage() {
  const emps = await getJSON('/employees');
  const activeCount = emps.filter(e => {
    const statusKey = Object.keys(e).find(k => k.toLowerCase() === 'status');
    return e[statusKey] === 'active';
  }).length;
  const countNumElem = document.getElementById('activeCountNum');
  if (countNumElem) countNumElem.textContent = activeCount;

  const head = document.getElementById('empTableHead');
  const body = document.getElementById('empTableBody');
  head.innerHTML = '';
  body.innerHTML = '';
  if (!emps.length) {
    head.innerHTML = '<tr><th class="px-4 py-2">No data</th></tr>';
    return;
  }

  let noKey = Object.keys(emps[0]).find(k => k.toLowerCase() === 'no');
  let nameKey = Object.keys(emps[0]).find(k => k.toLowerCase() === 'name');
  let statusKey = Object.keys(emps[0]).find(k => k.toLowerCase() === 'status');
  // Exclude id, name, status, leaveBalances, no from dynamic keys
  let keys = Object.keys(emps[0]).filter(
    k =>
      k !== 'id' &&
      k.toLowerCase() !== 'name' &&
      k.toLowerCase() !== 'status' &&
      k.toLowerCase() !== 'leavebalances' &&
      k.toLowerCase() !== 'no'
  );

  // Apply filters
  const filtered = emps.filter(emp => {
    return Object.entries(empFilters).every(([k, val]) => {
      if (!val) return true;
      const empVal = String(emp[k] ?? '').toLowerCase();
      return empVal.includes(val.toLowerCase());
    });
  });

  // Table header
  head.innerHTML = '<tr>' +
    `<th class="sticky-col no-col px-4 py-2 font-medium bg-gray-50">No</th>` +
    `<th class="sticky-col name-col px-4 py-2 font-medium bg-gray-50">Name</th>` +
    `<th class="px-4 py-2 font-medium bg-gray-50">Status</th>` +
    keys.map(k => `<th class="px-4 py-2 font-medium bg-gray-50">${k.charAt(0).toUpperCase() + k.slice(1)}</th>`).join('') +
    `<th class="sticky-col actions-col px-4 py-2 font-medium bg-gray-50">Actions</th>` +
    '</tr>';

  // Filter row
  const filterRow = document.createElement('tr');
  filterRow.innerHTML =
    `<th class="sticky-col no-col px-4 py-2 bg-gray-50"><input type="text" data-key="${noKey}" class="w-full border px-2 py-1 text-sm" /></th>` +
    `<th class="sticky-col name-col px-4 py-2 bg-gray-50"><input type="text" data-key="${nameKey}" class="w-full border px-2 py-1 text-sm" /></th>` +
    `<th class="px-4 py-2 bg-gray-50"><input type="text" data-key="${statusKey}" class="w-full border px-2 py-1 text-sm" /></th>` +
    keys.map(k => `<th class="px-4 py-2 bg-gray-50"><input type="text" data-key="${k}" class="w-full border px-2 py-1 text-sm" /></th>`).join('') +
    `<th class="sticky-col actions-col px-4 py-2 bg-gray-50"></th>`;
  head.appendChild(filterRow);
  filterRow.querySelectorAll('input').forEach(inp => {
    const k = inp.dataset.key;
    inp.value = empFilters[k] || '';
    inp.oninput = () => {
      empFilters[k] = inp.value;
      loadEmployeesManage();
    };
  });

  filtered.forEach((emp, idx) => {
    body.innerHTML += `<tr>
      <td class="sticky-col no-col px-4 py-2 bg-white">${emp[noKey] ?? idx + 1}</td>
      <td class="sticky-col name-col px-4 py-2 bg-white">${emp[nameKey] ?? ''}</td>
      <td class="px-4 py-2">
        <span class="inline-block rounded-full px-3 py-1 text-xs font-bold
          ${emp[statusKey] === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
          ${emp[statusKey]}
        </span>
      </td>
      ${keys.map(k => `<td class="px-4 py-2">${typeof emp[k] === 'object' ? JSON.stringify(emp[k]) : (emp[k] ?? '')}</td>`).join('')}
      <td class="sticky-col actions-col px-4 py-2 bg-white">
        <button onclick="openEditEmployee('${emp.id}')" class="mr-2 underline text-blue-600">Edit</button>
        <button data-action="toggle" data-id="${emp.id}" class="mr-2 underline text-${emp[statusKey]==='active'?'red':'green'}-600">
          ${emp[statusKey] === 'active' ? 'Deactivate' : 'Activate'}
        </button>
        <button data-action="delete" data-id="${emp.id}" class="underline text-red-600">Delete</button>
      </td>
    </tr>`;
  });
}

// Called when edit button is clicked
window.openEditEmployee = async function(empId) {
  const emps = await getJSON('/employees');
  const emp = emps.find(e => e.id == empId);
  const fields = await getDynamicEmployeeFields();
  openEmpDrawer({title: 'Edit Employee', fields, initial: emp});
};

// Table actions (toggle, delete)
async function onEmpTableClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === 'toggle') {
    const emp = (await getJSON('/employees')).find(x => x.id == id);
    const status = (emp.status === 'active' ? 'inactive' : 'active');
    await apiFetch(`/employees/${id}/status`, {
      method:  'PATCH',
      headers: {'Content-Type':'application/json'},
      body:    JSON.stringify({ status })
    });
  }
  if (action === 'delete') {
    if (confirm('Are you sure you want to delete this employee?')) {
      await apiFetch(`/employees/${id}`, {
        method: 'DELETE'
      });
    }
  }
  await loadEmployeesManage();
  await loadEmployeesPortal();
}

// ======== LEAVE REPORT LOGIC ========
async function loadLeaveReport() {
  const data = await getJSON('/leave-report');
  const body = document.getElementById('leaveReportBody');
  if (!body) return;
  if (!data.length) {
    body.innerHTML = '<tr><td colspan="5" class="px-4 py-2 italic text-gray-500">No leave records.</td></tr>';
    return;
  }
  body.innerHTML = data.map(r => {
    const breakdown = Object.entries(r.leaves).map(([k,v]) => `${capitalize(k)}: ${v}`).join(', ');
    return `<tr>
      <td class="px-4 py-2">${r.name}</td>
      <td class="px-4 py-2">${r.title || ''}</td>
      <td class="px-4 py-2">${r.location || ''}</td>
      <td class="px-4 py-2 text-center">${r.totalDays}</td>
      <td class="px-4 py-2">${breakdown}</td>
    </tr>`;
  }).join('');
}

async function loadLeaveRange(start, end) {
  const params = [];
  if (start) params.push('start=' + start);
  if (end) params.push('end=' + end);
  const query = params.length ? '?' + params.join('&') : '';
  const data = await getJSON('/leave-report' + query);
  const container = document.getElementById('leaveRangeCards');
  if (!container) return;
  if (!data.length) {
    container.innerHTML = '<div class="text-gray-500 italic">No leaves in this period.</div>';
    return;
  }
  container.innerHTML = data.map(r => {
    const breakdown = Object.entries(r.leaves).map(([k,v]) => `${capitalize(k)}: ${v}`).join(', ');
    return `<div class="bg-white border border-gray-200 rounded-lg shadow-sm p-4 w-64">
      <div class="font-semibold mb-1">${r.name}</div>
      <div class="text-gray-700 mb-1"><b>Title:</b> ${r.title || ''}</div>
      <div class="text-gray-700 mb-1"><b>Location:</b> ${r.location || ''}</div>
      <div class="mb-1 text-gray-700"><b>Total:</b> ${r.totalDays}</div>
      <div class="text-gray-700"><b>Breakdown:</b> ${breakdown}</div>
    </div>`;
  }).join('');
}

// ---- Drawer logic ----
function openEmpDrawer({title, fields, initial={}}) {
  drawerEditId = initial.id || null;
  document.getElementById('drawerTitle').textContent = title;
  const fieldHtml = fields.map(f => {
    const val = initial[f.key] ?? '';
    if (f.type === 'select') {
      return `<label class="block mb-1">${f.label}
        <select name="${f.key}" class="w-full p-2 border rounded mb-2">${f.options.map(opt => `
          <option value="${opt}" ${val === opt ? 'selected':''}>${opt}</option>
        `).join('')}</select>
      </label>`;
    }
    return `<label class="block mb-1">${f.label}
      <input name="${f.key}" class="w-full p-2 border rounded mb-2" value="${val}" ${f.type ? `type="${f.type}"` : ''} ${f.required ? 'required' : ''}>
    </label>`;
  }).join('');
  document.getElementById('drawerFields').innerHTML = fieldHtml;
  document.getElementById('empDrawer').classList.remove('hidden');
  setTimeout(()=>document.getElementById('empDrawer').classList.add('show'),10);
  setTimeout(()=>document.getElementById('drawerPanel').focus(),100);
}
function closeEmpDrawer() {
  document.getElementById('empDrawer').classList.remove('show');
  setTimeout(()=>document.getElementById('empDrawer').classList.add('hidden'), 300);
}

// Drawer submit
async function onEmpDrawerSubmit(ev) {
  ev.preventDefault();
  const data = {};
  new FormData(ev.target).forEach((v,k)=>{data[k]=v;});
  ['annual','casual','medical'].forEach(f=>{if(data[f])data[f]=+data[f]});
  const payload = {...data, leaveBalances: {annual: data.annual, casual: data.casual, medical: data.medical}};
  delete payload.annual; delete payload.casual; delete payload.medical;
  let url, method;
  if (drawerEditId) {
    url = `/employees/${drawerEditId}`; method = 'PUT';
  } else {
    url = '/employees'; method = 'POST';
  }
  await apiFetch(url, {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  closeEmpDrawer();
  await loadEmployeesManage();
  await loadEmployeesPortal();
}

async function getDynamicEmployeeFields() {
  const emps = await getJSON('/employees');
  let sample = emps[0] || {};
  let leaveFields = [];
  if (sample.leaveBalances) {
    Object.entries(sample.leaveBalances).forEach(([k,v])=>{
      leaveFields.push({key:k,label:k.charAt(0).toUpperCase()+k.slice(1)+' Leave',type:'number',required:false});
    });
  }
  const requiredFields = ['name', 'title', 'country/city'];
  let normalFields = Object.keys(sample)
    .filter(k=>k!=='id' && k!=='leaveBalances')
    .map(k=>{
      let isRequired = requiredFields.includes(k.toLowerCase());
      if (['status','Status'].includes(k)) return {key:k,label:'Status',type:'select',options:['active','inactive'],required:isRequired};
      return {key:k,label:k.charAt(0).toUpperCase()+k.slice(1),type:'text',required:isRequired};
    });
  return [...normalFields, ...leaveFields];
}

function onEmpCancel() {
  editId = null;
  document.getElementById('formLegend').textContent = 'Add New Employee';
  document.getElementById('empForm').reset();
}
async function onEmpFormSubmit(ev) {
  ev.preventDefault();
  const payload = {
    name: document.getElementById('empName').value,
    status: document.getElementById('empStatus').value,
    leaveBalances: {
      annual:  +document.getElementById('empAnnual').value,
      casual:  +document.getElementById('empCasual').value,
      medical: +document.getElementById('empMedical').value
    }
  };
  const url    = editId ? `/employees/${editId}` : '/employees';
  const method = editId ? 'PUT' : 'POST';
  await apiFetch(url, {
    method,
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  editId = null;
  document.getElementById('formLegend').textContent = 'Add New Employee';
  document.getElementById('empForm').reset();
  await loadEmployeesManage();
  await loadEmployeesPortal();
}

// -------- Calendar View ---------
async function loadLeaveCalendar() {
  const monthStart = new Date(calendarCurrent.getFullYear(), calendarCurrent.getMonth(), 1);
  const monthEnd   = new Date(calendarCurrent.getFullYear(), calendarCurrent.getMonth() + 1, 0);
  const startStr   = monthStart.toLocaleDateString('en-CA');
  const endStr     = monthEnd.toLocaleDateString('en-CA');
  const data = await getJSON(`/leave-calendar?start=${startStr}&end=${endStr}`);
  const map = {};
  data.forEach(d => { map[d.date] = d.entries; });
  const grid = document.getElementById('leaveCalendar');
  if (!grid) return;
  document.getElementById('calMonth').textContent = monthStart.toLocaleString('default', {month:'long', year:'numeric'});
  grid.innerHTML = '';
  const firstDay = new Date(monthStart);
  const offset = firstDay.getDay();
  for (let i = 0; i < offset; i++) {
    grid.innerHTML += '<div class="bg-white h-24"></div>';
  }
  const today = new Date();
  for (let d=1; d<=monthEnd.getDate(); d++) {
    const date   = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
    const dateStr = date.toLocaleDateString('en-CA');
    const entries = map[dateStr] || [];
    const future  = date > today;
    const classes = ['h-24','p-1','relative','cursor-default','hover:cursor-pointer'];
    if ([1,2,3,4,5].includes(date.getDay())) {
      classes.push('bg-blue-50');
    } else {
      classes.push('bg-white');
    }
    if (future) classes.push('text-gray-400');
    const names = entries.map(e => e.name).join(', ');
    const short = names.length > 25 ? names.substring(0,22) + '...' : names;
    let content = `<div>${d}</div>`;
    if (names) {
      content += `<div class="text-xs truncate" title="${names}">${short}</div>`;
    }
    const title = entries.map(e => `${e.name} - ${capitalize(e.type)}`).join('\n');
    grid.innerHTML += `<div class="${classes.join(' ')}" title="${title}">${content}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const prev = document.getElementById('calPrev');
  const next = document.getElementById('calNext');
  if (prev && next) {
    prev.onclick = () => { calendarCurrent.setMonth(calendarCurrent.getMonth()-1); loadLeaveCalendar(); };
    next.onclick = () => { calendarCurrent.setMonth(calendarCurrent.getMonth()+1); loadLeaveCalendar(); };
  }
});
