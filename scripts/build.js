/**
 * scripts/build.js
 *
 * Assembles an installable copy of the extension for a given browser:
 *   node scripts/build.js firefox   -> dist/firefox  (manifest.json, MV2)
 *   node scripts/build.js chrome    -> dist/chrome   (manifest.chrome.json, MV3)
 *   node scripts/build.js all       -> both
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

function build(name) {
  const out = path.join(root, 'dist', name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const dir of dirs) {
    fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(root, targets[name]), path.join(out, 'manifest.json'));

  console.log(name + ' build written to ' + path.relative(root, out));
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
