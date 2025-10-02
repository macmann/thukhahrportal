// public/index.js

let currentUser = null;
let calendarCurrent = new Date();
let empSearchTerm = '';

const PIPELINE_STATUSES = ['New', 'Selected for Interview', 'Rejected', 'Hired'];
let recruitmentPositions = [];
let recruitmentCandidates = [];
let recruitmentActivePositionId = null;
let recruitmentInitialized = false;

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

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch] || ch));
}

// Tab switching logic
function showPanel(name) {
  const portalBtn   = document.getElementById('tabPortal');
  const manageBtn   = document.getElementById('tabManage');
  const recruitmentBtn = document.getElementById('tabRecruitment');
  const managerBtn  = document.getElementById('tabManagerApps');
  const reportBtn   = document.getElementById('tabLeaveReport');
  const portalPanel = document.getElementById('portalPanel');
  const managePanel = document.getElementById('managePanel');
  const recruitmentPanel = document.getElementById('recruitmentPanel');
  const managerPanel = document.getElementById('managerAppsPanel');
  const reportPanel  = document.getElementById('leaveReportPanel');

  [portalBtn, manageBtn, recruitmentBtn, managerBtn, reportBtn].forEach(btn => btn && btn.classList.remove('active-tab'));

  portalPanel.classList.add('hidden');
  managePanel.classList.add('hidden');
  recruitmentPanel.classList.add('hidden');
  managerPanel.classList.add('hidden');
  reportPanel.classList.add('hidden');

  if (name === 'portal') {
    portalPanel.classList.remove('hidden');
    portalBtn.classList.add('active-tab');
  }
  if (name === 'manage') {
    managePanel.classList.remove('hidden');
    manageBtn.classList.add('active-tab');
  }
  if (name === 'recruitment') {
    recruitmentPanel.classList.remove('hidden');
    recruitmentBtn.classList.add('active-tab');
    if (currentUser?.role === 'manager') {
      if (recruitmentInitialized) {
        loadRecruitmentPositions();
      } else {
        initRecruitment();
      }
    }
  }
  if (name === 'managerApps') {
    managerPanel.classList.remove('hidden');
    managerBtn.classList.add('active-tab');
    loadManagerApplications();
  }
  if (name === 'leaveReport') {
    reportPanel.classList.remove('hidden');
    reportBtn.classList.add('active-tab');
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
    document.getElementById('tabRecruitment').classList.remove('hidden');
    document.getElementById('tabManagerApps').classList.remove('hidden');
    document.getElementById('tabLeaveReport').classList.remove('hidden');
  } else {
    document.getElementById('tabManage').classList.add('hidden');
    document.getElementById('tabRecruitment').classList.add('hidden');
    document.getElementById('tabManagerApps').classList.add('hidden');
    document.getElementById('tabLeaveReport').classList.add('hidden');
  }
}

async function initRecruitment() {
  if (!currentUser || currentUser.role !== 'manager') return;
  if (recruitmentInitialized) return;
  recruitmentInitialized = true;

  const positionForm = document.getElementById('positionForm');
  if (positionForm) positionForm.addEventListener('submit', onPositionSubmit);

  const candidateForm = document.getElementById('candidateForm');
  if (candidateForm) candidateForm.addEventListener('submit', onCandidateSubmit);

  const positionSelect = document.getElementById('candidatePositionSelect');
  if (positionSelect) positionSelect.addEventListener('change', onCandidatePositionChange);

  const positionsContainer = document.getElementById('positionsList');
  if (positionsContainer) positionsContainer.addEventListener('click', onPositionsListClick);

  const candidateTable = document.getElementById('candidateTableBody');
  if (candidateTable) {
    candidateTable.addEventListener('change', onCandidateStatusChange);
    candidateTable.addEventListener('click', onCandidateTableClick);
  }

  await loadRecruitmentPositions();
}

async function loadRecruitmentPositions() {
  if (!currentUser || currentUser.role !== 'manager') return;
  const data = await getJSON('/recruitment/positions');
  recruitmentPositions = Array.isArray(data) ? data : [];
  recruitmentPositions.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  if (recruitmentPositions.length) {
    const exists = recruitmentPositions.some(p => p.id == recruitmentActivePositionId);
    recruitmentActivePositionId = exists ? recruitmentActivePositionId : recruitmentPositions[0].id;
  } else {
    recruitmentActivePositionId = null;
  }

  renderRecruitmentPositions();
  updateCandidatePositionSelect();

  if (recruitmentActivePositionId) {
    await loadRecruitmentCandidates(recruitmentActivePositionId);
  } else {
    recruitmentCandidates = [];
    renderRecruitmentCandidates();
  }
}

