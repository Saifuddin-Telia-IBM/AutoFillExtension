/**
 * popup/popup.js  (v2)
 *
 * Profile-aware popup. For each URL pattern that matches the current page:
 *   - Lists all profiles
 *   - Each profile has a "Fill now" button (sends FILL_PROFILE to content script)
 *   - Each profile shows its rules (toggle, edit, delete)
 *   - "Add rule" per profile
 *   - "New Profile" creates a new named profile
 *   - Rename / delete profiles
 */

'use strict';

const $ = id => document.getElementById(id);

let currentUrl    = '';
// Patterns added in this popup session (shown even if still empty / not matching)
const pinnedPatterns = new Set();
// Pattern that the inline "new profile" form will add to
let newProfilePattern = '';

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function valuePreview(rule) {
  if (rule.type === 'checkbox') return rule.value ? '✓ checked' : '✗ unchecked';
  const v = String(rule.value);
  return v.length > 18 ? v.slice(0, 16) + '…' : v;
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/** Send a message to the content script on the active tab. */
async function sendToPage(msg) {
  const tab = await getActiveTab();
  if (!tab) return;
  try {
    await browser.tabs.sendMessage(tab.id, msg);
  } catch {
    // content script may not be loaded on extension/about pages — ignore
  }
}

// -------------------------------------------------------------------------
// Render every pattern in the current page's group, each with its profiles
// -------------------------------------------------------------------------

async function renderProfiles() {
  const container = $('profiles-list');
  const emptyState = $('empty-state');
  container.innerHTML = '';

  const all = await getAllRules();
  const keys = new Set(await getMatchingPatterns(currentUrl));
  for (const p of pinnedPatterns) if (all[p]) keys.add(p);

  // Exact match for the current page first, then the rest in stored order
  const ordered = [...keys].sort((a, b) => (b === currentUrl) - (a === currentUrl));

  if (ordered.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  for (const pattern of ordered) {
    container.appendChild(buildPatternGroup(pattern, all[pattern].profiles || []));
  }
}

function buildPatternGroup(pattern, profiles) {
  const group = document.createElement('div');
  group.className = 'pattern-group';

  const header = document.createElement('div');
  header.className = 'pattern-group-header';

  const urlSpan = document.createElement('span');
  urlSpan.className = 'url-text';
  urlSpan.textContent = pattern;
  urlSpan.title = pattern;

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-small btn-primary';
  addBtn.textContent = '+ Profile';
  addBtn.title = 'Add a profile to this URL';
  addBtn.addEventListener('click', () => {
    newProfilePattern = pattern;
    $('new-profile-form').classList.remove('hidden');
    $('new-profile-name').focus();
  });

  header.appendChild(urlSpan);
  header.appendChild(addBtn);
  group.appendChild(header);

  if (profiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pattern-group-empty';
    empty.textContent = 'No profiles yet.';
    group.appendChild(empty);
  }
  for (const profile of profiles) {
    group.appendChild(buildProfileBlock(pattern, profile));
  }
  return group;
}

function buildProfileBlock(pattern, profile) {
  const block = document.createElement('div');
  block.className = 'profile-block';
  block.dataset.profileId = profile.id;

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'profile-header';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'profile-name';
  nameSpan.textContent = profile.name;
  // Double-click to rename
  nameSpan.title = 'Double-click or use ✎ to rename';
  nameSpan.addEventListener('dblclick', () => startRename(pattern, nameSpan, profile));

  const actions = document.createElement('div');
  actions.className = 'profile-actions';

  // Rename profile button
  const renameBtn = document.createElement('button');
  renameBtn.className = 'btn-rename-profile';
  renameBtn.title = 'Rename this profile';
  renameBtn.textContent = '✎';
  renameBtn.addEventListener('click', () => startRename(pattern, nameSpan, profile));

  // Fill Now button
  const fillBtn = document.createElement('button');
  fillBtn.className = 'btn-fill';
  fillBtn.textContent = '▶ Fill Now';
  fillBtn.title = 'Fill this profile\'s fields in the current page without reloading';
  fillBtn.addEventListener('click', async () => {
    await sendToPage({ type: 'FILL_PROFILE', profileId: profile.id });
    fillBtn.textContent = '✓ Filled';
    fillBtn.disabled = true;
    setTimeout(() => { fillBtn.textContent = '▶ Fill Now'; fillBtn.disabled = false; }, 2000);
  });

  // Delete profile button
  const deleteProfileBtn = document.createElement('button');
  deleteProfileBtn.className = 'btn-delete-profile';
  deleteProfileBtn.title = 'Delete this profile';
  deleteProfileBtn.textContent = '✕';
  deleteProfileBtn.addEventListener('click', async () => {
    if (!confirm(`Delete profile "${profile.name}"?`)) return;
    await deleteProfile(pattern, profile.id);
    await renderProfiles();
  });

  actions.appendChild(renameBtn);
  actions.appendChild(fillBtn);
  actions.appendChild(deleteProfileBtn);
  header.appendChild(nameSpan);
  header.appendChild(actions);
  block.appendChild(header);

  // --- Rules list ---
  const rulesDiv = document.createElement('div');
  rulesDiv.className = 'profile-rules';

  for (const rule of (profile.rules || [])) {
    rulesDiv.appendChild(buildRuleItem(pattern, profile, rule));
  }

  // Add Rule button
  const addRow = document.createElement('div');
  addRow.className = 'add-rule-row';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-small btn-primary';
  addBtn.textContent = '+ Add Rule';
  addBtn.addEventListener('click', () => openRuleForm(pattern, profile.id, null));
  addRow.appendChild(addBtn);
  rulesDiv.appendChild(addRow);

  block.appendChild(rulesDiv);
  return block;
}

function buildRuleItem(pattern, profile, rule) {
  const item = document.createElement('div');
  item.className = 'rule-item';
  item.dataset.ruleId = rule.id;

  const info = document.createElement('div');
  info.className = 'rule-info';

  const selectorDiv = document.createElement('div');
  selectorDiv.className = 'rule-selector';
  selectorDiv.title = rule.selector;
  selectorDiv.textContent = rule.selector;

  const meta = document.createElement('div');
  meta.className = 'rule-meta';

  const badge = document.createElement('span');
  badge.className = `badge ${rule.type}`;
  badge.textContent = rule.type;

  const valSpan = document.createElement('span');
  valSpan.className = 'rule-value';
  valSpan.title = String(rule.value);
  valSpan.textContent = valuePreview(rule);

  meta.appendChild(badge);
  meta.appendChild(valSpan);

  if (rule.label) {
    const lbl = document.createElement('span');
    lbl.className = 'rule-label';
    lbl.style.cssText = 'font-size:10px;color:#9ca3af;';
    lbl.textContent = rule.label;
    meta.appendChild(lbl);
  }

  info.appendChild(selectorDiv);
  info.appendChild(meta);

  // Actions
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'rule-actions';

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'toggle';
  toggleLabel.title = rule.enabled ? 'Enabled' : 'Disabled';

  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.checked = rule.enabled;
  toggleInput.addEventListener('change', async e => {
    await updateRule(pattern, profile.id, rule.id, { enabled: e.target.checked });
  });

  const toggleSlider = document.createElement('span');
  toggleSlider.className = 'toggle-slider';
  toggleLabel.appendChild(toggleInput);
  toggleLabel.appendChild(toggleSlider);

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-edit';
  editBtn.title = 'Edit';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', () => openRuleForm(pattern, profile.id, rule));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-danger';
  deleteBtn.title = 'Delete';
  deleteBtn.textContent = '✕';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this rule?')) return;
    await deleteRule(pattern, profile.id, rule.id);
    await renderProfiles();
  });

  actionsDiv.appendChild(toggleLabel);
  actionsDiv.appendChild(editBtn);
  actionsDiv.appendChild(deleteBtn);

  item.appendChild(info);
  item.appendChild(actionsDiv);
  return item;
}

