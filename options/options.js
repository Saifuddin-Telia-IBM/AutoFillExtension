/**
 * options/options.js
 *
 * Full-page rule manager for AutoFill extension.
 * shared/storage.js is loaded before this file via options.html.
 */

'use strict';

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    const rules = all[pattern];
    container.appendChild(buildPatternCard(pattern, rules));
  }
}

function buildPatternCard(pattern, rules) {
  const card = document.createElement('div');
  card.className = 'pattern-card';
  card.dataset.pattern = pattern;

  // Header
  const header = document.createElement('div');
  header.className = 'pattern-header';

  const patternUrlSpan = document.createElement('span');
  patternUrlSpan.className = 'pattern-url';
  patternUrlSpan.title = pattern;
  patternUrlSpan.textContent = pattern;

  const patternActions = document.createElement('div');
  patternActions.className = 'pattern-actions';

  const deletePatternBtn = document.createElement('button');
  deletePatternBtn.className = 'btn-danger-outline btn-sm btn-delete-pattern';
  deletePatternBtn.textContent = 'Delete pattern';
  deletePatternBtn.addEventListener('click', async () => {
    if (!confirm(`Delete all rules for "${pattern}"?`)) return;
    await deletePattern(pattern);
    await renderAll();
  });

  patternActions.appendChild(deletePatternBtn);
  header.appendChild(patternUrlSpan);
  header.appendChild(patternActions);

  // Rules table
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
  table.appendChild(tbody);

  for (const rule of rules) {
    tbody.appendChild(buildRuleRow(pattern, rule));
  }

  // Add rule row
  const addRow = document.createElement('div');
  addRow.className = 'add-rule-row';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-primary btn-sm';
  addBtn.textContent = '+ Add Rule';
  addBtn.addEventListener('click', () => openModal(pattern, null));
  addRow.appendChild(addBtn);

  card.appendChild(header);
  card.appendChild(table);
  card.appendChild(addRow);
  return card;
}

function buildRuleRow(pattern, rule) {
  const tr = document.createElement('tr');
  tr.dataset.id = rule.id;

  // Selector cell
  const tdSel = document.createElement('td');
  tdSel.className = 'col-selector';
  tdSel.title = rule.selector;
  tdSel.textContent = rule.selector;

  // Type badge cell
  const tdType = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `badge ${rule.type}`;
  badge.textContent = rule.type;
  tdType.appendChild(badge);

  // Value cell
  const tdVal = document.createElement('td');
  tdVal.className = 'col-value';
  tdVal.title = String(rule.value);
  tdVal.textContent = valuePreview(rule);

  // Label cell
  const tdLabel = document.createElement('td');
  tdLabel.className = 'col-value';
  tdLabel.textContent = rule.label || '—';

  // Toggle cell
  const tdToggle = document.createElement('td');
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'toggle';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.className = 'rule-toggle';
  toggleInput.checked = rule.enabled;
  toggleInput.addEventListener('change', async e => {
    await updateRule(pattern, rule.id, { enabled: e.target.checked });
  });
  const toggleSlider = document.createElement('span');
  toggleSlider.className = 'toggle-slider';
  toggleLabel.appendChild(toggleInput);
  toggleLabel.appendChild(toggleSlider);
  tdToggle.appendChild(toggleLabel);

  // Actions cell
  const tdActions = document.createElement('td');
  tdActions.className = 'col-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-icon-sm btn-edit-rule';
  editBtn.title = 'Edit';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', () => openModal(pattern, rule));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-danger-icon btn-delete-rule';
  deleteBtn.title = 'Delete';
  deleteBtn.textContent = '✕';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this rule?')) return;
    await deleteRule(pattern, rule.id);
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

function openModal(pattern, rule) {
  $('modal-pattern').value = pattern;
  $('modal-rule-id').value = rule ? rule.id : '';
  $('modal-title').textContent = rule ? 'Edit Rule' : 'Add Rule';
  $('modal-selector').value = rule ? rule.selector : '';
  $('modal-type').value = rule ? rule.type : 'text';
  $('modal-label').value = rule ? (rule.label || '') : '';
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
  const pattern = $('modal-pattern').value;
  const ruleId = $('modal-rule-id').value;
  const selector = $('modal-selector').value.trim();

  if (!selector) {
    $('modal-error').textContent = 'CSS Selector is required.';
    $('modal-error').classList.remove('hidden');
    return;
  }

  const type = $('modal-type').value;
  let value;
  if (type === 'checkbox') {
    value = $('modal-checkbox-value').checked;
  } else {
    value = $('modal-value-text').value;
  }
  const label = $('modal-label').value.trim();

  if (ruleId) {
    await updateRule(pattern, ruleId, { selector, type, value, label });
  } else {
    await addRule(pattern, { selector, type, value, label });
  }

  closeModal();
  await renderAll();
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

async function exportRules() {
  const all = await getAllRules();
  const json = JSON.stringify(all, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'autofill-rules.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importRulesFromFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    alert('Invalid JSON file.');
    return;
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    alert('Invalid rules format — expected a JSON object mapping URL patterns to rule arrays.');
    return;
  }
  const merge = confirm(
    'Import mode:\n\n' +
    '• OK = Merge with existing rules (keeps current rules, adds new patterns)\n' +
    '• Cancel = Replace all existing rules with the imported file'
  );
  if (merge) {
    const existing = await getAllRules();
    for (const [pattern, rules] of Object.entries(parsed)) {
      if (!existing[pattern]) existing[pattern] = [];
      existing[pattern].push(...rules);
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

  // Add pattern
  $('btn-add-pattern').addEventListener('click', async () => {
    const pattern = $('new-pattern-input').value.trim();
    if (!pattern) return;
    const all = await getAllRules();
    if (!all[pattern]) {
      all[pattern] = [];
      await saveRules(all);
    }
    $('new-pattern-input').value = '';
    await renderAll();
    // Scroll to the new pattern card
    const card = document.querySelector(`.pattern-card[data-pattern="${CSS.escape(pattern)}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('new-pattern-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-add-pattern').click();
  });

  // Export
  $('btn-export').addEventListener('click', exportRules);

  // Import
  $('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (file) await importRulesFromFile(file);
    e.target.value = ''; // reset so same file can be re-imported
  });

  // Modal
  $('modal-type').addEventListener('change', e => updateModalValueField(e.target.value));
  $('modal-save').addEventListener('click', saveModal);
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-backdrop').addEventListener('click', e => {
    if (e.target === $('modal-backdrop')) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

document.addEventListener('DOMContentLoaded', init);
