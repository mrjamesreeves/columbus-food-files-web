const { checkPassword, setSession, clearSession, isEditor } = require('./_auth');

// Slow down guessing. Serverless instances are short-lived so this is a speed
// bump rather than a lockout, but it makes an online brute force impractical.
let lastFailure = 0;

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ editor: isEditor(req) });
  }
  if (req.method === 'DELETE') {
    clearSession(res);
    return res.status(200).json({ editor: false });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const since = Date.now() - lastFailure;
  if (since < 1000) return res.status(429).json({ error: 'too fast, try again' });

  let password = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    password = body.password || '';
  } catch {
    return res.status(400).json({ error: 'bad request' });
  }

  try {
    if (!password || !checkPassword(password)) {
      lastFailure = Date.now();
      await new Promise((r) => setTimeout(r, 400));
      return res.status(401).json({ error: 'wrong password' });
    }
  } catch (e) {
    console.error('[login]', e.message);
    return res.status(500).json({ error: 'server not configured' });
  }

  setSession(res);
  return res.status(200).json({ editor: true });
};
