// Visitor log for baybotdynamics.com, and the password-protected API that reads it.
//
// Every page view (HTML pages only, not images or scripts) is appended to a
// monthly file under DATA_DIR/visitors/ as one JSON line: time, IP address,
// page, referrer, browser. Opening /visitors asks for the password and then
// lists who has been on the site. Nothing here can break a page: logging
// errors are swallowed.
//
//   GET /visitors                    people-friendly page (browser asks for the password)
//   GET /visitors?format=json        the same data as JSON
//   GET /visitors?days=7             window in days (1-365, default 30)
//   GET /visitors?view=hits          every page view instead of one row per visitor
//   GET /visitors?bots=1             include crawlers and monitors (hidden by default)
//   GET /visitors?ip=1.2.3.4         one visitor only
//
// The password goes in VISITOR_API_PASSWORD (server .env.local). With no
// password set the API answers 503 and shows nothing. Credentials are accepted
// as HTTP Basic (any username), "Authorization: Bearer <password>" or
// "X-API-Key: <password>". Never put the password in the URL: server logs keep URLs.
//
// VISITOR_IGNORE_IPS=1.2.3.4,5.6.7.8 leaves your own visits out of the log.
// VISITOR_RETENTION_DAYS (default 365) deletes older monthly files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('./config');

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|uptime|pingdom|lighthouse|headless|curl\/|wget|python-requests|python-urllib|go-http-client|okhttp|axios|node-fetch|java\/|httpclient|libwww|scrapy|semrush|ahrefs|mj12|dotbot|bingpreview|gtmetrix|statuscake/i;
const SESSION_GAP_MS = 30 * 60 * 1000;
const FAIL_LIMIT = 10, FAIL_WINDOW_MS = 15 * 60 * 1000;

function dir() { return path.join(dataDir(), 'visitors'); }

// ---------- who is the visitor ----------

function stripV4Mapped(ip) { return String(ip || '').replace(/^::ffff:/i, ''); }

// Behind Apache the socket is always 127.0.0.1 and the real address is in X-Forwarded-For.
// Apache appends the connecting address to whatever the visitor sent, so the LAST entry is the
// trustworthy one. A request that reaches this server directly (not from loopback) is taken as is.
function clientIp(req) {
    const remote = stripV4Mapped(req.socket && req.socket.remoteAddress);
    if (remote === '::1' || /^127\./.test(remote)) {
        const parts = String(req.headers['x-forwarded-for'] || '').split(',').map(function(s) { return stripV4Mapped(s.trim()); }).filter(Boolean);
        const last = parts[parts.length - 1];
        if (last && /^[0-9a-f.:]{3,45}$/i.test(last)) return last;
    }
    return remote || 'unknown';
}

function describeAgent(ua) {
    ua = String(ua || '');
    let browser = 'Other';
    if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
    else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
    else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
    else if (/Chrome\/|CriOS/.test(ua)) browser = 'Chrome';
    else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari';
    let os = 'Other';
    if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    let device = 'Desktop';
    if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) device = 'Tablet';
    else if (/Mobi|iPhone|iPod|Android/.test(ua)) device = 'Mobile';
    return { browser: browser, os: os, device: device };
}

// ---------- writing ----------

let madeDir = false;
let warned = false;

