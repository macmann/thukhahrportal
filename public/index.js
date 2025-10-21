// public/index.js

let currentUser = null;
let calendarCurrent = new Date();
let empSearchTerm = '';
let companyHolidays = [];
let holidaysLoaded = false;
let holidaysLoading = null;

function setupTabGroupMenus() {
  const groups = Array.from(document.querySelectorAll('[data-tab-group]'));
  if (!groups.length) return;

  const closeGroup = (group) => {
    group.classList.remove('is-open');
    const toggle = group.querySelector('[data-tab-group-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  };

  const openGroup = (group) => {
    group.classList.add('is-open');
    const toggle = group.querySelector('[data-tab-group-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  };

  const closeAll = (except = null) => {
    groups.forEach((group) => {
      if (group !== except) closeGroup(group);
    });
  };

  groups.forEach((group) => {
    const toggle = group.querySelector('[data-tab-group-toggle]');
    const menu = group.querySelector('[data-tab-group-menu]');
    if (!toggle || !menu) return;

    toggle.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const isOpen = group.classList.contains('is-open');
      if (isOpen) {
        closeGroup(group);
      } else {
        closeAll(group);
        openGroup(group);
      }
    });

    menu.addEventListener('click', (ev) => {
      const button = ev.target.closest('button');
      if (!button) return;
      closeAll();
    });
  });

  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-tab-group]')) {
      closeAll();
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closeAll();
    }
  });

  refreshTabGroupVisibility();
}

function refreshTabGroupVisibility() {
  document.querySelectorAll('[data-tab-group]').forEach((group) => {
    const menu = group.querySelector('[data-tab-group-menu]');
    if (!menu) return;
    const hasVisibleButton = Array.from(menu.querySelectorAll('button')).some(
      (btn) => !btn.classList.contains('hidden')
    );
    const toggle = group.querySelector('[data-tab-group-toggle]');
    if (hasVisibleButton) {
      group.classList.remove('tab-group--hidden');
      if (toggle) toggle.removeAttribute('disabled');
    } else {
      group.classList.remove('is-open');
      group.classList.add('tab-group--hidden');
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('disabled', '');
      }
    }
  });
}

const PIPELINE_STATUSES = ['New', 'Selected for Interview', 'Interview Completed', 'Rejected', 'Hired'];
const CANDIDATE_CV_HELP_DEFAULT = 'Accepted formats: PDF or Word documents.';
const CANDIDATE_CV_HELP_EDIT = 'Accepted formats: PDF or Word documents. Leave blank to keep the current CV.';
let recruitmentPositions = [];
let recruitmentCandidates = [];
let recruitmentActivePositionId = null;
let recruitmentInitialized = false;
let recruitmentActiveCommentCandidateId = null;
let recruitmentCandidateComments = [];
let recruitmentEditingCommentId = null;
let recruitmentActiveDetailsCandidateId = null;
let recruitmentEditingPositionId = null;
let recruitmentEditingCandidateId = null;
let recruitmentCandidateSearchTimer = null;
let recruitmentCandidateSearchAbort = null;
let recruitmentCandidateSearchResults = [];
let recruitmentCandidateSearchQuery = '';
let recruitmentCandidateSearchLoading = false;
let recruitmentCandidateSearchError = null;
const candidateCvPreviewUrls = new Map();
const candidateDetailsCache = new Map();
let candidateCvModalCandidateId = null;
let currentDrawerFields = [];
let hireModalState = { candidateId: null, select: null, previousStatus: null, candidate: null };
let currentHireFields = [];
let profileData = null;
let profileLoading = null;
let emailSettings = null;
let emailSettingsLoaded = false;
let emailSettingsLoading = null;
let emailSettingsHasPassword = false;
let emailRecipientOptions = [];

function normalizeCandidateId(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function cacheCandidateDetails(candidate) {
  if (!candidate || candidate.id == null) return null;
  const id = normalizeCandidateId(candidate.id);
  if (id == null) return null;
  const existing = candidateDetailsCache.get(id);
  if (existing) {
    Object.assign(existing, candidate);
    return existing;
  }
  const stored = { ...candidate, id };
  candidateDetailsCache.set(id, stored);
  return stored;
}

function getCachedCandidate(id) {
  const normalized = normalizeCandidateId(id);
  if (normalized == null) return null;
  return recruitmentCandidates.find(candidate => candidate.id == normalized) || candidateDetailsCache.get(normalized) || null;
}

function adaptSearchResultToCandidate(result) {
  if (!result || result.id == null) return null;
  const id = normalizeCandidateId(result.id);
  if (id == null) return null;
  const filename = result.cvFilename || result.cv?.filename || 'CV Document';
  const lower = filename.toLowerCase();
  const contentType = result.cvContentType || result.cv?.contentType || (lower.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  const candidate = {
    id,
    positionId: result.positionId != null ? normalizeCandidateId(result.positionId) : null,
    name: result.name || '',
    contact: result.contact || '',
    status: result.status || 'New',
    createdAt: result.createdAt || null,
    updatedAt: result.updatedAt || null,
    cv: result.hasCv
      ? { filename, contentType }
      : null,
    commentCount: typeof result.commentCount === 'number' ? result.commentCount : null
  };
  return candidate;
}

document.addEventListener('DOMContentLoaded', () => {
  setupTabGroupMenus();
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
  document.getElementById('tabProfile').classList.add('hidden');
  document.getElementById('tabManage').classList.add('hidden');
  document.getElementById('tabRecruitment').classList.add('hidden');
  document.getElementById('tabManagerApps').classList.add('hidden');
  document.getElementById('tabLeaveReport').classList.add('hidden');
  document.getElementById('tabSettings').classList.add('hidden');
  refreshTabGroupVisibility();
  location.reload();
}
window.logout = logout;

const API = window.location.origin;

const PROFILE_SECTION_ICONS = {
  personal: 'person',
  contact: 'call',
  emergency: 'medical_services',
  employment: 'work_history',
  department: 'corporate_fare'
};

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
  const profileBtn = document.getElementById('tabProfile');
  const portalBtn   = document.getElementById('tabPortal');
  const manageBtn   = document.getElementById('tabManage');
  const recruitmentBtn = document.getElementById('tabRecruitment');
  const managerBtn  = document.getElementById('tabManagerApps');
  const reportBtn   = document.getElementById('tabLeaveReport');
  const settingsBtn = document.getElementById('tabSettings');
  const profilePanel = document.getElementById('profilePanel');
  const portalPanel = document.getElementById('portalPanel');
  const managePanel = document.getElementById('managePanel');
  const recruitmentPanel = document.getElementById('recruitmentPanel');
  const managerPanel = document.getElementById('managerAppsPanel');
  const reportPanel  = document.getElementById('leaveReportPanel');
  const settingsPanel = document.getElementById('settingsPanel');

  [profileBtn, portalBtn, manageBtn, recruitmentBtn, managerBtn, reportBtn, settingsBtn].forEach(btn => btn && btn.classList.remove('active-tab'));

  if (profilePanel) profilePanel.classList.add('hidden');
  portalPanel.classList.add('hidden');
  managePanel.classList.add('hidden');
  recruitmentPanel.classList.add('hidden');
  managerPanel.classList.add('hidden');
  reportPanel.classList.add('hidden');
  settingsPanel.classList.add('hidden');

  if (name === 'profile') {
    if (profilePanel) profilePanel.classList.remove('hidden');
    if (profileBtn) profileBtn.classList.add('active-tab');
    loadMyProfile();
  }
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
  if (name === 'settings') {
    settingsPanel.classList.remove('hidden');
    if (settingsBtn) settingsBtn.classList.add('active-tab');
    if (currentUser?.role === 'manager') {
      loadHolidays();
      loadEmailSettingsConfig();
    }
  }
}

// Role-based tab display
function toggleTabsByRole() {
  const profileTab = document.getElementById('tabProfile');
  if (profileTab) profileTab.classList.remove('hidden');
  if (currentUser && currentUser.role === 'manager') {
    document.getElementById('tabManage').classList.remove('hidden');
    document.getElementById('tabRecruitment').classList.remove('hidden');
    document.getElementById('tabManagerApps').classList.remove('hidden');
    document.getElementById('tabLeaveReport').classList.remove('hidden');
    document.getElementById('tabSettings').classList.remove('hidden');
  } else {
    document.getElementById('tabManage').classList.add('hidden');
    document.getElementById('tabRecruitment').classList.add('hidden');
    document.getElementById('tabManagerApps').classList.add('hidden');
    document.getElementById('tabLeaveReport').classList.add('hidden');
    document.getElementById('tabSettings').classList.add('hidden');
  }
  refreshTabGroupVisibility();
}

function setProfileSummaryField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = value && String(value).trim() ? String(value).trim() : '-';
  el.textContent = text;
  if (text === '-') {
    el.classList.add('text-muted');
  } else {
    el.classList.remove('text-muted');
  }
}

function renderProfileSection(section) {
  if (!section || !Array.isArray(section.fields) || !section.fields.length) {
    return '';
  }
  const icon = PROFILE_SECTION_ICONS[section.id] || 'info';
  const title = escapeHtml(section.title || 'Details');
  const sectionId = escapeHtml(section.id || Math.random().toString(36).slice(2, 8));
  const hasEditable = section.fields.some(field => field && field.editable);
  const fieldsMarkup = section.fields.map(field => {
    if (!field || !field.key) return '';
    const label = escapeHtml(field.label || field.key);
    const key = String(field.key);
    const normalizedKey = key.toLowerCase();
    const rawValue = field.value === null || typeof field.value === 'undefined' ? '' : field.value;
    const value = typeof rawValue === 'string' ? rawValue : String(rawValue);
    if (field.editable) {
      const inputId = makeDynamicFieldId('profile', key);
      const requiredAttr = field.required ? 'required' : '';
      const isTextArea = field.type === 'textarea' || field.input === 'textarea' || normalizedKey.includes('address');
      if (isTextArea) {
        return `
          <div class="md-field">
            <label class="md-label" for="${escapeHtml(inputId)}">${label}</label>
            <textarea class="md-textarea" id="${escapeHtml(inputId)}" name="${escapeHtml(key)}" rows="3" data-editable-field ${requiredAttr}>${escapeHtml(value)}</textarea>
          </div>
        `;
      }
      const inputType = field.type && field.type !== 'textarea' ? escapeHtml(field.type) : 'text';
      return `
        <div class="md-field">
          <label class="md-label" for="${escapeHtml(inputId)}">${label}</label>
          <div class="md-input-wrapper">
            <input class="md-input" id="${escapeHtml(inputId)}" name="${escapeHtml(key)}" type="${inputType}" value="${escapeHtml(value)}" data-editable-field ${requiredAttr}>
          </div>
        </div>
      `;
    }
    const inputId = makeDynamicFieldId('profile', `${key}-readonly`);
    const hasValue = value && value.trim() !== '';
    const displayValue = hasValue ? escapeHtml(value) : 'Not provided';
    const valueAttr = ` value="${displayValue}"`;
    const emptyClass = hasValue ? '' : ' md-input--empty';
    return `
      <div class="md-field md-field--readonly">
        <label class="md-label" for="${escapeHtml(inputId)}">${label}</label>
        <div class="md-input-wrapper md-input-wrapper--readonly">
          <input class="md-input${emptyClass}" id="${escapeHtml(inputId)}" type="text"${valueAttr} disabled>
        </div>
      </div>
    `;
  }).join('');
  const bodyMarkup = fieldsMarkup || '<p class="text-muted" style="font-style: italic;">No information captured yet.</p>';
  const headerMarkup = `
    <div class="card-title">
      <span class="material-symbols-rounded">${icon}</span>
      ${title}
    </div>
  `;
  if (hasEditable) {
    return `
      <form class="md-card profile-section-form" data-section="${sectionId}">
        ${headerMarkup}
        ${bodyMarkup}
        <div class="profile-form-actions">
          <button type="submit" class="md-button md-button--filled md-button--small">
            <span class="material-symbols-rounded">save</span>
            Save Changes
          </button>
        </div>
        <div class="profile-feedback hidden" data-feedback></div>
      </form>
    `;
  }
  return `
    <div class="md-card" data-section="${sectionId}">
      ${headerMarkup}
      ${bodyMarkup}
    </div>
  `;
}

function renderMyProfile() {
  if (!profileData) return;
  const {
    name,
    email,
    summary = {},
    leaveBalances = {},
    sections = [],
    message = '',
    messageType = 'success'
  } = profileData;

  setProfileSummaryField('profileSummaryName', name);
  setProfileSummaryField('profileSummaryEmail', email);
  setProfileSummaryField('profileSummaryTitle', summary.title);
  setProfileSummaryField('profileSummaryDepartment', summary.department);
  setProfileSummaryField('profileSummaryManager', summary.manager);
  setProfileSummaryField('profileSummaryStatus', summary.status);

  const annualEl = document.getElementById('profileBalAnnual');
  if (annualEl) annualEl.textContent = leaveBalances?.annual ?? '-';
  const casualEl = document.getElementById('profileBalCasual');
  if (casualEl) casualEl.textContent = leaveBalances?.casual ?? '-';
  const medicalEl = document.getElementById('profileBalMedical');
  if (medicalEl) medicalEl.textContent = leaveBalances?.medical ?? '-';

  const container = document.getElementById('profileSections');
  if (container) {
    if (!sections.length) {
      container.innerHTML = `
        <div class="md-card">
          <div class="card-title">
            <span class="material-symbols-rounded">info</span>
            Profile Details
          </div>
          <p class="text-muted" style="font-style: italic;">No profile information recorded yet.</p>
        </div>
      `;
    } else {
      container.innerHTML = sections.map(renderProfileSection).join('');
      container.querySelectorAll('.profile-section-form').forEach(form => {
        form.addEventListener('submit', onProfileSectionSubmit);
      });
    }
  }

  const feedback = document.getElementById('profileGlobalFeedback');
  if (feedback) {
    if (message) {
      feedback.textContent = message;
      feedback.classList.remove('hidden');
      if (messageType === 'error') {
        feedback.classList.add('error');
      } else {
        feedback.classList.remove('error');
      }
    } else {
      feedback.textContent = '';
      feedback.classList.add('hidden');
      feedback.classList.remove('error');
    }
  }
}

async function loadMyProfile({ force = false } = {}) {
  const container = document.getElementById('profileSections');
  if (!container) return;

  if (!force && profileData && !profileLoading) {
    renderMyProfile();
    return;
  }

  if (profileLoading && !force) {
    return profileLoading;
  }

  container.innerHTML = `
    <div class="md-card">
      <div class="card-title">
        <span class="material-symbols-rounded">info</span>
        Profile Details
      </div>
      <p class="text-muted" style="font-style: italic;">Loading profile information...</p>
    </div>
  `;

  const request = (async () => {
    try {
      const res = await apiFetch('/api/my-profile');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Unable to load profile information.');
      }
      profileData = data;
      renderMyProfile();
      return data;
    } catch (err) {
      console.error('Failed to load profile information', err);
      profileData = null;
      container.innerHTML = `
        <div class="md-card">
          <div class="card-title">
            <span class="material-symbols-rounded">error</span>
            Profile Details
          </div>
          <p class="text-muted" style="font-style: italic; color:#b3261e;">${escapeHtml(err.message || 'Unable to load profile information.')}</p>
        </div>
      `;
      const feedback = document.getElementById('profileGlobalFeedback');
      if (feedback) {
        feedback.textContent = '';
        feedback.classList.add('hidden');
        feedback.classList.remove('error');
      }
      return null;
    } finally {
      profileLoading = null;
    }
  })();
  profileLoading = request;
  return request;
}