// -------------------------------------------------------------------------
// Inline rename of profile name
// -------------------------------------------------------------------------

function startRename(pattern, nameSpan, profile) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = profile.name;
  input.style.cssText = 'font-size:12px;font-weight:600;color:#1e3a5f;border:1px solid #3b82f6;border-radius:3px;padding:1px 4px;width:120px;';
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  async function commit() {
    const newName = input.value.trim() || profile.name;
    await renameProfile(pattern, profile.id, newName);
    await renderProfiles();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { input.value = profile.name; commit(); }
  });
}

// -------------------------------------------------------------------------
// Rule form (add / edit)
// -------------------------------------------------------------------------

function updateValueField(type) {
  const isCheckbox = type === 'checkbox';
  $('field-value-text').classList.toggle('hidden', isCheckbox);
  $('field-value-checkbox').classList.toggle('hidden', !isCheckbox);
  $('label-value').textContent = isCheckbox ? 'State' : 'Value';
}

function openRuleForm(pattern, profileId, rule) {
  $('form-title').textContent = rule ? 'Edit Rule' : 'Add Rule';
  $('edit-pattern').value    = pattern;
  $('edit-rule-id').value   = rule ? rule.id : '';
  $('edit-profile-id').value = profileId;
  $('field-selector').value  = rule ? rule.selector : '';
  $('field-type').value      = rule ? rule.type : 'text';
  $('field-label').value     = rule ? (rule.label || '') : '';
  $('form-error').classList.add('hidden');
  updateValueField(rule ? rule.type : 'text');

  if (rule && rule.type === 'checkbox') {
    $('checkbox-value').checked = rule.value === true || rule.value === 'true';
  } else {
    $('field-value-text').value = rule ? String(rule.value) : '';
  }

  $('rule-form').classList.remove('hidden');
  $('field-selector').focus();
  // Scroll form into view
  $('rule-form').scrollIntoView({ block: 'nearest' });
}

