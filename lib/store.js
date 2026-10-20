// Product storage: one JSON file plus an uploads folder inside DATA_DIR.
// Writes are atomic (temp file + rename) and serialised, because the admin and
// public pages share one Node process.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir, ROOT, LAYOUTS, LIMITS } = require('./config');

let cache = null;          // { mtimeMs, data }
let writeChain = Promise.resolve();

function productsFile() { return path.join(dataDir(), 'products.json'); }
function uploadsDir() { return path.join(dataDir(), 'uploads'); }

function ensureDirs() {
    fs.mkdirSync(uploadsDir(), { recursive: true, mode: 0o700 });
}

function load() {
    const file = productsFile();
    let stat;
    try { stat = fs.statSync(file); } catch (e) { return { products: [], categories: [] }; }
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.data;
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { data = { products: [], categories: [] }; }
    if (!data || !Array.isArray(data.products)) data = { products: [] };
    if (!Array.isArray(data.categories)) data.categories = [];
    cache = { mtimeMs: stat.mtimeMs, data: data };
    return data;
}

function save(data) {
    ensureDirs();
    const file = productsFile();
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    cache = null;
}

// Run read-modify-write operations one at a time.
function mutate(fn) {
    const run = writeChain.then(function() {
        const data = JSON.parse(JSON.stringify(load()));
        const result = fn(data);
        save(data);
        return result;
    });
    writeChain = run.catch(function() {});
    return run;
}

function newId() { return crypto.randomBytes(8).toString('hex'); }

// Built-in products come from data/models.json; their ids and page names are
// reserved so a custom product can never shadow one.
let builtinCache = null;
function builtinProducts() {
    if (!builtinCache) {
        try {
            const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'models.json'), 'utf8'));
            builtinCache = (raw.models || []).map(function(m) {
                return { id: m.id, name: m.name, category: m.category };
            });
        } catch (e) { builtinCache = []; }
    }
    return builtinCache;
}

function slugify(text) {
    return String(text || '')
        .replace(/<[^>]*>/g, ' ')
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/g, '');
}

function slugTaken(data, slug, exceptId) {
    if (builtinProducts().some(function(b) { return b.id === slug; })) return true;
    if (fs.existsSync(path.join(ROOT, 'product-' + slug + '.html'))) return true;
    return data.products.some(function(p) { return p.slug === slug && p.id !== exceptId; });
}

function uniqueSlug(data, name, exceptId) {
    const base = slugify(name) || 'product';
    let slug = base;
    for (let n = 2; slugTaken(data, slug, exceptId) && n < 500; n++) slug = base + '-' + n;
    return slug;
}

function list() {
    return load().products.slice().sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
}
function get(id) { return load().products.filter(function(p) { return p.id === id; })[0] || null; }
function getBySlug(slug) { return load().products.filter(function(p) { return p.slug === slug; })[0] || null; }
function published() { return load().products.filter(function(p) { return p.status === 'published'; }); }

function remove(id) {
    return mutate(function(data) {
        const before = data.products.length;
        data.products = data.products.filter(function(p) { return p.id !== id; });
        return before !== data.products.length;
    }).then(function(removed) {
        if (removed) {
            try { fs.rmSync(path.join(uploadsDir(), id), { recursive: true, force: true }); } catch (e) { /* ignore */ }
        }
        return removed;
    });
}

// ---- validation ---------------------------------------------------------------
function text(value, max) {
    return String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}
function line(value, max) { return text(value, max).replace(/\s*\n\s*/g, ' '); }

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
function youtubeId(input) {
    const v = String(input || '').trim();
    if (!v) return '';
    if (YT_ID.test(v)) return v;
    let u;
    try { u = new URL(v); } catch (e) { return null; }
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = '';
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
        else { const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/); if (m) id = m[1]; }
    }
    return YT_ID.test(id) ? id : null;
}

// Turn raw form fields into a clean product. Returns { value, errors }.
function validate(input) {
    const errors = [];
    const v = {
        name: line(input.name, LIMITS.name),
        category: String(input.category || ''),
        layout: String(input.layout || ''),
        tagline: line(input.tagline, LIMITS.tagline),
        summary: line(input.summary, LIMITS.summary),
        overview: text(input.overview, LIMITS.overview),
        videoId: '',
        deployedIn: [],
        features: [],
        specs: []
    };
    if (!v.name) errors.push('Enter a product name.');
    if (!v.category) errors.push('Choose a category.');
    if (!LAYOUTS[v.layout]) errors.push('Choose a layout.');
    if (!v.summary) errors.push('Enter a short summary. It appears on the product card.');

    const vid = youtubeId(input.videoUrl);
    if (vid === null) errors.push('The video link is not a valid YouTube address.');
    else v.videoId = vid;

    const titles = [].concat(input.featureTitle || []);
    const texts = [].concat(input.featureText || []);
    for (let i = 0; i < titles.length && v.features.length < LIMITS.features; i++) {
        const t = line(titles[i], LIMITS.featureTitle);
        const d = text(texts[i], LIMITS.featureText);
        if (t || d) v.features.push({ title: t, text: d });
    }
    if (v.features.some(function(f) { return !f.title; })) errors.push('Give every feature a title.');

    const labels = [].concat(input.specLabel || []);
    const values = [].concat(input.specValue || []);
    for (let i = 0; i < labels.length && v.specs.length < LIMITS.specs; i++) {
        const l = line(labels[i], LIMITS.specLabel);
        const val = line(values[i], LIMITS.specValue);
        if (l || val) v.specs.push({ label: l, value: val });
    }
    if (v.specs.some(function(s) { return !s.label || !s.value; })) errors.push('Fill in both the label and the value for every specification.');

    String(input.deployedIn || '').split(/[,\n]/).forEach(function(c) {
        const t = line(c, LIMITS.chipText);
        if (t && v.deployedIn.length < LIMITS.chips && v.deployedIn.indexOf(t) === -1) v.deployedIn.push(t);
    });

    return { value: v, errors: errors };
}

module.exports = {
    uploadsDir, ensureDirs, load, mutate, newId, uniqueSlug, slugify, list, get, getBySlug, published, remove,
    builtinProducts, validate, youtubeId
};
