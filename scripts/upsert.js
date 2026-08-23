#!/usr/bin/env node
/**
 * Update one restaurant, or add a new one, without touching the rest.
 *
 *   pbpaste | node scripts/upsert.js          # straight from the clipboard
 *   node scripts/upsert.js entry.txt          # or from a file
 *
 * notes/source.txt stays the single source of truth: the block is replaced in
 * place if the name already exists, or inserted alphabetically if it does not.
 * Re-run parse.js and build.js afterwards (or use scripts/update.sh).
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'notes', 'source.txt');

function readInput() {
  if (process.argv[2]) return fs.readFileSync(process.argv[2], 'utf8');
  const stdin = fs.readFileSync(0, 'utf8');
  if (!stdin.trim()) {
    console.error('Nothing on stdin. Try:  pbpaste | node scripts/upsert.js');
    process.exit(1);
  }
  return stdin;
}

// Match on the name alone, ignoring case, punctuation, a [VERDICT] marker and
// any trailing "(on Sawmill)" so an edited entry still finds its original.
function key(nameLine) {
  return nameLine
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .split(/\s+[-–]\s+/)[0]
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const sortKey = (s) => key(s).replace(/^the /, '');

const incoming = readInput().replace(/\r\n/g, '\n').trim();
if (!incoming) {
  console.error('Empty entry, nothing to do.');
  process.exit(1);
}

const raw = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const blocks = raw.split(/\n\s*\n/).map((b) => b.replace(/\n+$/, '')).filter((b) => b.trim());

const newName = incoming.split('\n')[0].trim();
const newKey = key(newName);
if (!newKey) {
  console.error('Could not read a restaurant name from the first line.');
  process.exit(1);
}

const at = blocks.findIndex((b) => key(b.split('\n')[0].trim()) === newKey);

let action;
if (at > -1) {
  const before = blocks[at];
  blocks[at] = incoming;
  action = `replaced "${before.split('\n')[0].trim()}" (${before.split('\n').length} lines -> ${incoming.split('\n').length})`;
} else {
  // Keep the file alphabetical; block 0 is the "OH restaurants reviewed" title.
  let insert = blocks.length;
  for (let i = 1; i < blocks.length; i++) {
    if (sortKey(blocks[i].split('\n')[0].trim()) > sortKey(newName)) { insert = i; break; }
  }
  blocks.splice(insert, 0, incoming);
  action = `added "${newName}" at position ${insert} of ${blocks.length}`;
}

fs.writeFileSync(SRC, blocks.join('\n\n') + '\n');
console.log(action);
