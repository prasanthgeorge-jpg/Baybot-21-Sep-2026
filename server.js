// Standalone Node.js server for hosting this site on a plain VPS (e.g.
// Hetzner) instead of Vercel. Serves the static files and runs the api/*.js
// handlers itself, using the exact same handler files Vercel would call -
// nothing in api/chat.js or api/lead.js needs to change between the two.
//
// Run directly with `node server.js`, or as the long-running process behind
// systemd - see deploy/baybot.service and README.md's "Deployment: Node.js
// VPS (e.g. Hetzner)" section for the full setup.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const API_DIR = path.join(ROOT, 'api');

// .env.local (if present) wins over .env, matching tools/dev-server.js's
// local-dev convention; on a server you'll typically only have one or the
// other.
loadEnvFile(path.join(ROOT, '.env.local'));
loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 3000;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.xml': 'application/xml'
};

const server = http.createServer(function(req, res) {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);

    if (urlPath.startsWith('/api/')) {
        const name = urlPath.slice('/api/'.length);
        const apiFile = path.join(API_DIR, name + '.js');
        if (/^[\w-]+$/.test(name) && fs.existsSync(apiFile)) {
            const handler = require(apiFile);
            return Promise.resolve(handler(req, makeVercelLikeResponse(res))).catch(function(err) {
                console.error('Unhandled error in ' + urlPath, err);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Internal server error' }));
                }
            });
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No such API route: ' + urlPath }));
    }

    // cleanUrls-style behaviour (mirrors vercel.json): /contact resolves to
    // contact.html so links written without the extension still work.
    let relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    let filePath = path.join(ROOT, relPath);
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    fs.readFile(filePath, function(err, data) {
        if (err && path.extname(filePath) === '') {
            return fs.readFile(filePath + '.html', function(err2, data2) {
                if (err2) return notFound(res, urlPath);
                res.writeHead(200, { 'Content-Type': MIME['.html'] });
                res.end(data2);
            });
        }
        if (err) return notFound(res, urlPath);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(PORT, function() {
    console.log('Server running on port ' + PORT);
    ['GEMINI_API_KEY', 'SHEETS_WEBHOOK_URL', 'SHEETS_WEBHOOK_SECRET', 'DEMO_SHEETS_WEBHOOK_URL', 'DEMO_SHEETS_WEBHOOK_SECRET'].forEach(function(key) {
        if (!process.env[key]) {
            console.log('Note: ' + key + ' is not set - see .env.local.example.');
        }
    });
});

function notFound(res, urlPath) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + urlPath);
}

function makeVercelLikeResponse(res) {
    return {
        statusCode: 200,
        setHeader: function(name, value) { res.setHeader(name, value); },
        status: function(code) { this.statusCode = code; return this; },
        json: function(obj) {
            res.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(obj));
        }
    };
}

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    lines.forEach(function(line) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eq = trimmed.indexOf('=');
        if (eq === -1) return;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!(key in process.env)) process.env[key] = value;
    });
}
