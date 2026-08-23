/**
 * Session handling for the one person allowed to edit.
 *
 * A password check mints a signed, http-only cookie that lasts a year, so C.
 * signs in once on her phone and never thinks about it again. No dependencies:
 * scrypt for the password, HMAC for the cookie, both from node:crypto.
 */

const crypto = require('crypto');

const SESSION_COOKIE = 'cff_session';
const FLAG_COOKIE = 'cff_editor';           // readable by the page, not a credential
const YEAR = 60 * 60 * 24 * 365;

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}

/** EDIT_PASSWORD_HASH is "scrypt$<saltHex>$<keyHex>" — see scripts/hash-password.js */
function checkPassword(password) {
  const [scheme, saltHex, keyHex] = need('EDIT_PASSWORD_HASH').split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) throw new Error('EDIT_PASSWORD_HASH is malformed');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', need('SESSION_SECRET')).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', need('SESSION_SECRET')).update(body).digest('base64url');
  const a = Buffer.from(mac || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((acc, part) => {
    const i = part.indexOf('=');
    if (i > 0) acc[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    return acc;
  }, {});
}

function isEditor(req) {
  return Boolean(verify(parseCookies(req)[SESSION_COOKIE]));
}

function setSession(res) {
  const token = sign({ editor: true, exp: Date.now() + YEAR * 1000 });
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`,
    `${FLAG_COOKIE}=1; Path=/; Max-Age=${YEAR}; Secure; SameSite=Lax`,
  ]);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    `${FLAG_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`,
  ]);
}

module.exports = { checkPassword, isEditor, setSession, clearSession, SESSION_COOKIE, FLAG_COOKIE };
