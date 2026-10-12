/**
 * background/background.js
 *
 * Background script — message router for AutoFill extension.
 * The content script cannot access browser.storage directly (it runs in the
 * page context), so it sends a message here and we proxy the storage lookup.
 *
 * Popup and options page are extension pages and can call browser.storage directly.
 */

'use strict';

// ---------------------------------------------------------------------------
// Inline URL-matching + storage helper (mirrors shared/storage.js logic)
// Cannot use importScripts for a regular JS file in MV2 background easily,
// so we keep just what the background needs here.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'autofillRules';

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
    const prefix = urlPattern.slice(0, -1);
    if (cleanUrl.startsWith(prefix)) return true;
  }

  try {
    const patUrl = new URL(urlPattern.endsWith('*') ? urlPattern.slice(0, -1) : urlPattern);
    const pageUrl = new URL(cleanUrl);
    if (
      patUrl.hostname === pageUrl.hostname &&
      patUrl.protocol === pageUrl.protocol &&
      (patUrl.pathname === '/' || patUrl.pathname === '')
    ) {
      return true;
    }
  } catch {
    // not a valid URL — ignore
  }

  return false;
}

async function getRulesForUrl(url) {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const all = result[STORAGE_KEY] || {};
  const matched = [];
  for (const [pattern, rules] of Object.entries(all)) {
    if (patternMatches(pattern, url)) {
      for (const rule of rules) {
        if (rule.enabled) matched.push(rule);
      }
    }
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_RULES_FOR_URL') {
    getRulesForUrl(message.url)
      .then(rules => sendResponse({ rules }))
      .catch(err => {
        console.error('[AutoFill background] Error fetching rules:', err);
        sendResponse({ rules: [] });
      });
    return true; // keep channel open for async response
  }
});
