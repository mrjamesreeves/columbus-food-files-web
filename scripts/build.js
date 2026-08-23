#!/usr/bin/env node
/**
 * Inline the parsed entries into the page, producing a single self-contained
 * index.html. One file, no fetch, no build-time dependency at runtime.
 *
 * Run:  node scripts/build.js   (after scripts/parse.js)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const entries = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
const template = fs.readFileSync(path.join(ROOT, 'src', 'template.html'), 'utf8');

// Alphabetical, ignoring a leading "The".
const sortKey = (e) => e.name.toLowerCase().replace(/^the\s+/, '');
entries.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

// Ship only what the page uses. verdictConfidence and duplicateMerged are
// parser bookkeeping and stay in data/entries.json.
const slim = entries.map((e) => ({
  id: e.id,
  name: e.name,
  kind: e.kind,
  verdict: e.verdict,
  closed: e.closed,
  location: e.location,
  cuisine: e.cuisine,
  people: e.people,
  visits: e.visits,
  notes: e.notes,
}));

// `<` is escaped so a "</script>" anywhere in the notes cannot end the block.
const json = JSON.stringify(slim).replace(/</g, '\\u003c');

const html = template
  .replace('__DATA__', json)
  .replace('__COUNT__', String(slim.length));

if (html.includes('__DATA__') || html.includes('__COUNT__')) {
  throw new Error('template placeholder was not substituted');
}

const outDir = path.join(ROOT, 'public');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'index.html');
fs.writeFileSync(out, html);
console.log(`built index.html — ${slim.length} entries, ${(html.length / 1024).toFixed(0)}K`);
