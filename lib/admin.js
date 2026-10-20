// The /site-admin area: login, a product list, and a form to add or edit a
// product (category, content, photos, layout) with preview and publish.
// Routes live under /site-admin because /admin on this domain belongs to the
// older CMS.
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const { requireHuman } = require('../api/_captcha');
const { ROOT, CATEGORIES, LAYOUTS, LIMITS } = require('./config');
const auth = require('./auth');
const store = require('./store');
const images = require('./images');
const render = require('./render');

const esc = render.esc;
const BASE = '/site-admin';

// ---- small response helpers -------------------------------------------------------
const ADMIN_HEADERS = {
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'"
};

function send(res, status, body, headers, type) {
    res.writeHead(status, Object.assign({ 'Content-Type': type || 'text/html; charset=utf-8' }, ADMIN_HEADERS, headers || {}));
    res.end(body);
}
function redirect(res, location, headers) {
    res.writeHead(303, Object.assign({ Location: location }, ADMIN_HEADERS, headers || {}));
    res.end();
}
// Behind Apache the LAST X-Forwarded-For entry is the address Apache saw; the
// first entries can be written by the visitor, so they are not trusted.
function clientIp(req) {
    const parts = String(req.headers['x-forwarded-for'] || '').split(',').map(function(p) { return p.trim(); }).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : ((req.socket && req.socket.remoteAddress) || '');
}

