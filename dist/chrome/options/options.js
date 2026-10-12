/**
 * options/options.js  (v2 — profile-aware)
 */

'use strict';

const $ = id => document.getElementById(id);

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function valuePreview(rule) {
  if (rule.type === 'checkbox') return rule.value ? '✓ checked' : '✗ unchecked';
  const v = String(rule.value);
  return v.length > 24 ? v.slice(0, 22) + '…' : v;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

async function renderAll() {
  const all = await getAllRules();
  const container = $('all-patterns');
  const emptyGlobal = $('empty-global');
  container.innerHTML = '';

  const patterns = Object.keys(all);
  if (patterns.length === 0) {
    emptyGlobal.classList.remove('hidden');
    return;
  }
  emptyGlobal.classList.add('hidden');

  for (const pattern of patterns) {
    const data = all[pattern];
    container.appendChild(buildPatternCard(pattern, data.profiles || []));
  }
}

function buildPatternCard(pattern, profiles) {
  const card = document.createElement('div');
  card.className = 'pattern-card';
  card.dataset.pattern = pattern;

  // Pattern header
  const header = document.createElement('div');
  header.className = 'pattern-header';

  const urlSpan = document.createElement('span');
  urlSpan.className = 'pattern-url';
  urlSpan.title = pattern;
  urlSpan.textContent = pattern;

  const patActions = document.createElement('div');
  patActions.className = 'pattern-actions';

  const addProfileBtn = document.createElement('button');
  addProfileBtn.className = 'btn-ghost btn-sm';
  addProfileBtn.textContent = '+ Add Profile';
  addProfileBtn.addEventListener('click', async () => {
    const name = prompt('Profile name:', 'New Profile');
    if (!name) return;
    await addProfile(pattern, name.trim() || 'New Profile');
    await renderAll();
    const card2 = document.querySelector(`.pattern-card[data-pattern="${CSS.escape(pattern)}"]`);
    if (card2) card2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  const deletePatternBtn = document.createElement('button');
  deletePatternBtn.className = 'btn-danger-outline btn-sm';
  deletePatternBtn.textContent = 'Delete pattern';
  deletePatternBtn.addEventListener('click', async () => {
    if (!confirm(`Delete all profiles and rules for "${pattern}"?`)) return;
    await deletePattern(pattern);
    await renderAll();
  });

  patActions.appendChild(addProfileBtn);
  patActions.appendChild(deletePatternBtn);
  header.appendChild(urlSpan);
  header.appendChild(patActions);
  card.appendChild(header);

  if (profiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'profile-empty';
    empty.textContent = 'No profiles yet. Click "+ Add Profile" to create one.';
    card.appendChild(empty);
    return card;
  }

  for (const profile of profiles) {
    card.appendChild(buildProfileSection(pattern, profile));
  }

  return card;
}

function buildProfileSection(pattern, profile) {
  const section = document.createElement('div');
  section.className = 'profile-section';
  section.dataset.profileId = profile.id;

  // Profile header
  const header = document.createElement('div');
  header.className = 'profile-section-header';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'profile-section-name';
  nameSpan.textContent = profile.name;
  nameSpan.title = 'Double-click to rename';
  nameSpan.addEventListener('dblclick', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = profile.name;
    input.style.cssText = 'font-size:13px;font-weight:600;border:1px solid #3b82f6;border-radius:3px;padding:2px 6px;width:160px;';
    nameSpan.replaceWith(input);
    input.focus(); input.select();
    async function commit() {
      const v = input.value.trim() || profile.name;
      await renameProfile(pattern, profile.id, v);
      await renderAll();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { input.value = profile.name; commit(); }
    });
  });

  const profileActions = document.createElement('div');
  profileActions.className = 'profile-section-actions';

  const addRuleBtn = document.createElement('button');
  addRuleBtn.className = 'btn-primary btn-sm';
  addRuleBtn.textContent = '+ Add Rule';
  addRuleBtn.addEventListener('click', () => openModal(pattern, profile.id, null));

  const deleteProfileBtn = document.createElement('button');
  deleteProfileBtn.className = 'btn-danger-outline btn-sm';
  deleteProfileBtn.textContent = 'Delete profile';
  deleteProfileBtn.addEventListener('click', async () => {
    if (!confirm(`Delete profile "${profile.name}" and all its rules?`)) return;
    await deleteProfile(pattern, profile.id);
    await renderAll();
  });

  profileActions.appendChild(addRuleBtn);
  profileActions.appendChild(deleteProfileBtn);
  header.appendChild(nameSpan);
  header.appendChild(profileActions);
  section.appendChild(header);

  // Rules table
  const rules = profile.rules || [];
  if (rules.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'rules-empty';
    empty.textContent = 'No rules yet.';
    section.appendChild(empty);
  } else {
    const table = document.createElement('table');
    table.className = 'rules-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const text of ['Selector', 'Type', 'Value', 'Label', 'On', 'Actions']) {
      const th = document.createElement('th');
      th.textContent = text;
      if (text === 'Actions') th.className = 'col-actions';
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const rule of rules) {
      tbody.appendChild(buildRuleRow(pattern, profile.id, rule));
    }
    table.appendChild(tbody);
    section.appendChild(table);
  }

  return section;
}

