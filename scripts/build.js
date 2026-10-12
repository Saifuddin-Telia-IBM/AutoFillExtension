/**
 * scripts/build.js
 *
 * Assembles an installable copy of the extension for a given browser:
 *   node scripts/build.js firefox   -> dist/firefox  (manifest.json, MV2)
 *   node scripts/build.js chrome    -> dist/chrome   (manifest.chrome.json, MV3)
 *   node scripts/build.js all       -> both
 *
 * Set EXT_VERSION to override the manifest version in the build output only
 * (source manifests are not modified), e.g.:
 *   EXT_VERSION=1.0.1 node scripts/build.js all
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dirs = ['background', 'content', 'popup', 'options', 'shared', 'icons'];

const targets = {
  firefox: 'manifest.json',
  chrome:  'manifest.chrome.json',
};

const versionOverride = process.env.EXT_VERSION;
if (versionOverride && !/^\d+(\.\d+){0,3}$/.test(versionOverride)) {
  console.error('EXT_VERSION must be 1-4 dot-separated integers, e.g. 1.0.1 (got "' + versionOverride + '")');
  process.exit(1);
}

function build(name) {
  const out = path.join(root, 'dist', name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const dir of dirs) {
    fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, targets[name]), 'utf8'));
  if (versionOverride) manifest.version = versionOverride;
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(name + ' ' + manifest.version + ' build written to ' + path.relative(root, out));
}

const arg = process.argv[2];
if (arg === 'all') {
  Object.keys(targets).forEach(build);
} else if (targets[arg]) {
  build(arg);
} else {
  console.error('Usage: node scripts/build.js <firefox|chrome|all>');
  process.exit(1);
}
