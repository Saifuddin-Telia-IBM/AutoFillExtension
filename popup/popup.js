/**
 * popup/popup.js
 *
 * Manages the popup UI: lists rules for the current page,
 * and allows add / edit / toggle / delete.
 *
 * shared/storage.js is loaded before this file via popup.html <script> tags,
 * so all storage functions are globally available.
 */

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentUrl = '';
let activePattern = '';  // the URL pattern key currently being managed

// ---------------------------------------------------------------------------
// DOM references (resolved after DOMContentLoaded)
// ---------------------------------------------------------------------------

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function valuePreview(rule) {
  if (rule.type === 'checkbox') return rule.value ? '✓ checked' : '✗ unchecked';
  const v = String(rule.value);
  return v.length > 18 ? v.slice(0, 16) + '…' : v;
}

function renderRules(rules) {
  const list = $('rules-list');
  const empty = $('empty-state');
  list.innerHTML = '';

  if (rules.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const rule of rules) {
    const li = document.createElement('li');
    li.className = 'rule-item';
    li.dataset.id = rule.id;

    // Left: rule info
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

    const valueSpan = document.createElement('span');
    valueSpan.className = 'rule-value';
    valueSpan.title = String(rule.value);
    valueSpan.textContent = valuePreview(rule);

    meta.appendChild(badge);
    meta.appendChild(valueSpan);

    if (rule.label) {
      const labelSpan = document.createElement('span');
      labelSpan.className = 'rule-label';
      labelSpan.textContent = rule.label;
      meta.appendChild(labelSpan);
    }

    info.appendChild(selectorDiv);
    info.appendChild(meta);

    // Right: actions
    const actions = document.createElement('div');
    actions.className = 'rule-actions';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle';
    toggleLabel.title = rule.enabled ? 'Enabled' : 'Disabled';

    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.className = 'rule-toggle';
    toggleInput.checked = rule.enabled;
    toggleInput.addEventListener('change', async e => {
      await updateRule(activePattern, rule.id, { enabled: e.target.checked });
    });

    const toggleSlider = document.createElement('span');
    toggleSlider.className = 'toggle-slider';

    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleSlider);

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit rule-edit';
    editBtn.title = 'Edit';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => openEditForm(rule));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger rule-delete';
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Delete this rule?')) return;
      await deleteRule(activePattern, rule.id);
      await refreshRules();
    });

    actions.appendChild(toggleLabel);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(info);
    li.appendChild(actions);
    list.appendChild(li);
  }
}

// Escape HTML entities
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Refresh (reload rules from storage and re-render)
// ---------------------------------------------------------------------------

async function refreshRules() {
  if (!activePattern) return;
  const rules = await getRulesForPattern(activePattern);
  renderRules(rules);
}

// ---------------------------------------------------------------------------
// Pattern management
// ---------------------------------------------------------------------------

function showPatternForm(prefill = '') {
  $('pattern-form').classList.remove('hidden');
  $('rules-section').classList.add('hidden');
  $('rule-form').classList.add('hidden');
  $('pattern-input').value = prefill;
  $('active-pattern').textContent = '';
  $('pattern-bar').classList.add('hidden');
}

function showRulesSection(pattern) {
  activePattern = pattern;
  $('pattern-form').classList.add('hidden');
  $('rules-section').classList.remove('hidden');
  $('pattern-bar').classList.remove('hidden');
  $('active-pattern').textContent = pattern;
}

// ---------------------------------------------------------------------------
// Rule form
// ---------------------------------------------------------------------------

function openAddForm() {
  $('form-title').textContent = 'Add Rule';
  $('edit-rule-id').value = '';
  $('field-selector').value = '';
  $('field-type').value = 'text';
  $('field-value-text').value = '';
  $('checkbox-value').checked = false;
  $('field-label').value = '';
  $('form-error').classList.add('hidden');
  updateValueField('text');
  $('rule-form').classList.remove('hidden');
  $('field-selector').focus();
}

function openEditForm(rule) {
  $('form-title').textContent = 'Edit Rule';
  $('edit-rule-id').value = rule.id;
  $('field-selector').value = rule.selector;
  $('field-type').value = rule.type;
  $('field-label').value = rule.label || '';
  $('form-error').classList.add('hidden');
  updateValueField(rule.type);

  if (rule.type === 'checkbox') {
    $('checkbox-value').checked = rule.value === true || rule.value === 'true';
  } else {
    $('field-value-text').value = String(rule.value);
  }
  $('rule-form').classList.remove('hidden');
  $('field-selector').focus();
}

function closeForm() {
  $('rule-form').classList.add('hidden');
}

function updateValueField(type) {
  const isCheckbox = type === 'checkbox';
  $('field-value-text').classList.toggle('hidden', isCheckbox);
  $('field-value-checkbox').classList.toggle('hidden', !isCheckbox);
  $('label-value').textContent = isCheckbox ? 'State' : 'Value';
}

async function saveRuleForm() {
  const selector = $('field-selector').value.trim();
  if (!selector) {
    showFormError('CSS Selector is required.');
    return;
  }

  const type = $('field-type').value;
  let value;
  if (type === 'checkbox') {
    value = $('checkbox-value').checked;
  } else {
    value = $('field-value-text').value;
  }

  const label = $('field-label').value.trim();
  const editId = $('edit-rule-id').value;

  if (editId) {
    await updateRule(activePattern, editId, { selector, type, value, label });
  } else {
    await addRule(activePattern, { selector, type, value, label });
  }

  closeForm();
  await refreshRules();
}

function showFormError(msg) {
  const el = $('form-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  // Get the current tab URL
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentUrl = tab ? tab.url : '';

  $('current-url').textContent = currentUrl;
  $('current-url').title = currentUrl;

  // Check if there's already a pattern that matches this URL
  const matchingPatterns = await getMatchingPatterns(currentUrl);

  if (matchingPatterns.length > 0) {
    // Use the first (most specific) match
    showRulesSection(matchingPatterns[0]);
    await refreshRules();
  } else {
    // Offer to create a new pattern defaulting to the current URL
    showPatternForm(currentUrl);
  }

  // Wire up pattern form
  $('btn-save-pattern').addEventListener('click', async () => {
    const pattern = $('pattern-input').value.trim();
    if (!pattern) return;
    // Ensure the key exists in storage (even with empty array)
    const all = await getAllRules();
    if (!all[pattern]) {
      all[pattern] = [];
      await saveRules(all);
    }
    showRulesSection(pattern);
    await refreshRules();
  });

  // Change pattern
  $('btn-change-pattern').addEventListener('click', () => {
    showPatternForm(activePattern);
  });

  // Add rule
  $('btn-add-rule').addEventListener('click', openAddForm);

  // Form type change → update value field
  $('field-type').addEventListener('change', e => updateValueField(e.target.value));

  // Form save
  $('btn-save-rule').addEventListener('click', saveRuleForm);

  // Form cancel
  $('btn-cancel-rule').addEventListener('click', closeForm);

  // Options page link
  $('link-options').addEventListener('click', e => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });
}

document.addEventListener('DOMContentLoaded', init);