function renderRecruitmentPositions() {
  const container = document.getElementById('positionsList');
  if (!container) return;
  if (!recruitmentPositions.length) {
    container.innerHTML = '<p class="text-muted" style="font-style: italic;">No positions yet. Add your first opening to start sourcing talent.</p>';
    updateCandidateFormAvailability();
    return;
  }
  const markup = recruitmentPositions.map(pos => {
    const isActive = pos.id == recruitmentActivePositionId;
    const created = formatRecruitmentDate(pos.createdAt);
    const metaParts = [];
    if (pos.department) metaParts.push(escapeHtml(pos.department));
    if (created) metaParts.push(escapeHtml(created));
    const meta = metaParts.length ? `<div class="position-item__meta">${metaParts.join(' • ')}</div>` : '';
    const description = pos.description ? `<div class="position-item__description">${escapeHtml(pos.description)}</div>` : '';
    return `
      <button type="button" class="position-item${isActive ? ' position-item--active' : ''}" data-position-id="${pos.id}">
        <span class="material-symbols-rounded position-item__icon">work</span>
        <div class="position-item__content">
          <div class="position-item__title">${escapeHtml(pos.title)}</div>
          ${meta}
          ${description}
        </div>
        <span class="material-symbols-rounded position-item__chevron">chevron_right</span>
      </button>
    `;
  }).join('');
  container.innerHTML = markup;
  updateCandidateFormAvailability();
}

function updateCandidatePositionSelect() {
  const select = document.getElementById('candidatePositionSelect');
  if (!select) return;
  if (!recruitmentPositions.length) {
    select.innerHTML = '<option value="">No positions available</option>';
    select.value = '';
    return;
  }
  const options = recruitmentPositions.map(pos => {
    const label = pos.department ? `${escapeHtml(pos.title)} • ${escapeHtml(pos.department)}` : escapeHtml(pos.title);
    return `<option value="${pos.id}">${label}</option>`;
  }).join('');
  select.innerHTML = options;
  if (recruitmentActivePositionId) {
    select.value = recruitmentActivePositionId;
  } else {
    select.selectedIndex = 0;
    recruitmentActivePositionId = Number(select.value);
  }
}

function updateCandidateFormAvailability() {
  const form = document.getElementById('candidateForm');
  if (!form) return;
  const hasPositions = recruitmentPositions.length > 0;
  form.querySelectorAll('input, select, button').forEach(el => {
    el.disabled = !hasPositions;
  });
}

function onPositionsListClick(ev) {
  const target = ev.target.closest('[data-position-id]');
  if (!target) return;
  const id = Number(target.getAttribute('data-position-id'));
  if (Number.isNaN(id)) return;
  recruitmentActivePositionId = id;
  updateCandidatePositionSelect();
  renderRecruitmentPositions();
  loadRecruitmentCandidates(recruitmentActivePositionId);
}

function onCandidatePositionChange(ev) {
  const id = Number(ev.target.value);
  recruitmentActivePositionId = Number.isNaN(id) ? null : id;
  renderRecruitmentPositions();
  if (recruitmentActivePositionId) {
    loadRecruitmentCandidates(recruitmentActivePositionId);
  } else {
    recruitmentCandidates = [];
    renderRecruitmentCandidates();
  }
}

async function onPositionSubmit(ev) {
  ev.preventDefault();
  const form = ev.target;
  const formData = new FormData(form);
  const payload = {
    title: (formData.get('title') || '').toString().trim(),
    department: (formData.get('department') || '').toString().trim(),
    description: (formData.get('description') || '').toString().trim()
  };
  if (!payload.title) {
    alert('Position title is required');
    return;
  }
  try {
    const res = await apiFetch('/recruitment/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed');
    form.reset();
    await loadRecruitmentPositions();
  } catch (err) {
    alert('Failed to save position. Please try again.');
  }
}

