# AutoFill Extension — Architecture Document

## Directory Structure

```
AutoFillExtension/
├── manifest.json               # Firefox manifest (MV2)
├── manifest.chrome.json        # Chrome manifest (MV3)
├── background/
│   └── background.js           # Background script — message router
├── content/
│   └── autofill.js             # Content script — runs on every page
├── popup/
│   ├── popup.html              # Toolbar popup
│   ├── popup.js                # Popup logic
│   └── popup.css               # Popup styles
├── options/
│   ├── options.html            # Full options page
│   ├── options.js              # Options page logic
│   └── options.css             # Options styles
├── shared/
│   ├── storage.js              # Storage read/write helpers (shared module)
│   └── browser-polyfill.js     # Aliases `browser` to `chrome` on Chrome
├── icons/
│   ├── icon-48.png
│   └── icon-96.png
├── scripts/
│   ├── build.js                # Builds dist/firefox and dist/chrome
│   └── generate-icons.js       # Icon generation
├── dist/                       # Generated build output (not hand-edited)
│   ├── firefox/                # npm run build:firefox
│   ├── chrome/                 # npm run build:chrome
│   └── packages/               # npm run package (zips)
└── docs/
    ├── APPROACH.md
    ├── ARCHITECTURE.md
    ├── TASKS.md
    └── PROGRESS.md
```

---

## Component Responsibilities

### `manifest.json` (Firefox)
- Declares `manifest_version: 2` (Firefox MV2 — most stable for Firefox extensions)
- Requests permissions: `storage`, `activeTab`, `<all_urls>`
- Registers the background script, content script (matching all URLs), popup, and options page

### `manifest.chrome.json` (Chrome / Chromium)
- Declares `manifest_version: 3` (required by Chrome)
- `<all_urls>` moves to `host_permissions`; `browser_action` becomes `action`
- Background is a `service_worker` instead of a persistent/event page script
- No `browser_specific_settings` (Firefox-only)
- Copied to `manifest.json` inside `dist/chrome/` by the build script