function closeRuleForm() {
  $('rule-form').classList.add('hidden');
}

async function saveRuleForm() {
  const selector = $('field-selector').value.trim();
  if (!selector) {
    $('form-error').textContent = 'CSS Selector is required.';
    $('form-error').classList.remove('hidden');
    return;
  }
  const type = $('field-type').value;
  const value = type === 'checkbox' ? $('checkbox-value').checked : $('field-value-text').value;
  const label = $('field-label').value.trim();
  const ruleId = $('edit-rule-id').value;
  const profileId = $('edit-profile-id').value;
  const pattern = $('edit-pattern').value;

  if (ruleId) {
    await updateRule(pattern, profileId, ruleId, { selector, type, value, label });
  } else {
    await addRule(pattern, profileId, { selector, type, value, label });
  }
  closeRuleForm();
  await renderProfiles();
}

// -------------------------------------------------------------------------
// Pattern management
// -------------------------------------------------------------------------

function showPatternForm(prefill = '') {
  $('pattern-form').classList.remove('hidden');
  $('profiles-section').classList.add('hidden');
  $('rule-form').classList.add('hidden');
  $('pattern-bar').classList.add('hidden');
  $('pattern-input').value = prefill;
}

async function showProfilesSection() {
  $('pattern-form').classList.add('hidden');
  $('profiles-section').classList.remove('hidden');
  $('pattern-bar').classList.remove('hidden');
  $('active-pattern').textContent = baseUrlOf(currentUrl);
  await renderProfiles();
}

// -------------------------------------------------------------------------
// Boot
// -------------------------------------------------------------------------

async function init() {
  const tab = await getActiveTab();
  currentUrl = tab ? tab.url : '';
  $('current-url').textContent = currentUrl;
  $('current-url').title = currentUrl;

  const matching = await getMatchingPatterns(currentUrl);

  if (matching.length > 0) {
    await showProfilesSection();
  } else {
    showPatternForm(currentUrl);
  }

  // Pattern form: save
  $('btn-save-pattern').addEventListener('click', async () => {
    const pattern = $('pattern-input').value.trim();
    if (!pattern) return;
    await ensurePattern(pattern);
    pinnedPatterns.add(pattern);
    await showProfilesSection();
  });
  $('pattern-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-save-pattern').click();
  });

  // Add another URL pattern to this site's group
  $('btn-change-pattern').addEventListener('click', () => showPatternForm(currentUrl));

  // New profile (target pattern is set by the per-URL "+ Profile" button)
  $('btn-save-new-profile').addEventListener('click', async () => {
    const name = $('new-profile-name').value.trim() || 'New Profile';
    await addProfile(newProfilePattern, name);
    $('new-profile-name').value = '';
    $('new-profile-form').classList.add('hidden');
    await renderProfiles();
  });
  $('btn-cancel-new-profile').addEventListener('click', () => {
    $('new-profile-name').value = '';
    $('new-profile-form').classList.add('hidden');
  });
  $('new-profile-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-save-new-profile').click();
    if (e.key === 'Escape') $('btn-cancel-new-profile').click();
  });

  // Rule form
  $('field-type').addEventListener('change', e => updateValueField(e.target.value));
  $('btn-save-rule').addEventListener('click', saveRuleForm);
  $('btn-cancel-rule').addEventListener('click', closeRuleForm);

  // Options page
  $('link-options').addEventListener('click', e => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });
}

document.addEventListener('DOMContentLoaded', init);
