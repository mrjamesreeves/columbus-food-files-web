#!/usr/bin/env node
/**
 * Turn C.'s single Apple Notes export into structured entries.
 *
 * Run:  node scripts/parse.js
 * In:   notes/source.txt
 * Out:  data/entries.json  +  a report of anything that needed a judgement call
 *
 * The notes are the source of truth. Every entry keeps its original text
 * verbatim in `notes`; everything else is derived and may be wrong.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'notes', 'source.txt');
const OUT = path.join(ROOT, 'data', 'entries.json');

// --- what belongs on a site called Columbus Food Files ---------------------
// Groceries and markets stay: they are places you go for food. Parks and the
// stray note about donating books are not, so they are dropped.
const MARKET = /\b(market|grocery|trader joe|giant eagle|whole foods|saraga)\b/i;
const NOT_FOOD = /^(.*\bpark\b.*|donations)$/i;

// --- cuisine keywords, checked against name + body -------------------------
const CUISINES = {
  indian: /\b(india|indian|biryani|paneer|naan|korma|masala|tikka|dosa|chaat)\b/i,
  chinese: /\b(chinese|szechuan|sichuan|hunan|dim sum|mapo|wonton|xiao long|noodle house)\b/i,
  japanese: /\b(japanese|sushi|ramen|izakaya|hibachi|udon|donburi|onigiri|tempura)\b/i,
  korean: /\b(korean|bibimbap|bulgogi|tofu house|banchan|kimchi)\b/i,
  thai: /\b(thai|pad see|pad thai|tom yum|drunken noodle|massaman)\b/i,
  vietnamese: /\b(vietnamese|pho\b|banh mi|banh me|bun cha)\b/i,
  mexican: /\b(mexican|taco|taqueria|burrito|oaxaca|birria|quesadilla|elote)\b/i,
  italian: /\b(italian|pizza|pasta|piada|calzone|risotto)\b/i,
  'middle eastern': /\b(falafel|gyro|shawarma|hummus|zatar|za'?atar|labneh|palestinian|tagine|moroccan)\b/i,
  ethiopian: /\b(ethiopian|injera|lalibela|doro wat)\b/i,
  american: /\b(burger|bbq|barbecue|diner|deli|wings|steakhouse|comfort food)\b/i,
  seafood: /\b(seafood|lobster|crab|oyster|bonefish|fish fry)\b/i,
  bakery: /\b(bakery|pastry|cake|cookie|crepe|donut|croissant)\b/i,
  cafe: /\b(smoothie|coffee|cafe\b|boba|bubble tea)\b/i,
};

// --- people ----------------------------------------------------------------
// "James Beard" is an award, not a dinner companion.
function findPeople(text) {
  const clean = text.replace(/James Beard/gi, '');
  const out = new Set();
  if (/\bJames\b/.test(clean) || /\bJ\b\.?(?=\s|,|$)/.test(clean) || /\bj\s/.test(clean)) out.add('J');
  if (/\bmom\b/i.test(clean)) out.add('Mom');
  if (/\bdad\b/i.test(clean)) out.add('Dad');
  for (const m of clean.matchAll(/\b([NW])\.(?=\s|,|$)/g)) out.add(m[1] + '.');
  return [...out];
}

// --- overall verdict -------------------------------------------------------
// C. writes the summary as a line that STARTS with the word: "Great!",
// "Excellent! Had 1/2/21", "Good, nothing special". A line like "Great:"
// is different — that heads a list of dishes, not a judgement of the place.
const VERDICT_WORDS = [
  ['great', /^(excellent|amazing|fantastic|wonderful|great)\b/i],
  ['good',  /^(very good|pretty good|good|solid|decent)\b/i],
  ['ok',    /^(okay|ok|fine)\b/i],
  ['meh',   /^(meh|mediocre|underwhelming|forgettable)\b/i],
  ['bad',   /^(bad|awful|terrible|worst)\b/i],
];
const SECTION_HEADER = /^(great|good|ok|okay|meh|bad|try|excellent)\s*:/i;

function findVerdict(lines) {
  for (const line of lines) {
    const s = line.trim();
    if (!s || SECTION_HEADER.test(s)) continue;
    for (const [label, re] of VERDICT_WORDS) {
      const m = s.match(re);
      // Only a summary if the word stands alone or is followed by punctuation:
      // "Good, nothing special" yes; "Good garlic naan" no, that is a dish.
      if (m && /^[!.,;]*$|^[!.,;]\s/.test(s.slice(m[0].length))) {
        return { verdict: label, confidence: 'high' };
      }
    }
  }
  // Fall back to any verdict word in the opening lines, which is a guess.
  const head = lines.slice(0, 4).join(' ');
  for (const [label, re] of VERDICT_WORDS) {
    if (new RegExp(re.source.replace(/^\^/, '\\b'), 'i').test(head)) {
      return { verdict: label, confidence: 'low' };
    }
  }
  return { verdict: null, confidence: 'none' };
}

function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseDates(text) {
  const out = new Set();
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
    let [, mo, d, y] = m;
    y = y.length === 2 ? '20' + y : y;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) {
      out.add(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }
  for (const m of text.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? ?(\d{4})\b/g)) {
    const mo = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
      .indexOf(m[1].toLowerCase()) + 1;
    out.add(`${m[2]}-${String(mo).padStart(2, '0')}`);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
const raw = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
let blocks = raw.split(/\n\s*\n/).map((b) => b.replace(/\n+$/, '')).filter((b) => b.trim());

const report = { dropped: [], merged: [], duplicates: [], noVerdict: [], markets: [], notFood: [] };

// Drop the file title and Apple Notes' empty checkbox artefact.
blocks = blocks.filter((b) => {
  const first = b.split('\n')[0].trim();
  if (/^OH restaurants reviewed$/i.test(first) || /^-\s*\[\s*\]$/.test(b.trim())) {
    report.dropped.push(first || b.trim());
    return false;
  }
  return true;
});

// A block whose first line is plainly not a name is a stray continuation of
// the previous entry that picked up an extra blank line in Apple Notes.
// A blank line inside an entry — before a bullet run, or after a "Try:"
// heading — would otherwise read as the start of a new restaurant. None of
// these shapes can be a name.
const CONTINUATION = new RegExp([
  '^\\s*[*\\u2022\\u00b7-]\\s+',                                   // a bullet
  '^\\s*(great|good|ok|okay|meh|bad|try|excellent|order|avoid)\\s*:\\s*$', // a section heading
  '^(lunch buffets?|hours?|open|closed \\w+day|m-f|sa-su|tue|wed|thu|fri|sat|sun)\\b',
].join('|'), 'i');
const merged = [];
for (const b of blocks) {
  const first = b.split('\n')[0].trim();
  if (merged.length && CONTINUATION.test(first)) {
    report.merged.push({ into: merged[merged.length - 1].split('\n')[0].trim(), text: first });
    merged[merged.length - 1] += '\n\n' + b;
  } else {
    merged.push(b);
  }
}
blocks = merged;

const entries = [];
const seen = new Map();

for (const block of blocks) {
  const lines = block.split('\n');
  let nameLine = lines[0].trim();
  const body = lines.slice(1);

  // Explicit verdict marker: "Chili Spot [GREAT]". Apple Notes drops bold on
  // paste, so this is how to state a verdict outright rather than leaving the
  // parser to infer one from the prose.
  // Trailing [tags] on the name line, any number of them:
  //   "Chili Spot [GREAT] [Chinese]"
  // A verdict word sets the verdict outright; anything else is a cuisine tag.
  // This is the escape hatch for places the name and opening lines cannot
  // classify, and it always beats what the parser would have guessed.
  let stated = null;
  const statedCuisine = [];
  const VERDICT_TAG = /^(great|good|ok|okay|meh|bad|excellent|closed)$/i;
  let tag;
  while ((tag = nameLine.match(/\s*\[\s*([^\]]+?)\s*\]\s*$/))) {
    nameLine = nameLine.slice(0, tag.index).trim();
    const word = tag[1].toLowerCase();
    if (VERDICT_TAG.test(word)) {
      stated = word === 'excellent' ? 'great' : (word === 'okay' ? 'ok' : word);
    } else {
      statedCuisine.unshift(word);
    }
  }

  // "Al Manakeesh - by Meijer. Cheeses and such on bread. Palestinian"
  let trailing = '';
  const dash = nameLine.match(/^(.{2,40}?)\s+[-–]\s+(.+)$/);
  if (dash) { nameLine = dash[1].trim(); trailing = dash[2].trim(); }

  // "Chile Verde Cafe (Mexican)" / "Kyoto (on Sawmill)"
  let paren = '';
  const pm = nameLine.match(/^(.+?)\s*\(([^)]*)\)\s*$/);
  if (pm) { nameLine = pm[1].trim(); paren = pm[2].trim(); }

  const name = nameLine.replace(/\s+/g, ' ').trim();
  const text = [trailing, paren, ...body].filter(Boolean).join('\n');
  const all = name + '\n' + text;

  if (NOT_FOOD.test(name)) {
    report.notFood.push(name);
    continue;
  }
  const kind = MARKET.test(name) ? 'market' : 'restaurant';
  if (kind === 'market') report.markets.push(name);

  // Infer cuisine from the NAME first. Judging by the whole body tags a place
  // by whatever C. happened to eat or mention — Piada came out "indian"
  // because she dipped leftover beef in chicken korma. If the name says
  // nothing, fall back to the opening description only, never the dish list.
  let cuisine = Object.entries(CUISINES)
    .filter(([, re]) => re.test(name)).map(([k]) => k);
  if (!cuisine.length) {
    const intro = [trailing, paren, ...body.slice(0, 2)].filter(Boolean).join(' ');
    cuisine = Object.entries(CUISINES)
      .filter(([, re]) => re.test(intro)).map(([k]) => k);
  }
  cuisine = cuisine.slice(0, 2);
  if (statedCuisine.length) cuisine = statedCuisine;

  let { verdict, confidence } = findVerdict([trailing, paren, ...body].filter(Boolean));
  if (stated && stated !== 'closed') {
    verdict = stated;
    confidence = 'stated';
  }
  if (!verdict) report.noVerdict.push(name);

  // The first short body line that is not a verdict is usually the location.
  const location = [paren, trailing, ...body].filter(Boolean)
    .map((l) => l.trim().replace(/^\((.*)\)$/, '$1').split(/\.\s+/)[0].trim())
    .find((l) =>
    l.length <= 60 &&
    /\b(min|ave|st\b|rd\b|street|downtown|near|by |mall|complex|strip|dublin|grandview|clintonville|short north|german village|worthington|polaris|easton|hilliard|westerville|powell|gahanna|sawmill|henderson|kenny|bethel|arlington|high st)\b/i.test(l)
  ) || null;

  let id = slugify(name);
  if (seen.has(id)) {
    report.duplicates.push(name);
    entries[seen.get(id)].notes += '\n\n---\n\n' + text;   // fold into the first
    entries[seen.get(id)].duplicateMerged = true;
    continue;
  }
  seen.set(id, entries.length);

  entries.push({
    id,
    name,
    kind,
    verdict,
    verdictConfidence: confidence,
    // Narrow on purpose: an entry mentioning that some OTHER place was
    // closed should not be marked closed itself.
    closed: stated === 'closed' ||
      /^\s*(permanently\s+)?closed\b/im.test(all) || /\b(now|permanently)\s+closed\b/i.test(all),
    location,
    cuisine,
    people: findPeople(all),
    visits: parseDates(all),
    prices: [...all.matchAll(/\$\d[\d,.]*(?:\s*(?:each|pp|per person|w tip|after tip|for two)?)?/gi)]
      .map((m) => m[0].trim()),
    links: [...all.matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[).,]+$/, '')),
    notes: text.trim(),
  });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(entries, null, 2));

// --- report ----------------------------------------------------------------
const pct = (n) => `${Math.round((n / entries.length) * 100)}%`;
console.log(`\nparsed ${entries.length} entries -> ${path.relative(ROOT, OUT)}\n`);
console.log(`  with a verdict      ${entries.filter((e) => e.verdict).length}  (${pct(entries.filter((e) => e.verdict).length)})`);
console.log(`    stated outright   ${entries.filter((e) => e.verdictConfidence === 'stated').length}`);
console.log(`    high confidence   ${entries.filter((e) => e.verdictConfidence === 'high').length}`);
console.log(`  with a location     ${entries.filter((e) => e.location).length}`);
console.log(`  with a cuisine tag  ${entries.filter((e) => e.cuisine.length).length}`);
console.log(`  with dated visits   ${entries.filter((e) => e.visits.length).length}`);
console.log(`  mention people      ${entries.filter((e) => e.people.length).length}`);
console.log(`  marked closed       ${entries.filter((e) => e.closed).length}`);
console.log(`\n  dropped:        ${report.dropped.map((d) => JSON.stringify(d)).join(', ')}`);
console.log(`  merged strays:  ${report.merged.map((m) => `"${m.text}" -> ${m.into}`).join('; ') || 'none'}`);
console.log(`  duplicates:     ${report.duplicates.join(', ') || 'none'}`);
console.log(`  markets kept:   ${report.markets.length} (${report.markets.join(', ')})`);
console.log(`  not food, dropped: ${report.notFood.length} (${report.notFood.join(', ')})`);
console.log(`\n  no verdict found (${report.noVerdict.length}): ${report.noVerdict.join(', ')}\n`);
