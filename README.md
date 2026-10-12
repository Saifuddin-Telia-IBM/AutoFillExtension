# AutoFill Firefox Extension

Automatically fill form fields — text inputs, checkboxes, radio buttons, and dropdowns — on any page you configure, every time that page loads.

**Primary use case:** pages that need to be re-configured after every restart (router admin panels, local dev servers, test forms, etc.).

---

## Features

- ✅ Autofill **text, password, email, number, URL, search** inputs
- ✅ Autofill **checkboxes** (check or uncheck)
- ✅ Autofill **radio buttons** (select by value)
- ✅ Autofill **dropdowns** (`<select>`)
- ✅ Works with **React, Vue, Angular** — synthetic events dispatched
- ✅ Handles **dynamically rendered fields** (MutationObserver with 3s window)
- ✅ **URL pattern matching** — exact, wildcard prefix (`http://host/*`), or hostname-only
- ✅ **Enable/disable** individual rules without deleting them
- ✅ **Export / Import** rules as JSON (for backup or sharing)

---

## Installation (Developer / Unpacked)

Firefox doesn't require a signed extension for local developer use.

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on…"**
3. Navigate to this folder and select `manifest.json`
4. The AutoFill icon will appear in the toolbar

> Temporary add-ons are removed when Firefox restarts. For permanent installation, package and sign the extension (see below).

---

## Permanent Installation (Self-Signed / Developer Build)

### Prerequisites

```bash
npm install -g web-ext
```

### Build the `.xpi` package

```bash
web-ext build --source-dir . --artifacts-dir ./dist --ignore-files "scripts/**" "docs/**" "node_modules/**" "dist/**" "package*.json"
```

This creates `dist/autofill-1.0.0.zip`. Rename it to `.xpi` if needed.

### Install permanently (Firefox Developer Edition / Nightly only)

In `about:config`, set:
```
xpinstall.signatures.required = false
```
Then drag the `.xpi` file into Firefox, or use:
```bash
web-ext run --source-dir .
```

### Submit to AMO (addons.mozilla.org) for signing

Follow the [official AMO upload guide](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).

---

## Usage

### Adding rules for a page

1. Navigate to the page you want to configure.
2. Click the **AutoFill** toolbar icon.
3. If no pattern exists for this URL, the popup shows the current URL pre-filled as the pattern — adjust if needed (e.g. add `*` for wildcard) and click **"Use this pattern"**.
4. Click **+ Add Rule**.
5. Fill in:
   - **CSS Selector** — the selector for the field (see tips below)
   - **Field Type** — text, checkbox, radio, or select
   - **Value** — what to fill in
   - **Label** — optional friendly name
6. Click **Save**. The rule takes effect immediately on the next page load.

### Finding a CSS selector

The easiest way is to use browser DevTools:

1. Right-click the field → **Inspect Element**
2. In the Inspector, right-click the `<input>` element → **Copy** → **CSS Selector**
3. Paste that into the AutoFill rule

Common patterns:
```
#username              → element with id="username"
input[name="ssid"]     → input with name="ssid"
input[name="mode"][value="advanced"]  → the specific radio with value="advanced"
#settings > select     → a select inside #settings
```

### Managing all rules

Click **"Manage all rules →"** in the popup, or go to `about:addons` → AutoFill → **Preferences**.

The Options page lets you:
- View all URL patterns and their rules
- Add, edit, toggle, and delete rules
- Delete an entire URL pattern
- **Export** all rules to a JSON file
- **Import** rules from a JSON file (merge or replace)

---

## Data Model

Rules are stored in `browser.storage.local` under the key `autofillRules`:

```json
{
  "http://192.168.1.1/setup": [
    {
      "id": "uuid",
      "enabled": true,
      "selector": "#admin-password",
      "type": "text",
      "value": "mypassword",
      "label": "Admin password"
    },
    {
      "id": "uuid2",
      "enabled": true,
      "selector": "input[name='remember']",
      "type": "checkbox",
      "value": true,
      "label": "Remember me"
    }
  ]
}
```

---

## URL Pattern Matching

| Pattern | Matches |
|---|---|
| `http://192.168.1.1/setup` | Only that exact URL |
| `http://192.168.1.1/*` | Any path on 192.168.1.1 over HTTP |
| `http://192.168.1.1` | Any path on 192.168.1.1 (hostname match) |
| `https://example.com/config*` | Any URL starting with that prefix |

---

## Troubleshooting

**Fields aren't being filled**
- Check the selector: open DevTools → Console and run `document.querySelector('your-selector')` to verify it finds the element.
- The page may render fields after 3 seconds. Consider using a more specific selector.
- Make sure the rule is **enabled** (toggle is blue in the popup).

**React/Vue/Angular fields revert**
- This is usually because the framework re-renders. The extension dispatches `input` and `change` events which should keep state in sync. If a field still reverts, the component may ignore synthetic events — in that case use the app's own state management if accessible.

**Rules lost after Firefox update / restart**
- Temporary (developer-loaded) extensions are removed on restart. See the [Permanent Installation](#permanent-installation-self-signed--developer-build) section.

---

## Privacy

- All data is stored **locally** in `browser.storage.local`
- **No network requests** are made by this extension
- **No telemetry**, no analytics
- Values are stored in **plaintext** — do not store highly sensitive credentials you wouldn't write in a text file

---

## Development

### File structure

```
manifest.json       Extension manifest
background/         Background script (message router)
content/            Content script (autofill engine)
popup/              Toolbar popup UI
options/            Options / preferences page
shared/             Shared storage helpers
icons/              Extension icons
docs/               Architecture and planning documents
scripts/            Dev scripts (icon generation)
```

### Regenerating icons

```bash
npm install
node scripts/generate-icons.js
```

### Running in dev mode

```bash
web-ext run --source-dir .
```

This launches a clean Firefox profile with the extension loaded and auto-reloads on file changes.
