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
- Listens for messages from the content script
- Handles the `GET_PROFILES_FOR_URL` message: reads storage, matches the URL against all pattern keys **and their `aliases`**, and returns matching profiles
- Thin coordinator — no business logic
- **Important:** because Chrome service workers cannot load external scripts, `background.js` inlines its own copies of `stripHash`, `patternMatches`, `migrateValue`, and `getProfilesForUrl`. These must be kept in sync with `shared/storage.js` whenever the matching logic or data shape changes — the aliases check in particular must appear in both places.

### `content/autofill.js`
- Injected into every page at `document_idle`
- On load: sends `GET_PROFILES_FOR_URL` with `window.location.href` to background
- Background returns all matching profiles (each with their enabled rules)
- Content script shows a **toast** listing available profiles; user clicks one to fill
- **Phase 1 — initial observer**: `MutationObserver` for up to 3 seconds after page load to catch late-rendered fields (SPAs, lazy content)
- **Phase 2 — persistent observer**: always-on `MutationObserver` that re-shows the toast when new nodes (modals, dialogs) are injected
- Uses `setNativeValue()` (native `HTMLInputElement.prototype.value` setter) to bypass framework-overridden `.value` descriptors (Angular, React)
- Dispatches synthetic events with `{ bubbles: true, composed: true }` so they cross shadow DOM boundaries and reach host-element listeners (Carbon Design System, other web components)
- Pierces shadow DOM to fill web components

### `shared/storage.js`
- `getAllRules()` — returns entire rules map (migrates legacy flat-array entries on first load)
- `saveRules(rules)` — persists entire rules map
- `getProfilesForUrl(url)` — returns all matching profiles (with only their enabled rules) across all matching patterns and their aliases
- `getMatchingPatterns(url)` — returns all pattern keys whose primary URL or aliases match the given URL
- `ensurePattern(urlPattern)` — creates a pattern key if absent
- `deletePattern(urlPattern)` — removes a pattern and all its profiles
- `addProfile(urlPattern, name)` — adds a named profile, returns new id
- `renameProfile(urlPattern, profileId, newName)`
- `deleteProfile(urlPattern, profileId)`
- `addAlias(urlPattern, alias)` — adds an extra URL that shares the pattern's profiles
- `removeAlias(urlPattern, alias)` — removes an alias URL
- `addRule(urlPattern, profileId, fieldRule)` — adds a rule to a specific profile, returns new id
- `updateRule(urlPattern, profileId, ruleId, patch)` — partial update
- `deleteRule(urlPattern, profileId, ruleId)`
- `importRules(rules)` — replaces all rules

### `popup/popup.js`
- Shows current page URL
- Lists existing profiles and their rules for the current page
- Provides inline add/edit/delete/toggle per rule
- Add/delete profiles per pattern
- Rename a profile via the ✎ button or double-click on its name
- "Fill now" button sends a `FILL_PROFILE` message to the content script
- Communicates with storage via direct `browser.storage.local` calls

### `options/options.js`
- Full-page rule manager
- Shows all URL patterns, their aliases, their profiles, and their rules
- Add/remove aliases per pattern (+ Add URL / ✕)
- Add/delete/rename profiles per pattern
- Add/edit/toggle/delete rules per profile
- Import / Export rules as JSON

---

## Data Model

```jsonc
// browser.storage.local key: "autofillRules"
{
  "autofillRules": {
    "http://192.168.1.1/setup": {
      "aliases": ["http://10.0.0.1/setup"],   // optional — extra URLs sharing these profiles
      "profiles": [
        {
          "id": "profile-uuid-1",
          "name": "Admin",
          "rules": [
            {
              "id": "rule-uuid-1",
              "enabled": true,
              "selector": "#username",
              "type": "text",       // "text" | "checkbox" | "radio" | "select"
              "value": "admin",
              "label": "Username"
            },
            {
              "id": "rule-uuid-2",
              "enabled": true,
              "selector": "input[name='remember']",
              "type": "checkbox",
              "value": true
            }
          ]
        },
        {
          "id": "profile-uuid-2",
          "name": "Guest",
          "rules": [
            {
              "id": "rule-uuid-3",
              "enabled": true,
              "selector": "#username",
              "type": "text",
              "value": "guest"
            }
          ]
        }
      ]
    },
    "https://example.com/config*": {
      "profiles": [
        {
          "id": "profile-uuid-3",
          "name": "Default",
          "rules": [
            {
              "id": "rule-uuid-4",
              "enabled": false,
              "selector": "#theme",
              "type": "select",
              "value": "dark"
            }
          ]
        }
      ]
    }
  }
}
```

Legacy entries where the value is a flat array of rules (pre-v2 format) are silently migrated to a single "Default" profile on first load.

### Pattern Entry Fields

| Field | Type | Description |
|---|---|---|
| `aliases` | string[] _(optional)_ | Additional URL patterns that share this entry's profiles |
| `profiles` | Profile[] | One or more named fill-sets |

### Profile Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | UUID, stable key for updates/deletes |
| `name` | string | Display name shown in the toast and UI |
| `rules` | Rule[] | Ordered list of field-fill rules |

### Rule Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | UUID, stable key for updates/deletes |
| `enabled` | boolean | If false, rule is skipped during autofill |
| `selector` | string | CSS selector to find the element |
| `type` | string | Fill strategy hint: `text`, `checkbox`, `radio`, `select` |
| `value` | string \| boolean | Value to fill. Checkbox: `true`/`false`. Radio: the `.value` of the target radio. Text/select: string |
| `label` _(optional)_ | string | Human-readable description shown in the UI |

---

## URL Pattern Matching

Matching is done in `shared/storage.js` (`patternMatches`). For each stored pattern entry, both the primary key **and every alias** are tested:

1. **Exact match** — pattern equals current URL (ignoring hash)
2. **Glob/wildcard** — pattern ends with `*`, current URL must start with the prefix
3. **Hostname-only** — pattern is a bare hostname (no path), matches any path on that host
4. **SPA hash routes** — when the pattern contains `#`, the full URL (including hash) is compared

All matching entries contribute their profiles; there is no first-match-only cutoff.

---

## Message Protocol (content ↔ background)

```
Content → Background:
  { type: "GET_PROFILES_FOR_URL", url: string }

Background → Content (response):
  { profiles: Profile[] }   // may be empty array
                            // each Profile: { id, name, rules (enabled only), patternKey }

Content → Background (fill request from popup):
  { type: "FILL_PROFILE", profileId: string }

Content → Background (re-show toast):
  { type: "SHOW_TOAST" }
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
   ├─► Send GET_PROFILES_FOR_URL → background.js
   │         │
   │         └─► getProfilesForUrl(url) → return matching profiles
   │
   ▼
Any profiles with matching DOM selectors?
   │
   ├── Yes → Show toast listing profile names
   │              │
   │              └─► User clicks profile button → fillProfile(profile)
   │                        │
   │                        ├─► type=text/textarea/select → el.value = value; dispatch input+change
   │                        ├─► type=checkbox             → el.checked = value; dispatch change
   │                        └─► type=radio                → el.checked = true; dispatch change
   │
   ├── No (fields not in DOM yet) → poll every 200ms for up to 3s, then show toast
   │
   └─► Persistent MutationObserver — re-shows toast when new nodes (modals) are added
```

---

## Security Considerations

- Extension only fills fields the user has explicitly configured
- No external network requests
- Values are stored in plaintext — warn user not to store sensitive passwords (or add optional obfuscation in a future version)
- Content script has no elevated privileges beyond filling DOM elements
