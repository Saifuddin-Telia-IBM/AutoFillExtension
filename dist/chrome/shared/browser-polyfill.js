/**
 * shared/browser-polyfill.js
 *
 * Chrome exposes the WebExtension API as `chrome` rather than `browser`.
 * Chrome MV3 APIs return promises when no callback is given, so a simple
 * alias is enough for the calls this extension makes.
 */

'use strict';

if (typeof globalThis.browser === 'undefined') {
  globalThis.browser = globalThis.chrome;
}
