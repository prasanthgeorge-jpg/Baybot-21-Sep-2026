// Editing the 14 built-in products (from data/models.json) in the admin.
//
// The generated product pages are never rewritten. A customer's edits are kept
// in DATA_DIR/builtin-overrides.json and are applied to the page when it is
// served, so the look of each page stays as designed, a developer rebuild does
// not silently undo the customer's text, and "Reset" restores the original.
//
// Editable: name, headline, summary, card description, overview, YouTube video
// and the main photo. The feature and function sections keep their current text.
const fs = require('fs');
const path = require('path');
const { ROOT, LIMITS, dataDir } = require('./config');
const store = require('./store');
const images = require('./images');
const { esc, paragraphs } = require('./render');

const FIELDS = ['name', 'headline', 'summary', 'cardDescription', 'overview', 'videoId', 'image', 'imageAlt'];

function overridesFile() { return path.join(dataDir(), 'builtin-overrides.json'); }
let ovCache = null;
let writeChain = Promise.resolve();

function loadOverrides() {
    let st;
    try { st = fs.statSync(overridesFile()); } catch (e) { return { items: {} }; }
    if (ovCache && ovCache.mtimeMs === st.mtimeMs) return ovCache.data;
    let data;
    try { data = JSON.parse(fs.readFileSync(overridesFile(), 'utf8')); } catch (e) { data = null; }
    if (!data || typeof data.items !== 'object' || !data.items) data = { items: {} };
    ovCache = { mtimeMs: st.mtimeMs, data: data };
    return data;
}
function saveOverrides(data) {
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    const tmp = overridesFile() + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, overridesFile());
    ovCache = null;
}
function mutateOverrides(fn) {
    const run = writeChain.then(function() {
        const data = JSON.parse(JSON.stringify(loadOverrides()));
        const result = fn(data);
        saveOverrides(data);
        return result;
    });
    writeChain = run.catch(function() {});
    return run;
}

// ---- the catalogue and the original page content -----------------------------------
function catalogue() { return require(path.join(ROOT, 'data', 'models.json')).models || []; }
function isBuiltin(id) { return catalogue().some(function(m) { return m.id === id; }); }

// A path the browser can always resolve, wherever the page is shown.
function publicPath(p) {
    if (!p) return '';
    if (/^(\/|https?:)/.test(p)) return p;
    return '/' + p;
}

function decode(s) {
    return String(s || '')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');
}
function plain(html) {
    return decode(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/\s+\n/g, '\n').trim();
}

const baseCache = new Map();
// The original content of a built-in product, read from its generated page.
function readBase(id) {
    if (!isBuiltin(id)) return null;
    const pageFile = path.join(ROOT, 'product-' + id + '.html');
    const listFile = path.join(ROOT, 'products.html');
    let s1, s2;
    try { s1 = fs.statSync(pageFile); s2 = fs.statSync(listFile); } catch (e) { return null; }
    const key = id + ':' + s1.mtimeMs + ':' + s2.mtimeMs;
    if (baseCache.has(key)) return baseCache.get(key);

    const h = fs.readFileSync(pageFile, 'utf8');
    const l = fs.readFileSync(listFile, 'utf8');
    const pick = function(re) { const m = h.match(re); return m ? m[1] : ''; };
    const img = h.match(/<div class="product-hero-media">\s*<img src="([^"]*)" alt="([^"]*)"/) || [];
    const card = l.match(new RegExp('<article class="model-card" id="model-' + id + '">[\\s\\S]*?<p>([\\s\\S]*?)<\\/p>'));
    const out = {
        name: plain(pick(/<h1>([\s\S]*?)<\/h1>/)),
        headline: plain(pick(/<p class="product-hero-title">([\s\S]*?)<\/p>/)),
        summary: plain(pick(/<div class="rich-text product-hero-summary">([\s\S]*?)<\/div>/)),
        overview: plain(pick(/<div class="product-overview">[\s\S]*?<div class="rich-text section-description">([\s\S]*?)<\/div>/)),
        cardDescription: card ? plain(card[1]) : '',
        videoId: pick(/data-video-id="([^"]+)"/),
        image: img[1] || '',
        imageAlt: decode(img[2] || '')
    };
    baseCache.set(key, out);
    return out;
}

