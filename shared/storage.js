/**
 * shared/storage.js  (v2 — profile-aware)
 *
 * Data shape stored under key "autofillRules":
 * {
 *   "<urlPattern>": {
 *     "profiles": [
 *       {
 *         "id": "uuid",
 *         "name": "Profile name",
 *         "rules": [ { id, enabled, selector, type, value, label? }, ... ]
 *       },
 *       ...
 *     ]
 *   },
 *   ...
 * }
 *
 * On first load, any legacy flat-array format is silently migrated to the
 * new shape by wrapping the array into a single profile named "Default".
 */

'use strict';

const STORAGE_KEY = 'autofillRules';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function stripHash(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function patternMatches(urlPattern, url) {
  const cleanUrl = stripHash(url);
  if (urlPattern === cleanUrl) return true;
  if (urlPattern.endsWith('*')) {
    if (cleanUrl.startsWith(urlPattern.slice(0, -1))) return true;
  }
  try {
    const base = urlPattern.endsWith('*') ? urlPattern.slice(0, -1) : urlPattern;
    const patUrl = new URL(base);
    const pageUrl = new URL(cleanUrl);
    if (
      patUrl.hostname === pageUrl.hostname &&
      patUrl.protocol === pageUrl.protocol &&
      (patUrl.pathname === '/' || patUrl.pathname === '')
    ) return true;
  } catch { /* not a valid URL */ }
  return false;
}

/**
 * Migrate a legacy flat-array value to the new profile-based shape.
 * If it already has the new shape, return as-is.
 */
function migratePatternValue(value) {
  if (!value) return { profiles: [] };
  // Already migrated
  if (value.profiles) return value;
  // Legacy: value is an array of rules
  if (Array.isArray(value)) {
    return {
      profiles: [{
        id: generateId(),
        name: 'Default',
        rules: value,
      }],
    };
  }
  return { profiles: [] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Load and migrate the full rules map from storage. */
async function getAllRules() {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY] || {};
  // Migrate any legacy entries in-place
  const migrated = {};
  let needsSave = false;
  for (const [pattern, value] of Object.entries(raw)) {
    const m = migratePatternValue(value);
    migrated[pattern] = m;
    if (m !== value) needsSave = true;
  }
  if (needsSave) await browser.storage.local.set({ [STORAGE_KEY]: migrated });
  return migrated;
}

/** Persist the full rules map. */
async function saveRules(rules) {
  await browser.storage.local.set({ [STORAGE_KEY]: rules });
}

/**
 * Return all profiles (with only their enabled rules) for matching URL patterns.
 * Each returned profile may come from a different pattern (all matches collected).
 * @returns {Promise<Array<{ id, name, rules, patternKey }>>}
 */
async function getProfilesForUrl(url) {
  const all = await getAllRules();
  const result = [];
  for (const [pattern, data] of Object.entries(all)) {
    if (!patternMatches(pattern, url)) continue;
    for (const profile of (data.profiles || [])) {
      const enabledRules = (profile.rules || []).filter(r => r.enabled);
      if (enabledRules.length > 0) {
        result.push({
          id: profile.id,
          name: profile.name,
          rules: enabledRules,
          patternKey: pattern,
        });
      }
    }
  }
  return result;
}

/** Return the raw pattern data (profiles array) for an exact pattern key. */
async function getPatternData(urlPattern) {
  const all = await getAllRules();
  return all[urlPattern] || { profiles: [] };
}

/** Return matching pattern keys for a URL. */
async function getMatchingPatterns(url) {
  const all = await getAllRules();
  return Object.keys(all).filter(p => patternMatches(p, url));
}

// --- Pattern-level ---

/** Ensure a URL pattern key exists in storage. */
async function ensurePattern(urlPattern) {
  const all = await getAllRules();
  if (!all[urlPattern]) {
    all[urlPattern] = { profiles: [] };
    await saveRules(all);
  }
}

/** Delete an entire URL pattern. */
async function deletePattern(urlPattern) {
  const all = await getAllRules();
  delete all[urlPattern];
  await saveRules(all);
}

// --- Profile-level ---

/**
 * Add a new profile under a URL pattern.
 * @returns {Promise<string>} new profile id
 */
async function addProfile(urlPattern, name) {
  const all = await getAllRules();
  if (!all[urlPattern]) all[urlPattern] = { profiles: [] };
  const id = generateId();
  all[urlPattern].profiles.push({ id, name, rules: [] });
  await saveRules(all);
  return id;
}

/** Rename a profile. */
async function renameProfile(urlPattern, profileId, newName) {
  const all = await getAllRules();
  const profile = _findProfile(all, urlPattern, profileId);
  if (profile) profile.name = newName;
  await saveRules(all);
}

/** Delete a profile. */
async function deleteProfile(urlPattern, profileId) {
  const all = await getAllRules();
  if (!all[urlPattern]) return;
  all[urlPattern].profiles = all[urlPattern].profiles.filter(p => p.id !== profileId);
  if (all[urlPattern].profiles.length === 0) delete all[urlPattern];
  await saveRules(all);
}

// --- Rule-level ---

/** Add a rule to a specific profile. @returns {Promise<string>} rule id */
async function addRule(urlPattern, profileId, fieldRule) {
  const all = await getAllRules();
  const profile = _findProfile(all, urlPattern, profileId);
  if (!profile) return;
  const id = generateId();
  profile.rules.push({
    id,
    enabled: true,
    selector: fieldRule.selector,
    type: fieldRule.type,
    value: fieldRule.value,
    label: fieldRule.label || '',
  });
  await saveRules(all);
  return id;
}

/** Update specific fields of a rule. */
async function updateRule(urlPattern, profileId, ruleId, patch) {
  const all = await getAllRules();
  const profile = _findProfile(all, urlPattern, profileId);
  if (!profile) return;
  const idx = profile.rules.findIndex(r => r.id === ruleId);
  if (idx === -1) return;
  profile.rules[idx] = { ...profile.rules[idx], ...patch };
  await saveRules(all);
}

/** Delete a rule. */
async function deleteRule(urlPattern, profileId, ruleId) {
  const all = await getAllRules();
  const profile = _findProfile(all, urlPattern, profileId);
  if (!profile) return;
  profile.rules = profile.rules.filter(r => r.id !== ruleId);
  await saveRules(all);
}

/** Import (replace all) rules. */
async function importRules(rules) {
  await saveRules(rules);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _findProfile(all, urlPattern, profileId) {
  const data = all[urlPattern];
  if (!data) return null;
  return data.profiles.find(p => p.id === profileId) || null;
}
