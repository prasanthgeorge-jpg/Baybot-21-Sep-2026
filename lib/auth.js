// Admin login: one account stored in DATA_DIR/admin.json (scrypt hash, never
// the password itself), signed session cookies, CSRF tokens and a login
// rate limit. There is deliberately no default password: until
// `node tools/admin-user.js` has been run, nobody can log in.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('./config');

const COOKIE = 'bb_admin';
const SESSION_HOURS = 8;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function adminFile() { return path.join(dataDir(), 'admin.json'); }
function secretFile() { return path.join(dataDir(), 'session.key'); }

function ensureDir() { fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 }); }

// ---- account ------------------------------------------------------------------
function readAdmin() {
    try { return JSON.parse(fs.readFileSync(adminFile(), 'utf8')); } catch (e) { return null; }
}

function hashPassword(password, saltHex) {
    const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function passwordProblem(password) {
    if (typeof password !== 'string' || password.length < 12) return 'Use at least 12 characters.';
    if (password.length > 200) return 'Use at most 200 characters.';
    if (!/[a-z]/i.test(password) || !/[0-9]/.test(password)) return 'Include letters and at least one number.';
    return '';
}

function writeAdmin(username, password) {
    ensureDir();
    const h = hashPassword(password);
    fs.writeFileSync(adminFile(), JSON.stringify({
        username: String(username).trim(),
        salt: h.salt,
        hash: h.hash,
        updatedAt: new Date().toISOString()
    }, null, 2), { mode: 0o600 });
}

function checkPassword(admin, password) {
    if (!admin || typeof password !== 'string') {
        // Burn comparable time so a missing account is not detectable by timing.
        hashPassword('x', '00'.repeat(16));
        return false;
    }
    const h = hashPassword(password.slice(0, 200), admin.salt);
    const a = Buffer.from(h.hash, 'hex');
    const b = Buffer.from(admin.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- sessions -----------------------------------------------------------------
function secret() {
    ensureDir();
    try { return fs.readFileSync(secretFile()); } catch (e) { /* create below */ }
    const key = crypto.randomBytes(48);
    fs.writeFileSync(secretFile(), key, { mode: 0o600 });
    return key;
}

function b64(buf) { return Buffer.from(buf).toString('base64url'); }

function sign(payloadB64) {
    return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

function createSession(username) {
    const payload = b64(JSON.stringify({
        u: username,
        exp: Date.now() + SESSION_HOURS * 3600 * 1000,
        csrf: crypto.randomBytes(24).toString('base64url')
    }));
    return payload + '.' + sign(payload);
}

function parseCookies(header) {
    const out = {};
    String(header || '').split(';').forEach(function(part) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    });
    return out;
}

// Returns { user, csrf } for a valid, unexpired session, else null.
function readSession(req) {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    if (!raw || raw.length > 1000) return null;
    const dot = raw.lastIndexOf('.');
    if (dot < 1) return null;
    const payload = raw.slice(0, dot);
    const given = Buffer.from(raw.slice(dot + 1));
    const want = Buffer.from(sign(payload));
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
    let data;
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (e) { return null; }
    if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    const admin = readAdmin();
    if (!admin || admin.username !== data.u) return null;   // account removed or renamed
    return { user: data.u, csrf: data.csrf };
}

function isHttps(req) {
    return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || Boolean(req.socket && req.socket.encrypted);
}

function sessionCookie(req, value, clear) {
    const parts = [COOKIE + '=' + (clear ? '' : value), 'Path=/site-admin', 'HttpOnly', 'SameSite=Strict'];
    if (isHttps(req)) parts.push('Secure');
    parts.push(clear ? 'Max-Age=0' : 'Max-Age=' + SESSION_HOURS * 3600);
    return parts.join('; ');
}

function csrfOk(session, token) {
    if (!session || typeof token !== 'string') return false;
    const a = Buffer.from(token);
    const b = Buffer.from(session.csrf);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- login rate limit -----------------------------------------------------------
const attempts = new Map();   // key -> { fails, lockedUntil }
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

function limitKey(ip, username) { return String(ip) + '|' + String(username || '').toLowerCase().slice(0, 80); }
const MAX_FAILS_PER_IP = 20;      // across any usernames, so rotating names does not help
function lockedEntry(k) {
    const e = attempts.get(k);
    return Boolean(e && e.lockedUntil && e.lockedUntil > Date.now());
}
function isLocked(ip, username) {
    return lockedEntry(limitKey(ip, username)) || lockedEntry(String(ip) + '|*');
}
function bump(k, max) {
    const e = attempts.get(k) || { fails: 0, lockedUntil: 0 };
    e.fails += 1;
    if (e.fails >= max) { e.lockedUntil = Date.now() + LOCK_MS; e.fails = 0; }
    attempts.set(k, e);
}
function recordFailure(ip, username) {
    bump(limitKey(ip, username), MAX_FAILS);
    bump(String(ip) + '|*', MAX_FAILS_PER_IP);
    if (attempts.size > 5000) attempts.clear();
}
function recordSuccess(ip, username) { attempts.delete(limitKey(ip, username)); }

module.exports = {
    readAdmin, writeAdmin, checkPassword, passwordProblem,
    createSession, readSession, sessionCookie, csrfOk,
    isLocked, recordFailure, recordSuccess, SESSION_HOURS
};