function overrideFor(id) { return loadOverrides().items[id] || null; }
function isEdited(id) { return Boolean(overrideFor(id)); }

// Original content with the saved edits applied (empty edits fall back to the original).
function effective(id) {
    const base = readBase(id);
    if (!base) return null;
    const o = overrideFor(id) || {};
    const e = Object.assign({}, base);
    FIELDS.forEach(function(f) { if (typeof o[f] === 'string' && o[f] !== '') e[f] = o[f]; });
    return e;
}

// ---- rendering the product page with a set of values ---------------------------------
// `e` holds complete values. `resolveImg` turns a stored image into a URL.
function applyPage(html, id, e, resolveImg) {
    const base = readBase(id);
    if (!base) return html;
    let out = html;
    const set = function(re, makeText) { out = out.replace(re, function() { return makeText(arguments); }); };

    set(/<title>[\s\S]*?<\/title>/, function() {
        return '<title>' + esc(e.name + ' | ' + e.headline + ' | BayBot Dynamics') + '</title>';
    });
    set(/<meta name="description" content="[^"]*">/, function() { return '<meta name="description" content="' + esc(e.summary) + '">'; });
    set(/<meta property="og:description" content="[^"]*">/, function() { return '<meta property="og:description" content="' + esc(e.summary) + '">'; });
    set(/<meta property="og:title" content="[^"]*">/, function() { return '<meta property="og:title" content="' + esc(e.name) + '">'; });
    set(/<h1>[\s\S]*?<\/h1>/, function() { return '<h1>' + esc(e.name) + '</h1>'; });
    set(/<p class="product-hero-title">[\s\S]*?<\/p>/, function() { return '<p class="product-hero-title">' + esc(e.headline) + '</p>'; });
    set(/<div class="rich-text product-hero-summary">[\s\S]*?<\/div>/, function() {
        return '<div class="rich-text product-hero-summary"><p>' + esc(e.summary) + '</p></div>';
    });
    set(/(<div class="product-hero-media">\s*)<img src="[^"]*" alt="[^"]*"/, function(m) {
        return m[1] + '<img src="' + esc(resolveImg(e.image)) + '" alt="' + esc(e.imageAlt || e.name) + '"';
    });
    if (e.videoId) {
        const vid = esc(e.videoId);
        out = out.replace(/data-video-id="[^"]*"/, function() { return 'data-video-id="' + vid + '"'; });
        out = out.replace(/i\.ytimg\.com\/vi\/[^/"]+\//, function() { return 'i.ytimg.com/vi/' + vid + '/'; });
        out = out.replace(/watch\?v=[^"&]+/, function() { return 'watch?v=' + vid; });
    }
    set(/(<div class="product-overview">[\s\S]*?)<div class="rich-text section-description">[\s\S]*?<\/div>/, function(m) {
        return m[1] + '<div class="rich-text section-description">' + paragraphs(e.overview) + '</div>';
    });
    if (base.name && base.name !== e.name) {
        out = out.split('About the ' + esc(base.name)).join('About the ' + esc(e.name));
        out = out.split('Watch the ' + esc(base.name) + ' in Action').join('Watch the ' + esc(e.name) + ' in Action');
        out = out.split('Watch the ' + base.name + ' in Action').join('Watch the ' + esc(e.name) + ' in Action');
    }
    return out;
}

// Updates the product card of one built-in product wherever it appears
// (Products page and the "related models" sections). Only fields that were
// edited are touched.
function applyCard(html, id, o, resolveImg) {
    const re = new RegExp('<article class="model-card" id="model-' + id + '">[\\s\\S]*?<\\/article>');
    return html.replace(re, function(art) {
        let a = art;
        if (o.image) {
            a = a.replace(/(<a [^>]*class="model-card-media"[^>]*>\s*)<img src="[^"]*" alt="[^"]*"/, function(m, x) {
                return x + '<img src="' + esc(resolveImg(o.image)) + '" alt="' + esc(o.imageAlt || o.name || '') + '"';
            });
        }
        if (o.name) {
            a = a.replace(/<h3><a href="([^"]*)">[\s\S]*?<\/a><\/h3>/, function(m, href) {
                return '<h3><a href="' + href + '">' + esc(o.name) + '</a></h3>';
            });
        }
        if (o.cardDescription) {
            a = a.replace(/<p>[\s\S]*?<\/p>/, function() { return '<p>' + esc(o.cardDescription) + '</p>'; });
        }
        return a;
    });
}

// Applied to every HTML page as it is served.
function applyPublic(html, relPath) {
    const items = loadOverrides().items;
    const ids = Object.keys(items);
    if (!ids.length) return html;
    let out = html;
    const m = String(relPath).match(/^product-([a-z0-9-]+)\.html$/);
    if (m && items[m[1]]) {
        const e = effective(m[1]);
        if (e) out = applyPage(out, m[1], e, publicPath);
    }
    ids.forEach(function(id) { out = applyCard(out, id, items[id], publicPath); });
    return out;
}

// ---- validation and saving ----------------------------------------------------------
function line(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
function text(v, max) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max); }

