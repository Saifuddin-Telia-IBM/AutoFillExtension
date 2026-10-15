/**
 * content/autofill.js  (v2)
 *
 * On page load:
 *   1. Fetch matching profiles from background.
 *   2. Detect whether any profile's selectors are present in the DOM.
 *   3. If yes, show a small toast in the top-right corner listing profiles.
 *   4. Clicking a profile name fills all its enabled rules immediately.
 *   5. A persistent MutationObserver re-shows the toast when new fields
 *      appear (modals/dialogs), and also listens for FILL_PROFILE messages
 *      from the popup's "Fill now" button.
 *
 * Toast auto-dismisses after TOAST_TIMEOUT_MS if the user ignores it.
 */

'use strict';

(function () {
  const INITIAL_SCAN_MS   = 3000;  // how long to wait for late-rendered fields on load
  const TOAST_TIMEOUT_MS  = 8000;  // auto-dismiss toast after this delay
  const TOAST_ID          = '__autofill_toast__';
  const STYLE_ID          = '__autofill_style__';

  let allProfiles = [];   // profiles returned for this URL
  let toastTimer  = null;

  // -------------------------------------------------------------------------
  // Field fill logic (unchanged from v1)
  // -------------------------------------------------------------------------

  function dispatch(el, eventName) {
    el.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  /**
   * If `host` is a web component (has a shadowRoot), find the native input
   * inside it that best matches the requested field type.  Falls back to `host`
   * itself when no shadow root exists (normal elements) or nothing is found.
   *
   * We query by type rather than just taking [0] so that a component like
   * <cds-password-input> whose shadow contains both an <input type="password">
   * and a toggle <button> doesn't accidentally return the wrong element.
   */
  function resolveShadowInput(host, fieldType) {
    const root = host.shadowRoot;
    if (!root) return host;
    switch (fieldType) {
      case 'checkbox': return root.querySelector('input[type="checkbox"]') || host;
      case 'radio':    return root.querySelector('input[type="radio"]')    || host;
      case 'select':   return root.querySelector('select')                  || host;
      default: {
        // For text/password/email/number/etc: prefer a non-checkbox, non-radio,
        // non-submit, non-button <input>, then fall back to <textarea>.
        return root.querySelector(
          'input:not([type="checkbox"]):not([type="radio"])' +
          ':not([type="submit"]):not([type="button"]):not([type="reset"])'
        ) || root.querySelector('textarea') || host;
      }
    }
  }

  function inferType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'text';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
    }
    // Web component host: inspect its shadow root to infer the real type
    if (el.shadowRoot) {
      if (el.shadowRoot.querySelector('input[type="checkbox"]')) return 'checkbox';
      if (el.shadowRoot.querySelector('input[type="radio"]'))    return 'radio';
      if (el.shadowRoot.querySelector('select'))                 return 'select';
    }
    return 'text';
  }

  function fillField(rule) {
    const host = document.querySelector(rule.selector);
    if (!host) return false;
    const type = rule.type || inferType(host);

    // Resolve the actual fillable element (pierces shadow DOM when needed)
    const el = resolveShadowInput(host, type);

    switch (type) {
      case 'checkbox': {
        const checked = rule.value === true || rule.value === 'true';
        if (el.checked !== checked) {
          el.checked = checked;
          dispatch(el, 'change');
          // Also notify the host so framework listeners (Angular, etc.) fire
          if (el !== host) dispatch(host, 'change');
        }
        return true;
      }
      case 'radio': {
        if (el.type === 'radio') {
          if (!el.checked) {
            el.checked = true;
            dispatch(el, 'change');
            if (el !== host) dispatch(host, 'change');
          }
          return true;
        }
        // Selector pointed at a container — search light DOM then shadow DOM
        const scope = el.shadowRoot || el;
        for (const radio of scope.querySelectorAll('input[type="radio"]')) {
          if (String(radio.value) === String(rule.value)) {
            if (!radio.checked) {
              radio.checked = true;
              dispatch(radio, 'change');
              if (radio !== host) dispatch(host, 'change');
            }
            return true;
          }
        }
        return false;
      }
      case 'select': {
        if (el.value !== String(rule.value)) {
          el.value = String(rule.value);
          dispatch(el, 'change');
          if (el !== host) dispatch(host, 'change');
        }
        return true;
      }
      default: {
        if (el.value !== String(rule.value)) {
          el.value = String(rule.value);
          dispatch(el, 'input');
          dispatch(el, 'change');
          // Notify the host element so Angular/React/Vue framework bindings update
          if (el !== host) {
            dispatch(host, 'input');
            dispatch(host, 'change');
          }
        }
        return true;
      }
    }
  }

  /** Fill all enabled rules in a profile. Returns count of filled fields. */
  function fillProfile(profile) {
    let filled = 0;
    for (const rule of profile.rules) {
      if (fillField(rule)) filled++;
    }
    return filled;
  }

  // -------------------------------------------------------------------------
  // Detect whether any profile has at least one matching field in the DOM
  // -------------------------------------------------------------------------

  function profileHasMatchingField(profile) {
    return profile.rules.some(rule => !!document.querySelector(rule.selector));
  }

  function getVisibleProfiles() {
    return allProfiles.filter(profileHasMatchingField);
  }

  // -------------------------------------------------------------------------
  // Toast UI
  // -------------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TOAST_ID} {
        all: initial;
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        background: #1e3a5f;
        color: #ffffff;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.35);
        padding: 12px 14px 10px;
        width: 230px;
        box-sizing: border-box;
        animation: __af_slide_in 0.18s ease;
      }
      @keyframes __af_slide_in {
        from { opacity: 0; transform: translateY(-10px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      #${TOAST_ID} .__af_header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      #${TOAST_ID} .__af_title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: #7fc8f8;
      }
      #${TOAST_ID} .__af_close {
        background: none;
        border: none;
        color: #7fc8f8;
        cursor: pointer;
        font-size: 15px;
        line-height: 1;
        padding: 0;
        font-family: inherit;
      }
      #${TOAST_ID} .__af_close:hover { color: #fff; }
      #${TOAST_ID} .__af_profiles {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      #${TOAST_ID} .__af_btn {
        all: unset;
        box-sizing: border-box;
        display: block;
        width: 100%;
        padding: 6px 10px;
        background: rgba(255,255,255,0.12);
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        color: #ffffff;
        text-align: left;
        font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
        transition: background 0.12s;
      }
      #${TOAST_ID} .__af_btn:hover { background: rgba(255,255,255,0.22); }
      #${TOAST_ID} .__af_btn.__af_filled {
        background: rgba(74,222,128,0.25);
        color: #bbf7d0;
        cursor: default;
      }
      #${TOAST_ID} .__af_count {
        font-size: 10px;
        opacity: 0.7;
        margin-left: 5px;
        font-weight: 400;
      }
      #${TOAST_ID} .__af_dismiss {
        display: block;
        margin-top: 8px;
        font-size: 10px;
        color: rgba(255,255,255,0.45);
        text-align: right;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function dismissToast() {
    const existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  }

  function showToast(profiles) {
    dismissToast();
    if (profiles.length === 0) return;

    injectStyles();

    const toast = document.createElement('div');
    toast.id = TOAST_ID;

    // Header
    const header = document.createElement('div');
    header.className = '__af_header';

    const title = document.createElement('span');
    title.className = '__af_title';
    title.textContent = '⚡ AutoFill';

    const closeBtn = document.createElement('button');
    closeBtn.className = '__af_close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', dismissToast);

    header.appendChild(title);
    header.appendChild(closeBtn);
    toast.appendChild(header);

    // Profile buttons
    const profileList = document.createElement('div');
    profileList.className = '__af_profiles';

    for (const profile of profiles) {
      const btn = document.createElement('button');
      btn.className = '__af_btn';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = profile.name;

      const countSpan = document.createElement('span');
      countSpan.className = '__af_count';
      countSpan.textContent = `${profile.rules.length} field${profile.rules.length !== 1 ? 's' : ''}`;

      btn.appendChild(nameSpan);
      btn.appendChild(countSpan);

      btn.addEventListener('click', () => {
        const filled = fillProfile(profile);
        btn.classList.add('__af_filled');
        nameSpan.textContent = `✓ ${profile.name}`;
        countSpan.textContent = `${filled} filled`;
        btn.disabled = true;
        // Auto-dismiss after brief pause if all profiles are done
        const allDone = profileList.querySelectorAll('.__af_btn:not(.__af_filled)').length === 0;
        if (allDone) setTimeout(dismissToast, 1200);
      });

      profileList.appendChild(btn);
    }

    toast.appendChild(profileList);

    // Auto-dismiss hint
    const hint = document.createElement('span');
    hint.className = '__af_dismiss';
    hint.textContent = 'Dismisses automatically';
    toast.appendChild(hint);

    document.documentElement.appendChild(toast);

    // Auto-dismiss
    toastTimer = setTimeout(dismissToast, TOAST_TIMEOUT_MS);
  }

  // -------------------------------------------------------------------------
  // Decide whether to show the toast (called on load and on DOM changes)
  // -------------------------------------------------------------------------

  let toastShownForCurrentDom = false;

  function maybeShowToast() {
    if (allProfiles.length === 0) return;
    const visible = getVisibleProfiles();
    if (visible.length === 0) return;
    if (document.getElementById(TOAST_ID)) return; // already showing
    toastShownForCurrentDom = true;
    showToast(visible);
  }

  // -------------------------------------------------------------------------
  // Persistent observer — re-shows toast when new fields appear (modals)
  // -------------------------------------------------------------------------

  function startPersistentObserver() {
    const observer = new MutationObserver(mutations => {
      let hasNewNodes = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) { hasNewNodes = true; break; }
      }
      if (!hasNewNodes) return;

      // Check if any newly added node contains a selector we care about
      const newFields = allProfiles.some(profile =>
        profile.rules.some(rule => document.querySelector(rule.selector))
      );
      if (newFields && !document.getElementById(TOAST_ID)) {
        showToast(getVisibleProfiles());
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // -------------------------------------------------------------------------
  // Message listener — "Fill now" from popup
  // -------------------------------------------------------------------------

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'FILL_PROFILE') {
      const profile = allProfiles.find(p => p.id === message.profileId);
      if (profile) {
        dismissToast();
        fillProfile(profile);
      }
    }
    if (message.type === 'SHOW_TOAST') {
      showToast(getVisibleProfiles());
    }
  });

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  async function init() {
    let profiles;
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_PROFILES_FOR_URL',
        url: window.location.href,
      });
      profiles = (response && response.profiles) || [];
    } catch {
      return;
    }

    if (profiles.length === 0) return;
    allProfiles = profiles;

    // Initial scan — show toast if fields are present now
    maybeShowToast();

    // If fields not in DOM yet (SPA/lazy), keep checking for INITIAL_SCAN_MS
    if (!toastShownForCurrentDom) {
      const scanInterval = setInterval(() => {
        if (getVisibleProfiles().length > 0) {
          clearInterval(scanInterval);
          maybeShowToast();
        }
      }, 200);
      setTimeout(() => clearInterval(scanInterval), INITIAL_SCAN_MS);
    }

    // Persistent observer for modals opened later
    startPersistentObserver();
  }

  init();
})();
