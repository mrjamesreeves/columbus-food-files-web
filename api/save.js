/**
 * Write one restaurant's notes back to notes/source.txt on GitHub.
 *
 * The commit triggers Vercel's build, which re-runs the parser and rebuilds
 * the page. C. sees her change immediately because the page updates locally;
 * everyone else sees it once that deploy lands, about ten seconds later.
 */

const { isEditor } = require('./_auth');
const { splitEntries, replaceBody } = require('../lib/entries');

const REPO = 'mrjamesreeves/columbus-food-files-web';
const FILE = 'notes/source.txt';
const BRANCH = 'main';
const MAX_BODY = 40000;   // the longest real entry is ~2.7KB

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
    console.error('[save] GITHUB_TOKEN is not set');
    return res.status(500).json({ error: 'server not configured' });
  }

  let id, notes;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    id = String(body.id || '');
    notes = String(body.notes ?? '');
  } catch {
    return res.status(400).json({ error: 'bad request' });
  }
  if (!id) return res.status(400).json({ error: 'missing id' });
  if (notes.length > MAX_BODY) return res.status(413).json({ error: 'that is an implausibly long entry' });

  try {
    // Always read the file fresh, so two edits in a row cannot clobber.
    const file = await gh(`contents/${FILE}?ref=${BRANCH}`);
    const current = Buffer.from(file.content, 'base64').toString('utf8');

    const entry = splitEntries(current).find((e) => e.id === id);
    if (!entry) return res.status(404).json({ error: 'no such entry' });

    const updated = replaceBody(current, id, notes);
    // replaceBody returns null when the id is ambiguous — never guess.
    if (updated === null) return res.status(409).json({ error: 'entry is ambiguous, not saved' });
    if (updated === current) return res.status(200).json({ ok: true, unchanged: true, name: entry.name });

    await gh(`contents/${FILE}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Update ${entry.name}`,
        content: Buffer.from(updated, 'utf8').toString('base64'),
        sha: file.sha,
        branch: BRANCH,
      }),
    });

    return res.status(200).json({ ok: true, name: entry.name });
  } catch (e) {
    console.error('[save]', e.message);
    // A 409 from GitHub means the file moved under us; the client should retry.
    const conflict = /-> 409/.test(e.message);
    return res.status(conflict ? 409 : 502).json({ error: conflict ? 'please try again' : 'could not save' });
  }
};