function validateFields(input) {
    const errors = [];
    const v = {
        name: line(input.name, LIMITS.name),
        headline: line(input.headline, LIMITS.tagline),
        summary: line(input.summary, LIMITS.summary),
        cardDescription: line(input.cardDescription, 160),
        overview: text(input.overview, LIMITS.overview)
    };
    if (!v.name) errors.push('Enter the product name.');
    if (!v.headline) errors.push('Enter the headline under the name.');
    if (!v.summary) errors.push('Enter the summary shown at the top of the page.');
    if (!v.cardDescription) errors.push('Enter the one-line description shown on the product card.');
    if (!v.overview) errors.push('Enter the overview text.');
    const vid = store.youtubeId(input.videoUrl);
    if (vid === null) errors.push('The video link is not a valid YouTube address.');
    v.videoId = vid || '';          // empty keeps the current video
    return { value: v, errors: errors };
}

async function saveEdit(id, input, photoBuffer) {
    if (!isBuiltin(id)) throw new Error('Unknown product.');
    const r = validateFields(input);
    if (r.errors.length) return { errors: r.errors };
    const prev = overrideFor(id) || {};
    const record = Object.assign({}, r.value, {
        image: prev.image || '',
        imageAlt: prev.imageAlt || '',
        updatedAt: new Date().toISOString()
    });
    let newDir = null;
    if (photoBuffer) {
        newDir = store.newId();
        const file = await images.saveImage(newDir, photoBuffer);
        record.image = '/uploads/' + newDir + '/' + file;
        record.imageAlt = r.value.name;
    }
    await mutateOverrides(function(d) { d.items[id] = record; });
    if (newDir && prev.image) removePhoto(prev.image);
    return { ok: true };
}

function removePhoto(url) {
    const m = String(url || '').match(/^\/uploads\/([a-f0-9]{16})\/([a-f0-9]{16}\.webp)$/);
    if (!m) return;
    images.removeImage(m[1], m[2]);
    try { fs.rmdirSync(path.join(store.uploadsDir(), m[1])); } catch (e) { /* folder not empty or gone */ }
}

async function resetEdit(id) {
    const prev = overrideFor(id);
    await mutateOverrides(function(d) { delete d.items[id]; });
    if (prev) removePhoto(prev.image);
    return true;
}

// Values for a preview: what the form says now, with the photo that is currently in use.
async function previewDraft(id, input, photoBuffer) {
    const base = readBase(id);
    const current = effective(id) || base;
    const v = validateFields(input).value;
    const eff = Object.assign({}, current);
    ['name', 'headline', 'summary', 'cardDescription', 'overview'].forEach(function(f) { if (v[f]) eff[f] = v[f]; });
    if (v.videoId) eff.videoId = v.videoId;
    const imageMap = {};
    if (photoBuffer) {
        imageMap['m.webp'] = await images.processImage(photoBuffer);
        eff.image = 'preview:m.webp';
        eff.imageAlt = eff.name;
    }
    return { eff: eff, imageMap: imageMap };
}

function rows() {
    return catalogue().map(function(m) {
        const e = effective(m.id);
        return { id: m.id, name: e ? e.name : m.name, category: m.category, edited: isEdited(m.id) };
    });
}

module.exports = {
    isBuiltin, readBase, effective, isEdited, rows, catalogue,
    applyPage, applyPublic, publicPath, validateFields, saveEdit, resetEdit, previewDraft
};
