# AutoFill Browser Extension (Firefox & Chrome)

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

## Building

Firefox (Manifest V2) and Chrome (Manifest V3) need different manifests, so each browser gets its own build folder. Requires Node.js (and `npm install -g web-ext` for packaging).

### Unpacked builds (for development)

| Command | Output | Manifest used |
|---|---|---|
| `npm run build:firefox` | `dist/firefox/` | `manifest.json` (MV2) |
| `npm run build:chrome` | `dist/chrome/` | `manifest.chrome.json` (MV3) |
| `npm run build` | both of the above | — |

Each build copies `background/`, `content/`, `popup/`, `options/`, `shared/` and `icons/` into its output folder and writes the right manifest as `manifest.json`. Rebuild after any source change.

### Packaged builds (zip files)

| Command | Output |
|---|---|
| `npm run package:firefox` | `dist/packages/autofill-firefox-<version>.zip` |
| `npm run package:chrome` | `dist/packages/autofill-chrome-<version>.zip` |
| `npm run package` | both of the above |

Each `package:*` command runs the matching `build:*` first, then zips the folder with `web-ext build`. The version comes from the manifest.

- The **Firefox** zip can be installed directly via `about:addons` → gear icon → **Install Add-on From File…** (unsigned installs need Developer Edition / Nightly with `xpinstall.signatures.required = false`; see below), or uploaded to AMO for signing.
- The **Chrome** zip is what you upload to the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole). Chrome does not install a loose zip directly; for local use, unzip it or load `dist/chrome` as an unpacked extension.

The equivalent manual commands, if you don't want to use npm:

```bash
# Firefox
node scripts/build.js firefox
web-ext build --source-dir dist/firefox --artifacts-dir dist/packages --filename autofill-firefox-{version}.zip --overwrite-dest

# Chrome
node scripts/build.js chrome
web-ext build --source-dir dist/chrome --artifacts-dir dist/packages --filename autofill-chrome-{version}.zip --overwrite-dest
```

---

## Installation in Firefox (Developer / Unpacked)

Firefox doesn't require a signed extension for local developer use.

1. Build: `npm run build:firefox`
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on…"**
4. Select `dist/firefox/manifest.json`
5. The AutoFill icon will appear in the toolbar

> Temporary add-ons are removed when Firefox restarts. For permanent installation, package and sign the extension (see below).

---

## Installation in Chrome (Developer / Unpacked)

1. Build: `npm run build:chrome`
2. Open `chrome://extensions` and enable **Developer mode** (top-right toggle)
3. Click **"Load unpacked"** and select the `dist/chrome` folder
4. Pin the AutoFill icon from the puzzle-piece menu in the toolbar

The same build works in other Chromium browsers (Edge, Brave, etc.) via their `edge://extensions` / `brave://extensions` pages. After rebuilding, click the reload icon on the extension's card in `chrome://extensions`.

---

## Permanent Installation of Firefox Build (Self-Signed / Developer Build)

### Prerequisites

```bash
npm install -g web-ext
```

### Build the package

```bash
npm run package:firefox
```

This creates `dist/packages/autofill-firefox-1.0.0.zip`. No renaming is needed; Firefox installs the `.zip` as-is.

### Install permanently (Firefox Developer Edition / Nightly only)

1. In `about:config`, set:
   ```
   xpinstall.signatures.required = false
   ```
2. Open `about:addons` (**Manage Extensions**).
3. Click the gear icon → **Install Add-on From File…**
4. Select `dist/packages/autofill-firefox-1.0.0.zip`.

The extension stays installed across restarts.

> Release Firefox ignores `xpinstall.signatures.required`, so this only works on Developer Edition, Nightly, or unbranded builds. On release Firefox, submit the zip to AMO for signing (below).

To try changes without installing, run a temporary session instead:
```bash
npm run build:firefox
web-ext run --source-dir dist/firefox
```

### Submit to AMO (addons.mozilla.org) for signing

Follow the [official AMO upload guide](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).

---

## Publishing the Chrome Build

Run `npm run package:chrome` and upload `dist/packages/autofill-chrome-<version>.zip` in the Chrome Web Store developer dashboard. Bump `version` in both `manifest.json` and `manifest.chrome.json` for each release.

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

Click **"Manage all rules →"** in the popup, or go to `about:addons` → AutoFill → **Preferences** (Firefox) / `chrome://extensions` → AutoFill → **Details** → **Extension options** (Chrome).

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
- Temporary (developer-loaded) extensions are removed on restart. See the [Permanent Installation](#permanent-installation-of-firefox-build-self-signed--developer-build) section.

---

## Privacy

- All data is stored **locally** in `browser.storage.local` (`chrome.storage.local` in Chrome)
- **No network requests** are made by this extension
- **No telemetry**, no analytics
- Values are stored in **plaintext** — do not store highly sensitive credentials you wouldn't write in a text file

---

## Development

### File structure

```
manifest.json         Firefox manifest (MV2)
manifest.chrome.json  Chrome manifest (MV3)
background/           Background script (message router)
content/              Content script (autofill engine)
popup/                Toolbar popup UI
options/              Options / preferences page
shared/               Shared helpers (storage, browser API polyfill)
icons/                Extension icons
docs/                 Architecture and planning documents
scripts/              Dev scripts (build.js, generate-icons.js)
dist/firefox/         Generated Firefox build (npm run build:firefox)
dist/chrome/          Generated Chrome build (npm run build:chrome)
dist/packages/        Generated zips (npm run package)
```

### Regenerating icons

```bash
npm install
node scripts/generate-icons.js
```

### Running in dev mode

```bash
npm run build:firefox
web-ext run --source-dir dist/firefox
```

This launches a clean Firefox profile with the extension loaded. Re-run `npm run build:firefox` after source changes to refresh `dist/firefox`.
