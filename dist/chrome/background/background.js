/**
 * background/background.js  (v2)
 *
 * Message router. Handles requests from the content script.
 * Popup and options page access browser.storage directly.
 */

'use strict';

// Chrome exposes `chrome` instead of `browser` (mirrors shared/browser-polyfill.js,
// inlined because the Chrome service worker doesn't load other scripts here).
if (typeof globalThis.browser === 'undefined') globalThis.browser = globalThis.chrome;

const STORAGE_KEY = 'autofillRules';

// ---------------------------------------------------------------------------
// URL matching + storage helpers (inlined — mirrors shared/storage.js)
// ---------------------------------------------------------------------------

function stripHash(url) {
  try { const u = new URL(url); u.hash = ''; return u.toString(); }
  catch { return url; }
}

function patternMatches(urlPattern, url) {
  // Pattern targets a specific hash route (SPA): compare against the full URL, hash included.
  if (urlPattern.includes('#')) {
    if (urlPattern === url) return true;
    return urlPattern.endsWith('*') && url.startsWith(urlPattern.slice(0, -1));
  }
  const clean = stripHash(url);
  if (urlPattern === clean) return true;
  if (urlPattern.endsWith('*') && clean.startsWith(urlPattern.slice(0, -1))) return true;
  try {
    const base = urlPattern.endsWith('*') ? urlPattern.slice(0, -1) : urlPattern;
    const p = new URL(base), pg = new URL(clean);
    if (p.hostname === pg.hostname && p.protocol === pg.protocol &&
        (p.pathname === '/' || p.pathname === '')) return true;
  } catch { /* ignore */ }
  return false;
}

function migrateValue(value) {
  if (!value) return { profiles: [] };
  if (value.profiles) return value;
  if (Array.isArray(value)) {
    return { profiles: [{ id: 'migrated', name: 'Default', rules: value }] };
  }
  return { profiles: [] };
}

async function getProfilesForUrl(url) {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY] || {};
  const profiles = [];
  for (const [pattern, value] of Object.entries(raw)) {
    const data = migrateValue(value);
    const allPatterns = [pattern, ...(data.aliases || [])];
    if (!allPatterns.some(p => patternMatches(p, url))) continue;
    for (const profile of (data.profiles || [])) {
      const enabledRules = (profile.rules || []).filter(r => r.enabled);
      if (enabledRules.length > 0) {
        profiles.push({ id: profile.id, name: profile.name, rules: enabledRules, patternKey: pattern });
      }
    }
  }
  return profiles;
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PROFILES_FOR_URL') {
    getProfilesForUrl(message.url)
      .then(profiles => sendResponse({ profiles }))
      .catch(err => {
        console.error('[AutoFill background]', err);
        sendResponse({ profiles: [] });
      });
    return true;
  }
});
