/**
 * Locating entries inside notes/source.txt.
 *
 * Shared by scripts/parse.js (which builds the site) and api/save.js (which
 * writes C.'s edits back). Both must agree exactly on where one restaurant
 * ends and the next begins, or a save would overwrite the wrong notes.
 */

// A blank line inside an entry — before a bullet run, after a heading, or
// around a stray link — would otherwise read as the start of a new
// restaurant. None of these shapes can be a name.
const CONTINUATION = new RegExp([
  '^\\s*[*\\u2022\\u00b7-]\\s+',            // a bullet
  '^\\s*https?://',                          // a bare link
  '[-\\u2013\\u2014]\\s*$',                  // a dish stub left dangling: "Eggs Benedict - "
  '^\\s*[^a-z0-9]*$',                        // punctuation only, e.g. "?"
  // A heading, with or without its colon: "Great:", "Try.", "Good ok", "Not great:"
  '^\\s*(not\\s+)?(great|good|ok|okay|meh|bad|try|excellent|order|avoid)(\\s+(ok|good|great))?\\s*[:.]?\\s*$',
  '^(lunch buffets?|hours?|open|closed \\w+day|m-f|sa-su|tue|wed|thu|fri|sat|sun)\\b',
].join('|'), 'i');

const TITLE = /^OH restaurants reviewed$/i;
const EMPTY_CHECKBOX = /^-\s*\[\s*\]$/;

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The display name, with the parser's annotations stripped:
 *   "Chili Spot [GREAT] [chinese]"                    -> "Chili Spot"
 *   "Al Manakeesh - by Meijer. Cheeses on bread"      -> "Al Manakeesh"
 *   "Kyoto (on Sawmill)"                              -> "Kyoto"
 */
function displayName(nameLine) {
  let n = nameLine.trim();
  while (/\s*\[[^\]]*\]\s*$/.test(n)) n = n.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  const dash = n.match(/^(.{2,40}?)\s+[-–]\s+(.+)$/);
  if (dash) n = dash[1].trim();
  const paren = n.match(/^(.+?)\s*\(([^)]*)\)\s*$/);
  if (paren) n = paren[1].trim();
  return n.replace(/\s+/g, ' ').trim();
}

/**
 * Split the file into entries by line range.
 *
 * Returns, for each restaurant: its id, the line its name sits on, and the
 * half-open line range [start, end) it occupies including any blank lines and
 * continuation blocks. Working in line ranges rather than blank-line-delimited
 * blocks is what lets an entry contain blank lines of its own.
 */
function splitEntries(raw) {
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n');

  // A line starts an entry if it has content, follows a blank line (or is the
  // first line), and does not look like a continuation.
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const prevBlank = i === 0 || !lines[i - 1].trim();
    if (!prevBlank) continue;
    if (CONTINUATION.test(line)) continue;
    if (TITLE.test(line.trim()) || EMPTY_CHECKBOX.test(line.trim())) continue;
    starts.push(i);
  }

  return starts.map((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    const nameLine = lines[start].trim();
    // Trim trailing blank lines so a save does not accumulate whitespace.
    let bodyEnd = end;
    while (bodyEnd > start + 1 && !lines[bodyEnd - 1].trim()) bodyEnd--;
    return {
      id: slugify(displayName(nameLine)),
      name: displayName(nameLine),
      nameLine,
      start,
      end,
      bodyStart: start + 1,
      bodyEnd,
      body: lines.slice(start + 1, bodyEnd).join('\n'),
    };
  });
}

/**
 * Replace one entry's body, leaving its name line and every other entry byte
 * for byte as they were. Returns the new file text, or null if the id is
 * unknown — callers must treat null as "refuse to write".
 */
function replaceBody(raw, id, newBody) {
  const text = String(raw).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const found = splitEntries(text).filter((e) => e.id === id);
  // Two entries sharing a name means we cannot know which one she edited.
  // Refuse rather than write to the wrong restaurant's notes.
  if (found.length !== 1) return null;
  const entry = found[0];

  // Strip trailing newlines only. Her notes carry trailing spaces on many
  // lines and those are hers to keep, not whitespace to tidy.
  const body = String(newBody).replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const out = [
    ...lines.slice(0, entry.bodyStart),
    ...(body ? body.split('\n') : []),
    ...lines.slice(entry.bodyEnd),
  ];
  return out.join('\n');
}

module.exports = { CONTINUATION, TITLE, EMPTY_CHECKBOX, slugify, displayName, splitEntries, replaceBody };
