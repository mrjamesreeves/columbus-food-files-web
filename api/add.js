/**
 * Create a new restaurant in notes/source.txt on GitHub.
 *
 * Same shape as save.js: read fresh, change one thing, commit. insertEntry
 * places the new entry alphabetically and refuses duplicates, so the file
 * stays ordered without anyone thinking about it.
 */

const { isEditor } = require('./_auth');
const { insertEntry, setVerdictTag } = require('../lib/entries');

const REPO = 'mrjamesreeves/columbus-food-files-web';
const FILE = 'notes/source.txt';
const BRANCH = 'main';
const MAX_BODY = 40000;
const MAX_NAME = 120;

async function gh(path, init = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'columbus-food-files',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`github ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!isEditor(req)) return res.status(401).json({ error: 'not signed in' });
  if (!process.env.GITHUB_TOKEN) {
    console.error('[add] GITHUB_TOKEN is not set');
    return res.status(500).json({ error: 'server not configured' });
  }

  let name, notes, verdict = null;
  const VERDICTS = new Set(['great', 'good', 'ok', 'meh', 'bad']);
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    name = String(body.name || '').trim();
    notes = String(body.notes ?? '');
    if (body.verdict != null) {
      verdict = String(body.verdict).toLowerCase();
      if (!VERDICTS.has(verdict)) return res.status(400).json({ error: 'not a verdict' });
    }
  } catch {
    return res.status(400).json({ error: 'bad request' });
  }
  if (!name) return res.status(400).json({ error: 'it needs a name' });
  if (name.length > MAX_NAME) return res.status(400).json({ error: 'that name is implausibly long' });
  if (notes.length > MAX_BODY) return res.status(413).json({ error: 'those notes are implausibly long' });

  try {
    const file = await gh(`contents/${FILE}?ref=${BRANCH}`);
    const current = Buffer.from(file.content, 'base64').toString('utf8');

    // A tapped chip beats a typed [TAG]; with no chip, typed tags stand.
    const result = insertEntry(current, verdict ? setVerdictTag(name, verdict) : name, notes);
    if (result.error) return res.status(409).json({ error: result.error });

    await gh(`contents/${FILE}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Add ${name.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim()}`,
        content: Buffer.from(result.text, 'utf8').toString('base64'),
        sha: file.sha,
        branch: BRANCH,
      }),
    });

    return res.status(200).json({ ok: true, id: result.id });
  } catch (e) {
    console.error('[add]', e.message);
    const conflict = /-> 409/.test(e.message);
    return res.status(conflict ? 409 : 502).json({ error: conflict ? 'please try again' : 'could not save' });
  }
};
