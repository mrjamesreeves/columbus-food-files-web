/**
 * Locating entries inside notes/source.txt.
 *
 * Shared by scripts/parse.js (builds the site), api/save.js (writes C.'s
 * edits back) and api/add.js (creates entries). All must agree exactly on
 * where one restaurant ends and the next begins.
 *
 * Entries are separated by a delimiter line of three or more equals signs.
 * The first heuristic format (blank-line-separated, with continuation rules)
 * corrupted itself once a human edited bodies live: a blank line followed by
 * prose looked like a new restaurant, which silently shrank the region the
 * next save replaced, which left stale tails behind. With an explicit
 * delimiter, a body can contain anything at all.
 */

const DELIM = /^\s*={3,}\s*$/;

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The display name, with annotations stripped:
 *   "Chili Spot [GREAT] [chinese]"                -> "Chili Spot"
 *   "Al Manakeesh - by Meijer. Cheeses on bread"  -> "Al Manakeesh"
 *   "Kyoto (on Sawmill)"                          -> "Kyoto"
 */
function displayName(nameLine) {
  let n = String(nameLine).trim();
  while (/\s*\[[^\]]*\]\s*$/.test(n)) n = n.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  const dash = n.match(/^(.{2,40}?)\s+[-–]\s+(.+)$/);
  if (dash) n = dash[1].trim();
  const paren = n.match(/^(.+?)\s*\(([^)]*)\)\s*$/);
  if (paren) n = paren[1].trim();
  return n.replace(/\s+/g, ' ').trim();
}

/** Alphabetical position, ignoring a leading "The". */
function sortKey(name) {
  return displayName(name).toLowerCase().replace(/^the\s+/, '');
}

/**
 * Split the file into entries by line range.
 *
 * An entry runs from the first non-blank line after a delimiter (its name
 * line) to the last non-blank line before the next delimiter. Interior blank
 * lines are content. Returns half-open line ranges so edits can splice
 * without touching a byte of any other entry.
 */
function splitEntries(raw) {
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n');
  const regions = [];
  let start = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || DELIM.test(lines[i])) {
      regions.push([start, i]);
      start = i + 1;
    }
  }

  const out = [];
  for (const [a, b] of regions) {
    let s = a, e = b;
    while (s < e && !lines[s].trim()) s++;
    while (e > s && !lines[e - 1].trim()) e--;
    if (s >= e) continue;                       // an empty region is not an entry
    const nameLine = lines[s].trim();
    out.push({
      id: slugify(displayName(nameLine)),
      name: displayName(nameLine),
      nameLine,
      start: s,
      end: e,
      bodyStart: s + 1,
      bodyEnd: e,
      body: lines.slice(s + 1, e).join('\n'),
    });
  }
  return out;
}

/**
 * Replace one entry's body, leaving its name line and every other entry byte
 * for byte as they were. Returns the new file text, or null if the id is
 * unknown or ambiguous — callers must treat null as "refuse to write".
 */
function replaceBody(raw, id, newBody) {
  const text = String(raw).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const found = splitEntries(text).filter((e) => e.id === id);
  if (found.length !== 1) return null;
  const entry = found[0];

  // Strip trailing newlines only: trailing spaces on lines are hers to keep.
  const body = String(newBody).replace(/\r\n/g, '\n').replace(/\n+$/, '');
  return [
    ...lines.slice(0, entry.bodyStart),
    ...(body ? body.split('\n') : []),
    ...lines.slice(entry.bodyEnd),
  ].join('\n');
}

/**
 * Insert a new entry in alphabetical position (ignoring a leading "The").
 * Returns { text, id } or an { error } the caller can send straight back.
 */
function insertEntry(raw, nameLine, body) {
  const text = String(raw).replace(/\r\n/g, '\n');
  const name = String(nameLine).trim();
  if (!name || /\n/.test(name)) return { error: 'name must be one non-empty line' };
  if (DELIM.test(name)) return { error: 'that is not a name' };
  const id = slugify(displayName(name));
  if (!id) return { error: 'name needs at least one letter or number' };

  const entries = splitEntries(text);
  if (entries.some((e) => e.id === id)) return { error: 'that place already exists' };

  const cleanBody = String(body || '').replace(/\r\n/g, '\n').replace(/\n+$/, '')
    .split('\n').filter((l) => !DELIM.test(l)).join('\n');
  const chunk = name + (cleanBody ? '\n' + cleanBody : '');

  const key = sortKey(name);
  const after = entries.find((e) => sortKey(e.nameLine) > key);
  const lines = text.split('\n');

  let out;
  if (!after) {
    out = text.replace(/\n*$/, '') + '\n\n=====\n\n' + chunk + '\n';
  } else {
    out = [
      ...lines.slice(0, after.start),
      ...chunk.split('\n'),
      '',
      '=====',
      '',
      ...lines.slice(after.start),
    ].join('\n');
  }
  return { text: out, id };
}

/**
 * Rewrite the verdict tag on a name line, leaving other tags (cuisine,
 * closed) and the name itself alone. verdict of null removes it.
 */
const VERDICT_TAG = /\s*\[\s*(great|good|okay|ok|meh|bad|excellent)\s*\]/gi;
function setVerdictTag(nameLine, verdict) {
  let n = String(nameLine).replace(VERDICT_TAG, '').replace(/\s+$/, '');
  if (verdict) n += ` [${String(verdict).toUpperCase()}]`;
  return n;
}

/**
 * Replace an entry's name line and body together. Same contract as
 * replaceBody: byte-exact everywhere else, null means refuse.
 */
function replaceEntry(raw, id, nameLine, newBody) {
  const name = String(nameLine).trim();
  if (!name || /\n/.test(name) || DELIM.test(name)) return null;
  const text = String(raw).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const found = splitEntries(text).filter((e) => e.id === id);
  if (found.length !== 1) return null;
  const entry = found[0];
  // The name may change its annotations but never its identity: a renamed
  // entry would strand the id the client is holding.
  if (slugify(displayName(name)) !== id) return null;
  const body = String(newBody).replace(/\r\n/g, '\n').replace(/\n+$/, '');
  return [
    ...lines.slice(0, entry.start),
    name,
    ...(body ? body.split('\n') : []),
    ...lines.slice(entry.bodyEnd),
  ].join('\n');
}

module.exports = { DELIM, slugify, displayName, sortKey, splitEntries, replaceBody, insertEntry, setVerdictTag, replaceEntry };