// ---- request bodies ---------------------------------------------------------------------
function readUrlencoded(req, max) {
    return new Promise(function(resolve, reject) {
        const chunks = [];
        let size = 0;
        req.on('data', function(c) {
            size += c.length;
            if (size > (max || 100 * 1024)) { reject(new Error('Request too large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', function() {
            const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
            const fields = {};
            params.forEach(function(v, k) {
                if (Object.prototype.hasOwnProperty.call(fields, k)) fields[k] = [].concat(fields[k], v);
                else fields[k] = v;
            });
            resolve({ fields: fields, files: {} });
        });
        req.on('error', reject);
    });
}

function readMultipart(req) {
    return new Promise(function(resolve, reject) {
        let bb;
        try {
            bb = Busboy({ headers: req.headers, limits: { fileSize: LIMITS.imageBytes, files: 1 + LIMITS.galleryImages, fields: 150, fieldSize: 64 * 1024, parts: 200 } });
        } catch (e) { reject(new Error('Bad upload')); return; }
        const fields = {};
        const files = {};
        let tooBig = false;
        bb.on('field', function(name, value) {
            if (Object.prototype.hasOwnProperty.call(fields, name)) fields[name] = [].concat(fields[name], value);
            else fields[name] = value;
        });
        bb.on('file', function(name, stream, info) {
            const chunks = [];
            stream.on('data', function(c) { chunks.push(c); });
            stream.on('limit', function() { tooBig = true; });
            stream.on('end', function() {
                const buffer = Buffer.concat(chunks);
                if (!info.filename || !buffer.length) return;       // empty file input
                (files[name] = files[name] || []).push({ filename: info.filename, buffer: buffer });
            });
        });
        bb.on('error', reject);
        bb.on('close', function() {
            if (tooBig) { const e = new Error('An image is larger than 8 MB.'); e.userFacing = true; reject(e); return; }
            resolve({ fields: fields, files: files });
        });
        req.pipe(bb);
    });
}

function readBody(req) {
    const type = String(req.headers['content-type'] || '');
    return /^multipart\/form-data/i.test(type) ? readMultipart(req) : readUrlencoded(req);
}

// ---- HTML --------------------------------------------------------------------------------
const FLASH = {
    saved: 'Saved.',
    published: 'Published. The product is now on the website.',
    unpublished: 'Unpublished. The product is hidden from the website.',
    deleted: 'Product deleted.',
    password: 'Password changed.'
};

function page(title, body, opts) {
    opts = opts || {};
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<meta name="robots" content="noindex, nofollow"><title>' + esc(title) + ' | BayBot admin</title>' +
        '<link rel="icon" href="/assets/favicon.ico" type="image/x-icon">' +
        '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
        '<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">' +
        '<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/design.css?v=3"><link rel="stylesheet" href="' + BASE + '/assets/admin.css?v=1"></head>' +
        '<body class="admin">' +
        '<header class="admin-bar"><div class="admin-bar-inner"><a class="admin-brand" href="' + BASE + '"><img src="/assets/images/logo-light.png?v=1" alt="BayBot Dynamics"><span>Admin</span></a>' +
        (opts.session
            ? '<nav aria-label="Admin"><a href="' + BASE + '">Products</a><a href="' + BASE + '/account">Password</a><a href="/" target="_blank" rel="noopener">View website</a>' +
              '<form method="post" action="' + BASE + '/logout"><input type="hidden" name="_csrf" value="' + esc(opts.session.csrf) + '"><button class="admin-link" type="submit">Log out</button></form></nav>'
            : '') +
        '</div></header><main class="admin-main">' +
        (opts.flash && FLASH[opts.flash] ? '<p class="admin-flash" role="status">' + esc(FLASH[opts.flash]) + '</p>' : '') +
        body + '</main>' + (opts.script !== false ? '<script src="' + BASE + '/assets/admin.js?v=1"></script>' : '') + '</body></html>';
}

function loginPage(message, siteKey) {
    return page('Log in', '<section class="admin-card admin-login"><h1>Admin log in</h1>' +
        (message ? '<p class="admin-error" role="alert">' + esc(message) + '</p>' : '') +
        '<form method="post" action="' + BASE + '/login" autocomplete="on">' +
        '<label for="u">Username</label><input id="u" name="username" type="text" autocomplete="username" required maxlength="80" autofocus>' +
        '<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required maxlength="200">' +
        (siteKey ? '<div class="cf-box" data-sitekey="' + esc(siteKey) + '"></div>' : '') +
        '<button class="btn btn-primary" type="submit"' + (siteKey ? ' data-needs-captcha' : '') + '>Log in</button></form></section>');
}

function statusBadge(p) {
    return '<span class="admin-badge ' + (p.status === 'published' ? 'is-live' : 'is-draft') + '">' + (p.status === 'published' ? 'Published' : 'Draft') + '</span>';
}

function dashboardPage(session, flash) {
    const custom = store.list();
    const builtin = store.builtinProducts();
    const rows = custom.map(function(p) {
        const live = p.status === 'published';
        return '<tr><td><strong>' + esc(p.name) + '</strong><br><span class="admin-muted">' + esc(CATEGORIES[p.category] ? CATEGORIES[p.category].label : p.category) + ' · ' + esc((LAYOUTS[p.layout] || {}).label || p.layout) + ' layout</span></td>' +
            '<td>' + statusBadge(p) + '</td><td class="admin-muted">' + esc(String(p.updatedAt).slice(0, 10)) + '</td>' +
            '<td class="admin-actions"><a class="btn btn-outline" href="' + BASE + '/products/' + esc(p.id) + '/edit">Edit</a>' +
            '<a class="btn btn-outline" href="' + BASE + '/products/' + esc(p.id) + '/preview" target="_blank" rel="noopener">Preview</a>' +
            (live ? '<a class="btn btn-outline" href="/' + esc(render.pageUrl(p)) + '" target="_blank" rel="noopener">View live</a>' : '') +
            '<form method="post" action="' + BASE + '/products/' + esc(p.id) + '/status"><input type="hidden" name="_csrf" value="' + esc(session.csrf) + '"><input type="hidden" name="to" value="' + (live ? 'draft' : 'published') + '"><button class="btn btn-outline" type="submit">' + (live ? 'Unpublish' : 'Publish') + '</button></form>' +
            '<form method="post" action="' + BASE + '/products/' + esc(p.id) + '/delete" data-confirm="Delete ' + esc(p.name) + '? This cannot be undone."><input type="hidden" name="_csrf" value="' + esc(session.csrf) + '"><button class="btn btn-danger" type="submit">Delete</button></form></td></tr>';
    }).join('');
    const body = '<div class="admin-head"><h1>Products</h1><a class="btn btn-primary" href="' + BASE + '/products/new">Add a product</a></div>' +
        '<section class="admin-card"><h2>Products you added</h2>' +
        (custom.length
            ? '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Status</th><th>Updated</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            : '<p class="admin-empty">You have not added a product yet. Choose <strong>Add a product</strong> to start. A new product stays a draft until you publish it.</p>') +
        '</section>' +
        '<details class="admin-card"><summary>Built-in products (' + builtin.length + ')</summary><p class="admin-muted">These come with the website and are changed by the developer, not here.</p><ul class="admin-list">' +
        builtin.map(function(b) { return '<li><a href="/product-' + esc(b.id) + '.html" target="_blank" rel="noopener">' + esc(b.name) + '</a> <span class="admin-muted">' + esc(CATEGORIES[b.category] ? CATEGORIES[b.category].label : b.category) + '</span></li>'; }).join('') +
        '</ul></details>';
    return page('Products', body, { session: session, flash: flash });
}

function featureRow(f) {
    f = f || { title: '', text: '' };
    return '<div class="admin-row admin-row-feature" data-row><div><label>Feature title<input name="featureTitle" type="text" maxlength="' + LIMITS.featureTitle + '" value="' + esc(f.title) + '" placeholder="Smart, hands-free floor care"></label></div>' +
        '<div><label>Description<textarea name="featureText" rows="2" maxlength="' + LIMITS.featureText + '" placeholder="One or two sentences">' + esc(f.text) + '</textarea></label></div>' +
        '<button type="button" class="admin-remove" data-remove-row aria-label="Remove this feature">Remove</button></div>';
}
function specRow(s) {
    s = s || { label: '', value: '' };
    return '<div class="admin-row" data-row><div><label>Label<input name="specLabel" type="text" maxlength="' + LIMITS.specLabel + '" value="' + esc(s.label) + '" placeholder="Battery life"></label></div>' +
        '<div><label>Value<input name="specValue" type="text" maxlength="' + LIMITS.specValue + '" value="' + esc(s.value) + '" placeholder="Up to 10 hours"></label></div>' +
        '<button type="button" class="admin-remove" data-remove-row aria-label="Remove this specification">Remove</button></div>';
}

function layoutPicker(selected) {
    return '<div class="layout-picker" role="radiogroup" aria-label="Page layout">' + Object.keys(LAYOUTS).map(function(key) {
        const l = LAYOUTS[key];
        return '<label class="layout-option"><input type="radio" name="layout" value="' + key + '"' + (selected === key ? ' checked' : '') + ' required>' +
            '<span class="layout-card"><span class="layout-thumb layout-thumb-' + key + '" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
            '<strong>' + esc(l.label) + '</strong><span class="admin-muted">' + esc(l.help) + '</span></span></label>';
    }).join('') + '</div>';
}

function formPage(session, p, errors, opts) {
    opts = opts || {};
    const isNew = !p.id;
    const featureRows = (p.features && p.features.length ? p.features : [null]).map(featureRow).join('');
    const specRows = (p.specs && p.specs.length ? p.specs : [null]).map(specRow).join('');
    const gallery = (p.gallery || []).map(function(file) {
        return '<label class="admin-thumb"><img src="' + esc(render.imgUrl(p, file)) + '" alt="">' +
            '<span><input type="checkbox" name="removeGallery" value="' + esc(file) + '"> Remove</span></label>';
    }).join('');
    const body = '<div class="admin-head"><h1>' + (isNew ? 'Add a product' : 'Edit ' + esc(p.name)) + '</h1>' +
        (!isNew ? '<div class="admin-actions">' + statusBadge(p) + '<a class="btn btn-outline" href="' + BASE + '/products/' + esc(p.id) + '/preview" target="_blank" rel="noopener">Preview</a></div>' : '') + '</div>' +
        (errors && errors.length ? '<div class="admin-error" role="alert"><strong>Fix these first:</strong><ul>' + errors.map(function(e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' + (opts.filesLost ? '<p>Photos you chose need to be chosen again.</p>' : '') + '</div>' : '') +
        '<form class="admin-form" method="post" action="' + BASE + '/products' + (isNew ? '' : '/' + esc(p.id)) + '" enctype="multipart/form-data">' +
        '<input type="hidden" name="_csrf" value="' + esc(session.csrf) + '">' +
        '<section class="admin-card"><h2>1. The basics</h2>' +
        '<label>Product name<input name="name" type="text" required maxlength="' + LIMITS.name + '" value="' + esc(p.name) + '"></label>' +
        '<label>Category<select name="category" required><option value="">Choose a category</option>' + Object.keys(CATEGORIES).map(function(k) { return '<option value="' + k + '"' + (p.category === k ? ' selected' : '') + '>' + esc(CATEGORIES[k].label) + '</option>'; }).join('') + '</select></label>' +
        '<label>Headline under the name <span class="admin-muted">(optional)</span><input name="tagline" type="text" maxlength="' + LIMITS.tagline + '" value="' + esc(p.tagline) + '" placeholder="Autonomous floor cleaning for large facilities"></label>' +
        '<label>Short summary <span class="admin-muted">(shown on the product card and in Google)</span><textarea name="summary" rows="3" required maxlength="' + LIMITS.summary + '" data-count>' + esc(p.summary) + '</textarea></label></section>' +
        '<section class="admin-card"><h2>2. Choose a layout</h2><p class="admin-muted">This sets how the product page is arranged. You can change it later and use Preview to compare.</p>' + layoutPicker(p.layout || 'showcase') + '</section>' +
        '<section class="admin-card"><h2>3. Photos</h2>' +
        '<div class="admin-photo"><label>Main photo <span class="admin-muted">(JPG, PNG or WebP, at least 200 px. Large photos are shrunk automatically.)</span><input name="mainImage" type="file" accept="image/jpeg,image/png,image/webp" data-preview="mainPreview"></label>' +
        '<div class="admin-preview" id="mainPreview">' + (p.image ? '<img src="' + esc(render.imgUrl(p, p.image)) + '" alt="Current main photo">' : '<span class="admin-muted">No photo yet</span>') + '</div></div>' +
        '<label>More photos <span class="admin-muted">(up to ' + LIMITS.galleryImages + ' in total)</span><input name="galleryImages" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>' +
        (gallery ? '<div class="admin-thumbs">' + gallery + '</div>' : '') + '</section>' +
        '<section class="admin-card"><h2>4. Content</h2>' +
        '<label>Overview <span class="admin-muted">(plain text; leave a blank line between paragraphs)</span><textarea name="overview" rows="7" maxlength="' + LIMITS.overview + '">' + esc(p.overview) + '</textarea></label>' +
        '<label>Where it is used <span class="admin-muted">(separate with commas)</span><input name="deployedIn" type="text" value="' + esc((p.deployedIn || []).join(', ')) + '" placeholder="Hospitals, Hotels, Malls"></label>' +
        '<label>YouTube video link <span class="admin-muted">(optional)</span><input name="videoUrl" type="text" value="' + esc(p.videoId ? 'https://www.youtube.com/watch?v=' + p.videoId : (p.videoUrlRaw || '')) + '" placeholder="https://www.youtube.com/watch?v=..."></label>' +
        '<fieldset><legend>Key features</legend><div data-rows="feature">' + featureRows + '</div><button type="button" class="btn btn-outline" data-add-row="feature">Add a feature</button></fieldset>' +
        '<fieldset><legend>Specifications</legend><div data-rows="spec">' + specRows + '</div><button type="button" class="btn btn-outline" data-add-row="spec">Add a specification</button></fieldset></section>' +
        '<section class="admin-card admin-publish"><h2>5. Save</h2><p class="admin-muted">A draft is only visible to you. Publishing puts the product on the Products page and gives it its own page.</p>' +
        '<div class="admin-actions"><button class="btn btn-outline" type="submit" name="action" value="draft">Save draft</button><button class="btn btn-primary" type="submit" name="action" value="publish">' + (p.status === 'published' ? 'Save changes' : 'Save and publish') + '</button><a class="admin-link" href="' + BASE + '">Cancel</a></div></section>' +
        '</form>' +
        '<template id="tpl-feature">' + featureRow() + '</template><template id="tpl-spec">' + specRow() + '</template>';
    return page(isNew ? 'Add a product' : 'Edit product', body, { session: session });
}

function accountPage(session, message, ok) {
    return page('Password', '<section class="admin-card admin-login"><h1>Change password</h1>' +
        (message ? '<p class="' + (ok ? 'admin-flash' : 'admin-error') + '" role="alert">' + esc(message) + '</p>' : '') +
        '<form method="post" action="' + BASE + '/account"><input type="hidden" name="_csrf" value="' + esc(session.csrf) + '">' +
        '<label for="cur">Current password</label><input id="cur" name="current" type="password" autocomplete="current-password" required maxlength="200">' +
        '<label for="new">New password <span class="admin-muted">(12+ characters, letters and a number)</span></label><input id="new" name="next" type="password" autocomplete="new-password" required minlength="12" maxlength="200">' +
        '<button class="btn btn-primary" type="submit">Change password</button></form></section>', { session: session });
}

// ---- product form handling ------------------------------------------------------------------
function blankProduct() {
    return { name: '', category: '', layout: 'showcase', tagline: '', summary: '', overview: '', videoId: '', deployedIn: [], features: [], specs: [], image: '', gallery: [], status: 'draft' };
}

function formValues(fields) {
    return {
        name: fields.name, category: fields.category, layout: fields.layout, tagline: fields.tagline, summary: fields.summary,
        overview: fields.overview, videoUrl: fields.videoUrl, deployedIn: fields.deployedIn,
        featureTitle: fields.featureTitle, featureText: fields.featureText, specLabel: fields.specLabel, specValue: fields.specValue
    };
}

async function handleSave(req, res, session, existing) {
    let body;
    try { body = await readBody(req); }
    catch (e) {
        const p = existing || blankProduct();
        return send(res, 400, formPage(session, p, [e.userFacing ? e.message : 'The upload could not be read. Try again with smaller photos.'], { filesLost: true }));
    }
    if (!auth.csrfOk(session, body.fields._csrf)) return send(res, 403, page('Session expired', '<p class="admin-error">Your session expired. <a href="' + BASE + '">Go back</a> and try again.</p>', { session: session }));

    const result = store.validate(formValues(body.fields));
    const v = result.value;
    const errors = result.errors.slice();
    const draft = Object.assign(existing ? JSON.parse(JSON.stringify(existing)) : blankProduct(), v);
    draft.videoUrlRaw = String(body.fields.videoUrl || '');
    const wantsPublish = body.fields.action === 'publish';

    const mainFile = (body.files.mainImage || [])[0];
    const newGallery = body.files.galleryImages || [];
    const remove = [].concat(body.fields.removeGallery || []);
    const keepCount = (draft.gallery || []).filter(function(f) { return remove.indexOf(f) === -1; }).length;
    if (keepCount + newGallery.length > LIMITS.galleryImages) errors.push('You can have at most ' + LIMITS.galleryImages + ' extra photos.');
    if (wantsPublish && !mainFile && !(existing && existing.image)) errors.push('Add a main photo before publishing.');
    if (errors.length) return send(res, 400, formPage(session, draft, errors, { filesLost: Boolean(mainFile || newGallery.length) }));

    const id = existing ? existing.id : store.newId();
    const savedFiles = [];
    try {
        let mainName = existing ? existing.image : '';
        if (mainFile) { mainName = await images.saveImage(id, mainFile.buffer); savedFiles.push(mainName); }
        const gallery = (existing ? existing.gallery : []).filter(function(f) { return remove.indexOf(f) === -1; });
        for (const g of newGallery) { const name = await images.saveImage(id, g.buffer); savedFiles.push(name); gallery.push(name); }

        const now = new Date().toISOString();
        const status = wantsPublish ? 'published' : (existing ? existing.status : 'draft');
        let product;
        await store.mutate(function(data) {
            if (existing) {
                product = data.products.filter(function(x) { return x.id === id; })[0];
                if (!product) throw new Error('This product no longer exists.');
            } else {
                product = { id: id, slug: store.uniqueSlug(data, v.name), createdAt: now };
                data.products.push(product);
            }
            Object.assign(product, v, { image: mainName, gallery: gallery, status: status, updatedAt: now });
        });
        if (mainFile && existing && existing.image && existing.image !== mainName) images.removeImage(id, existing.image);
        remove.forEach(function(f) { if ((existing ? existing.gallery : []).indexOf(f) !== -1) images.removeImage(id, f); });
        return redirect(res, BASE + '/products/' + id + '/edit?flash=' + (wantsPublish ? 'published' : 'saved'));
    } catch (e) {
        savedFiles.forEach(function(f) { images.removeImage(id, f); });
        const msg = e instanceof images.ImageError ? e.message : 'Something went wrong while saving. Try again.';
        if (!(e instanceof images.ImageError)) console.error('Admin save failed:', e);
        return send(res, 400, formPage(session, draft, [msg], { filesLost: true }));
    }
}

// ---- router ------------------------------------------------------------------------------------
const ASSET_TYPES = { 'admin.css': 'text/css; charset=utf-8', 'admin.js': 'application/javascript; charset=utf-8' };

async function handle(req, res, urlPath, query) {
    const method = req.method;
    const sub = urlPath.slice(BASE.length) || '/';

    // static admin assets (no login needed)
    const asset = sub.match(/^\/assets\/(admin\.css|admin\.js)$/);
    if (asset && method === 'GET') {
        return fs.readFile(path.join(ROOT, 'admin-assets', asset[1]), function(err, data) {
            if (err) return send(res, 404, 'Not found', {}, 'text/plain');
            send(res, 200, data, { 'Cache-Control': 'public, max-age=300' }, ASSET_TYPES[asset[1]]);
        });
    }

    const session = auth.readSession(req);
    const siteKey = process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY ? process.env.TURNSTILE_SITE_KEY : '';

    // ---- login / logout
    if (sub === '/login') {
        if (method === 'GET') return session ? redirect(res, BASE) : send(res, 200, loginPage('', siteKey));
        if (method === 'POST') {
            let body;
            try { body = await readUrlencoded(req, 10 * 1024); } catch (e) { return send(res, 400, loginPage('The request was too large.', siteKey)); }
            const username = String(body.fields.username || '').trim().slice(0, 80);
            const ip = clientIp(req);
            if (auth.isLocked(ip, username)) return send(res, 429, loginPage('Too many attempts. Wait 15 minutes and try again.', siteKey));
            const human = await requireHuman(body.fields['cf-turnstile-response'], req);
            if (!human.ok) return send(res, 400, loginPage(human.error, siteKey));
            const admin = auth.readAdmin();
            const ok = auth.checkPassword(admin, String(body.fields.password || '')) && admin && admin.username === username;
            if (!ok) {
                auth.recordFailure(ip, username);
                await new Promise(function(r) { setTimeout(r, 400); });
                return send(res, 401, loginPage('That username or password is not right.', siteKey));
            }
            auth.recordSuccess(ip, username);
            return redirect(res, BASE, { 'Set-Cookie': auth.sessionCookie(req, auth.createSession(admin.username)) });
        }
        return send(res, 405, 'Method not allowed', { Allow: 'GET, POST' }, 'text/plain');
    }

    if (!session) {
        if (method === 'GET' || method === 'HEAD') return redirect(res, BASE + '/login');
        return send(res, 401, 'Log in first.', {}, 'text/plain');
    }

    if (sub === '/logout' && method === 'POST') {
        const body = await readUrlencoded(req, 10 * 1024).catch(function() { return { fields: {} }; });
        if (!auth.csrfOk(session, body.fields._csrf)) return send(res, 403, 'Forbidden', {}, 'text/plain');
        return redirect(res, BASE + '/login', { 'Set-Cookie': auth.sessionCookie(req, '', true) });
    }

    // ---- dashboard
    if (sub === '/' && method === 'GET') return send(res, 200, dashboardPage(session, query.get('flash')));

    // ---- account
    if (sub === '/account') {
        if (method === 'GET') return send(res, 200, accountPage(session));
        if (method === 'POST') {
            const body = await readUrlencoded(req, 10 * 1024).catch(function() { return null; });
            if (!body || !auth.csrfOk(session, body.fields._csrf)) return send(res, 403, 'Forbidden', {}, 'text/plain');
            const admin = auth.readAdmin();
            if (!auth.checkPassword(admin, String(body.fields.current || ''))) return send(res, 400, accountPage(session, 'The current password is not right.'));
            const problem = auth.passwordProblem(String(body.fields.next || ''));
            if (problem) return send(res, 400, accountPage(session, problem));
            auth.writeAdmin(admin.username, String(body.fields.next));
            return redirect(res, BASE + '?flash=password');
        }
    }

    // ---- products
    if (sub === '/products/new' && method === 'GET') return send(res, 200, formPage(session, blankProduct(), []));
    if (sub === '/products' && method === 'POST') return handleSave(req, res, session, null);

    const m = sub.match(/^\/products\/([a-f0-9]{16})\/(edit|preview|status|delete)?$/) || sub.match(/^\/products\/([a-f0-9]{16})$/);
    if (m) {
        const product = store.get(m[1]);
        if (!product) return send(res, 404, page('Not found', '<p class="admin-error">That product does not exist. <a href="' + BASE + '">Back to products</a></p>', { session: session }));
        const action = m[2] || '';
        if (action === 'edit' && method === 'GET') return send(res, 200, formPageWithFlash(session, product, query.get('flash')));
        if (action === 'preview' && method === 'GET') {
            return send(res, 200, render.productPage(product, true), { 'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' });
        }
        if (!action && method === 'POST') return handleSave(req, res, session, product);
        if (action === 'status' && method === 'POST') {
            const body = await readUrlencoded(req, 10 * 1024).catch(function() { return null; });
            if (!body || !auth.csrfOk(session, body.fields._csrf)) return send(res, 403, 'Forbidden', {}, 'text/plain');
            const to = body.fields.to === 'published' ? 'published' : 'draft';
            if (to === 'published' && !product.image) return send(res, 400, page('Cannot publish', '<p class="admin-error">Add a main photo before publishing. <a href="' + BASE + '/products/' + esc(product.id) + '/edit">Edit the product</a></p>', { session: session }));
            await store.mutate(function(data) {
                const p = data.products.filter(function(x) { return x.id === product.id; })[0];
                if (p) { p.status = to; p.updatedAt = new Date().toISOString(); }
            });
            return redirect(res, BASE + '?flash=' + (to === 'published' ? 'published' : 'unpublished'));
        }
        if (action === 'delete' && method === 'POST') {
            const body = await readUrlencoded(req, 10 * 1024).catch(function() { return null; });
            if (!body || !auth.csrfOk(session, body.fields._csrf)) return send(res, 403, 'Forbidden', {}, 'text/plain');
            await store.remove(product.id);
            return redirect(res, BASE + '?flash=deleted');
        }
    }

    return send(res, 404, page('Not found', '<p class="admin-error">Page not found. <a href="' + BASE + '">Back to products</a></p>', { session: session }));
}

function formPageWithFlash(session, product, flash) {
    let html = formPage(session, product, []);
    if (flash && FLASH[flash]) html = html.replace('<main class="admin-main">', '<main class="admin-main"><p class="admin-flash" role="status">' + esc(FLASH[flash]) + '</p>');
    return html;
}

module.exports = { handle, BASE };