function ignoredIps() {
    return String(process.env.VISITOR_IGNORE_IPS || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

// Call once per delivered page. relPath is the file served, e.g. "index.html" or "about.html".
function record(req, relPath) {
    try {
        if (req.method !== 'GET') return;
        const purpose = String(req.headers['purpose'] || req.headers['sec-purpose'] || '').toLowerCase();
        if (purpose.indexOf('prefetch') !== -1 || purpose.indexOf('prerender') !== -1) return;
        const ip = clientIp(req);
        if (ignoredIps().indexOf(ip) !== -1) return;
        const ua = String(req.headers['user-agent'] || '').slice(0, 300);
        const page = relPath === 'index.html' ? '/' : '/' + String(relPath).replace(/\.html$/, '');
        const now = new Date();
        const line = JSON.stringify({
            t: now.toISOString(),
            ip: ip,
            page: page.slice(0, 200),
            ref: String(req.headers['referer'] || '').slice(0, 300),
            ua: ua,
            lang: String(req.headers['accept-language'] || '').split(',')[0].slice(0, 20),
            bot: !ua || BOT_RE.test(ua)
        }) + '\n';
        if (!madeDir) { fs.mkdirSync(dir(), { recursive: true, mode: 0o700 }); madeDir = true; }
        const file = path.join(dir(), now.toISOString().slice(0, 7) + '.jsonl');
        fs.appendFile(file, line, { mode: 0o600 }, function(err) {
            if (err && !warned) { warned = true; console.error('Visitor log: could not write', err.message); }
        });
    } catch (e) {
        if (!warned) { warned = true; console.error('Visitor log: could not record a visit', e.message); }
    }
}

function prune() {
    try {
        const keepDays = Math.max(30, Number(process.env.VISITOR_RETENTION_DAYS) || 365);
        const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 7);
        fs.readdirSync(dir()).forEach(function(f) {
            if (/^\d{4}-\d{2}\.jsonl$/.test(f) && f.slice(0, 7) < cutoff) fs.unlinkSync(path.join(dir(), f));
        });
    } catch (e) { /* no folder yet */ }
}
prune();
setInterval(prune, 24 * 3600 * 1000).unref();

// ---------- reading ----------

function readHits(days) {
    const since = Date.now() - days * 86400000;
    const months = {};
    for (let t = since; t <= Date.now() + 86400000; t += 7 * 86400000) months[new Date(t).toISOString().slice(0, 7)] = true;
    months[new Date().toISOString().slice(0, 7)] = true;
    const hits = [];
    Object.keys(months).sort().forEach(function(m) {
        let text = '';
        try { text = fs.readFileSync(path.join(dir(), m + '.jsonl'), 'utf8'); } catch (e) { return; }
        text.split('\n').forEach(function(line) {
            if (!line) return;
            try { const h = JSON.parse(line); if (Date.parse(h.t) >= since) hits.push(h); } catch (e) { /* skip a torn line */ }
        });
    });
    return hits;
}

function top(counts, n) {
    return Object.keys(counts).map(function(k) { return { name: k, views: counts[k] }; })
        .sort(function(a, b) { return b.views - a.views; }).slice(0, n);
}

function referrerHost(ref) {
    if (!ref) return '(direct)';
    try { return new URL(ref).hostname.replace(/^www\./, ''); } catch (e) { return '(unknown)'; }
}

function summarize(hits) {
    const byIp = {}, pages = {}, refs = {};
    hits.forEach(function(h) {
        const v = byIp[h.ip] || (byIp[h.ip] = { ip: h.ip, hits: [] });
        v.hits.push(h);
        pages[h.page] = (pages[h.page] || 0) + 1;
        const r = referrerHost(h.ref);
        if (r !== '(direct)' && /baybotdynamics\./.test(r)) return;   // our own pages are not a source
        refs[r] = (refs[r] || 0) + 1;
    });
    let sessions = 0;
    const visitors = Object.keys(byIp).map(function(ip) {
        const v = byIp[ip];
        v.hits.sort(function(a, b) { return a.t < b.t ? -1 : 1; });
        let n = 0, prev = 0;
        v.hits.forEach(function(h) { const ms = Date.parse(h.t); if (!prev || ms - prev > SESSION_GAP_MS) n++; prev = ms; });
        sessions += n;
        const first = v.hits[0], last = v.hits[v.hits.length - 1];
        const seen = {};
        v.hits.forEach(function(h) { seen[h.page] = (seen[h.page] || 0) + 1; });
        const agent = describeAgent(first.ua);
        return {
            ip: ip,
            first_seen: first.t, last_seen: last.t,
            visits: n, page_views: v.hits.length,
            landing_page: first.page,
            came_from: referrerHost(first.ref),
            device: agent.device, browser: agent.browser, os: agent.os,
            language: first.lang || '',
            pages: top(seen, 12),
            bot: v.hits.every(function(h) { return h.bot; })
        };
    }).sort(function(a, b) { return a.last_seen < b.last_seen ? 1 : -1; });
    return {
        totals: { unique_visitors: visitors.length, visits: sessions, page_views: hits.length },
        top_pages: top(pages, 15),
        top_sources: top(refs, 10),
        visitors: visitors
    };
}

// ---------- the API ----------

const failures = {};   // ip -> { n, reset }

function suppliedPassword(req) {
    const auth = String(req.headers['authorization'] || '');
    let m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
    m = auth.match(/^Basic\s+(.+)$/i);
    if (m) {
        const decoded = Buffer.from(m[1], 'base64').toString('utf8');
        return decoded.slice(decoded.indexOf(':') + 1);   // any username
    }
    return String(req.headers['x-api-key'] || '');
}

function sameSecret(a, b) {
    const x = crypto.createHash('sha256').update(String(a)).digest();
    const y = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(x, y);
}

function send(res, status, type, body, extra) {
    const headers = Object.assign({
        'Content-Type': type, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
        'Content-Length': Buffer.byteLength(body)
    }, extra || {});
    res.writeHead(status, headers);
    res.end(body);
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function eastern(iso) {
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderPage(data, opts) {
    const t = data.totals;
    const rows = data.visitors.map(function(v) {
        return '<tr><td>' + esc(v.ip) + '</td><td>' + esc(v.device + ' / ' + v.browser + ' / ' + v.os) + '</td><td>' + esc(eastern(v.first_seen)) +
            '</td><td>' + esc(eastern(v.last_seen)) + '</td><td class="n">' + v.visits + '</td><td class="n">' + v.page_views + '</td><td>' + esc(v.landing_page) +
            '</td><td>' + esc(v.came_from) + '</td><td>' + esc(v.pages.map(function(p) { return p.name + ' (' + p.views + ')'; }).join(', ')) + '</td></tr>';
    }).join('');
    const list = function(items) { return items.map(function(i) { return '<li>' + esc(i.name) + ' <b>' + i.views + '</b></li>'; }).join('') || '<li>None yet</li>'; };
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="robots" content="noindex,nofollow"><title>Website visitors</title><style>' +
        'body{font:15px/1.5 system-ui,Arial,sans-serif;margin:0;padding:24px;background:#f6f8fb;color:#0a1f44}h1{margin:0 0 4px}.sub{color:#44546a;margin:0 0 20px}' +
        '.stats{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px}.stat{background:#fff;border-radius:12px;padding:14px 20px;min-width:140px}.stat b{display:block;font-size:28px;color:#1b5be0}' +
        '.cols{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:20px}.box{background:#fff;border-radius:12px;padding:14px 20px;min-width:240px}.box h2{font-size:15px;margin:0 0 8px}.box ul{margin:0;padding-left:18px}' +
        '.wrap{overflow-x:auto;background:#fff;border-radius:12px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #e3e9f2;vertical-align:top}th{background:#eaf2fb;position:sticky;top:0}td.n{text-align:right}' +
        'nav a{margin-right:12px;color:#1b5be0}</style></head><body><h1>Website visitors</h1><p class="sub">baybotdynamics.com, last ' + opts.days + ' days. Times are Eastern. ' +
        (opts.bots ? 'Crawlers and monitors are included.' : 'Crawlers and monitors are hidden.') + '</p>' +
        '<nav><a href="?days=1">Today</a><a href="?days=7">7 days</a><a href="?days=30">30 days</a><a href="?days=90">90 days</a><a href="?days=' + opts.days + '&amp;bots=' + (opts.bots ? 0 : 1) + '">' + (opts.bots ? 'Hide' : 'Show') + ' bots</a><a href="?days=' + opts.days + '&amp;format=json">JSON</a></nav><br>' +
        '<div class="stats"><div class="stat"><b>' + t.unique_visitors + '</b>Visitors</div><div class="stat"><b>' + t.visits + '</b>Visits</div><div class="stat"><b>' + t.page_views + '</b>Page views</div></div>' +
        '<div class="cols"><div class="box"><h2>Top pages</h2><ul>' + list(data.top_pages) + '</ul></div><div class="box"><h2>Where they came from</h2><ul>' + list(data.top_sources) + '</ul></div></div>' +
        '<div class="wrap"><table><thead><tr><th>Visitor IP</th><th>Device / browser / OS</th><th>First seen</th><th>Last seen</th><th>Visits</th><th>Page views</th><th>Landing page</th><th>Came from</th><th>Pages viewed</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="9">No visits recorded in this period.</td></tr>') + '</tbody></table></div></body></html>';
}

function handle(req, res, query) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'application/json', '{"error":"Method not allowed"}', { Allow: 'GET, HEAD' });

    const password = process.env.VISITOR_API_PASSWORD;
    if (!password) return send(res, 503, 'application/json', '{"error":"The visitor API is not set up on this server."}');

    const ip = clientIp(req);
    const f = failures[ip];
    if (f && f.reset > Date.now() && f.n >= FAIL_LIMIT) {
        return send(res, 429, 'application/json', '{"error":"Too many wrong passwords. Try again in 15 minutes."}', { 'Retry-After': '900' });
    }
    const wantsHtml = /text\/html/.test(String(req.headers['accept'] || '')) && query.get('format') !== 'json';
    const given = suppliedPassword(req);
    if (!given || !sameSecret(given, password)) {
        if (given) {
            const cur = failures[ip] && failures[ip].reset > Date.now() ? failures[ip] : (failures[ip] = { n: 0, reset: Date.now() + FAIL_WINDOW_MS });
            cur.n++;
        }
        // Browsers get the built-in password box; API clients get a plain 401.
        return send(res, 401, 'application/json', '{"error":"Password required."}', { 'WWW-Authenticate': 'Basic realm="BayBot visitors", charset="UTF-8"' });
    }
    delete failures[ip];

    const days = Math.min(365, Math.max(1, parseInt(query.get('days'), 10) || 30));
    const bots = query.get('bots') === '1';
    const onlyIp = query.get('ip');
    let hits = readHits(days);
    if (!bots) hits = hits.filter(function(h) { return !h.bot; });
    if (onlyIp) hits = hits.filter(function(h) { return h.ip === onlyIp; });

    if (query.get('view') === 'hits') {
        const limit = Math.min(5000, Math.max(1, parseInt(query.get('limit'), 10) || 500));
        const list = hits.slice().reverse().slice(0, limit);
        return send(res, 200, 'application/json', JSON.stringify({ days: days, count: list.length, hits: list }, null, 2));
    }
    const data = summarize(hits);
    if (wantsHtml) return send(res, 200, 'text/html; charset=utf-8', renderPage(data, { days: days, bots: bots }));
    return send(res, 200, 'application/json', JSON.stringify(Object.assign({ days: days, generated: new Date().toISOString() }, data), null, 2));
}

module.exports = { record, handle, clientIp, describeAgent, summarize };
