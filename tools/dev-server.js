// Local development server. Serves the static site and runs the api/*.js
// serverless functions the same way Vercel does, so they can be tested
// before deploying. Not used in production - Vercel runs the api/ files
// directly. Usage: node tools/dev-server.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API_DIR = path.join(ROOT, 'api');
loadEnvFile(path.join(ROOT, '.env.local'));

const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8765;

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
            delete require.cache[require.resolve(apiFile)];
            const handler = require(apiFile);
            return handler(req, makeVercelLikeResponse(res));
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No such API route: ' + urlPath }));
    }

    let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    fs.readFile(filePath, function(err, data) {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Not found: ' + urlPath);
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(PORT, function() {
    console.log('Dev server running at http://localhost:' + PORT);
    if (!process.env.GEMINI_API_KEY) {
        console.log('Note: GEMINI_API_KEY is not set. Copy .env.local.example to .env.local and add your key to test the chat.');
    }
});

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
