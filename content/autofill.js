/**
 * content/autofill.js
 *
 * Injected into every page at document_idle.
 * Retrieves matching autofill rules from the background script and fills fields.
 *
 * Two-phase watching strategy:
 *   Phase 1 — "initial" observer: fires on every DOM mutation for up to
 *             INITIAL_TIMEOUT_MS after page load, filling any rules whose
 *             elements appear late (SPAs, lazy renders).
 *             Once all rules are filled OR the timeout fires, this observer stops.
 *
 *   Phase 2 — "persistent" observer: always-on for the lifetime of the page.
 *             Whenever new nodes are added to the DOM (e.g. a modal/dialog opens),
 *             it checks whether any of the added nodes contain elements that match
 *             a configured rule, and fills them immediately.
 *             This is what makes modal/dialog autofill work regardless of when
 *             the modal is opened.
 */

'use strict';

(function () {
  // How long (ms) to keep the initial "fill everything" observer running.
  const INITIAL_TIMEOUT_MS = 3000;

  // All rules for this page — populated once on init, referenced by both observers.
  let allRules = [];

  // -------------------------------------------------------------------------
  // Field fill logic
  // -------------------------------------------------------------------------

  /**
   * Dispatch a synthetic event on an element so that frameworks (React, Vue, Angular)
   * pick up the change.
   */
  function dispatch(el, eventName) {
    el.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  /**
   * Fill a single field based on its rule.
   * @param {{ selector: string, type: string, value: * }} rule
   * @returns {boolean} true if the element was found and filled
   */
  function fillField(rule) {
    const el = document.querySelector(rule.selector);
    if (!el) return false;

    const type = rule.type || inferType(el);

    switch (type) {
      case 'checkbox': {
        const checked = rule.value === true || rule.value === 'true';
        if (el.checked !== checked) {
          el.checked = checked;
          dispatch(el, 'change');
        }
        return true;
      }

      case 'radio': {
        // rule.selector should uniquely identify the target radio button.
        // If it points to a group container we fall back to name+value matching.
        if (el.type === 'radio') {
          if (!el.checked) {
            el.checked = true;
            dispatch(el, 'change');
          }
          return true;
        }
        // Fallback: find radio by name + value inside the matched container
        const radios = el.querySelectorAll
          ? el.querySelectorAll('input[type="radio"]')
          : [];
        for (const radio of radios) {
          if (String(radio.value) === String(rule.value)) {
            if (!radio.checked) {
              radio.checked = true;
              dispatch(radio, 'change');
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
        }
        return true;
      }

      default: {
        // text, email, password, number, url, search, tel, textarea
        if (el.value !== String(rule.value)) {
          el.value = String(rule.value);
          dispatch(el, 'input');
          dispatch(el, 'change');
        }
        return true;
      }
    }
  }

  /**
   * Infer a simplified field type from the element's tag/type attribute.
   */
  function inferType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'text';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
    }
    return 'text';
  }

  // -------------------------------------------------------------------------
  // Phase 1 — initial observer (covers page load + SPA renders)
  // -------------------------------------------------------------------------

  /**
   * Attempt to fill all pending rules. Returns the rules that were NOT filled.
   */
  function applyRules(rules) {
    return rules.filter(rule => !fillField(rule));
  }

  /**
   * Watch the DOM for new nodes and retry unfilled rules until timeout.
   * Stops as soon as all rules are filled or INITIAL_TIMEOUT_MS elapses.
   */
  function runInitialObserver(pendingRules) {
    if (pendingRules.length === 0) return;

    let remaining = pendingRules;

    const observer = new MutationObserver(() => {
      remaining = applyRules(remaining);
      if (remaining.length === 0) observer.disconnect();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      if (remaining.length > 0) {
        console.debug(
          '[AutoFill] Initial observer timed out with',
          remaining.length,
          'unfilled rule(s):',
          remaining.map(r => r.selector)
        );
      }
    }, INITIAL_TIMEOUT_MS);
  }

  // -------------------------------------------------------------------------
  // Phase 2 — persistent observer (covers modals / dialogs opened any time)
  // -------------------------------------------------------------------------

  /**
   * Given a list of newly-added DOM nodes (from a MutationRecord), check whether
   * any configured rule's selector matches an element inside those nodes,
   * and fill it if so.
   *
   * This fires every time ANY new nodes appear in the DOM — including when a
   * modal/dialog is injected — so modal fields are filled the moment they appear.
   */
  function fillInAddedNodes(addedNodes) {
    for (const rule of allRules) {
      for (const node of addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Does the added node itself match, or does it contain a match?
        let target = null;
        if (node.matches && node.matches(rule.selector)) {
          target = node;
        } else if (node.querySelector) {
          target = node.querySelector(rule.selector);
        }

        if (target) {
          // Re-use fillField which does a document.querySelector —
          // the element is now in the DOM so it will be found.
          fillField(rule);
          break; // rule matched; move to next rule
        }
      }
    }
  }

  /**
   * Start the persistent observer. Runs for the entire lifetime of the page.
   * It only acts when something is actually added to the DOM, so it is
   * lightweight (no polling).
   */
  function startPersistentObserver() {
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          fillInAddedNodes(mutation.addedNodes);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    // Note: we intentionally never disconnect this observer.
  }

  // -------------------------------------------------------------------------
  // Bootstrap — request rules from background then run both phases
  // -------------------------------------------------------------------------

  async function init() {
    let rules;
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_RULES_FOR_URL',
        url: window.location.href,
      });
      rules = (response && response.rules) || [];
    } catch (err) {
      // Extension context may not be ready on very fast pages; silently bail.
      return;
    }

    if (rules.length === 0) return;

    allRules = rules;

    // Phase 1: fill fields already in the DOM, watch for late ones (≤3s)
    const pending = applyRules(rules);
    runInitialObserver(pending);

    // Phase 2: persistent watch — fills fields in modals/dialogs opened any time
    startPersistentObserver();
  }

  init();
})();
