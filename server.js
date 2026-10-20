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
const zlib = require('zlib');

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
    '.xml': 'application/xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.pdf': 'application/pdf'
};

// Only these files are ever served. Everything else in the project folder
// (secrets, source, server config, build tooling) stays private. This matters
// because the project root doubles as the web root: without it, a request for
// /.env.local would return the secrets file.
const PRIVATE_DIRS = new Set(['api', 'tools', 'deploy', 'node_modules', 'data', 'lib', 'admin-assets']);
const PRIVATE_FILES = new Set([
    'server.js', 'package.json', 'package-lock.json', 'vercel.json',
    'web.config', 'readme.md'
]);

function isPublicPath(relPath) {
    const segments = relPath.split('/').filter(Boolean);
    if (!segments.length) return false;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        // Dotfiles and dot-directories (.env*, .git, .htaccess ...) are private,
        // except .well-known which certificate validation needs.
        if (seg.charAt(0) === '.' && !(i === 0 && seg === '.well-known')) return false;
        if (seg.indexOf('\0') !== -1) return false;
    }
    if (PRIVATE_DIRS.has(segments[0].toLowerCase())) return false;
    if (PRIVATE_FILES.has(segments[segments.length - 1].toLowerCase())) return false;
    return true;
}

// Same headers vercel.json sets, so the VPS behaves like Vercel.
const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
};

function cacheControlFor(relPath, ext) {
    if (relPath.indexOf('assets/') === 0) return 'public, max-age=31536000, immutable';
    if (ext === '.css' || ext === '.js') return 'public, max-age=0, must-revalidate';
    if (ext === '.html') return 'public, max-age=0, must-revalidate';
    return 'public, max-age=86400';
}

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.xml']);

function sendFile(req, res, relPath, data) {
    const ext = path.extname(relPath).toLowerCase();
    // Categories added in the admin appear in the "Products" menu on every page.
    if (ext === '.html') {
        try {
            const withNav = require('./lib/render').injectNav(data.toString('utf8'));
            data = Buffer.from(withNav, 'utf8');
        } catch (e) { console.error('Could not add admin categories to the menu', e); }
    }
    const headers = Object.assign({
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': cacheControlFor(relPath, ext),
        'Vary': 'Accept-Encoding'
    }, SECURITY_HEADERS);
    const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (wantsGzip && COMPRESSIBLE.has(ext) && data.length > 1024) {
        headers['Content-Encoding'] = 'gzip';
        data = zlib.gzipSync(data);
    }
    headers['Content-Length'] = data.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
}

const server = http.createServer(function(req, res) {
    let urlPath;
    try {
        urlPath = decodeURIComponent(req.url.split('?')[0]);
    } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Bad request');
    }

    Object.keys(SECURITY_HEADERS).forEach(function(h) { res.setHeader(h, SECURITY_HEADERS[h]); });

    if (urlPath.startsWith('/api/')) {
        const name = urlPath.slice('/api/'.length);
        const apiFile = path.join(API_DIR, name + '.js');
        if (/^[\w-]+$/.test(name) && name.charAt(0) !== '_' && fs.existsSync(apiFile)) {
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

    // Product admin (login, add/edit products). Lives under /site-admin because
    // /admin on baybotdynamics.com is the older CMS.
    if (urlPath === '/site-admin' || urlPath.indexOf('/site-admin/') === 0) {
        const query = new URL(req.url, 'http://localhost').searchParams;
        return Promise.resolve(require('./lib/admin').handle(req, res, urlPath, query)).catch(function(err) {
            console.error('Unhandled admin error', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Something went wrong.');
            }
        });
    }

    // Photos uploaded through the admin. File names are random, so they can be cached for a year.
    const upload = urlPath.match(/^\/uploads\/([a-f0-9]{16})\/([a-f0-9]{16}\.webp)$/);
    if (upload) {
        const file = path.join(require('./lib/store').uploadsDir(), upload[1], upload[2]);
        return fs.readFile(file, function(err, data) {
            if (err) return notFound(res, urlPath);
            res.writeHead(200, {
                'Content-Type': 'image/webp',
                'Content-Length': data.length,
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff'
            });
            res.end(req.method === 'HEAD' ? undefined : data);
        });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Allow': 'GET, HEAD', 'Content-Type': 'text/plain' });
        return res.end('Method not allowed');
    }

    // cleanUrls-style behaviour (mirrors vercel.json): /contact resolves to
    // contact.html so links written without the extension still work.
    let relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    let filePath = path.join(ROOT, relPath);
    if (filePath !== ROOT && filePath.indexOf(ROOT + path.sep) !== 0) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    // Private files get the same 404 as a missing file, so their existence
    // is not revealed.
    if (!isPublicPath(relPath)) return notFound(res, urlPath);

    // The Products page gets the admin-added products injected into its grids.
    const isProductsPage = relPath === 'products' || relPath === 'products.html';

    fs.readFile(filePath, function(err, data) {
        if (err && path.extname(filePath) === '') {
            return fs.readFile(filePath + '.html', function(err2, data2) {
                if (err2) return customProduct(req, res, relPath, urlPath);
                if (isProductsPage) data2 = injectProducts(data2);
                sendFile(req, res, relPath + '.html', data2);
            });
        }
        if (err) return customProduct(req, res, relPath, urlPath);
        if (isProductsPage) data = injectProducts(data);
        sendFile(req, res, relPath, data);
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

function injectProducts(buffer) {
    try { return Buffer.from(require('./lib/render').injectCards(buffer.toString('utf8')), 'utf8'); }
    catch (e) { console.error('Could not add admin products to the Products page', e); return buffer; }
}

// /product-<slug> (or .html) for a published product added through the admin.
function customProduct(req, res, relPath, urlPath) {
    const m = relPath.match(/^product-([a-z0-9-]{1,60}?)(?:\.html)?$/);
    if (!m) return notFound(res, urlPath);
    try {
        const product = require('./lib/store').getBySlug(m[1]);
        if (!product || product.status !== 'published') return notFound(res, urlPath);
        sendFile(req, res, 'product-' + m[1] + '.html', Buffer.from(require('./lib/render').productPage(product, false), 'utf8'));
    } catch (e) {
        console.error('Could not render product page', e);
        notFound(res, urlPath);
    }
}

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
