#!/usr/bin/env node
// Generates icons/icon-48.png and icons/icon-96.png using the Canvas API (via node-canvas)
// Run: node scripts/generate-icons.js
// Requires: npm install canvas (only needed once during dev)
//
// If you don't want to install canvas, copy any 48x48 and 96x96 PNG into icons/ manually.

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const r = size * 0.1; // corner radius

  // Background — dark blue-grey
  ctx.fillStyle = '#1e3a5f';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // Draw a simplified "form with pencil" symbol
  const pad = size * 0.18;
  const lineH = size * 0.1;
  const lineGap = size * 0.07;
  const startY = size * 0.22;

  ctx.fillStyle = '#7fc8f8';
  // Three horizontal "field" lines
  for (let i = 0; i < 3; i++) {
    const y = startY + i * (lineH + lineGap);
    ctx.beginPath();
    ctx.roundRect(pad, y, size - pad * 2, lineH, lineH / 2);
    ctx.fill();
  }

  // Small checkmark on bottom line to suggest autofill
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.07;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = size * 0.55;
  const cy = startY + 2 * (lineH + lineGap) + lineH * 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.1, cy);
  ctx.lineTo(cx - size * 0.02, cy + size * 0.09);
  ctx.lineTo(cx + size * 0.13, cy - size * 0.09);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

const iconsDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [48, 96]) {
  const buf = drawIcon(size);
  const outPath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`Written: ${outPath}`);
}