function buildRuleRow(pattern, profileId, rule) {
  const tr = document.createElement('tr');
  tr.dataset.id = rule.id;

  const tdSel = document.createElement('td');
  tdSel.className = 'col-selector';
  tdSel.title = rule.selector;
  tdSel.textContent = rule.selector;

  const tdType = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `badge ${rule.type}`;
  badge.textContent = rule.type;
  tdType.appendChild(badge);

  const tdVal = document.createElement('td');
  tdVal.className = 'col-value';
  tdVal.title = String(rule.value);
  tdVal.textContent = valuePreview(rule);

  const tdLabel = document.createElement('td');
  tdLabel.className = 'col-value';
  tdLabel.textContent = rule.label || '—';

  const tdToggle = document.createElement('td');
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'toggle';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.checked = rule.enabled;
  toggleInput.addEventListener('change', async e => {
    await updateRule(pattern, profileId, rule.id, { enabled: e.target.checked });
  });
  const toggleSlider = document.createElement('span');
  toggleSlider.className = 'toggle-slider';
  toggleLabel.appendChild(toggleInput);
  toggleLabel.appendChild(toggleSlider);
  tdToggle.appendChild(toggleLabel);

  const tdActions = document.createElement('td');
  tdActions.className = 'col-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-icon-sm';
  editBtn.title = 'Edit';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', () => openModal(pattern, profileId, rule));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-danger-icon';
  deleteBtn.title = 'Delete';
  deleteBtn.textContent = '✕';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this rule?')) return;
    await deleteRule(pattern, profileId, rule.id);
    await renderAll();
  });

  tdActions.appendChild(editBtn);
  tdActions.appendChild(deleteBtn);

  tr.appendChild(tdSel);
  tr.appendChild(tdType);
  tr.appendChild(tdVal);
  tr.appendChild(tdLabel);
  tr.appendChild(tdToggle);
  tr.appendChild(tdActions);
  return tr;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

let _modalPattern   = '';
let _modalProfileId = '';

function openModal(pattern, profileId, rule) {
  _modalPattern   = pattern;
  _modalProfileId = profileId;
  $('modal-pattern').value   = pattern;
  $('modal-profile-id').value = profileId;
  $('modal-rule-id').value   = rule ? rule.id : '';
  $('modal-title').textContent = rule ? 'Edit Rule' : 'Add Rule';
  $('modal-selector').value  = rule ? rule.selector : '';
  $('modal-type').value      = rule ? rule.type : 'text';
  $('modal-label').value     = rule ? (rule.label || '') : '';
  $('modal-error').classList.add('hidden');
  updateModalValueField(rule ? rule.type : 'text');

  if (rule && rule.type === 'checkbox') {
    $('modal-checkbox-value').checked = rule.value === true || rule.value === 'true';
  } else {
    $('modal-value-text').value = rule ? String(rule.value) : '';
  }
  $('modal-backdrop').classList.remove('hidden');
  $('modal-selector').focus();
}

function closeModal() {
  $('modal-backdrop').classList.add('hidden');
}

function updateModalValueField(type) {
  const isCheckbox = type === 'checkbox';
  $('modal-value-text').classList.toggle('hidden', isCheckbox);
  $('modal-value-checkbox').classList.toggle('hidden', !isCheckbox);
  $('modal-label-value').textContent = isCheckbox ? 'State' : 'Value';
}

async function saveModal() {
  const selector  = $('modal-selector').value.trim();
  const profileId = $('modal-profile-id').value;
  const ruleId    = $('modal-rule-id').value;
  const pattern   = $('modal-pattern').value;

  if (!selector) {
    $('modal-error').textContent = 'CSS Selector is required.';
    $('modal-error').classList.remove('hidden');
    return;
  }

  const type  = $('modal-type').value;
  const value = type === 'checkbox' ? $('modal-checkbox-value').checked : $('modal-value-text').value;
  const label = $('modal-label').value.trim();

  if (ruleId) {
    await updateRule(pattern, profileId, ruleId, { selector, type, value, label });
  } else {
    await addRule(pattern, profileId, { selector, type, value, label });
  }
  closeModal();
  await renderAll();
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

async function exportRules() {
  const all = await getAllRules();
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'autofill-rules.json'; a.click();
  URL.revokeObjectURL(url);
}

async function importRulesFromFile(file) {
  const text = await file.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { alert('Invalid JSON file.'); return; }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    alert('Invalid format — expected a JSON object mapping URL patterns to profile data.');
    return;
  }
  const merge = confirm(
    'Import mode:\n\n• OK = Merge with existing rules\n• Cancel = Replace all existing rules'
  );
  if (merge) {
    const existing = await getAllRules();
    for (const [pattern, data] of Object.entries(parsed)) {
      if (!existing[pattern]) { existing[pattern] = data; continue; }
      // Merge profiles by name
      const existingProfiles = existing[pattern].profiles || [];
      for (const incomingProfile of (data.profiles || [])) {
        const match = existingProfiles.find(p => p.name === incomingProfile.name);
        if (match) {
          match.rules.push(...(incomingProfile.rules || []));
        } else {
          existingProfiles.push(incomingProfile);
        }
      }
      existing[pattern].profiles = existingProfiles;
    }
    await saveRules(existing);
  } else {
    await importRules(parsed);
  }
  await renderAll();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  await renderAll();

  $('btn-add-pattern').addEventListener('click', async () => {
    const pattern = $('new-pattern-input').value.trim();
    if (!pattern) return;
    await ensurePattern(pattern);
    $('new-pattern-input').value = '';
    await renderAll();
    const card = document.querySelector(`.pattern-card[data-pattern="${CSS.escape(pattern)}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('new-pattern-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-add-pattern').click();
  });

  $('btn-export').addEventListener('click', exportRules);

  $('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (file) await importRulesFromFile(file);
    e.target.value = '';
  });

  $('modal-type').addEventListener('change', e => updateModalValueField(e.target.value));
  $('modal-save').addEventListener('click', saveModal);
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-backdrop').addEventListener('click', e => { if (e.target === $('modal-backdrop')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

document.addEventListener('DOMContentLoaded', init);
