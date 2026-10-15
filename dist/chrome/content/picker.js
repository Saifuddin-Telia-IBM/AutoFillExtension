/**
 * content/picker.js
 *
 * Element picker (uBlock Origin style) used by the popup's "Pick" button.
 *
 *   1. Popup sends START_PICKER -> an overlay + control panel is shown.
 *   2. Hovering highlights the element under the cursor; page clicks are
 *      swallowed so the page doesn't react.
 *   3. Clicking selects an element. Because the click doesn't always land on
 *      the element you actually want (overlays, labels, wrappers) the panel
 *      lets you refine it: Parent / Child buttons, the full stack of elements
 *      under the click point, generated selector suggestions, and a freely
 *      editable selector with a live match count.
 *   4. "Use this selector" stores { selector, type } in storage.local. The
 *      popup closes when the page is clicked, so it restores its saved rule
 *      form draft and applies the result the next time it opens.
 */

'use strict';

(function () {
  const RESULT_KEY = 'autofillPickerResult';
  const HOST_ID    = '__autofill_picker__';
  const MAX_BOXES  = 50;

  let active = null;

  // -------------------------------------------------------------------------
  // Selector generation
  // -------------------------------------------------------------------------

  const esc = s => CSS.escape(s);
  const cssStr = v => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');

  function queryAll(sel) {
    try { return document.querySelectorAll(sel); } catch { return null; }
  }

  function isUniqueFor(sel, el) {
    const m = queryAll(sel);
    return !!m && m.length === 1 && m[0] === el;
  }

  function pathSelector(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur.id && isUniqueFor('#' + esc(cur.id), cur)) {
        parts.unshift('#' + esc(cur.id));
        break;
      }
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      if (isUniqueFor(parts.join(' > '), el)) break;
      cur = parent;
    }
    return parts.join(' > ');
  }

  /** Selectors that match exactly this element, best (shortest/most stable) first. */
  function candidateSelectors(el) {
    const out = [];
    const add = s => { if (s && !out.includes(s) && isUniqueFor(s, el)) out.push(s); };
    const tag = el.tagName.toLowerCase();
    const attr = (name, v) => `[${name}="${cssStr(v)}"]`;

    if (el.id) add('#' + esc(el.id));

    const name = el.getAttribute('name');
    const type = el.getAttribute('type');
    const value = el.getAttribute('value');
    if (name) {
      add(tag + attr('name', name));
      if (type && value != null) add(tag + attr('name', name) + attr('type', type) + attr('value', value));
      if (value != null) add(tag + attr('name', name) + attr('value', value));
    }
    for (const a of ['data-testid', 'data-test', 'data-qa', 'data-cy', 'formcontrolname', 'aria-label', 'placeholder', 'title']) {
      const v = el.getAttribute(a);
      if (v) add(tag + attr(a, v));
    }

    const classes = Array.from(el.classList).slice(0, 4);
    for (const c of classes) add(tag + '.' + esc(c));
    if (classes.length > 1) add(tag + classes.map(c => '.' + esc(c)).join(''));

    add(pathSelector(el));
    return out;
  }

  function detectType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'text';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      return 'text';
    }
    // Container of radio buttons: fill logic picks the radio by value
    if (el.querySelector('input[type="radio"]')) return 'radio';
    // Web component host: inspect its shadow root
    if (el.shadowRoot) {
      if (el.shadowRoot.querySelector('input[type="checkbox"]')) return 'checkbox';
      if (el.shadowRoot.querySelector('input[type="radio"]'))    return 'radio';
      if (el.shadowRoot.querySelector('select'))                 return 'select';
    }
    return 'text';
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = Array.from(el.classList).slice(0, 3);
    if (cls.length) s += '.' + cls.join('.');
    const nm = el.getAttribute('name');
    if (nm) s += `[name=${nm}]`;
    return s.length > 60 ? s.slice(0, 58) + '…' : s;
  }

  // -------------------------------------------------------------------------
  // Picker UI
  // -------------------------------------------------------------------------

  const PANEL_HTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", system-ui, sans-serif; }
      .box { position: fixed; pointer-events: none; border-radius: 2px; }
      .hover { border: 2px solid #f59e0b; background: rgba(245,158,11,0.15); }
      .sel   { border: 2px solid #16a34a; background: rgba(22,163,74,0.2); }
      .match { border: 2px dashed #3b82f6; background: rgba(59,130,246,0.12); }
      #panel {
        position: fixed; bottom: 16px; width: 320px; max-height: calc(100vh - 32px); overflow: auto;
        pointer-events: auto; background: #1e3a5f; color: #fff; font-size: 12px; line-height: 1.4;
        border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); padding: 10px 12px;
      }
      .hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .hd b { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: #7fc8f8; }
      #hint { color: #cbd5e1; }
      #desc { font-family: ui-monospace, Menlo, monospace; color: #bbf7d0; margin-bottom: 6px; word-break: break-all; }
      label { display: block; margin: 8px 0 3px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #7fc8f8; }
      select, input {
        width: 100%; padding: 4px 6px; border-radius: 4px; border: 1px solid #3b5b85;
        background: #0f2540; color: #fff; font-size: 11px; font-family: ui-monospace, Menlo, monospace;
      }
      .row { display: flex; gap: 6px; margin-top: 8px; }
      .row:first-child { margin-top: 0; }
      button {
        flex: 1; padding: 5px 8px; border: none; border-radius: 5px; cursor: pointer;
        background: rgba(255,255,255,0.14); color: #fff; font-size: 12px;
      }
      button:hover { background: rgba(255,255,255,0.25); }
      button.pri { background: #3b82f6; font-weight: 600; }
      button.pri:hover { background: #2563eb; }
      button.pri:disabled { opacity: 0.4; cursor: default; }
      #x { flex: none; padding: 0 6px; background: none; font-size: 14px; color: #7fc8f8; }
      #count { margin-top: 4px; font-size: 11px; }
      .ok { color: #86efac; } .warn { color: #fcd34d; } .bad { color: #fca5a5; }
      [hidden] { display: none !important; }
    </style>
    <div id="boxes"></div>
    <div id="panel">
      <div class="hd"><b>⚡ AutoFill picker</b><button id="x" title="Cancel (Esc)">✕</button></div>
      <div id="hint">Hover over the field and click it. Esc to cancel.</div>
      <div id="selected" hidden>
        <div id="desc"></div>
        <div class="row"><button id="up" title="Select the parent element">▲ Parent</button><button id="down" title="Select a child element">▼ Child</button></div>
        <label>Elements under your click</label>
        <select id="stack"></select>
        <label>Suggested selectors</label>
        <select id="cands"></select>
        <label>Selector (editable)</label>
        <input id="text" spellcheck="false" autocomplete="off" />
        <div id="count"></div>
        <div class="row"><button id="use" class="pri">Use this selector</button><button id="cancel">Cancel</button></div>
      </div>
    </div>`;

  function startPicker() {
    if (active) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = PANEL_HTML;
    const $ = id => root.getElementById(id);

    const ui = {
      boxes: $('boxes'), panel: $('panel'), hint: $('hint'), selected: $('selected'),
      desc: $('desc'), stack: $('stack'), cands: $('cands'), text: $('text'),
      count: $('count'), use: $('use'),
    };

    const st = { current: null, hover: null, childStack: [], stackEls: [] };

    function addBox(el, cls) {
      const r = el.getBoundingClientRect();
      const b = document.createElement('div');
      b.className = 'box ' + cls;
      b.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
      ui.boxes.appendChild(b);
    }

    function matchesOfText() {
      const m = queryAll(ui.text.value.trim());
      return m ? Array.from(m) : null;
    }

    function render() {
      ui.boxes.textContent = '';
      if (st.current) {
        const matches = matchesOfText() || [];
        matches.slice(0, MAX_BOXES).forEach(m => { if (m !== st.current) addBox(m, 'match'); });
        addBox(st.current, 'sel');
      }
      if (st.hover && st.hover !== st.current) addBox(st.hover, 'hover');
    }

    function updateCount() {
      const sel = ui.text.value.trim();
      const m = sel ? queryAll(sel) : null;
      ui.use.disabled = !m || m.length === 0;
      if (!sel) { ui.count.className = 'bad'; ui.count.textContent = 'Enter a selector.'; }
      else if (!m) { ui.count.className = 'bad'; ui.count.textContent = 'Invalid selector.'; }
      else if (m.length === 0) { ui.count.className = 'bad'; ui.count.textContent = 'No matches on this page.'; }
      else if (m.length === 1) { ui.count.className = 'ok'; ui.count.textContent = '1 match.'; }
      else { ui.count.className = 'warn'; ui.count.textContent = `${m.length} matches — only the first one will be filled.`; }
    }

    function setCurrent(el) {
      st.current = el;
      ui.hint.hidden = true;
      ui.selected.hidden = false;
      ui.desc.textContent = '<' + describe(el) + '>';

      ui.cands.textContent = '';
      const cands = candidateSelectors(el);
      for (const c of cands) {
        const o = document.createElement('option');
        o.value = c; o.textContent = c;
        ui.cands.appendChild(o);
      }
      ui.text.value = cands[0] || '';

      const idx = st.stackEls.indexOf(el);
      ui.stack.selectedIndex = idx;

      updateCount();
      render();
    }

    function pick(e) {
      let el = e.target;
      if (!(el instanceof Element)) return;
      st.stackEls = document.elementsFromPoint(e.clientX, e.clientY).filter(n => n !== host).slice(0, 12);
      // A click on a <label> almost always means its field
      if (el.tagName === 'LABEL' && el.control) el = el.control;
      if (!st.stackEls.includes(el)) st.stackEls.unshift(el);
      // If the clicked element is a web component, add its shadow input(s) to
      // the stack so the user can pick the actual native <input> directly.
      for (const node of Array.from(st.stackEls)) {
        if (node.shadowRoot) {
          const shadowInputs = Array.from(node.shadowRoot.querySelectorAll(
            'input, select, textarea'
          ));
          // Insert shadow inputs right after their host in the stack
          const idx = st.stackEls.indexOf(node);
          st.stackEls.splice(idx + 1, 0, ...shadowInputs);
        }
      }
      st.stackEls = st.stackEls.slice(0, 16);

      ui.stack.textContent = '';
      st.stackEls.forEach((n, i) => {
        const o = document.createElement('option');
        o.value = String(i); o.textContent = describe(n);
        ui.stack.appendChild(o);
      });

      st.childStack = [];
      // Keep the panel away from the clicked spot
      if (e.clientX > window.innerWidth / 2) { ui.panel.style.left = '16px'; ui.panel.style.right = 'auto'; }
      else { ui.panel.style.right = '16px'; ui.panel.style.left = 'auto'; }
      setCurrent(el);
    }

    function confirmPick() {
      const selector = ui.text.value.trim();
      const m = selector ? queryAll(selector) : null;
      if (!m || m.length === 0) return;
      const target = Array.from(m).includes(st.current) ? st.current : m[0];
      browser.storage.local.set({ [RESULT_KEY]: { selector, type: detectType(target), savedAt: Date.now() } });
      cleanup();
      ui.boxes.textContent = '';
      ui.panel.style.left = 'auto';
      ui.panel.style.right = '16px';
      ui.panel.textContent = 'Selector saved. Reopen the AutoFill popup to continue.';
      setTimeout(() => host.remove(), 3000);
    }

    // --- page event interception ------------------------------------------

    const BLOCKED = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick',
      'contextmenu', 'auxclick', 'touchstart', 'touchend'];

    function onBlocked(e) {
      if (e.target === host) return; // our own panel
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'click' && e.button === 0) pick(e);
    }

    function onMove(e) {
      if (e.target === host) { if (st.hover) { st.hover = null; render(); } return; }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const next = el && el !== host ? el : null;
      if (next !== st.hover) { st.hover = next; render(); }
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); }
    }

    let raf = 0;
    function onViewportChange() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; render(); });
    }

    function cleanup() {
      BLOCKED.forEach(t => window.removeEventListener(t, onBlocked, true));
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange, true);
      active = null;
    }

    function cancel() {
      cleanup();
      host.remove();
    }

    BLOCKED.forEach(t => window.addEventListener(t, onBlocked, true));
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange, true);

    // --- panel controls -----------------------------------------------------

    $('x').addEventListener('click', cancel);
    $('cancel').addEventListener('click', cancel);
    ui.use.addEventListener('click', confirmPick);

    $('up').addEventListener('click', () => {
      const p = st.current && st.current.parentElement;
      if (!p || p === document.documentElement) return;
      st.childStack.push(st.current);
      setCurrent(p);
    });
    $('down').addEventListener('click', () => {
      if (!st.current) return;
      // Check shadow root first (web components), then light DOM children
      const shadowChild = st.current.shadowRoot && st.current.shadowRoot.querySelector(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="submit"])' +
        ':not([type="button"]):not([type="reset"]), select, textarea'
      );
      const next = st.childStack.pop()
        || shadowChild
        || st.current.querySelector('input, select, textarea')
        || st.current.firstElementChild;
      if (next) setCurrent(next);
    });
    ui.stack.addEventListener('change', () => {
      const el = st.stackEls[Number(ui.stack.value)];
      if (el) { st.childStack = []; setCurrent(el); }
    });
    ui.cands.addEventListener('change', () => {
      ui.text.value = ui.cands.value;
      updateCount();
      render();
    });
    ui.text.addEventListener('input', () => { updateCount(); render(); });
    ui.text.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); confirmPick(); }
      e.stopPropagation(); // keep page shortcuts away from the input
    });

    document.documentElement.appendChild(host);
    active = { host };
  }

  // -------------------------------------------------------------------------
  // Message listener
  // -------------------------------------------------------------------------

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'START_PICKER') {
      startPicker();
      sendResponse({ ok: true });
    }
  });
})();
