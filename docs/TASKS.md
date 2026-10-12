# AutoFill Extension — Task Breakdown

Each task below is self-contained and can be started independently if a chat session is interrupted. Reference `docs/ARCHITECTURE.md` for data models and file structure before starting any task.

---

## Task 1 — Project Scaffolding
**Goal:** Create the folder structure, `manifest.json`, placeholder files, and icons.

**Files to create:**
- `manifest.json`
- `background/background.js` (stub)
- `content/autofill.js` (stub)
- `popup/popup.html`, `popup.js`, `popup.css` (stubs)
- `options/options.html`, `options.js`, `options.css` (stubs)
- `shared/storage.js` (stub)
- `icons/` (placeholder PNGs or SVGs)

**Completion criteria:** Extension loads in Firefox (`about:debugging`) without errors.

---

## Task 2 — Storage Module
**Goal:** Implement `shared/storage.js` with all CRUD helpers.

**Functions to implement:**
- `getRulesForUrl(url)` — URL pattern matching + return matching rules
- `getAllRules()` — return full rules map
- `saveRules(rules)` — persist rules map
- `addRule(urlPattern, fieldRule)` — generate UUID, append to array
- `deleteRule(urlPattern, ruleId)` — remove by id
- `updateRule(urlPattern, ruleId, patch)` — merge patch into rule
- `generateId()` — UUID v4 (simple crypto.randomUUID or manual)

**Completion criteria:** Unit-testable pure functions; can be imported by popup, options, and background.

---

## Task 3 — Content Script (Autofill Engine)
**Goal:** Implement `content/autofill.js` — the core autofill logic.

**Steps:**
1. On `DOMContentLoaded` (or `document_idle`), message background for matching rules.
2. For each enabled rule, call `fillField(selector, type, value)`.
3. `fillField` implementations:
   - **text/email/password/number/url/textarea/select**: set `.value`, dispatch `input` and `change` events
   - **checkbox**: set `.checked = (value === true || value === 'true')`, dispatch `change`
   - **radio**: query `input[type=radio][name=X]`, find the one with matching `.value`, set `.checked`, dispatch `change`
4. Set up `MutationObserver` watching `document.body` for DOM additions; retry unfilled rules for up to 3 seconds, then disconnect.

**Completion criteria:** Opening a configured test page auto-fills all field types correctly.

---

## Task 4 — Background Script
**Goal:** Implement `background/background.js` as a thin message router.

**Steps:**
1. Listen for `browser.runtime.onMessage`.
2. Handle `GET_RULES_FOR_URL`: call `getRulesForUrl(url)` from storage module, return result.
3. No other responsibilities.

**Completion criteria:** Content script can retrieve rules via message passing.

---

## Task 5 — Popup UI
**Goal:** Implement `popup/popup.html`, `popup.js`, `popup.css`.

**Features:**
- Header shows current tab URL
- List view of rules for the current URL
  - Each row: label/selector, value preview, type badge, enabled toggle, edit button, delete button
- **Add Rule** button → inline form:
  - CSS Selector field
  - Type dropdown (text, checkbox, radio, select)
  - Value field (text input or checkbox for boolean)
  - Optional label
  - Save / Cancel
- Edit rule: pre-fills the inline form with existing values
- Real-time save to storage on each change

**Completion criteria:** User can add, edit, toggle, and delete rules for the current page from the popup.

---

## Task 6 — Options Page
**Goal:** Implement `options/options.html`, `options.js`, `options.css`.

**Features:**
- Full-width rule manager
- Group rules by URL pattern
- Add new URL pattern
- Per-URL: add, edit, delete rules (same form as popup)
- Delete entire URL pattern
- **Export** button — downloads `autofill-rules.json`
- **Import** button — reads JSON file, merges or replaces rules
- Confirmation dialogs for destructive actions

**Completion criteria:** Full rule management available from `about:addons` options page.

---

## Task 7 — Polish and Packaging
**Goal:** Final wiring, UX polish, and packaging instructions.

**Steps:**
1. Add meaningful icons (SVG-based, embedded as data URIs or actual PNGs).
2. Add a brief on-boarding message when no rules exist for the current page.
3. Verify the MutationObserver properly disconnects to avoid memory leaks.
4. Verify synthetic events work on a React and a plain HTML page.
5. Write `README.md` with installation and usage instructions.
6. Document how to package as `.xpi` for Firefox (`web-ext build`).

**Completion criteria:** Extension is fully functional, documented, and packagable.

---

## Quick-Start for Resuming a Session

If a chat session ends mid-task, start a new session and say:

> "Continue the AutoFill Firefox Extension project. Check `docs/PROGRESS.md` for current status and resume from the next incomplete task."

Then reference `docs/ARCHITECTURE.md` for the data model and `docs/TASKS.md` for each task's scope.
