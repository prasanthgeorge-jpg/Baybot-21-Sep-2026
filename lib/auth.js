// Admin accounts: a short list in DATA_DIR/admins.json, identified by email.
// Passwords are stored as scrypt hashes, never in plain text. There is no
// default account or password: an admin starts with NO password and sets one
// with a one-time setup link (emailed) or a one-time invite code (given out by
// the developer). Setup tokens are stored hashed, expire, and work once.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('./config');

const COOKIE = 'bb_admin';
const SESSION_HOURS = 8;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I, O, 0, 1

function adminsFile() { return path.join(dataDir(), 'admins.json'); }
function secretFile() { return path.join(dataDir(), 'session.key'); }
function ensureDir() { fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 }); }

// ---- accounts -----------------------------------------------------------------
function normEmail(value) { return String(value || '').trim().toLowerCase().slice(0, 254); }
function validEmail(value) { return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(value) && value.length <= 254; }

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(adminsFile(), 'utf8'));
        return data && Array.isArray(data.admins) ? data : { admins: [] };
    } catch (e) { return { admins: [] }; }
}
function writeAll(data) {
    ensureDir();
    const file = adminsFile();
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
}
function findAdmin(email) {
    const e = normEmail(email);
    return readAll().admins.filter(function(a) { return a.email === e; })[0] || null;
}
function listAdmins() { return readAll().admins.slice(); }

function mutateAdmin(email, fn) {
    const data = readAll();
    const e = normEmail(email);
    const admin = data.admins.filter(function(a) { return a.email === e; })[0];
    if (!admin) return null;
    fn(admin);
    writeAll(data);
    return admin;
}

// Creates the account (without a password) if it does not exist yet.
function addAdmin(email) {
    const e = normEmail(email);
    if (!validEmail(e)) throw new Error('"' + email + '" is not a valid email address.');
    const data = readAll();
    if (!data.admins.some(function(a) { return a.email === e; })) {
        data.admins.push({ email: e, sessionVersion: 1, createdAt: new Date().toISOString() });
        writeAll(data);
    }
    return findAdmin(e);
}
function removeAdmin(email) {
    const data = readAll();
    const before = data.admins.length;
    data.admins = data.admins.filter(function(a) { return a.email !== normEmail(email); });
    writeAll(data);
    return before !== data.admins.length;
}

// ---- passwords ----------------------------------------------------------------
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

// Setting a password also signs out every existing session for that account.
function setPassword(email, password) {
    const h = hashPassword(password);
    return mutateAdmin(email, function(a) {
        a.salt = h.salt;
        a.hash = h.hash;
        a.passwordSetAt = new Date().toISOString();
        a.sessionVersion = (a.sessionVersion || 1) + 1;
        delete a.setupTokenHash;
        delete a.setupExpires;
    });
}

function checkPassword(admin, password) {
    if (!admin || !admin.hash || typeof password !== 'string') {
        hashPassword('x', '00'.repeat(16));       // burn comparable time: no account/password is not detectable
        return false;
    }
    const h = hashPassword(password.slice(0, 200), admin.salt);
    const a = Buffer.from(h.hash, 'hex');
    const b = Buffer.from(admin.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- one-time setup tokens (invite code / emailed link) --------------------------
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normToken(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64); }

// Returns the token to give to the person. Only its hash is stored.
function createSetupToken(email, ttlMs) {
    const bytes = crypto.randomBytes(20);
    let token = '';
    for (let i = 0; i < 20; i++) token += TOKEN_ALPHABET[bytes[i] % 32];
    const stored = mutateAdmin(email, function(a) {
        a.setupTokenHash = sha(token);
        a.setupExpires = Date.now() + ttlMs;
    });
    return stored ? token : null;
}
function formatToken(token) { return String(token).replace(/(.{4})(?=.)/g, '$1-'); }

// The account a valid, unexpired token belongs to - or null.
function accountForToken(raw, expectEmail) {
    const token = normToken(raw);
    if (token.length !== 20) return null;
    const want = sha(token);
    const found = readAll().admins.filter(function(a) {
        if (!a.setupTokenHash || !a.setupExpires || a.setupExpires < Date.now()) return false;
        const x = Buffer.from(a.setupTokenHash);
        const y = Buffer.from(want);
        return x.length === y.length && crypto.timingSafeEqual(x, y);
    })[0];
    if (!found) return null;
    if (expectEmail && found.email !== normEmail(expectEmail)) return null;
    return found;
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
function sign(payloadB64) { return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url'); }

function createSession(admin) {
    const payload = b64(JSON.stringify({
        u: admin.email,
        sv: admin.sessionVersion || 1,
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

// { user, csrf } for a valid, unexpired session of an account that still
// exists and has not had its password changed since, else null.
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
    const admin = findAdmin(data.u);
    if (!admin || !admin.hash || (admin.sessionVersion || 1) !== data.sv) return null;
    return { user: admin.email, csrf: data.csrf };
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

// ---- rate limits (in memory) ------------------------------------------------------
const attempts = new Map();   // key -> { fails, lockedUntil }
const MAX_FAILS = 5;
const MAX_FAILS_PER_IP = 20;      // across any names, so rotating names does not help
const LOCK_MS = 15 * 60 * 1000;

function limitKey(ip, name) { return String(ip) + '|' + String(name || '').toLowerCase().slice(0, 80); }
function lockedEntry(k) { const e = attempts.get(k); return Boolean(e && e.lockedUntil && e.lockedUntil > Date.now()); }
function isLocked(ip, name) { return lockedEntry(limitKey(ip, name)) || lockedEntry(String(ip) + '|*'); }
function bump(k, max) {
    const e = attempts.get(k) || { fails: 0, lockedUntil: 0 };
    e.fails += 1;
    if (e.fails >= max) { e.lockedUntil = Date.now() + LOCK_MS; e.fails = 0; }
    attempts.set(k, e);
}
function recordFailure(ip, name) {
    bump(limitKey(ip, name), MAX_FAILS);
    bump(String(ip) + '|*', MAX_FAILS_PER_IP);
    if (attempts.size > 5000) attempts.clear();
}
function recordSuccess(ip, name) { attempts.delete(limitKey(ip, name)); }

// At most N setup emails per address per hour (stops mail-bombing an admin).
const mailLog = new Map();
function mayEmail(email, max) {
    const now = Date.now();
    const recent = (mailLog.get(email) || []).filter(function(t) { return now - t < 3600 * 1000; });
    if (recent.length >= (max || 3)) { mailLog.set(email, recent); return false; }
    recent.push(now);
    mailLog.set(email, recent);
    return true;
}

module.exports = {
    normEmail, validEmail, findAdmin, listAdmins, addAdmin, removeAdmin,
    setPassword, checkPassword, passwordProblem,
    createSetupToken, accountForToken, formatToken, normToken,
    createSession, readSession, sessionCookie, csrfOk,
    isLocked, recordFailure, recordSuccess, mayEmail, SESSION_HOURS
};