### `shared/browser-polyfill.js`
- Chrome only exposes `chrome.*`; this sets `globalThis.browser = globalThis.chrome` when `browser` is undefined
- Loaded by the content script (via manifest), popup and options pages (via `<script>`)
- `background/background.js` contains the same one-line alias inline (service workers can't load it from the manifest)

### `scripts/build.js`
- `node scripts/build.js <firefox|chrome|all>` (wrapped by `npm run build:firefox`, `build:chrome`, `build`)
- Copies `background/`, `content/`, `popup/`, `options/`, `shared/`, `icons/` to `dist/<browser>/` and writes the matching manifest as `manifest.json`
- Optional `EXT_VERSION` env var (1–4 dot-separated integers) overrides `version` in the output manifest only; source manifests are never modified

### Packaging (`npm run package*`)
- `npm run package:firefox` / `package:chrome` / `package` run the matching build, then `web-ext build` zips `dist/<browser>/` into `dist/packages/autofill-<browser>-<version>.zip`
- Firefox zip → install via `about:addons` → **Install Add-on From File…** (with `xpinstall.signatures.required = false` on Developer Edition/Nightly) or submit to AMO; Chrome zip → upload to the Chrome Web Store

### `background/background.js`
- Listens for messages from popup and options page
- Routes storage read/write operations
- Handles the `GET_RULES_FOR_URL` message (used by content script on load)
- Thin coordinator — no business logic

### `content/autofill.js`
- Injected into every page at `document_idle`
- On load: sends `GET_RULES_FOR_URL` with `window.location.href` to background
- Background returns matching rules
- Content script iterates rules and fills each field
- **Phase 1 — initial observer**: `MutationObserver` for up to 3 seconds after page load to catch late-rendered fields (SPAs, lazy content)
- **Phase 2 — persistent observer**: always-on `MutationObserver` that watches for any new nodes added to the DOM at any time; when a modal or dialog is injected (even minutes after load), it immediately fills any matching fields inside it
- Dispatches synthetic `input` and `change` events so frameworks react

### `shared/storage.js`
- `getRulesForUrl(url)` — returns matching rules array for a given URL
- `getAllRules()` — returns entire rules map
- `saveRules(rules)` — persists entire rules map
- `addRule(urlPattern, fieldRule)` — adds a single rule
- `deleteRule(urlPattern, ruleId)` — removes a rule by id
- `updateRule(urlPattern, ruleId, patch)` — partial update

### `popup/popup.js`
- Shows current page URL
- Lists existing rules for the current page
- Provides inline add/edit/delete/toggle per rule
- Renames a profile via the ✎ button or double-click on its name (calls `renameProfile` in `shared/storage.js`)
- Communicates with storage via direct `browser.storage.local` calls

### `options/options.js`
- Full-page rule manager
- Shows all URL patterns and their rules
- Renames a profile via the "✎ Rename" button or double-click on its name
- Import / Export rules as JSON

---

## Data Model

```jsonc
// browser.storage.local key: "autofillRules"
{
  "autofillRules": {
    "http://192.168.1.1/setup": [
      {
        "id": "rule-uuid-1",
        "enabled": true,
        "selector": "#username",
        "type": "text",         // "text" | "checkbox" | "radio" | "select"
        "value": "admin"
      },
      {
        "id": "rule-uuid-2",
        "enabled": true,
        "selector": "input[name='remember']",
        "type": "checkbox",
        "value": true
      },
      {
        "id": "rule-uuid-3",
        "enabled": true,
        "selector": "input[name='mode'][value='advanced']",
        "type": "radio",
        "value": "advanced"
      }
    ],
    "https://example.com/config*": [
      {
        "id": "rule-uuid-4",
        "enabled": false,
        "selector": "#theme",
        "type": "select",
        "value": "dark"
      }
    ]
  }
}
```

### Rule Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | UUID, used as stable key for updates/deletes |
| `enabled` | boolean | If false, rule is skipped during autofill |
| `selector` | string | CSS selector to find the element |
| `type` | string | Hint for fill strategy: `text`, `checkbox`, `radio`, `select` |
| `value` | string \| boolean | Value to fill. Checkbox: `true`/`false`. Radio: the `.value` of the target radio. Text/select: the string value |
| `label` _(optional)_ | string | Human-readable description shown in UI |

---

## URL Pattern Matching

Matching is done in the content script and storage helper:

1. **Exact match** — stored key equals current URL (ignoring hash)
2. **Glob/wildcard** — key ends with `*`, prefix is matched
3. **Hostname-only** — key is just a hostname, matches any path on that host

Matching priority: exact > glob > hostname. First match wins (all matching rules are collected).

---

## Message Protocol (content ↔ background)

```
Content → Background:
  { type: "GET_RULES_FOR_URL", url: string }

Background → Content (response):
  { rules: FieldRule[] }   // may be empty array
```

The popup and options page access `browser.storage.local` directly (they run in the extension context, not the page context).

---

## Event Flow

```
Page Load
   │
   ▼
content/autofill.js injected
   │
   ├─► Send GET_RULES_FOR_URL → background.js
   │         │
   │         └─► getRulesForUrl(url) → return matching rules
   │
   ▼
Iterate rules
   │
   ├─► type=text/textarea/select  → el.value = value; dispatch input+change
   ├─► type=checkbox              → el.checked = value; dispatch change
   └─► type=radio                 → el.checked = true; dispatch change
         │
         └─► MutationObserver (3s timeout) for any late-rendered elements
```

---

## Security Considerations

- Extension only fills fields the user has explicitly configured
- No external network requests
- Values are stored in plaintext — warn user not to store sensitive passwords (or add optional obfuscation in a future version)
- Content script has no elevated privileges beyond filling DOM elements