async function onCandidateSubmit(ev) {
  ev.preventDefault();
  if (!recruitmentPositions.length) {
    alert('Create a position before adding candidates.');
    return;
  }
  const form = ev.target;
  const formData = new FormData(form);
  const positionId = Number(formData.get('positionId'));
  const name = (formData.get('name') || '').toString().trim();
  const contact = (formData.get('contact') || '').toString().trim();
  const file = formData.get('cv');
  if (!positionId || Number.isNaN(positionId)) {
    alert('Please choose a position.');
    return;
  }
  if (!name) {
    alert('Candidate name is required.');
    return;
  }
  if (!contact) {
    alert('Contact details are required.');
    return;
  }
  if (!file || !file.size) {
    alert('Please upload a CV.');
    return;
  }
  try {
    const base64 = await fileToBase64(file);
    const payload = {
      positionId,
      name,
      contact,
      cv: {
        filename: file.name,
        contentType: file.type,
        data: base64
      }
    };
    const res = await apiFetch('/recruitment/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed');
    form.reset();
    recruitmentActivePositionId = positionId;
    const positionSelect = document.getElementById('candidatePositionSelect');
    if (positionSelect) positionSelect.value = positionId;
    await loadRecruitmentCandidates(positionId);
  } catch (err) {
    alert('Failed to add candidate. Please try again.');
  }
}

async function loadRecruitmentCandidates(positionId) {
  if (!positionId) {
    recruitmentCandidates = [];
    renderRecruitmentCandidates();
    return;
  }
  const data = await getJSON(`/recruitment/candidates?positionId=${encodeURIComponent(positionId)}`);
  recruitmentCandidates = Array.isArray(data) ? data : [];
  renderRecruitmentCandidates();
}

function renderRecruitmentCandidates() {
  const body = document.getElementById('candidateTableBody');
  if (!body) return;
  if (!recruitmentActivePositionId) {
    body.innerHTML = '<tr><td colspan="5" class="text-muted" style="padding:16px; font-style: italic;">Select a position to view candidates.</td></tr>';
    return;
  }
  if (!recruitmentCandidates.length) {
    body.innerHTML = '<tr><td colspan="5" class="text-muted" style="padding:16px; font-style: italic;">No candidates yet for this position.</td></tr>';
    return;
  }
  const rows = recruitmentCandidates.map(candidate => {
    const statusOptions = PIPELINE_STATUSES.map(status => `<option value="${status}" ${status === candidate.status ? 'selected' : ''}>${status}</option>`).join('');
    const contact = candidate.contact ? escapeHtml(candidate.contact) : '<span class="text-muted">Not provided</span>';
    const created = formatRecruitmentDateTime(candidate.createdAt);
    const fileLabel = candidate.cv?.filename ? escapeHtml(candidate.cv.filename) : 'Download CV';
    return `
      <tr>
        <td>${escapeHtml(candidate.name)}</td>
        <td>${contact}</td>
        <td>
          <select class="md-select candidate-status" data-candidate-id="${candidate.id}">
            ${statusOptions}
          </select>
        </td>
        <td>
          <button type="button" class="md-button md-button--tonal md-button--small candidate-download" data-candidate-id="${candidate.id}">
            <span class="material-symbols-rounded">download</span>
            Download
          </button>
          <div class="text-muted" style="font-size: 12px;">${fileLabel}</div>
        </td>
        <td>${created || '-'}</td>
      </tr>
    `;
  }).join('');
  body.innerHTML = rows;
}