async function onProfileSectionSubmit(ev) {
  ev.preventDefault();
  const form = ev.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const feedback = form.querySelector('[data-feedback]');
  if (feedback) {
    feedback.textContent = '';
    feedback.classList.add('hidden');
    feedback.classList.remove('error');
  }

  const updates = {};
  form.querySelectorAll('[data-editable-field]').forEach(input => {
    if (!input.name) return;
    updates[input.name] = input.value;
  });

  const updateKeys = Object.keys(updates);
  if (!updateKeys.length) {
    if (feedback) {
      feedback.textContent = 'No editable fields in this section.';
      feedback.classList.remove('hidden');
      feedback.classList.add('error');
    }
    return;
  }

  try {
    if (submitBtn) submitBtn.disabled = true;
    const res = await apiFetch('/api/my-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update profile.');
    }
    profileData = data;
    renderMyProfile();
  } catch (err) {
    console.error('Failed to update profile', err);
    if (feedback) {
      feedback.textContent = err.message || 'Unable to save changes right now.';
      feedback.classList.remove('hidden');
      feedback.classList.add('error');
    } else {
      alert(err.message || 'Unable to save changes right now.');
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function formatHolidayDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatHolidayWeekday(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { weekday: 'long' });
}

async function fetchHolidays({ force = false } = {}) {
  if (!force && holidaysLoaded && !holidaysLoading) {
    return companyHolidays;
  }
  if (!force && holidaysLoading) {
    return holidaysLoading;
  }
  const request = (async () => {
    try {
      const res = await apiFetch('/holidays');
      if (!res.ok) throw new Error('Failed to load holidays');
      const data = await res.json();
      companyHolidays = Array.isArray(data) ? data.slice() : [];
      companyHolidays.sort((a, b) => (a?.date || '').localeCompare(b?.date || ''));
      holidaysLoaded = true;
      return companyHolidays;
    } catch (err) {
      holidaysLoaded = false;
      throw err;
    } finally {
      holidaysLoading = null;
    }
  })();
  holidaysLoading = request;
  return request;
}

function renderHolidayHighlights(options = {}) {
  const container = document.getElementById('holidayHighlights');
  if (!container) return;
  const { error } = options;
  if (error) {
    container.innerHTML = `<p class="text-muted" style="font-style: italic; color:#b3261e;">${escapeHtml(error)}</p>`;
    return;
  }
  const holidays = Array.isArray(companyHolidays) ? companyHolidays.slice() : [];
  if (!holidays.length) {
    container.innerHTML = '<p class="text-muted" style="font-style: italic;">No upcoming holidays recorded.</p>';
    return;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = holidays.filter(holiday => {
    if (!holiday || !holiday.date) return false;
    const parsed = new Date(holiday.date);
    if (Number.isNaN(parsed.getTime())) return false;
    parsed.setHours(0, 0, 0, 0);
    return parsed >= today;
  });
  const source = upcoming.length ? upcoming : holidays;
  const limit = 5;
  const display = source.slice(0, limit);
  if (!display.length) {
    container.innerHTML = '<p class="text-muted" style="font-style: italic;">No upcoming holidays recorded.</p>';
    return;
  }
  const remainder = source.length - display.length;
  const needsFallbackNotice = upcoming.length === 0;
  const items = display.map(holiday => {
    const nameText = holiday?.name ? String(holiday.name) : 'Holiday';
    const safeName = escapeHtml(nameText);
    const dateValue = holiday?.date ? String(holiday.date) : '';
    const parsed = dateValue ? new Date(dateValue) : null;
    const hasValidDate = parsed && !Number.isNaN(parsed.getTime());
    let monthLabel = '';
    let dayLabel = '';
    const detailParts = [];
    if (hasValidDate) {
      monthLabel = parsed.toLocaleString(undefined, { month: 'short' });
      dayLabel = String(parsed.getDate()).padStart(2, '0');
      const pretty = formatHolidayDate(dateValue);
      if (pretty && pretty !== '-') detailParts.push(pretty);
      const weekday = formatHolidayWeekday(dateValue);
      if (weekday) detailParts.push(weekday);
    } else if (dateValue) {
      detailParts.push(dateValue);
    }
    const dateMarkup = hasValidDate
      ? `<div class="holiday-preview-date"><span class="holiday-preview-date__month">${escapeHtml(monthLabel)}</span><span class="holiday-preview-date__day">${escapeHtml(dayLabel)}</span></div>`
      : `<div class="holiday-preview-date holiday-preview-date--text">${escapeHtml(dateValue || '-')}</div>`;
    const metaMarkup = detailParts.length
      ? `<div class="holiday-preview-meta">${escapeHtml(detailParts.join(' • '))}</div>`
      : '';
    return `<div class="holiday-preview-item">${dateMarkup}<div class="holiday-preview-info"><div class="holiday-preview-name">${safeName}</div>${metaMarkup}</div></div>`;
  }).join('');
  const fallbackNotice = needsFallbackNotice
    ? '<p class="holiday-preview-empty text-muted">No upcoming holidays scheduled. Showing the most recent entries.</p>'
    : '';
  const moreMarkup = remainder > 0
    ? `<div class="holiday-preview-more text-quiet">+${remainder} more holiday${remainder === 1 ? '' : 's'} scheduled</div>`
    : '';
  container.innerHTML = fallbackNotice + items + moreMarkup;
}

async function loadHolidays(options = {}) {
  if (!currentUser || currentUser.role !== 'manager') return;
  const { force = true } = options;
  const list = document.getElementById('holidayList');
  if (list && !list.dataset.persist) {
    list.innerHTML = '<p class="text-muted" style="font-style: italic;">Loading holidays...</p>';
  }
  try {
    await fetchHolidays({ force });
    renderHolidayList();
  } catch (err) {
    console.error('Failed to load holidays', err);
    if (list) {
      list.innerHTML = '<p class="text-muted" style="font-style: italic; color:#b3261e;">Unable to load holidays.</p>';
      list.dataset.persist = 'true';
    }
    renderHolidayHighlights({ error: 'Unable to load holidays.' });
  }
}

function renderHolidayList() {
  const list = document.getElementById('holidayList');
  if (list) {
    list.dataset.persist = 'true';
    if (!Array.isArray(companyHolidays) || companyHolidays.length === 0) {
      list.innerHTML = '<p class="text-muted" style="font-style: italic;">No holidays added yet.</p>';
      renderHolidayHighlights();
      return;
    }
    const items = companyHolidays.map(holiday => {
      const id = holiday?.id ? escapeHtml(String(holiday.id)) : '';
      const name = holiday?.name ? escapeHtml(String(holiday.name)) : '';
      const iso = holiday?.date ? escapeHtml(String(holiday.date)) : '';
      const formatted = escapeHtml(formatHolidayDate(holiday?.date));
      return `
        <div class="holiday-item">
          <div class="holiday-item__meta">
            <div class="holiday-item__date">${formatted}</div>
            <div class="holiday-item__name">${name}</div>
            <div class="holiday-item__iso text-quiet">${iso}</div>
          </div>
          <button type="button" class="md-button md-button--text md-button--small holiday-item__delete" data-action="delete-holiday" data-id="${id}">
            <span class="material-symbols-rounded">delete</span>
            Remove
          </button>
        </div>
      `;
    });
    list.innerHTML = items.join('');
  }
  renderHolidayHighlights();
}

async function onHolidaySubmit(ev) {
  ev.preventDefault();
  if (!currentUser || currentUser.role !== 'manager') return;
  const dateInput = document.getElementById('holidayDate');
  const nameInput = document.getElementById('holidayName');
  const dateValue = dateInput?.value;
  const nameValue = nameInput?.value?.trim();
  if (!dateValue) {
    alert('Please choose a holiday date.');
    return;
  }
  if (!nameValue) {
    alert('Please enter a holiday name.');
    return;
  }
  try {
    const res = await apiFetch('/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateValue, name: nameValue })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to add holiday.');
    }
    if (Array.isArray(companyHolidays)) {
      companyHolidays = [...companyHolidays, data];
      companyHolidays.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    } else {
      companyHolidays = [data];
    }
    holidaysLoaded = true;
    renderHolidayList();
    if (dateInput) dateInput.value = '';
    if (nameInput) nameInput.value = '';
    const reportPanel = document.getElementById('leaveReportPanel');
    if (currentUser?.role === 'manager' && reportPanel && !reportPanel.classList.contains('hidden')) {
      await loadLeaveCalendar();
    }
  } catch (err) {
    console.error('Failed to add holiday', err);
    alert(err.message || 'Failed to add holiday.');
  }
}

async function onHolidayListClick(ev) {
  const button = ev.target.closest('[data-action="delete-holiday"]');
  if (!button) return;
  const id = button.getAttribute('data-id');
  if (!id) return;
  if (!confirm('Remove this holiday?')) return;
  try {
    const res = await apiFetch('/holidays/' + encodeURIComponent(id), { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete holiday.');
    }
    companyHolidays = Array.isArray(companyHolidays) ? companyHolidays.filter(h => h.id !== id) : [];
    holidaysLoaded = true;
    renderHolidayList();
    const reportPanel = document.getElementById('leaveReportPanel');
    if (currentUser?.role === 'manager' && reportPanel && !reportPanel.classList.contains('hidden')) {
      await loadLeaveCalendar();
    }
  } catch (err) {
    console.error('Failed to delete holiday', err);
    alert(err.message || 'Failed to delete holiday.');
  }
}

function setEmailSettingsStatus(message, type = 'info') {
  const statusEl = document.getElementById('emailSettingsStatus');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.classList.remove('settings-status--error', 'settings-status--success');
  if (!message) {
    statusEl.classList.add('text-muted');
    return;
  }
  statusEl.classList.remove('text-muted');
  if (type === 'error') {
    statusEl.classList.add('settings-status--error');
  } else if (type === 'success') {
    statusEl.classList.add('settings-status--success');
  }
}

function rememberCustomEmailSettings() {
  const form = document.getElementById('emailSettingsForm');
  const providerSelect = document.getElementById('emailProvider');
  if (!form || !providerSelect || providerSelect.value === 'office365') return;
  const hostInput = document.getElementById('emailHost');
  const portInput = document.getElementById('emailPort');
  const secureCheckbox = document.getElementById('emailSecure');
  if (hostInput) form.dataset.customHost = hostInput.value;
  if (portInput) form.dataset.customPort = portInput.value;
  if (secureCheckbox) form.dataset.customSecure = secureCheckbox.checked ? 'true' : 'false';
}

function updateEmailSettingsFormState() {
  const form = document.getElementById('emailSettingsForm');
  const providerSelect = document.getElementById('emailProvider');
  const hostInput = document.getElementById('emailHost');
  const portInput = document.getElementById('emailPort');
  const secureCheckbox = document.getElementById('emailSecure');
  if (!form || !providerSelect) return;
  const isOffice = providerSelect.value === 'office365';
  const previousProvider = form.dataset.provider || 'custom';

  if (isOffice) {
    if (hostInput) {
      if (previousProvider !== 'office365') {
        form.dataset.customHost = hostInput.value;
      }
      hostInput.value = 'smtp.office365.com';
      hostInput.setAttribute('disabled', '');
    }
    if (portInput) {
      if (previousProvider !== 'office365') {
        form.dataset.customPort = portInput.value;
      }
      portInput.value = '587';
      portInput.setAttribute('disabled', '');
    }
    if (secureCheckbox) {
      if (previousProvider !== 'office365') {
        form.dataset.customSecure = secureCheckbox.checked ? 'true' : 'false';
      }
      secureCheckbox.checked = false;
      secureCheckbox.setAttribute('disabled', '');
    }
  } else {
    if (hostInput) {
      hostInput.removeAttribute('disabled');
      if (previousProvider === 'office365') {
        hostInput.value = form.dataset.customHost || '';
      }
    }
    if (portInput) {
      portInput.removeAttribute('disabled');
      if (previousProvider === 'office365') {
        portInput.value = form.dataset.customPort || '';
      }
    }
    if (secureCheckbox) {
      secureCheckbox.removeAttribute('disabled');
      if (previousProvider === 'office365') {
        secureCheckbox.checked = form.dataset.customSecure === 'true';
      }
    }
    rememberCustomEmailSettings();
  }

  form.dataset.provider = isOffice ? 'office365' : 'custom';
}

function onEmailProviderChange() {
  const form = document.getElementById('emailSettingsForm');
  const providerSelect = document.getElementById('emailProvider');
  if (!form) return;
  const previousProvider = form.dataset.provider || 'custom';
  if (previousProvider !== 'office365') {
    rememberCustomEmailSettings();
  }
  updateEmailSettingsFormState();
  if (providerSelect) {
    const message = providerSelect.value === 'office365'
      ? 'Applied Microsoft 365 defaults. Save to confirm the change.'
      : 'Custom SMTP selected. Update the fields and save to apply.';
    setEmailSettingsStatus(message);
  }
}

function renderEmailSettingsForm() {
  const form = document.getElementById('emailSettingsForm');
  if (!form) return;
  const enabledInput = document.getElementById('emailEnabled');
  const providerSelect = document.getElementById('emailProvider');
  const hostInput = document.getElementById('emailHost');
  const portInput = document.getElementById('emailPort');
  const secureCheckbox = document.getElementById('emailSecure');
  const userInput = document.getElementById('emailUser');
  const fromInput = document.getElementById('emailFrom');
  const replyInput = document.getElementById('emailReplyTo');
  const passwordInput = document.getElementById('emailPassword');
  const recipientsContainer = document.getElementById('emailRecipients');
  const recipientsHelp = document.getElementById('emailRecipientsHelp');
  const help = document.getElementById('emailPasswordHelp');
  const settings = emailSettings || {};
  emailSettingsHasPassword = Boolean(settings.hasPassword);
  if (enabledInput) enabledInput.checked = Boolean(settings.enabled);
  const provider = settings.provider === 'office365' ? 'office365' : 'custom';
  if (providerSelect) providerSelect.value = provider;
  if (hostInput) hostInput.value = settings.host || (provider === 'office365' ? 'smtp.office365.com' : '');
  if (portInput) portInput.value = settings.port != null ? settings.port : (provider === 'office365' ? 587 : '');
  if (secureCheckbox) secureCheckbox.checked = Boolean(settings.secure);
  if (userInput) userInput.value = settings.user || '';
  if (fromInput) fromInput.value = settings.from || '';
  if (replyInput) replyInput.value = settings.replyTo || '';
  if (recipientsContainer) {
    const normalizedOptions = [];
    const seen = new Set();
    const addOption = (email, name = '') => {
      if (!email) return;
      const trimmed = typeof email === 'string' ? email.trim() : String(email || '').trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (seen.has(lower)) return;
      seen.add(lower);
      normalizedOptions.push({ email: trimmed, name: name ? String(name).trim() : '' });
    };
    const baseOptions = Array.isArray(emailRecipientOptions) ? emailRecipientOptions : [];
    baseOptions.forEach(option => addOption(option?.email, option?.name));
    const selectedEmails = Array.isArray(settings.recipients)
      ? settings.recipients
          .map(value => (typeof value === 'string' ? value.trim() : String(value || '').trim()))
          .filter(Boolean)
      : [];
    const selectedSet = new Set(selectedEmails.map(email => email.toLowerCase()));
    selectedEmails.forEach(email => addOption(email));
    if (!normalizedOptions.length) {
      recipientsContainer.innerHTML = '<p class="email-recipient-empty">No manager email addresses are available yet.</p>';
      if (recipientsHelp) {
        recipientsHelp.textContent = 'Add manager accounts with email addresses to enable notifications.';
      }
    } else {
      const items = normalizedOptions
        .map((option, index) => {
          const emailValue = option.email;
          if (!emailValue) return '';
          const inputId = `emailRecipient${index}`;
          const checked = selectedSet.has(emailValue.toLowerCase()) ? ' checked' : '';
          const labelText = option.name ? `${option.name} (${emailValue})` : emailValue;
          const safeValue = escapeHtml(emailValue);
          const safeLabel = escapeHtml(labelText);
          return `
            <label class="email-recipient-item" for="${inputId}">
              <input type="checkbox" id="${inputId}" name="emailRecipients" value="${safeValue}"${checked}>
              <span>${safeLabel}</span>
            </label>
          `;
        })
        .filter(Boolean)
        .join('');
      recipientsContainer.innerHTML = items || '<p class="email-recipient-empty">No manager email addresses are available yet.</p>';
      if (recipientsHelp) {
        recipientsHelp.textContent = 'Select which managers should receive leave notification emails.';
      }
    }
  } else if (recipientsHelp) {
    recipientsHelp.textContent = 'Select which managers should receive leave notification emails.';
  }
  if (passwordInput) {
    passwordInput.value = '';
    passwordInput.dataset.dirty = 'false';
  }
  if (help) {
    help.textContent = emailSettingsHasPassword
      ? 'Password is hidden. Enter a new value to update it.'
      : 'Provide the SMTP account password.';
  }
  if (provider !== 'office365') {
    rememberCustomEmailSettings();
  }
  updateEmailSettingsFormState();
}

async function fetchEmailSettings({ force = false } = {}) {
  if (!force && emailSettingsLoaded && !emailSettingsLoading) {
    return { settings: emailSettings, hasPassword: emailSettingsHasPassword };
  }
  if (!force && emailSettingsLoading) {
    return emailSettingsLoading;
  }
  const request = (async () => {
    try {
      const res = await apiFetch('/settings/email');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load email settings.');
      }
      const { recipientOptions: options = [], ...settingsData } = data;
      emailRecipientOptions = Array.isArray(options) ? options : [];
      emailSettings = { ...settingsData };
      emailSettingsHasPassword = Boolean(settingsData.hasPassword);
      emailSettingsLoaded = true;
      return { settings: emailSettings, hasPassword: emailSettingsHasPassword };
    } catch (err) {
      emailSettingsLoaded = false;
      throw err;
    } finally {
      emailSettingsLoading = null;
    }
  })();
  emailSettingsLoading = request;
  return request;
}

async function loadEmailSettingsConfig({ force = false } = {}) {
  if (!currentUser || currentUser.role !== 'manager') return;
  if (!force && emailSettingsLoaded) {
    renderEmailSettingsForm();
    const statusMessage = emailSettings?.enabled
      ? 'Email notifications are enabled.'
      : 'Email notifications are currently disabled.';
    setEmailSettingsStatus(statusMessage);
    return;
  }
  setEmailSettingsStatus('Loading email settings...');
  try {
    const result = await fetchEmailSettings({ force });
    emailSettings = result.settings;
    emailSettingsHasPassword = Boolean(result.hasPassword);
    renderEmailSettingsForm();
    const statusMessage = emailSettings?.enabled
      ? 'Email notifications are enabled.'
      : 'Email notifications are currently disabled.';
    setEmailSettingsStatus(statusMessage);
  } catch (err) {
    console.error('Failed to load email settings', err);
    setEmailSettingsStatus(err.message || 'Unable to load email settings.', 'error');
  }
}

async function onEmailSettingsSubmit(ev) {
  ev.preventDefault();
  if (!currentUser || currentUser.role !== 'manager') return;
  const form = ev.currentTarget;
  const submitBtn = form?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  setEmailSettingsStatus('Saving email settings...');
  try {
    const providerSelect = document.getElementById('emailProvider');
    const passwordInput = document.getElementById('emailPassword');
    const recipientInputs = Array.from(document.querySelectorAll('input[name="emailRecipients"]'));
    const selectedRecipients = recipientInputs
      .filter(input => input instanceof HTMLInputElement && input.checked)
      .map(input => input.value?.trim())
      .filter(Boolean);
    const payload = {
      enabled: document.getElementById('emailEnabled')?.checked ?? false,
      provider: providerSelect && providerSelect.value === 'office365' ? 'office365' : 'custom',
      host: document.getElementById('emailHost')?.value?.trim() || '',
      port: Number(document.getElementById('emailPort')?.value || 0),
      secure: document.getElementById('emailSecure')?.checked || false,
      user: document.getElementById('emailUser')?.value?.trim() || '',
      from: document.getElementById('emailFrom')?.value?.trim() || '',
      replyTo: document.getElementById('emailReplyTo')?.value?.trim() || '',
      updatePassword: passwordInput?.dataset?.dirty === 'true',
      password: passwordInput?.value || '',
      recipients: selectedRecipients
    };
    if (!payload.updatePassword) {
      delete payload.password;
    }
    const res = await apiFetch('/settings/email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save email settings.');
    }
    const { recipientOptions: updatedOptions = [], ...settingsData } = data;
    if (Array.isArray(updatedOptions)) {
      emailRecipientOptions = updatedOptions;
    }
    emailSettings = { ...settingsData };
    emailSettingsHasPassword = Boolean(settingsData.hasPassword);
    emailSettingsLoaded = true;
    renderEmailSettingsForm();
    setEmailSettingsStatus('Email settings saved successfully.', 'success');
  } catch (err) {
    console.error('Failed to save email settings', err);
    setEmailSettingsStatus(err.message || 'Unable to save email settings.', 'error');
  } finally {
    const passwordInput = document.getElementById('emailPassword');
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.dataset.dirty = 'false';
      const help = document.getElementById('emailPasswordHelp');
      if (help) {
        help.textContent = emailSettingsHasPassword
          ? 'Password is hidden. Enter a new value to update it.'
          : 'Provide the SMTP account password.';
      }
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function initRecruitment() {
  if (!currentUser || currentUser.role !== 'manager') return;
  if (recruitmentInitialized) return;
  recruitmentInitialized = true;

  const positionForm = document.getElementById('positionForm');
  if (positionForm) positionForm.addEventListener('submit', onPositionSubmit);

  const positionCancelBtn = document.getElementById('positionCancelEditBtn');
  if (positionCancelBtn) positionCancelBtn.addEventListener('click', onPositionEditCancel);

  const candidateForm = document.getElementById('candidateForm');
  if (candidateForm) candidateForm.addEventListener('submit', onCandidateSubmit);

  const candidateCancelBtn = document.getElementById('candidateCancelEditBtn');
  if (candidateCancelBtn) candidateCancelBtn.addEventListener('click', onCandidateEditCancel);

  const positionSelect = document.getElementById('candidatePositionSelect');
  if (positionSelect) positionSelect.addEventListener('change', onCandidatePositionChange);

  const positionsContainer = document.getElementById('positionsList');
  if (positionsContainer) positionsContainer.addEventListener('click', onPositionsListClick);

  const candidateTable = document.getElementById('candidateTableBody');
  if (candidateTable) {
    candidateTable.addEventListener('change', onCandidateStatusChange);
    candidateTable.addEventListener('click', onCandidateTableClick);
  }

  const candidateSearchInput = document.getElementById('candidateSearchInput');
  if (candidateSearchInput) candidateSearchInput.addEventListener('input', onCandidateSearchInput);

  const candidateSearchResults = document.getElementById('candidateSearchResults');
  if (candidateSearchResults) candidateSearchResults.addEventListener('click', onCandidateSearchResultsClick);

  const commentsList = document.getElementById('commentsList');
  if (commentsList) commentsList.addEventListener('click', onCommentsListClick);

  const commentFormEl = document.getElementById('commentForm');
  if (commentFormEl) commentFormEl.addEventListener('submit', onCommentSubmit);
  setCommentFormEnabled(false);

  const detailsCloseBtn = document.getElementById('candidateDetailsCloseBtn');
  if (detailsCloseBtn) detailsCloseBtn.onclick = closeCandidateDetailsModal;

  const detailsModal = document.getElementById('candidateDetailsModal');
  if (detailsModal) {
    detailsModal.addEventListener('click', ev => {
      if (ev.target === detailsModal) closeCandidateDetailsModal();
    });
  }

  const detailsDownloadBtn = document.getElementById('candidateDetailsDownloadBtn');
  if (detailsDownloadBtn) detailsDownloadBtn.addEventListener('click', onCandidateDetailsDownloadClick);

  const hireCloseBtn = document.getElementById('candidateHireCloseBtn');
  if (hireCloseBtn) hireCloseBtn.onclick = closeCandidateHireModal;

  const hireCancelBtn = document.getElementById('candidateHireCancelBtn');
  if (hireCancelBtn) hireCancelBtn.onclick = closeCandidateHireModal;

  const hireForm = document.getElementById('candidateHireForm');
  if (hireForm) hireForm.addEventListener('submit', onCandidateHireSubmit);

  const hireModal = document.getElementById('candidateHireModal');
  if (hireModal) {
    hireModal.addEventListener('click', ev => {
      if (ev.target === hireModal) closeCandidateHireModal();
    });
  }

  const candidateCvModal = document.getElementById('candidateCvModal');
  if (candidateCvModal) {
    candidateCvModal.addEventListener('click', ev => {
      if (ev.target === candidateCvModal) closeCandidateCvModal();
    });
  }

  const candidateCvModalCloseBtn = document.getElementById('candidateCvModalCloseBtn');
  if (candidateCvModalCloseBtn) candidateCvModalCloseBtn.onclick = closeCandidateCvModal;

  const candidateCvModalDownloadBtn = document.getElementById('candidateCvModalDownloadBtn');
  if (candidateCvModalDownloadBtn) candidateCvModalDownloadBtn.addEventListener('click', onCandidateCvModalDownload);

  await loadRecruitmentPositions();
  renderCandidateSearchResults();
}

async function loadRecruitmentPositions() {
  if (!currentUser || currentUser.role !== 'manager') return;
  const data = await getJSON('/recruitment/positions');
  recruitmentPositions = Array.isArray(data) ? data : [];
  recruitmentPositions.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  if (recruitmentEditingPositionId) {
    const stillExists = recruitmentPositions.some(p => p.id == recruitmentEditingPositionId);
    if (!stillExists) {
      resetPositionForm();
    }
  }

  if (recruitmentPositions.length) {
    const exists = recruitmentPositions.some(p => p.id == recruitmentActivePositionId);
    recruitmentActivePositionId = exists ? recruitmentActivePositionId : recruitmentPositions[0].id;
  } else {
    recruitmentActivePositionId = null;
  }

  renderRecruitmentPositions();
  updateCandidatePositionSelect();

  if (recruitmentEditingPositionId) {
    const editingPosition = recruitmentPositions.find(p => p.id == recruitmentEditingPositionId);
    if (editingPosition) {
      fillPositionForm(editingPosition);
    } else {
      resetPositionForm();
    }
  }

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
      <div class="position-item${isActive ? ' position-item--active' : ''}" data-position-id="${pos.id}">
        <button type="button" class="position-item__select" data-action="select-position" data-position-id="${pos.id}">
          <span class="material-symbols-rounded position-item__icon">work</span>
          <div class="position-item__content">
            <div class="position-item__title">${escapeHtml(pos.title)}</div>
            ${meta}
            ${description}
          </div>
          <span class="material-symbols-rounded position-item__chevron">chevron_right</span>
        </button>
        <div class="position-item__actions">
          <button type="button" class="md-button md-button--text md-button--small" data-action="edit-position" data-position-id="${pos.id}">
            <span class="material-symbols-rounded">edit</span>
            Edit
          </button>
        </div>
      </div>
    `;
  }).join('');
  container.innerHTML = markup;
  updateCandidateFormAvailability();
}

function fillPositionForm(position) {
  const titleEl = document.getElementById('positionTitle');
  if (titleEl) titleEl.value = position?.title || '';
  const deptEl = document.getElementById('positionDepartment');
  if (deptEl) deptEl.value = position?.department || '';
  const descEl = document.getElementById('positionDescription');
  if (descEl) descEl.value = position?.description || '';
}

function startPositionEdit(position) {
  if (!position) return;
  recruitmentEditingPositionId = position.id;
  const form = document.getElementById('positionForm');
  if (form) form.dataset.editId = position.id;
  fillPositionForm(position);
  const submitLabel = document.querySelector('#positionSubmitBtn .position-submit-label');
  if (submitLabel) submitLabel.textContent = 'Update Position';
  const icon = document.getElementById('positionSubmitIcon');
  if (icon) icon.textContent = 'edit';
  const cancelBtn = document.getElementById('positionCancelEditBtn');
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  const titleEl = document.getElementById('positionTitle');
  if (titleEl) {
    titleEl.focus();
    titleEl.setSelectionRange(titleEl.value.length, titleEl.value.length);
  }
}

function resetPositionForm() {
  const wasEditing = Boolean(recruitmentEditingPositionId);
  recruitmentEditingPositionId = null;
  const form = document.getElementById('positionForm');
  if (form && wasEditing) {
    form.reset();
  }
  if (form) delete form.dataset.editId;
  const submitLabel = document.querySelector('#positionSubmitBtn .position-submit-label');
  if (submitLabel) submitLabel.textContent = 'Save Position';
  const icon = document.getElementById('positionSubmitIcon');
  if (icon) icon.textContent = 'save';
  const cancelBtn = document.getElementById('positionCancelEditBtn');
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

function onPositionEditCancel() {
  resetPositionForm();
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
  const editBtn = ev.target.closest('[data-action="edit-position"]');
  if (editBtn) {
    const id = Number(editBtn.getAttribute('data-position-id'));
    if (Number.isNaN(id)) return;
    const position = recruitmentPositions.find(p => p.id == id);
    if (!position) return;
    startPositionEdit(position);
    return;
  }
  const selectTarget = ev.target.closest('[data-action="select-position"]');
  const container = ev.target.closest('.position-item');
  const idSource = selectTarget || container;
  if (!idSource) return;
  const id = Number(idSource.getAttribute('data-position-id'));
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
    const editingId = recruitmentEditingPositionId;
    const endpoint = editingId ? `/recruitment/positions/${editingId}` : '/recruitment/positions';
    const method = editingId ? 'PATCH' : 'POST';
    const res = await apiFetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed');
    if (editingId) {
      recruitmentActivePositionId = editingId;
      resetPositionForm();
    } else {
      form.reset();
    }
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
  const editingId = recruitmentEditingCandidateId;
  const hasNewCv = file && file.size;
  if (!editingId && !hasNewCv) {
    alert('Please upload a CV.');
    return;
  }
  try {
    const payload = {
      positionId,
      name,
      contact
    };
    if (hasNewCv) {
      const base64 = await fileToBase64(file);
      payload.cv = {
        filename: file.name,
        contentType: file.type,
        data: base64
      };
    }
    const endpoint = editingId ? `/recruitment/candidates/${editingId}` : '/recruitment/candidates';
    const method = editingId ? 'PATCH' : 'POST';
    const res = await apiFetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed');
    recruitmentActivePositionId = positionId;
    if (editingId) {
      resetCandidateForm();
    } else {
      form.reset();
      updateCandidatePositionSelect();
    }
    renderRecruitmentPositions();
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
  recruitmentCandidates.forEach(cacheCandidateDetails);
  if (recruitmentEditingCandidateId) {
    const editingCandidate = recruitmentCandidates.find(c => c.id == recruitmentEditingCandidateId);
    if (editingCandidate) {
      fillCandidateForm(editingCandidate);
    } else {
      resetCandidateForm();
    }
  }
  renderRecruitmentCandidates();
}

function renderRecruitmentCandidates() {
  const body = document.getElementById('candidateTableBody');
  if (!body) return;
  if (!recruitmentActivePositionId) {
    body.innerHTML = '<tr><td colspan="4" class="text-muted" style="padding:16px; font-style: italic;">Select a position to view candidates.</td></tr>';
    closeCandidateDetailsModal();
    return;
  }
  if (!recruitmentCandidates.length) {
    body.innerHTML = '<tr><td colspan="4" class="text-muted" style="padding:16px; font-style: italic;">No candidates yet for this position.</td></tr>';
    closeCandidateDetailsModal();
    return;
  }
  const rows = recruitmentCandidates.map(candidate => {
    const statusOptions = PIPELINE_STATUSES.map(status => `<option value="${status}" ${status === candidate.status ? 'selected' : ''}>${status}</option>`).join('');
    const contact = candidate.contact ? escapeHtml(candidate.contact) : '<span class="text-muted">Not provided</span>';
    return `
      <tr>
        <td>
          <div class="candidate-name-cell">
            <div class="candidate-name">${escapeHtml(candidate.name)}</div>
            <button type="button" class="md-button md-button--text candidate-details" data-candidate-id="${candidate.id}">
              <span class="material-symbols-rounded">info</span>
              View details
            </button>
          </div>
        </td>
        <td>${contact}</td>
        <td>
          <select class="md-select candidate-status" data-candidate-id="${candidate.id}">
            ${statusOptions}
          </select>
        </td>
        <td>
          <div class="candidate-actions">
            <button type="button" class="md-button md-button--text md-button--small" data-action="edit-candidate" data-candidate-id="${candidate.id}">
              <span class="material-symbols-rounded">edit</span>
              Edit
            </button>
            <button type="button" class="md-button md-button--text md-button--small" data-action="delete-candidate" data-candidate-id="${candidate.id}">
              <span class="material-symbols-rounded">delete</span>
              Delete
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  body.innerHTML = rows;
  body.querySelectorAll('.candidate-status').forEach(select => {
    const candidateId = select.getAttribute('data-candidate-id');
    const candidate = recruitmentCandidates.find(c => c.id == candidateId);
    if (candidate) {
      select.dataset.currentStatus = candidate.status;
    }
  });
  refreshCandidateDetailsModal();
}

function fillCandidateForm(candidate) {
  const positionSelect = document.getElementById('candidatePositionSelect');
  if (positionSelect) {
    const value = candidate && candidate.positionId != null ? String(candidate.positionId) : '';
    positionSelect.value = value;
  }
  const nameEl = document.getElementById('candidateName');
  if (nameEl) nameEl.value = candidate?.name || '';
  const contactEl = document.getElementById('candidateContact');
  if (contactEl) contactEl.value = candidate?.contact || '';
  const cvInput = document.getElementById('candidateCv');
  if (cvInput) cvInput.value = '';
}

function startCandidateEdit(candidate) {
  if (!candidate) return;
  recruitmentEditingCandidateId = candidate.id;
  const form = document.getElementById('candidateForm');
  if (form) form.dataset.editId = candidate.id;
  fillCandidateForm(candidate);
  const submitLabel = document.querySelector('#candidateSubmitBtn .candidate-submit-label');
  if (submitLabel) submitLabel.textContent = 'Update Candidate';
  const icon = document.getElementById('candidateSubmitIcon');
  if (icon) icon.textContent = 'save';
  const cancelBtn = document.getElementById('candidateCancelEditBtn');
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  const cvInput = document.getElementById('candidateCv');
  if (cvInput) {
    cvInput.removeAttribute('required');
    cvInput.value = '';
  }
  const helpText = document.getElementById('candidateCvHelpText');
  if (helpText) helpText.textContent = CANDIDATE_CV_HELP_EDIT;
  const nameEl = document.getElementById('candidateName');
  if (nameEl) {
    nameEl.focus();
    nameEl.setSelectionRange(nameEl.value.length, nameEl.value.length);
  }
}

function resetCandidateForm() {
  const wasEditing = Boolean(recruitmentEditingCandidateId);
  recruitmentEditingCandidateId = null;
  const form = document.getElementById('candidateForm');
  if (form && wasEditing) {
    form.reset();
  }
  if (form) delete form.dataset.editId;
  const submitLabel = document.querySelector('#candidateSubmitBtn .candidate-submit-label');
  if (submitLabel) submitLabel.textContent = 'Add to Pipeline';
  const icon = document.getElementById('candidateSubmitIcon');
  if (icon) icon.textContent = 'upload_file';
  const cancelBtn = document.getElementById('candidateCancelEditBtn');
  if (cancelBtn) cancelBtn.classList.add('hidden');
  const cvInput = document.getElementById('candidateCv');
  if (cvInput) {
    cvInput.value = '';
    cvInput.setAttribute('required', '');
  }
  const helpText = document.getElementById('candidateCvHelpText');
  if (helpText) helpText.textContent = CANDIDATE_CV_HELP_DEFAULT;
  updateCandidatePositionSelect();
}

function onCandidateEditCancel() {
  resetCandidateForm();
}

async function handleCandidateDelete(id) {
  if (!id) return;
  const candidate = recruitmentCandidates.find(c => c.id == id);
  if (!candidate) return;
  const confirmed = window.confirm('Remove this candidate from the pipeline?');
  if (!confirmed) return;
  try {
    const res = await apiFetch(`/recruitment/candidates/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed');
  } catch (err) {
    alert('Failed to delete candidate. Please try again.');
    return;
  }
  if (recruitmentActiveDetailsCandidateId == id) {
    closeCandidateDetailsModal();
  }
  if (recruitmentEditingCandidateId == id) {
    resetCandidateForm();
  }
  await loadRecruitmentCandidates(recruitmentActivePositionId);
}

function onCandidateSearchInput(ev) {
  const value = ev.target.value.trim();
  recruitmentCandidateSearchQuery = value;
  if (recruitmentCandidateSearchTimer) {
    clearTimeout(recruitmentCandidateSearchTimer);
    recruitmentCandidateSearchTimer = null;
  }
  if (recruitmentCandidateSearchAbort) {
    recruitmentCandidateSearchAbort.abort();
    recruitmentCandidateSearchAbort = null;
  }
  if (!value) {
    recruitmentCandidateSearchResults = [];
    recruitmentCandidateSearchLoading = false;
    recruitmentCandidateSearchError = null;
    renderCandidateSearchResults();
    return;
  }
  recruitmentCandidateSearchLoading = true;
  recruitmentCandidateSearchError = null;
  renderCandidateSearchResults();
  recruitmentCandidateSearchTimer = setTimeout(() => {
    performCandidateSearch(value);
  }, 300);
}

async function performCandidateSearch(query) {
  if (!query) return;
  recruitmentCandidateSearchTimer = null;
  if (recruitmentCandidateSearchAbort) {
    recruitmentCandidateSearchAbort.abort();
  }
  const controller = new AbortController();
  recruitmentCandidateSearchAbort = controller;
  let data;
  try {
    const res = await apiFetch(`/recruitment/candidates/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
    if (!res.ok) throw new Error('Failed');
    data = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (recruitmentCandidateSearchQuery !== query) return;
    recruitmentCandidateSearchError = 'Unable to search candidates right now.';
    recruitmentCandidateSearchResults = [];
    recruitmentCandidateSearchLoading = false;
    recruitmentCandidateSearchAbort = null;
    renderCandidateSearchResults();
    return;
  }
  recruitmentCandidateSearchAbort = null;
  if (recruitmentCandidateSearchQuery !== query) {
    return;
  }
  recruitmentCandidateSearchResults = Array.isArray(data) ? data : [];
  recruitmentCandidateSearchLoading = false;
  recruitmentCandidateSearchError = null;
  renderCandidateSearchResults();
}

function renderCandidateSearchResults() {
  const container = document.getElementById('candidateSearchResults');
  if (!container) return;
  if (!recruitmentCandidateSearchQuery) {
    container.classList.add('text-muted');
    container.innerHTML = 'Start typing to look up existing applicants.';
    return;
  }
  container.classList.remove('text-muted');
  if (recruitmentCandidateSearchLoading) {
    container.innerHTML = `
      <div class="candidate-search-loading">
        <span class="material-symbols-rounded">progress_activity</span>
        Searching...
      </div>
    `;
    return;
  }
  if (recruitmentCandidateSearchError) {
    container.innerHTML = `<div class="candidate-search-empty" style="color:#b3261e;">${escapeHtml(recruitmentCandidateSearchError)}</div>`;
    return;
  }
  if (!recruitmentCandidateSearchResults.length) {
    container.innerHTML = '<div class="candidate-search-empty text-muted">No matching candidates found.</div>';
    return;
  }
  const items = recruitmentCandidateSearchResults.map(result => {
    const name = escapeHtml(result?.name || 'Unknown candidate');
    const status = result?.status
      ? `<div class="candidate-search-item__status">${escapeHtml(result.status)}</div>`
      : '<div class="candidate-search-item__status candidate-search-item__status--muted">No status</div>';
    const detailItems = [];
    if (result?.contact) {
      detailItems.push({
        label: 'Contact',
        value: escapeHtml(result.contact)
      });
    }
    if (result?.positionTitle) {
      detailItems.push({
        label: 'Position',
        value: escapeHtml(result.positionTitle)
      });
    }
    const applied = formatRecruitmentDate(result?.createdAt);
    if (applied) {
      detailItems.push({
        label: 'Applied',
        value: escapeHtml(applied)
      });
    }
    const details = detailItems.length
      ? `
        <div class="candidate-search-item__details">
          ${detailItems
            .map(
              item => `
                <div class="candidate-search-item__detail">
                  <div class="candidate-search-item__detail-label">${item.label}</div>
                  <div class="candidate-search-item__detail-value">${item.value}</div>
                </div>
              `
            )
            .join('')}
        </div>
      `
      : '';
    const hasCv = !!result?.hasCv;
    const actions = hasCv
      ? `<button type="button" class="md-button md-button--text md-button--small candidate-search-item__view-btn" data-action="view-candidate-cv" data-candidate-id="${escapeHtml(String(result.id))}"><span class="material-symbols-rounded">picture_as_pdf</span>View CV</button>`
      : '<div class="candidate-search-item__no-cv">No CV uploaded</div>';
    return `
      <div class="candidate-search-item">
        <div class="candidate-search-item__content">
          <div class="candidate-search-item__name">${name}</div>
          ${details}
        </div>
        <div class="candidate-search-item__actions">
          ${status}
          ${actions}
        </div>
      </div>
    `;
  }).join('');
  container.innerHTML = items;
}

function resetCandidateCvModal(message = 'Select a candidate to preview their CV.') {
  const iframe = document.getElementById('candidateCvModalIframe');
  const messageEl = document.getElementById('candidateCvModalMessage');
  if (iframe) {
    iframe.classList.add('hidden');
    iframe.removeAttribute('src');
  }
  if (messageEl) {
    messageEl.textContent = message;
    messageEl.classList.remove('hidden');
  }
}

function setCandidateCvModalUrl(url) {
  const iframe = document.getElementById('candidateCvModalIframe');
  const messageEl = document.getElementById('candidateCvModalMessage');
  if (!iframe || !messageEl) return;
  iframe.src = url;
  iframe.classList.remove('hidden');
  messageEl.classList.add('hidden');
}

async function loadCandidateSearchCvPreview(candidateId) {
  const iframe = document.getElementById('candidateCvModalIframe');
  const messageEl = document.getElementById('candidateCvModalMessage');
  if (!iframe || !messageEl) return;
  messageEl.textContent = 'Loading CV preview...';
  messageEl.classList.remove('hidden');
  iframe.classList.add('hidden');
  try {
    const res = await apiFetch(`/recruitment/candidates/${candidateId}/cv`);
    if (!res.ok) throw new Error('Failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (candidateCvModalCandidateId !== candidateId) {
      URL.revokeObjectURL(url);
      return;
    }
    candidateCvPreviewUrls.set(candidateId, url);
    setCandidateCvModalUrl(url);
  } catch (err) {
    if (candidateCvModalCandidateId !== candidateId) return;
    resetCandidateCvModal('Unable to load CV preview right now. Use the download button to access the CV.');
  }
}

function openCandidateCvModal(candidateId) {
  const modal = document.getElementById('candidateCvModal');
  if (!modal) return;
  const candidate = recruitmentCandidateSearchResults.find(c => String(c.id) === String(candidateId));
  if (!candidate) return;
  candidateCvModalCandidateId = candidate.id;
  modal.classList.remove('hidden');
  const titleText = document.getElementById('candidateCvModalTitleText');
  if (titleText) {
    titleText.textContent = candidate?.name ? `CV Preview · ${candidate.name}` : 'CV Preview';
  }
  const downloadBtn = document.getElementById('candidateCvModalDownloadBtn');
  if (downloadBtn) {
    const hasCv = !!candidate?.hasCv;
    downloadBtn.classList.toggle('hidden', !hasCv);
    downloadBtn.dataset.candidateId = hasCv ? String(candidate.id) : '';
    downloadBtn.disabled = !hasCv;
  }
  if (!candidate?.hasCv) {
    resetCandidateCvModal('No CV uploaded for this candidate.');
    return;
  }
  const contentType = String(candidate.cvContentType || '').toLowerCase();
  if (!contentType.includes('pdf')) {
    resetCandidateCvModal('CV preview is available only for PDF files. Use the download button to open this document.');
    return;
  }
  const cachedUrl = candidateCvPreviewUrls.get(candidate.id);
  if (cachedUrl) {
    setCandidateCvModalUrl(cachedUrl);
    return;
  }
  resetCandidateCvModal('Loading CV preview...');
  loadCandidateSearchCvPreview(candidate.id);
}

function closeCandidateCvModal() {
  const modal = document.getElementById('candidateCvModal');
  if (!modal) return;
  modal.classList.add('hidden');
  candidateCvModalCandidateId = null;
  const titleText = document.getElementById('candidateCvModalTitleText');
  if (titleText) {
    titleText.textContent = 'CV Preview';
  }
  const downloadBtn = document.getElementById('candidateCvModalDownloadBtn');
  if (downloadBtn) {
    downloadBtn.classList.add('hidden');
    downloadBtn.dataset.candidateId = '';
    downloadBtn.disabled = false;
  }
  resetCandidateCvModal('Select a candidate to preview their CV.');
}

async function onCandidateCvModalDownload(ev) {
  const button = ev.currentTarget;
  if (!button || button.disabled) return;
  const id = button.dataset.candidateId;
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

function onCandidateSearchResultsClick(ev) {
  const button = ev.target.closest('[data-action="view-candidate-cv"]');
  if (!button) return;
  const id = button.getAttribute('data-candidate-id');
  if (!id) return;
  const result = recruitmentCandidateSearchResults.find(candidate => String(candidate.id) === String(id));
  const adapted = adaptSearchResultToCandidate(result);
  if (adapted) cacheCandidateDetails(adapted);
  openCandidateDetailsModal(id);
}

async function onCandidateStatusChange(ev) {
  const select = ev.target.closest('.candidate-status');
  if (!select) return;
  const id = select.getAttribute('data-candidate-id');
  const status = select.value;
  if (!id || !status) return;
  const candidate = recruitmentCandidates.find(c => c.id == id);
  const fallbackStatus = candidate?.status || PIPELINE_STATUSES[0];
  const previousStatus = select.dataset.currentStatus || fallbackStatus;
  if (status === previousStatus) return;
  if (status === 'Hired') {
    if (!candidate) {
      select.value = previousStatus;
      return;
    }
    select.value = previousStatus;
    openCandidateHireModal(candidate, select, previousStatus);
    return;
  }
  try {
    const res = await apiFetch(`/recruitment/candidates/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Failed');
    select.dataset.currentStatus = status;
    await loadRecruitmentCandidates(recruitmentActivePositionId);
  } catch (err) {
    alert('Failed to update candidate status.');
    select.value = previousStatus;
    await loadRecruitmentCandidates(recruitmentActivePositionId);
  }
}

async function onCandidateTableClick(ev) {
  const deleteBtn = ev.target.closest('[data-action="delete-candidate"]');
  if (deleteBtn) {
    const id = Number(deleteBtn.getAttribute('data-candidate-id'));
    if (!Number.isNaN(id)) {
      await handleCandidateDelete(id);
    }
    return;
  }
  const editBtn = ev.target.closest('[data-action="edit-candidate"]');
  if (editBtn) {
    const id = Number(editBtn.getAttribute('data-candidate-id'));
    if (!Number.isNaN(id)) {
      const candidate = recruitmentCandidates.find(c => c.id == id);
      if (candidate) {
        startCandidateEdit(candidate);
      }
    }
    return;
  }
  const detailsButton = ev.target.closest('.candidate-details');
  if (!detailsButton) return;
  const id = Number(detailsButton.getAttribute('data-candidate-id'));
  if (!id) return;
  openCandidateDetailsModal(id);
}

async function downloadCandidateCv(id) {
  const res = await apiFetch(`/recruitment/candidates/${id}/cv`);
  if (!res.ok) throw new Error('Failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const normalizedId = normalizeCandidateId(id);
  const candidate = recruitmentCandidates.find(c => c.id == id) ||
    recruitmentCandidateSearchResults.find(c => String(c.id) === String(id)) ||
    (normalizedId != null ? candidateDetailsCache.get(normalizedId) : null);
  const filename = candidate?.cv?.filename || candidate?.cvFilename || `candidate-${id}`;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetCandidateCvPreview(message = 'Select a candidate to view their CV.') {
  const messageEl = document.getElementById('candidateCvPreviewMessage');
  const iframe = document.getElementById('candidateCvIframe');
  if (iframe) {
    iframe.classList.add('hidden');
    iframe.removeAttribute('src');
  }
  if (messageEl) {
    messageEl.textContent = message;
    messageEl.classList.remove('hidden');
  }
}

function setCandidateCvPreviewUrl(url) {
  const messageEl = document.getElementById('candidateCvPreviewMessage');
  const iframe = document.getElementById('candidateCvIframe');
  if (!iframe || !messageEl) return;
  iframe.src = url;
  iframe.classList.remove('hidden');
  messageEl.classList.add('hidden');
}

async function loadCandidateCvPreview(candidate) {
  if (!candidate) {
    resetCandidateCvPreview();
    return;
  }
  if (!candidate?.cv?.filename) {
    resetCandidateCvPreview('No CV uploaded for this candidate.');
    return;
  }
  const contentType = String(candidate.cv.contentType || '').toLowerCase();
  if (!contentType.includes('pdf')) {
    resetCandidateCvPreview('CV preview is available only for PDF files. Use the download button to open this document.');
    return;
  }
  const messageEl = document.getElementById('candidateCvPreviewMessage');
  const iframe = document.getElementById('candidateCvIframe');
  if (!messageEl || !iframe) return;
  const cachedUrl = candidateCvPreviewUrls.get(candidate.id);
  if (cachedUrl) {
    setCandidateCvPreviewUrl(cachedUrl);
    return;
  }
  messageEl.textContent = 'Loading CV preview...';
  messageEl.classList.remove('hidden');
  iframe.classList.add('hidden');
  try {
    const res = await apiFetch(`/recruitment/candidates/${candidate.id}/cv`);
    if (!res.ok) throw new Error('Failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    candidateCvPreviewUrls.set(candidate.id, url);
    if (recruitmentActiveDetailsCandidateId !== candidate.id) return;
    setCandidateCvPreviewUrl(url);
  } catch (err) {
    if (recruitmentActiveDetailsCandidateId !== candidate?.id) return;
    resetCandidateCvPreview('Unable to load CV preview right now. Use the download button to access the CV.');
  }
}

function setCommentFormEnabled(enabled) {
  const textarea = document.getElementById('commentText');
  const submitBtn = document.getElementById('commentSubmitBtn');
  [textarea, submitBtn].forEach(el => {
    if (el) el.disabled = !enabled;
  });
}

function updateCandidateCommentsCount(count, candidate) {
  const countEl = document.getElementById('candidateDetailsCommentsCount');
  if (!countEl) return;
  let value = Number.isFinite(count) ? Number(count) : 0;
  if (candidate && candidate.id === recruitmentActiveCommentCandidateId && Array.isArray(recruitmentCandidateComments)) {
    value = recruitmentCandidateComments.length;
  }
  countEl.textContent = value;
}

function prepareCandidateCommentsSection(candidate) {
  const list = document.getElementById('commentsList');
  if (list) {
    list.classList.add('text-muted');
    list.innerHTML = '<p style="font-style: italic;">Loading comments...</p>';
  }
  const metaEl = document.getElementById('candidateDetailsCommentsMeta');
  if (metaEl) {
    metaEl.textContent = candidate?.name
      ? `Collaborate on interview notes for ${candidate.name}.`
      : 'Share feedback with your hiring team.';
  }
  const textarea = document.getElementById('commentText');
  if (textarea) textarea.value = '';
  updateCandidateCommentsCount(candidate?.commentCount, candidate);
  updateCommentSubmitLabel();
}

async function loadCandidateComments(candidateId) {
  const list = document.getElementById('commentsList');
  recruitmentCandidateComments = [];
  recruitmentEditingCommentId = null;
  updateCommentSubmitLabel();
  if (list) {
    list.classList.add('text-muted');
    list.innerHTML = '<p style="font-style: italic;">Loading comments...</p>';
  }
  try {
    const res = await apiFetch(`/recruitment/candidates/${candidateId}/comments`);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    recruitmentCandidateComments = Array.isArray(data) ? data : [];
  } catch (err) {
    if (recruitmentActiveCommentCandidateId !== candidateId) return;
    if (list) {
      list.innerHTML = '<p style="font-style: italic;">Unable to load comments right now.</p>';
    }
    updateCandidateCommentsCount(recruitmentCandidateComments.length);
    return;
  }
  if (recruitmentActiveCommentCandidateId !== candidateId) return;
  recruitmentCandidateComments.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const normalizedId = normalizeCandidateId(candidateId);
  const candidate = normalizedId != null
    ? recruitmentCandidates.find(c => c.id == normalizedId) || candidateDetailsCache.get(normalizedId)
    : null;
  if (candidate) {
    candidate.commentCount = recruitmentCandidateComments.length;
    cacheCandidateDetails(candidate);
  }
  renderCandidateComments();
  updateCandidateCommentsCount(recruitmentCandidateComments.length, candidate);
  refreshCandidateDetailsModal();
}

function openCandidateDetailsModal(candidateId) {
  const candidate = getCachedCandidate(candidateId);
  if (!candidate) {
    alert('Unable to load candidate details right now. Please try again.');
    return;
  }
  cacheCandidateDetails(candidate);
  recruitmentActiveDetailsCandidateId = candidate.id;
  recruitmentActiveCommentCandidateId = candidate.id;
  prepareCandidateCommentsSection(candidate);
  setCommentFormEnabled(true);
  populateCandidateDetails(candidate);
  loadCandidateComments(candidate.id);
  loadCandidateCvPreview(candidate);
  const modal = document.getElementById('candidateDetailsModal');
  if (modal) modal.classList.remove('hidden');
  const textarea = document.getElementById('commentText');
  if (textarea) textarea.focus();
}

function closeCandidateDetailsModal() {
  const modal = document.getElementById('candidateDetailsModal');
  if (modal) modal.classList.add('hidden');
  recruitmentActiveDetailsCandidateId = null;
  recruitmentActiveCommentCandidateId = null;
  recruitmentCandidateComments = [];
  recruitmentEditingCommentId = null;
  updateCommentSubmitLabel();
  setCommentFormEnabled(false);
  resetCandidateCvPreview();
  const list = document.getElementById('commentsList');
  if (list) {
    list.classList.add('text-muted');
    list.innerHTML = '<p style="font-style: italic;">Select a candidate to load comments.</p>';
  }
  const metaEl = document.getElementById('candidateDetailsCommentsMeta');
  if (metaEl) metaEl.textContent = 'Share feedback with your hiring team.';
  updateCandidateCommentsCount(0);
  const textarea = document.getElementById('commentText');
  if (textarea) textarea.value = '';
  ['Name', 'Contact', 'Status', 'Created'].forEach(field => {
    const el = document.getElementById(`candidateDetails${field}`);
    if (el) el.textContent = '-';
  });
  const cvEl = document.getElementById('candidateDetailsCvFilename');
  if (cvEl) cvEl.textContent = '-';
  const downloadBtn = document.getElementById('candidateDetailsDownloadBtn');
  if (downloadBtn) {
    delete downloadBtn.dataset.candidateId;
    downloadBtn.disabled = true;
  }
}

function populateCandidateDetails(candidate) {
  const nameEl = document.getElementById('candidateDetailsName');
  if (nameEl) nameEl.textContent = candidate?.name ? candidate.name : '-';

  const contactEl = document.getElementById('candidateDetailsContact');
  if (contactEl) contactEl.textContent = candidate?.contact ? candidate.contact : 'Not provided';

  const statusEl = document.getElementById('candidateDetailsStatus');
  if (statusEl) statusEl.textContent = candidate?.status || '-';

  const createdEl = document.getElementById('candidateDetailsCreated');
  if (createdEl) createdEl.textContent = formatRecruitmentDateTime(candidate?.createdAt) || '-';

  const cvEl = document.getElementById('candidateDetailsCvFilename');
  const hasCv = !!candidate?.cv?.filename;
  if (cvEl) cvEl.textContent = hasCv ? candidate.cv.filename : 'No CV uploaded';

  const downloadBtn = document.getElementById('candidateDetailsDownloadBtn');
  if (downloadBtn) {
    downloadBtn.dataset.candidateId = candidate?.id;
    downloadBtn.disabled = !hasCv;
  }
  updateCandidateCommentsCount(candidate?.commentCount, candidate);
}

function refreshCandidateDetailsModal() {
  if (!recruitmentActiveDetailsCandidateId) return;
  const candidate = getCachedCandidate(recruitmentActiveDetailsCandidateId);
  if (!candidate) {
    closeCandidateDetailsModal();
    return;
  }
  populateCandidateDetails(candidate);
}

function deriveHireInitialValues(candidate, fields = []) {
  const initial = {};
  const position = recruitmentPositions.find(pos => pos.id == candidate.positionId);
  fields.forEach(field => {
    const keyLower = String(field.key || '').toLowerCase();
    if (keyLower === 'name' && candidate?.name) {
      initial[field.key] = candidate.name;
      return;
    }
    if (position && keyLower === 'title' && position.title) {
      initial[field.key] = position.title;
      return;
    }
    if (position && position.department && keyLower.includes('department')) {
      initial[field.key] = position.department;
      return;
    }
    if (candidate?.contact) {
      const contact = candidate.contact;
      const lowerContact = contact.toLowerCase();
      if (lowerContact.includes('@') && keyLower.includes('email')) {
        initial[field.key] = contact;
        return;
      }
      if (!lowerContact.includes('@') && (keyLower.includes('phone') || keyLower.includes('mobile'))) {
        initial[field.key] = contact;
        return;
      }
      if (keyLower.includes('contact')) {
        initial[field.key] = contact;
        return;
      }
    }
    if (field.type === 'select' && Array.isArray(field.options)) {
      const activeOption = field.options.find(opt => String(opt).toLowerCase() === 'active');
      if (activeOption && typeof initial[field.key] === 'undefined') {
        initial[field.key] = activeOption;
        return;
      }
    }
    if (field.isLeaveBalance && typeof initial[field.key] === 'undefined') {
      initial[field.key] = 0;
    }
  });
  return initial;
}

async function openCandidateHireModal(candidate, select, previousStatus) {
  if (!candidate) return;
  hireModalState = { candidateId: candidate.id, select, previousStatus, candidate };
  currentHireFields = [];
  const modal = document.getElementById('candidateHireModal');
  const form = document.getElementById('candidateHireForm');
  const fieldsContainer = document.getElementById('candidateHireFields');
  const titleTextEl = document.getElementById('candidateHireTitleText');
  const subtitleEl = document.getElementById('candidateHireSubtitle');
  if (form) form.reset();
  if (titleTextEl) {
    titleTextEl.textContent = candidate.name ? `Complete record for ${candidate.name}` : 'Complete Employee Record';
  }
  if (subtitleEl) {
    subtitleEl.textContent = candidate.name
      ? `Provide the mandatory employee information to onboard ${candidate.name}.`
      : 'Provide the mandatory employee information before marking this candidate as hired.';
  }
  if (fieldsContainer) {
    fieldsContainer.innerHTML = '<p class="text-muted" style="font-style: italic;">Loading employee fields...</p>';
  }
  if (modal) {
    modal.classList.remove('hidden');
  }
  try {
    const fields = await getDynamicEmployeeFields();
    if (!hireModalState.candidateId || hireModalState.candidateId !== candidate.id) return;
    currentHireFields = Array.isArray(fields) ? fields : [];
    const initialValues = deriveHireInitialValues(candidate, currentHireFields);
    if (fieldsContainer) {
      if (currentHireFields.length) {
        fieldsContainer.innerHTML = buildDynamicFieldsHtml(currentHireFields, initialValues, 'hire');
      } else {
        fieldsContainer.innerHTML = '<p class="text-muted" style="font-style: italic;">No employee fields configured yet. Please add an employee template in Employee Management.</p>';
      }
    }
    setTimeout(() => {
      const focusTarget = document.querySelector('#candidateHireFields input, #candidateHireFields select, #candidateHireFields textarea');
      if (focusTarget) focusTarget.focus();
    }, 50);
  } catch (err) {
    if (fieldsContainer) {
      fieldsContainer.innerHTML = '<p style="color:#dc2626;">Unable to load employee fields. Please try again.</p>';
    }
  }
}

function closeCandidateHireModal() {
  const modal = document.getElementById('candidateHireModal');
  if (modal) modal.classList.add('hidden');
  const form = document.getElementById('candidateHireForm');
  if (form) form.reset();
  const fieldsContainer = document.getElementById('candidateHireFields');
  if (fieldsContainer) fieldsContainer.innerHTML = '';
  currentHireFields = [];
  hireModalState = { candidateId: null, select: null, previousStatus: null, candidate: null };
}

async function onCandidateHireSubmit(ev) {
  ev.preventDefault();
  if (!hireModalState.candidateId) {
    alert('Select a candidate to hire.');
    return;
  }
  const form = ev.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const cancelBtn = document.getElementById('candidateHireCancelBtn');
  [submitBtn, cancelBtn].forEach(btn => { if (btn) btn.disabled = true; });
  let employeeCreated = false;
  try {
    const payload = buildEmployeePayload(form, currentHireFields);
    const ensureValue = (keyName, value, overwriteEmpty = false) => {
      if (!value) return;
      const matchKey = Object.keys(payload).find(k => k.toLowerCase() === keyName.toLowerCase());
      if (matchKey) {
        if (overwriteEmpty) {
          const current = payload[matchKey];
          if (current === '' || current === null || typeof current === 'undefined') {
            payload[matchKey] = value;
          }
        }
      } else {
        payload[keyName] = value;
      }
    };
    ensureValue('name', hireModalState.candidate?.name, true);
    ensureValue('status', 'active', true);
    if (hireModalState.candidate?.contact) {
      const contact = hireModalState.candidate.contact;
      if (contact.includes('@')) {
        ensureValue('email', contact, true);
      }
    }
    const res = await apiFetch('/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create employee record.');
    }
    employeeCreated = true;
    const candidateId = hireModalState.candidateId;
    const statusRes = await apiFetch(`/recruitment/candidates/${candidateId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Hired' })
    });
    if (!statusRes.ok) {
      const err = await statusRes.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update candidate status.');
    }
    if (hireModalState.select) {
      hireModalState.select.value = 'Hired';
      hireModalState.select.dataset.currentStatus = 'Hired';
    }
    closeCandidateHireModal();
    alert('Candidate added to Employee Management and marked as hired.');
    await Promise.all([
      loadRecruitmentCandidates(recruitmentActivePositionId),
      loadEmployeesManage(),
      loadEmployeesPortal()
    ]);
  } catch (err) {
    if (employeeCreated) {
      const message = err.message ? `${err.message} Please update the candidate status manually.` : 'Employee record created but the candidate status was not updated. Please update it manually.';
      alert(message);
      if (hireModalState.select) {
        const revert = hireModalState.previousStatus || hireModalState.select.dataset.currentStatus || PIPELINE_STATUSES[0];
        hireModalState.select.value = revert;
        hireModalState.select.dataset.currentStatus = revert;
      }
      closeCandidateHireModal();
      await Promise.all([
        loadEmployeesManage(),
        loadEmployeesPortal(),
        loadRecruitmentCandidates(recruitmentActivePositionId)
      ]);
    } else {
      alert(err.message || 'Failed to complete hiring. Please try again.');
    }
  } finally {
    [submitBtn, cancelBtn].forEach(btn => { if (btn) btn.disabled = false; });
  }
}

async function onCandidateDetailsDownloadClick(ev) {
  const button = ev.currentTarget;
  if (!button?.dataset?.candidateId || button.disabled) return;
  const id = Number(button.dataset.candidateId);
  if (!id) return;
  button.disabled = true;
  try {
    await downloadCandidateCv(id);
  } catch (err) {
    alert('Unable to download CV at the moment.');
  } finally {
    const candidate = recruitmentCandidates.find(c => c.id == id);
    const hasCv = !!candidate?.cv?.filename;
    button.disabled = !hasCv;
  }
}

function renderCandidateComments() {
  const list = document.getElementById('commentsList');
  if (!list) return;
  if (!recruitmentCandidateComments.length) {
    list.classList.add('text-muted');
    list.innerHTML = '<p style="font-style: italic;">No comments yet. Be the first to add one.</p>';
    updateCandidateCommentsCount(0);
    return;
  }
  list.classList.remove('text-muted');
  const markup = recruitmentCandidateComments.map(comment => {
    const authorEmail = escapeHtml(comment.author?.email || 'Unknown');
    const timestamp = formatRecruitmentDateTime(comment.updatedAt || comment.createdAt);
    const edited = comment.updatedAt && comment.updatedAt !== comment.createdAt ? ' (edited)' : '';
    const commentText = escapeHtml(comment.text || '').replace(/\n/g, '<br>');
    const ownClass = comment.canEdit ? ' own-comment' : '';
    const editButton = comment.canEdit ? `
      <div class="comment-actions">
        <button type="button" class="comment-edit" data-comment-id="${comment.id}">
          <span class="material-symbols-rounded">edit</span>
          Edit
        </button>
      </div>
    ` : '';
    return `
      <div class="comment-item${ownClass}">
        <div class="comment-item-meta">
          <span>${authorEmail}</span>
          <span>${timestamp || ''}${edited}</span>
        </div>
        <div class="comment-text">${commentText || '<span class="text-muted">(No content)</span>'}</div>
        ${editButton}
      </div>
    `;
  }).join('');
  list.innerHTML = markup;
  updateCandidateCommentsCount(recruitmentCandidateComments.length);
}

function updateCommentSubmitLabel() {
  const label = document.querySelector('#commentSubmitBtn .comment-submit-label');
  if (!label) return;
  label.textContent = recruitmentEditingCommentId ? 'Update Comment' : 'Add Comment';
}

async function onCommentSubmit(ev) {
  ev.preventDefault();
  if (!recruitmentActiveCommentCandidateId) return;
  const textarea = document.getElementById('commentText');
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text) {
    alert('Please enter a comment before submitting.');
    return;
  }
  const payload = { text };
  const candidateId = recruitmentActiveCommentCandidateId;
  const commentId = recruitmentEditingCommentId;
  const endpoint = commentId ? `/recruitment/candidates/${candidateId}/comments/${commentId}` : `/recruitment/candidates/${candidateId}/comments`;
  const method = commentId ? 'PATCH' : 'POST';
  let data;
  try {
    const res = await apiFetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed');
    data = await res.json();
  } catch (err) {
    alert('Unable to save the comment right now. Please try again.');
    return;
  }
  if (data?.comment) {
    const idx = recruitmentCandidateComments.findIndex(c => c.id == data.comment.id);
    if (idx >= 0) {
      recruitmentCandidateComments[idx] = data.comment;
    } else {
      recruitmentCandidateComments.push(data.comment);
    }
    recruitmentCandidateComments.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  }
  if (typeof data?.commentCount === 'number') {
    const normalizedId = normalizeCandidateId(candidateId);
    let shouldRender = false;
    if (normalizedId != null) {
      const candidate = recruitmentCandidates.find(c => c.id == normalizedId);
      if (candidate) {
        candidate.commentCount = data.commentCount;
        cacheCandidateDetails(candidate);
        shouldRender = true;
      }
      const cached = candidateDetailsCache.get(normalizedId);
      if (cached && cached !== candidate) {
        cached.commentCount = data.commentCount;
        cacheCandidateDetails(cached);
      }
    }
    if (shouldRender) {
      renderRecruitmentCandidates();
    }
  }
  textarea.value = '';
  recruitmentEditingCommentId = null;
  updateCommentSubmitLabel();
  renderCandidateComments();
  refreshCandidateDetailsModal();
}

function onCommentsListClick(ev) {
  const editBtn = ev.target.closest('.comment-edit');
  if (!editBtn) return;
  const commentId = editBtn.getAttribute('data-comment-id');
  if (!commentId) return;
  const comment = recruitmentCandidateComments.find(c => c.id == commentId);
  if (!comment || !comment.canEdit) return;
  recruitmentEditingCommentId = comment.id;
  const textarea = document.getElementById('commentText');
  if (textarea) {
    textarea.value = comment.text || '';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
  updateCommentSubmitLabel();
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

  const profileTabBtn = document.getElementById('tabProfile');
  if (profileTabBtn) profileTabBtn.onclick = () => showPanel('profile');
  document.getElementById('tabPortal').onclick = () => showPanel('portal');
  document.getElementById('tabManage').onclick = () => showPanel('manage');
  const recruitmentTab = document.getElementById('tabRecruitment');
  if (recruitmentTab) recruitmentTab.onclick = () => showPanel('recruitment');
  const managerTab = document.getElementById('tabManagerApps');
  if (managerTab) managerTab.onclick = () => showPanel('managerApps');
  const reportTab = document.getElementById('tabLeaveReport');
  if (reportTab) reportTab.onclick = () => showPanel('leaveReport');
  const settingsTab = document.getElementById('tabSettings');
  if (settingsTab) settingsTab.onclick = () => showPanel('settings');
  const defaultPanel = currentUser && currentUser.role !== 'manager' ? 'profile' : 'portal';
  showPanel(defaultPanel);

  document.getElementById('empTableBody').addEventListener('click', onEmpTableClick);

  const emailForm = document.getElementById('emailSettingsForm');
  if (emailForm) emailForm.addEventListener('submit', onEmailSettingsSubmit);
  const emailProviderSelect = document.getElementById('emailProvider');
  if (emailProviderSelect) {
    emailProviderSelect.addEventListener('change', onEmailProviderChange);
  }
  const emailEnabledToggle = document.getElementById('emailEnabled');
  if (emailEnabledToggle) {
    emailEnabledToggle.addEventListener('change', () => {
      updateEmailSettingsFormState();
      const message = emailEnabledToggle.checked
        ? 'Email notifications will be enabled after you save.'
        : 'Email notifications will be disabled after you save.';
      setEmailSettingsStatus(message);
    });
  }
  const emailPasswordInput = document.getElementById('emailPassword');
  if (emailPasswordInput) {
    emailPasswordInput.addEventListener('input', () => {
      emailPasswordInput.dataset.dirty = 'true';
      const help = document.getElementById('emailPasswordHelp');
      if (help) {
        help.textContent = emailPasswordInput.value
          ? 'Password will be updated when you save.'
          : emailSettingsHasPassword
            ? 'Password is hidden. Enter a new value to update it.'
            : 'Provide the SMTP account password.';
      }
    });
  }
  ['emailHost', 'emailPort'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', () => {
        rememberCustomEmailSettings();
      });
    }
  });
  const emailSecureCheckbox = document.getElementById('emailSecure');
  if (emailSecureCheckbox) {
    emailSecureCheckbox.addEventListener('change', () => {
      rememberCustomEmailSettings();
    });
  }

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
  const leaveCsvBtn = document.getElementById('leaveCsvUploadBtn');
  const leaveCsvInput = document.getElementById('leaveCsvInput');
  if (leaveCsvBtn && leaveCsvInput) {
    leaveCsvBtn.onclick = () => leaveCsvInput.click();
    leaveCsvInput.onchange = async ev => {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const res = await apiFetch('/applications/bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'text/csv' },
          body: text
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || 'Failed to import leave data.');
        }
        const added = Number(data.added || 0);
        const skipped = Number(data.skipped || 0);
        const errors = Array.isArray(data.errors) ? data.errors : [];
        let message = `Imported ${added} leave record${added === 1 ? '' : 's'}.`;
        if (skipped) {
          message += ` Skipped ${skipped} row${skipped === 1 ? '' : 's'}.`;
        }
        if (errors.length) {
          message += `\n\nIssues:\n- ${errors.join('\n- ')}`;
        }
        alert(message);
        await onEmployeeChange();
        if (currentUser?.role === 'manager') {
          await loadLeaveReport();
          await loadLeaveCalendar();
        }
      } catch (err) {
        console.error('Leave CSV import failed', err);
        alert(err.message || 'Failed to import leave data.');
      } finally {
        ev.target.value = '';
      }
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
  const holidayForm = document.getElementById('holidayForm');
  if (holidayForm) {
    holidayForm.addEventListener('submit', onHolidaySubmit);
  }
  const holidayList = document.getElementById('holidayList');
  if (holidayList) {
    holidayList.addEventListener('click', onHolidayListClick);
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

  fetchHolidays().then(() => {
    renderHolidayHighlights();
  }).catch(err => {
    console.error('Failed to fetch holidays', err);
    renderHolidayHighlights({ error: 'Unable to load holidays.' });
  });

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
function makeDynamicFieldId(prefix, key) {
  const safeKey = String(key ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const suffix = safeKey.replace(/^-+|-+$/g, '') || Math.random().toString(36).slice(2, 8);
  return `${prefix}-${suffix}`;
}

function buildDynamicFieldsHtml(fields = [], initial = {}, prefix = 'field') {
  return fields.map(field => {
    const fieldId = makeDynamicFieldId(prefix, field.key);
    const rawValue = initial[field.key];
    const value = rawValue === null || typeof rawValue === 'undefined' ? '' : rawValue;
    const requiredAttr = field.required ? 'required' : '';
    if (field.type === 'select') {
      const options = Array.isArray(field.options) ? field.options : [];
      const optionsMarkup = options.map(opt => {
        const optionValue = opt === null || typeof opt === 'undefined' ? '' : String(opt);
        const selected = String(value) === optionValue ? 'selected' : '';
        return `<option value="${escapeHtml(optionValue)}" ${selected}>${escapeHtml(optionValue)}</option>`;
      }).join('');
      return `
        <div class="md-field">
          <label class="md-label" for="${fieldId}">${escapeHtml(field.label || field.key)}</label>
          <div class="md-input-wrapper">
            <select name="${field.key}" id="${fieldId}" class="md-select" ${requiredAttr}>
              ${optionsMarkup}
            </select>
          </div>
        </div>
      `;
    }
    const inputType = field.type && field.type !== 'select' ? field.type : 'text';
    return `
      <div class="md-field">
        <label class="md-label" for="${fieldId}">${escapeHtml(field.label || field.key)}</label>
        <div class="md-input-wrapper">
          <input name="${field.key}" id="${fieldId}" class="md-input" type="${escapeHtml(inputType)}" value="${escapeHtml(String(value))}" ${requiredAttr}>
        </div>
      </div>
    `;
  }).join('');
}

function buildEmployeePayload(formEl, fields = []) {
  const formData = new FormData(formEl);
  const data = {};
  formData.forEach((value, key) => {
    if (typeof key === 'string' && key.startsWith('_')) {
      return;
    }
    if (typeof value === 'string') {
      data[key] = value.trim();
    } else {
      data[key] = value;
    }
  });
  const payload = { ...data };
  let leaveKeys = Array.isArray(fields)
    ? fields.filter(field => field && field.isLeaveBalance).map(field => field.key)
    : [];
  if (!leaveKeys.length) {
    leaveKeys = ['annual', 'casual', 'medical'].filter(key => Object.prototype.hasOwnProperty.call(payload, key));
  }
  if (leaveKeys.length) {
    payload.leaveBalances = {};
    leaveKeys.forEach(key => {
      const raw = data[key];
      const num = Number(raw === '' || typeof raw === 'undefined' ? 0 : raw);
      payload.leaveBalances[key] = Number.isNaN(num) ? 0 : num;
      delete payload[key];
    });
  }
  return payload;
}

function openEmpDrawer({title, fields = [], initial = {}}) {
  drawerEditId = initial.id || null;
  currentDrawerFields = Array.isArray(fields) ? fields : [];
  document.getElementById('drawerTitle').textContent = title;
  const fieldHtml = buildDynamicFieldsHtml(currentDrawerFields, initial, 'drawer');
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
  const form = ev.target;
  const payload = buildEmployeePayload(form, currentDrawerFields);
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
      leaveFields.push({key:k,label:k.charAt(0).toUpperCase()+k.slice(1)+' Leave',type:'number',required:false,isLeaveBalance:true});
    });
  }
  const requiredFields = ['name', 'title', 'country/city'];
  let normalFields = Object.keys(sample)
    .filter(k => k !== 'id' && k !== 'leaveBalances' && !(typeof k === 'string' && k.startsWith('_')))
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
  let holidaysForCalendar = [];
  try {
    holidaysForCalendar = await fetchHolidays();
  } catch (err) {
    console.error('Failed to fetch holidays for calendar', err);
    holidaysForCalendar = Array.isArray(companyHolidays) ? companyHolidays : [];
  }
  const holidayMap = {};
  (Array.isArray(holidaysForCalendar) ? holidaysForCalendar : []).forEach(holiday => {
    if (!holiday || !holiday.date) return;
    const iso = String(holiday.date);
    if (!holidayMap[iso]) holidayMap[iso] = [];
    holidayMap[iso].push(holiday);
  });
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
    const holidayEntries = holidayMap[dateStr] || [];
    const future  = dayRef > today;
    const isToday = dayRef.getTime() === today.getTime();
    const classes = [];
    if ([1,2,3,4,5].includes(date.getDay())) {
      classes.push('weekday');
    }
    if (future) classes.push('future');
    if (isToday) classes.push('calendar-today');
    const contentParts = [`<div class="calendar-date">${d}</div>`];
    const titleParts = [];
    if (holidayEntries.length) {
      classes.push('calendar-holiday');
      const holidayNames = Array.from(new Set(holidayEntries.map(h => {
        const name = h?.name ? String(h.name).trim() : '';
        return name || 'Holiday';
      })));
      if (!holidayNames.length) holidayNames.push('Holiday');
      holidayNames.forEach(name => titleParts.push(`Holiday - ${name}`));
      const labelText = holidayNames.join(', ');
      const safeLabel = escapeHtml(labelText);
      contentParts.push(`<div class="calendar-holiday-label"><span class="material-symbols-rounded">celebration</span><span>${safeLabel}</span></div>`);
    }
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
      contentParts.push(`<div class="calendar-names">${namesMarkup}</div>`);
    }
    const title = titleParts.join('\n');
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
    grid.innerHTML += `<div${classAttr}${titleAttr}>${contentParts.join('')}</div>`;
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
