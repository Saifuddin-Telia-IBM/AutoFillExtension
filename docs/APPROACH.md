# AutoFill Extension — Approach Document

## Problem Statement

When a web page must be repeatedly configured after restarts (entering credentials, selecting options, toggling checkboxes, picking radio buttons), doing it manually every time is tedious and error-prone. This Firefox extension eliminates that friction by storing field-fill rules per URL and replaying them automatically every time the page loads.

---

## Approach

### Core Idea

A **content script** runs on every page load. It checks whether the current URL has any stored autofill rules. If rules exist, it iterates over them and fills each field (text input, checkbox, radio button, select, textarea) with the stored value.

A **popup UI** lets the user manage rules: add, edit, enable/disable, and delete field-fill entries per URL pattern.

An **options page** provides the same management in a larger, more comfortable surface.

### URL Matching

Rules are stored keyed by a URL pattern. The extension supports:
- **Exact match** — e.g. `http://192.168.1.1/setup`
- **Prefix match** — e.g. `http://192.168.1.1/*`
- **Hostname match** — e.g. `*.example.com`

This covers the primary use case (same admin page every restart) while allowing flexibility.

### Field Identification

Each rule entry identifies a field by one of:
- **CSS selector** — most reliable (e.g. `#password`, `input[name="ssid"]`)
- **`name` attribute** — e.g. `name="username"`
- **`id` attribute** — shorthand for `#id` selector

The selector approach is the most powerful and is the primary mode. The UI assists the user in identifying fields.

### Trigger Timing

Autofill fires:
1. On `DOMContentLoaded` for fields that are present immediately.
2. On a short MutationObserver watch (up to 3 seconds) for dynamically rendered fields (SPAs, delayed renders).

### Field Types Supported

| Type | Fill Strategy |
|---|---|
| `<input type="text/email/number/password/url/search/tel">` | Set `.value`, dispatch `input` + `change` events |
| `<textarea>` | Set `.value`, dispatch `input` + `change` events |
| `<input type="checkbox">` | Set `.checked`, dispatch `change` event |
| `<input type="radio">` | Find radio in group by value, set `.checked`, dispatch `change` event |
| `<select>` | Set `.value`, dispatch `change` event |

Events are dispatched so that React/Vue/Angular reactive frameworks pick up the change.

### Storage

All rules are stored in `browser.storage.local` (no server, no sync unless user opts into `storage.sync`). Data is structured as a map from URL pattern to an array of field rules.

### Privacy

- Nothing leaves the browser. No analytics, no remote calls.
- Data is stored entirely in the extension's local storage.
- The extension only activates on pages the user has explicitly configured.

---

## User Flow

1. User navigates to a page they want to autofill.
2. User clicks the extension icon → popup opens.
3. User clicks **"Add rule for this page"**.
4. User enters a CSS selector (or name/id) and the desired value.
5. User saves. The rule is stored.
6. Next time the page loads, the content script fires and fills the fields automatically.
7. User can toggle rules on/off, edit values, or delete them at any time.

---

## Non-Goals

- Password manager replacement (no encryption of values)
- Form submission (extension fills fields, does not click Submit)
- Cross-browser support in this iteration (Firefox-first, WebExtensions API is compatible with Chrome with minor manifest changes)