async function onCandidateStatusChange(ev) {
  const select = ev.target.closest('.candidate-status');
  if (!select) return;
  const id = select.getAttribute('data-candidate-id');
  const status = select.value;
  if (!id || !status) return;
  try {
    const res = await apiFetch(`/recruitment/candidates/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Failed');
    await loadRecruitmentCandidates(recruitmentActivePositionId);
  } catch (err) {
    alert('Failed to update candidate status.');
    await loadRecruitmentCandidates(recruitmentActivePositionId);
  }
}

async function onCandidateTableClick(ev) {
  const button = ev.target.closest('.candidate-download');
  if (!button) return;
  const id = button.getAttribute('data-candidate-id');
  if (!id) return;
  button.disabled = true;
  try {
    await downloadCandidateCv(id);
  } catch (err) {
    alert('Unable to download CV at the moment.');
  } finally {
    button.disabled = false;
  }
}

async function downloadCandidateCv(id) {
  const res = await apiFetch(`/recruitment/candidates/${id}/cv`);
  if (!res.ok) throw new Error('Failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const candidate = recruitmentCandidates.find(c => c.id == id);
  const filename = candidate?.cv?.filename || `candidate-${id}`;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatRecruitmentDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRecruitmentDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const base64 = result.split(',')[1] || '';
        resolve(base64);
      } else {
        resolve('');
      }
    };
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(file);
  });
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
  const recruitmentTab = document.getElementById('tabRecruitment');
  if (recruitmentTab) recruitmentTab.onclick = () => showPanel('recruitment');
  const managerTab = document.getElementById('tabManagerApps');
  if (managerTab) managerTab.onclick = () => showPanel('managerApps');
  const reportTab = document.getElementById('tabLeaveReport');
  if (reportTab) reportTab.onclick = () => showPanel('leaveReport');
  showPanel('portal');

  document.getElementById('empTableBody').addEventListener('click', onEmpTableClick);

  const empSearchInput = document.getElementById('empSearchInput');
  if (empSearchInput) {
    empSearchInput.addEventListener('input', () => {
      empSearchTerm = empSearchInput.value;
      loadEmployeesManage();
    });
  }

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

  if (currentUser && currentUser.role === 'manager') {
    await initRecruitment();
  }

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
    const empSel = document.getElementById('employeeSelect');
    const reportSel = document.getElementById('reportSelect');
    if (empSel) {
      empSel.value = filteredEmps[0].id;
      empSel.dispatchEvent(new Event('change'));
    }
    if (reportSel) {
      reportSel.value = filteredEmps[0].id;
      reportSel.dispatchEvent(new Event('change'));
    }
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
    container.innerHTML = '<div class="text-muted" style="font-style:italic;">No leave applications yet.</div>';
    return;
  }
  const typeIcon = { annual: 'beach_access', casual: 'sunny', medical: 'medical_information' };
  container.innerHTML = apps.sort((a,b)=>new Date(b.from)-new Date(a.from)).map(app => {
    let days = calculateLeaveDays(app.from, app.to, app.halfDay);
    let daysText = days;
    let typeLabel = capitalize(app.type) + ' Leave';
    if (app.halfDay) {
      typeLabel += ` (Half Day${app.halfDayPeriod ? ' ' + app.halfDayPeriod : ''})`;
    }
    const statusClass = app.status === 'approved' ? 'chip chip--approved' : app.status === 'rejected' ? 'chip chip--rejected' : 'chip chip--pending';
    const icon = typeIcon[app.type] || 'event';
    return `
      <article class="history-card">
        <div class="history-header">
          <span class="material-symbols-rounded">${icon}</span>
          <span>${typeLabel}</span>
        </div>
        <div class="text-muted"><strong>From:</strong> ${app.from}</div>
        <div class="text-muted"><strong>To:</strong> ${app.to}</div>
        <div class="text-muted"><strong>Days:</strong> ${daysText}</div>
        <div class="text-muted"><strong>Reason:</strong> <span class="text-quiet">${app.reason||'-'}</span></div>
        <div class="text-muted" style="margin-top:8px; display:flex; flex-direction:column; gap:6px;">
          <span class="${statusClass}">${capitalize(app.status||'pending')}</span>
          ${app.approvedBy ? `<span class="text-quiet">Approver: ${app.approvedBy}</span>` : ''}
          ${app.approverRemark ? `<span class="text-quiet">Remark: ${app.approverRemark}</span>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function calculateLeaveDays(from, to, halfDay) {
  const start = new Date(from);
  const end = new Date(to);
  if (halfDay) {
    const day = start.getDay();
    return (day === 0 || day === 6) ? 0 : 0.5;
  }
  let days = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) days++;
  }
  return days;
}

// ========== MANAGER LEAVE APPLICATIONS TAB LOGIC ==========

async function loadManagerApplications() {
  // Get all pending applications
  const apps = await getJSON('/applications?status=pending');
  const emps = await getJSON('/employees');
  const list = document.getElementById('managerAppsList');
  if (!apps.length) {
    list.innerHTML = `<div class="text-muted" style="font-style:italic;">No pending leave applications.</div>`;
  } else {
    list.innerHTML = apps.map(app => {
      const emp = emps.find(e => e.id == app.employeeId);
      let days = calculateLeaveDays(app.from, app.to, app.halfDay);
      let daysText = days;
      let typeLabel = capitalize(app.type) + ' Leave';
      if (app.halfDay) {
        typeLabel += ` (Half Day${app.halfDayPeriod ? ' ' + app.halfDayPeriod : ''})`;
      }
      // Calculate cancel eligibility: current date before "from" date
      const now = new Date();
      const canCancel = new Date(app.from) > now;
      return `
        <article class="list-card">
          <div class="list-card__main">
            <div class="list-card__header">
              <span class="material-symbols-rounded">assignment_ind</span>
              <span>${emp ? emp.name : 'Unknown'}</span>
              <span class="chip chip--info">${typeLabel}</span>
            </div>
            <div class="text-muted"><strong>From:</strong> ${app.from} · <strong>To:</strong> ${app.to} · <strong>Days:</strong> ${daysText}</div>
            <div class="text-muted"><strong>Reason:</strong> <span class="text-quiet">${app.reason||'-'}</span></div>
          </div>
          <textarea id="remark-${app.id}" placeholder="Add an optional remark…"></textarea>
          <div class="list-card__actions">
            <button class="md-button md-button--success md-button--small" onclick="approveApp(${app.id}, true)">
              <span class="material-symbols-rounded">check</span>
              Approve
            </button>
            <button class="md-button md-button--danger md-button--small" onclick="approveApp(${app.id}, false)">
              <span class="material-symbols-rounded">close</span>
              Reject
            </button>
            ${canCancel ? `<button class="md-button md-button--outlined md-button--small" onclick="cancelApp(${app.id})"><span class="material-symbols-rounded">cancel_schedule_send</span>Cancel</button>` : ''}
          </div>
        </article>
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
  list.innerHTML = `<div class="text-muted">Loading...</div>`;
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
      list.innerHTML = `<div class="text-muted" style="font-style:italic;">No one is on leave today.</div>`;
      return;
    }

    list.innerHTML = onLeave.map(app => {
      const emp = emps.find(e => e.id == app.employeeId);
      let typeLabel = capitalize(app.type) + ' Leave';
      if (app.halfDay) {
        typeLabel += ` (Half Day${app.halfDayPeriod ? ' ' + app.halfDayPeriod : ''})`;
      }
      return `
        <article class="history-card" style="background: rgba(255, 248, 230, 0.9); border-color: rgba(255, 211, 140, 0.45);">
          <div class="history-header">
            <span class="material-symbols-rounded">flight_takeoff</span>
            <span>${emp ? emp.name : 'Unknown'}</span>
            ${emp && emp.Project ? `<span class="chip chip--info">${emp.Project}</span>` : ''}
          </div>
          <div class="text-muted"><strong>Type:</strong> <span class="chip chip--approved">${typeLabel}</span></div>
          <div class="text-muted"><strong>From:</strong> ${app.from}</div>
          <div class="text-muted"><strong>To:</strong> ${app.to}</div>
          <div class="text-muted"><strong>Reason:</strong> <span class="text-quiet">${app.reason || '-'}</span></div>
        </article>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="text-muted" style="color:#b3261e;">Failed to load on-leave data.</div>`;
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
    list.innerHTML = `<div class="text-muted" style="font-style:italic;">No upcoming approved leaves in the next 1 month.</div>`;
    return;
  }

  const typeIcon = { annual: 'beach_access', casual: 'sunny', medical: 'medical_information' };

  list.innerHTML = filtered.sort((a, b) => new Date(a.from) - new Date(b.from)).map(app => {
    const emp = emps.find(e => e.id == app.employeeId);
    let days = calculateLeaveDays(app.from, app.to, app.halfDay);
    let daysText = days;
    let typeLabel = capitalize(app.type) + ' Leave';
    if (app.halfDay) {
      typeLabel += ` (Half Day${app.halfDayPeriod ? ' ' + app.halfDayPeriod : ''})`;
    }
    // Show cancel if approved leave in future
    const canCancel = new Date(app.from) > now;
    const icon = typeIcon[app.type] || 'event_available';
    return `
      <article class="list-card">
        <div class="list-card__main">
          <div class="list-card__header">
            <span class="material-symbols-rounded">${icon}</span>
            <span>${typeLabel}</span>
            <span class="chip chip--approved">Approved</span>
          </div>
          <div class="text-muted"><strong>Name:</strong> ${emp ? emp.name : 'Unknown'}</div>
          <div class="text-muted"><strong>From:</strong> ${app.from} · <strong>To:</strong> ${app.to}</div>
          <div class="text-muted"><strong>Days:</strong> ${daysText}</div>
          <div class="text-muted"><strong>Reason:</strong> <span class="text-quiet">${app.reason||'-'}</span></div>
          <div class="text-quiet">By: ${app.approvedBy||'-'}</div>
          ${app.approverRemark ? `<div class="text-quiet">Remark: ${app.approverRemark}</div>` : ''}
          ${app.approvedAt ? `<div class="text-quiet">Approved At: ${app.approvedAt.substring(0,10)}</div>` : ''}
        </div>
        ${canCancel ? `<div class="list-card__actions"><button class="md-button md-button--outlined md-button--small" onclick="cancelApp(${app.id})"><span class="material-symbols-rounded">cancel</span>Cancel</button></div>` : ''}
      </article>
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
  const searchInput = document.getElementById('empSearchInput');
  if (searchInput && searchInput.value !== empSearchTerm) {
    searchInput.value = empSearchTerm;
  }
  if (!emps.length) {
    head.innerHTML = '<tr><th style="padding:16px;">No data</th></tr>';
    return;
  }

  let noKey = Object.keys(emps[0]).find(k => k.toLowerCase() === 'no');
  let nameKey = Object.keys(emps[0]).find(k => k.toLowerCase() === 'name');
  let statusKey = Object.keys(emps[0]).find(k => k.toLowerCase() === 'status');
  let roleKey = Object.keys(emps[0]).find(k => k.toLowerCase() === 'role');
  // Exclude id, name, status, leaveBalances, no from dynamic keys
  let keys = Object.keys(emps[0]).filter(
    k =>
      k !== 'id' &&
      k.toLowerCase() !== 'name' &&
      k.toLowerCase() !== 'status' &&
      k.toLowerCase() !== 'leavebalances' &&
      k.toLowerCase() !== 'no'
  );

  const searchValue = empSearchTerm.trim().toLowerCase();

  const filtered = emps.filter(emp => {
    if (!searchValue) return true;
    return Object.entries(emp).some(([key, value]) => {
      if (key.toLowerCase() === 'id') return false;
      if (value === null || typeof value === 'undefined') return false;
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value).toLowerCase().includes(searchValue);
        } catch (e) {
          return false;
        }
      }
      return String(value).toLowerCase().includes(searchValue);
    });
  });

  // Sort managers first by name, then remaining employees by name A-Z
  filtered.sort((a, b) => {
    const roleA = roleKey ? (a[roleKey] || '').toLowerCase() : '';
    const roleB = roleKey ? (b[roleKey] || '').toLowerCase() : '';
    const nameA = (a[nameKey] || '').toLowerCase();
    const nameB = (b[nameKey] || '').toLowerCase();
    if (roleA === 'manager' && roleB !== 'manager') return -1;
    if (roleA !== 'manager' && roleB === 'manager') return 1;
    return nameA.localeCompare(nameB);
  });

  // Table header
  head.innerHTML = '<tr>' +
    `<th class="sticky-col no-col">No</th>` +
    `<th class="sticky-col name-col">Name</th>` +
    `<th>Status</th>` +
    keys.map(k => `<th>${k.charAt(0).toUpperCase() + k.slice(1)}</th>`).join('') +
    `<th class="sticky-col actions-col">Actions</th>` +
    '</tr>';

  if (!filtered.length) {
    body.innerHTML = `<tr><td class="table-empty" colspan="${keys.length + 4}">No employees match your search.</td></tr>`;
    return;
  }

  filtered.forEach((emp, idx) => {
    body.innerHTML += `<tr>
      <td class="sticky-col no-col">${emp[noKey] ?? idx + 1}</td>
      <td class="sticky-col name-col">${emp[nameKey] ?? ''}</td>
      <td>
        <span class="status-pill ${emp[statusKey] === 'active' ? 'status-pill--active' : 'status-pill--inactive'}">
          ${emp[statusKey]}
        </span>
      </td>
      ${keys.map(k => `<td>${typeof emp[k] === 'object' ? JSON.stringify(emp[k]) : (emp[k] ?? '')}</td>`).join('')}
      <td class="sticky-col actions-col">
        <div class="table-actions">
          <button onclick="openEditEmployee('${emp.id}')">Edit</button>
          <button data-action="toggle" data-id="${emp.id}" class="${emp[statusKey]==='active' ? 'action-danger' : ''}">
            ${emp[statusKey] === 'active' ? 'Deactivate' : 'Activate'}
          </button>
          <button data-action="delete" data-id="${emp.id}" class="action-danger">Delete</button>
        </div>
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
    body.innerHTML = '<tr><td colspan="5" style="padding:16px; font-style:italic;" class="text-muted">No leave records.</td></tr>';
    return;
  }
  body.innerHTML = data.map(r => {
    const breakdown = Object.entries(r.leaves).map(([k,v]) => `${capitalize(k)}: ${v}`).join(', ');
    return `<tr>
      <td>${r.name}</td>
      <td>${r.title || ''}</td>
      <td>${r.location || ''}</td>
      <td style="text-align:center; font-weight:600;">${r.totalDays}</td>
      <td>${breakdown}</td>
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
    container.innerHTML = '<div class="text-muted" style="font-style:italic;">No leaves in this period.</div>';
    return;
  }
  container.innerHTML = data.map(r => {
    const breakdown = Object.entries(r.leaves).map(([k,v]) => `${capitalize(k)}: ${v}`).join(', ');
    return `<article class="history-card">
      <div class="history-header">
        <span class="material-symbols-rounded">badge</span>
        <span>${r.name}</span>
      </div>
      <div class="text-muted"><strong>Title:</strong> ${r.title || ''}</div>
      <div class="text-muted"><strong>Location:</strong> ${r.location || ''}</div>
      <div class="text-muted"><strong>Total:</strong> ${r.totalDays}</div>
      <div class="text-muted"><strong>Breakdown:</strong> <span class="text-quiet">${breakdown}</span></div>
    </article>`;
  }).join('');
}

// ---- Drawer logic ----
function openEmpDrawer({title, fields, initial={}}) {
  drawerEditId = initial.id || null;
  document.getElementById('drawerTitle').textContent = title;
  const fieldHtml = fields.map(f => {
    const val = initial[f.key] ?? '';
    const fieldId = `drawer-${f.key}`.replace(/\s+/g, '-');
    if (f.type === 'select') {
      return `<div class="md-field">
        <label class="md-label" for="${fieldId}">${f.label}</label>
        <div class="md-input-wrapper">
          <select name="${f.key}" id="${fieldId}" class="md-select">
            ${f.options.map(opt => `<option value="${opt}" ${val === opt ? 'selected':''}>${opt}</option>`).join('')}
          </select>
        </div>
      </div>`;
    }
    return `<div class="md-field">
      <label class="md-label" for="${fieldId}">${f.label}</label>
      <div class="md-input-wrapper">
        <input name="${f.key}" id="${fieldId}" class="md-input" value="${val}" ${f.type ? `type="${f.type}"` : ''} ${f.required ? 'required' : ''}>
      </div>
    </div>`;
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
    grid.innerHTML += '<div class="calendar-empty"></div>';
  }
  const today = new Date();
  today.setHours(0,0,0,0);
  for (let d=1; d<=monthEnd.getDate(); d++) {
    const date   = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
    const dayRef = new Date(date);
    dayRef.setHours(0,0,0,0);
    const dateStr = date.toLocaleDateString('en-CA');
    const entries = map[dateStr] || [];
    const future  = dayRef > today;
    const isToday = dayRef.getTime() === today.getTime();
    const classes = [];
    if ([1,2,3,4,5].includes(date.getDay())) {
      classes.push('weekday');
    }
    if (future) classes.push('future');
    if (isToday) classes.push('calendar-today');
    let content = `<div class="calendar-date">${d}</div>`;
    const titleParts = [];
    if (entries.length) {
      const namesMarkup = entries.map(e => {
        const rawType = (e.type || '').toString();
        const typeLabel = capitalize(rawType);
        const typeKey = rawType.replace(/[^a-z0-9]/gi, '').toLowerCase();
        const typeClass = typeKey ? `calendar-type--${typeKey}` : '';
        if (typeLabel) {
          titleParts.push(`${e.name} - ${typeLabel}`);
        } else {
          titleParts.push(e.name);
        }
        const typeMarkup = typeLabel ? `<span class="calendar-type ${typeClass}">${typeLabel}</span>` : '';
        const entryTitle = typeLabel ? `${e.name} • ${typeLabel}` : e.name;
        return `<div class="calendar-name" title="${entryTitle}"><span class="calendar-employee">${e.name}</span>${typeMarkup}</div>`;
      }).join('');
      content += `<div class="calendar-names">${namesMarkup}</div>`;
    }
    const title = titleParts.join('\n');
    const titleAttr = title ? ` title="${title}"` : '';
    grid.innerHTML += `<div class="${classes.join(' ')}"${titleAttr}>${content}</div>`;
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
