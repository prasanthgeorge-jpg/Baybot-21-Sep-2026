// The /site-admin area: login, a product list, and a form to add or edit a
// product (category, content, photos, layout) with preview and publish.
// Routes live under /site-admin because /admin on this domain belongs to the
// older CMS.
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const { requireHuman } = require('../api/_captcha');
const mailer = require('../api/_mail');
const { ROOT, LAYOUTS, LIMITS, ICONS } = require('./config');
const categories = require('./categories');
const auth = require('./auth');
const store = require('./store');
const images = require('./images');
const render = require('./render');

const esc = render.esc;
function catName(id) { const c = categories.get(id); return c ? c.label : id; }
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
    password: 'Password changed. Log in again with your new password.',
    setup: 'Password saved. Log in with your email and your new password.',
    catsaved: 'Category saved.',
    catdeleted: 'Category deleted.'
};

function page(title, body, opts) {
    opts = opts || {};
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<meta name="robots" content="noindex, nofollow"><title>' + esc(title) + ' | BayBot admin</title>' +
        '<link rel="icon" href="/assets/favicon.ico" type="image/x-icon">' +
        '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
        '<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">' +
        '<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/design.css?v=4"><link rel="stylesheet" href="' + BASE + '/assets/admin.css?v=1"></head>' +
        '<body class="admin">' +
        '<header class="admin-bar"><div class="admin-bar-inner"><a class="admin-brand" href="' + BASE + '"><img src="/assets/images/logo-light.png?v=1" alt="BayBot Dynamics"><span>Admin</span></a>' +
        (opts.session
            ? '<nav aria-label="Admin"><a href="' + BASE + '">Products</a><a href="' + BASE + '/categories">Categories</a><a href="' + BASE + '/account">Password</a><a href="/" target="_blank" rel="noopener">View website</a>' +
              '<span class="admin-who" title="Signed in as">' + esc(opts.session.user) + '</span>' +
              '<form method="post" action="' + BASE + '/logout"><input type="hidden" name="_csrf" value="' + esc(opts.session.csrf) + '"><button class="admin-link" type="submit">Log out</button></form></nav>'
            : '') +
        '</div></header><main class="admin-main">' +
        (opts.flash && FLASH[opts.flash] ? '<p class="admin-flash" role="status">' + esc(FLASH[opts.flash]) + '</p>' : '') +
        body + '</main>' + (opts.script !== false ? '<script src="' + BASE + '/assets/admin.js?v=1"></script>' : '') + '</body></html>';
}

function loginPage(message, siteKey, flash) {
    return page('Log in', '<section class="admin-card admin-login"><h1>Admin log in</h1>' +
        (message ? '<p class="admin-error" role="alert">' + esc(message) + '</p>' : '') +
        '<form method="post" action="' + BASE + '/login" autocomplete="on">' +
        '<label for="u">Email</label><input id="u" name="email" type="email" autocomplete="username" required maxlength="254" autofocus>' +
        '<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required maxlength="200">' +
        (siteKey ? '<div class="cf-box" data-sitekey="' + esc(siteKey) + '"></div>' : '') +
        '<button class="btn btn-primary" type="submit"' + (siteKey ? ' data-needs-captcha' : '') + '>Log in</button></form>' +
        '<p class="admin-muted admin-setup-link">First time, or forgot your password? <a href="' + BASE + '/setup">Set a password</a></p></section>', { flash: flash });
}

function setupPage(opts) {
    opts = opts || {};
    const msg = opts.message ? '<p class="' + (opts.ok ? 'admin-flash' : 'admin-error') + '" role="alert">' + esc(opts.message) + '</p>' : '';
    return page('Set your password',
        '<section class="admin-card admin-login"><h1>Set your password</h1>' + msg +
        '<p class="admin-muted">Enter your admin email. If it is an admin address, we send a link that lets you choose a password. The link works once and expires in 30 minutes.</p>' +
        '<form method="post" action="' + BASE + '/setup"><input type="hidden" name="action" value="link">' +
        '<label for="se">Admin email</label><input id="se" name="email" type="email" autocomplete="username" required maxlength="254">' +
        (opts.siteKey ? '<div class="cf-box" data-sitekey="' + esc(opts.siteKey) + '"></div>' : '') +
        '<button class="btn btn-primary" type="submit"' + (opts.siteKey ? ' data-needs-captcha' : '') + '>Email me a link</button></form></section>' +
        '<section class="admin-card admin-login"><h2>Have an invite code?</h2>' +
        '<p class="admin-muted">Your developer may have given you a one-time code instead. Enter it here with your email.</p>' +
        '<form method="post" action="' + BASE + '/setup"><input type="hidden" name="action" value="code">' +
        '<label for="ce">Admin email</label><input id="ce" name="email" type="email" required maxlength="254">' +
        '<label for="cc">Invite code</label><input id="cc" name="code" type="text" required maxlength="40" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX">' +
        '<label for="cn">New password <span class="admin-muted">(12+ characters, letters and a number)</span></label><input id="cn" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="200">' +
        '<label for="cr">Repeat the password</label><input id="cr" name="repeat" type="password" autocomplete="new-password" required minlength="12" maxlength="200">' +
        '<button class="btn btn-primary" type="submit">Set password</button></form>' +
        '<p class="admin-muted admin-setup-link"><a href="' + BASE + '/login">Back to log in</a></p></section>', { flash: null });
}

function setPasswordPage(token, email, message) {
    return page('Choose a password',
        '<section class="admin-card admin-login"><h1>Choose a password</h1>' +
        '<p class="admin-muted">For <strong>' + esc(email) + '</strong></p>' +
        (message ? '<p class="admin-error" role="alert">' + esc(message) + '</p>' : '') +
        '<form method="post" action="' + BASE + '/setup/set"><input type="hidden" name="token" value="' + esc(token) + '">' +
        '<label for="np">New password <span class="admin-muted">(12+ characters, letters and a number)</span></label><input id="np" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="200" autofocus>' +
        '<label for="nr">Repeat the password</label><input id="nr" name="repeat" type="password" autocomplete="new-password" required minlength="12" maxlength="200">' +
        '<button class="btn btn-primary" type="submit">Save password</button></form></section>');
}

function statusBadge(p) {
    return '<span class="admin-badge ' + (p.status === 'published' ? 'is-live' : 'is-draft') + '">' + (p.status === 'published' ? 'Published' : 'Draft') + '</span>';
}

function dashboardPage(session, flash) {
    const custom = store.list();
    const builtin = store.builtinProducts();
    const rows = custom.map(function(p) {
        const live = p.status === 'published';
        return '<tr><td><strong>' + esc(p.name) + '</strong><br><span class="admin-muted">' + esc(catName(p.category)) + ' · ' + esc((LAYOUTS[p.layout] || {}).label || p.layout) + ' layout</span></td>' +
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
        builtin.map(function(b) { return '<li><a href="/product-' + esc(b.id) + '.html" target="_blank" rel="noopener">' + esc(b.name) + '</a> <span class="admin-muted">' + esc(catName(b.category)) + '</span></li>'; }).join('') +
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

function iconSelect(name, selected) {
    return '<label>Icon<select name="' + name + '">' + ICONS.map(function(i) { return '<option value="' + i + '"' + (selected === i ? ' selected' : '') + '>' + i.replace(/-/g, ' ') + '</option>'; }).join('') + '</select></label>';
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
        '<input type="hidden" name="_csrf" value="' + esc(session.csrf) + '">' + (isNew ? '' : '<input type="hidden" name="productId" value="' + esc(p.id) + '">') +
        '<section class="admin-card"><h2>1. The basics</h2>' +
        '<label>Product name<input name="name" type="text" required maxlength="' + LIMITS.name + '" value="' + esc(p.name) + '"></label>' +
        '<label>Category<select name="category" required data-category-select><option value="">Choose a category</option>' + categories.all().map(function(c) { return '<option value="' + esc(c.id) + '"' + (p.category === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '<option value="__new__"' + (p.category === '__new__' ? ' selected' : '') + '>+ Add a new category…</option></select></label>' +
        '<div class="admin-newcat" data-newcat><p class="admin-muted">The new category gets its own section on the Products page, a card at the top and a link in the menu once it has a published product.</p>' +
        '<label>New category name<input name="newCategoryName" type="text" maxlength="' + LIMITS.categoryName + '" value="' + esc(p.newCategoryName || '') + '" placeholder="Window Cleaning Robots"></label>' +
        '<label>One-line description <span class="admin-muted">(optional)</span><input name="newCategoryDescription" type="text" maxlength="' + LIMITS.categoryDescription + '" value="' + esc(p.newCategoryDescription || '') + '"></label>' +
        iconSelect('newCategoryIcon', p.newCategoryIcon) + '</div>' +
        '<label>Headline under the name <span class="admin-muted">(optional)</span><input name="tagline" type="text" maxlength="' + LIMITS.tagline + '" value="' + esc(p.tagline) + '" placeholder="Autonomous floor cleaning for large facilities"></label>' +
        '<label>Short summary <span class="admin-muted">(shown on the product card and in Google)</span><textarea name="summary" rows="3" required maxlength="' + LIMITS.summary + '" data-count>' + esc(p.summary) + '</textarea></label></section>' +
        '<section class="admin-card"><h2>2. Choose a layout</h2><p class="admin-muted">This sets how the product page is arranged. Fill in the form, then see your own product in every layout before you decide.</p>' + layoutPicker(p.layout || 'showcase') +
        '<p><button class="btn btn-outline" type="submit" formaction="' + BASE + '/preview" formtarget="_blank" formnovalidate>See how my page looks in each layout</button> <span class="admin-muted">Opens in a new tab. Nothing is saved.</span></p></section>' +
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
        '<div class="admin-actions"><button class="btn btn-outline" type="submit" formaction="' + BASE + '/preview" formtarget="_blank" formnovalidate>Preview</button><button class="btn btn-outline" type="submit" name="action" value="draft">Save draft</button><button class="btn btn-primary" type="submit" name="action" value="publish">' + (p.status === 'published' ? 'Save changes' : 'Save and publish') + '</button><a class="admin-link" href="' + BASE + '">Cancel</a></div></section>' +
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

    // A brand-new category can be created right from the product form.
    let newCat = null;
    if (v.category === '__new__') {
        newCat = {
            label: body.fields.newCategoryName, description: body.fields.newCategoryDescription, icon: body.fields.newCategoryIcon
        };
        const check = categories.validate(newCat);
        check.errors.forEach(function(e) { errors.push(e); });
        if (!check.errors.length && categories.all().some(function(c) { return c.label.toLowerCase() === check.value.label.toLowerCase(); })) {
            errors.push('A category with that name already exists. Choose it from the list instead.');
        }
    } else if (v.category && !categories.get(v.category)) {
        errors.push('Choose a category.');
    }

    const draft = Object.assign(existing ? JSON.parse(JSON.stringify(existing)) : blankProduct(), v);
    draft.newCategoryName = body.fields.newCategoryName; draft.newCategoryDescription = body.fields.newCategoryDescription; draft.newCategoryIcon = body.fields.newCategoryIcon;
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
        if (newCat) {
            const created = await categories.create(newCat);
            v.category = created.id;
        }
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

// The public address used in emailed links. Set SITE_URL (e.g. https://baybotdynamics.com)
// on the server: a link must never be built from the request's Host header, which a
// visitor can fake. Locally, localhost is accepted.
function siteBase(req) {
    if (process.env.SITE_URL) return String(process.env.SITE_URL).replace(/\/+$/, '');
    const host = String(req.headers.host || '');
    return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http://' + host : '';
}


// ---- previews of an unsaved form ---------------------------------------------------------------
// The form posts to /site-admin/preview; the entered content and any new photos
// are kept in memory for 30 minutes (per admin) so the page can be shown in all
// three layouts without saving anything.
const previews = new Map();
const PREVIEW_MS = 30 * 60 * 1000;
const MAX_PREVIEWS_PER_USER = 6;

function cleanPreviews() {
    const now = Date.now();
    previews.forEach(function(v, k) { if (v.expires < now) previews.delete(k); });
}
function savePreview(user, product, imageMap) {
    cleanPreviews();
    const mine = Array.from(previews.entries()).filter(function(e) { return e[1].user === user; });
    while (mine.length >= MAX_PREVIEWS_PER_USER) { previews.delete(mine.shift()[0]); }
    const id = store.newId();
    product.previewId = id;
    previews.set(id, { user: user, expires: Date.now() + PREVIEW_MS, product: product, images: imageMap });
    return id;
}
function getPreview(id, user) {
    cleanPreviews();
    const p = previews.get(id);
    return p && p.user === user ? p : null;
}

function layoutTabs(basePath, current, unsaved) {
    return '<strong>' + (unsaved ? 'Preview: nothing is saved yet.' : 'Preview of your saved page.') + '</strong> <span class="pl-bar-label">Layout:</span> ' +
        Object.keys(LAYOUTS).map(function(key) {
            return '<a class="pl-tab' + (key === current ? ' is-current' : '') + '" href="' + esc(basePath) + '?layout=' + key + '"' + (key === current ? ' aria-current="page"' : '') + '>' + esc(LAYOUTS[key].label) + '</a>';
        }).join('') +
        '<span class="pl-bar-note">' + (unsaved ? 'Close this tab and pick your layout in the form.' : 'Go back to the edit page to change the layout.') + '</span>';
}

async function handlePreview(req, res, session) {
    let body;
    try { body = await readBody(req); }
    catch (e) { return send(res, 400, page('Preview', '<p class="admin-error">' + esc(e.userFacing ? e.message : 'The preview could not be built. Try smaller photos.') + '</p>', { session: session })); }
    if (!auth.csrfOk(session, body.fields._csrf)) return send(res, 403, 'Forbidden', {}, 'text/plain');

    const existing = body.fields.productId ? store.get(String(body.fields.productId)) : null;
    const v = store.validate(formValues(body.fields)).value;       // lenient: problems do not block a preview
    const draft = Object.assign(existing ? JSON.parse(JSON.stringify(existing)) : blankProduct(), v);
    if (!draft.name) draft.name = 'Your product name';
    if (!draft.summary) draft.summary = 'A short summary of your product appears here and on the product card.';
    if (!LAYOUTS[draft.layout]) draft.layout = 'showcase';

    if (draft.category === '__new__') {
        draft.categoryLabel = String(body.fields.newCategoryName || '').trim().slice(0, LIMITS.categoryName) || 'New category';
        draft.category = 'new-category';
    }
    const imageMap = {};
    try {
        const mainFile = (body.files.mainImage || [])[0];
        if (mainFile) { imageMap['m.webp'] = await images.processImage(mainFile.buffer); draft.image = 'preview:m.webp'; }
        const removed = [].concat(body.fields.removeGallery || []);
        draft.gallery = (draft.gallery || []).filter(function(f) { return removed.indexOf(f) === -1; });
        let n = 0;
        for (const g of (body.files.galleryImages || []).slice(0, LIMITS.galleryImages)) {
            const key = 'g' + (++n) + '.webp';
            imageMap[key] = await images.processImage(g.buffer);
            draft.gallery.push('preview:' + key);
        }
        draft.gallery = draft.gallery.slice(0, LIMITS.galleryImages);
    } catch (e) {
        const msg = e instanceof images.ImageError ? e.message : 'A photo could not be read.';
        return send(res, 400, page('Preview', '<p class="admin-error">' + esc(msg) + ' Close this tab and fix the photo in the form.</p>', { session: session }));
    }
    const id = savePreview(session.user, draft, imageMap);
    return redirect(res, BASE + '/preview/' + id);
}

function sendPreviewPage(res, product, layoutParam, basePath, unsaved) {
    const prod = JSON.parse(JSON.stringify(product));
    if (LAYOUTS[layoutParam]) prod.layout = layoutParam;
    if (!LAYOUTS[prod.layout]) prod.layout = 'showcase';
    const html = render.productPage(prod, { bar: layoutTabs(basePath, prod.layout, unsaved) });
    return send(res, 200, html, { 'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' });
}

// ---- categories --------------------------------------------------------------------------------------
function categoryForm(session, c) {
    const isNew = !c;
    c = c || { label: '', description: '', icon: 'robot' };
    return '<form method="post" action="' + BASE + '/categories' + (isNew ? '' : '/' + esc(c.id)) + '" class="admin-form admin-catform">' +
        '<input type="hidden" name="_csrf" value="' + esc(session.csrf) + '">' +
        '<label>Name<input name="label" type="text" required maxlength="' + LIMITS.categoryName + '" value="' + esc(c.label) + '" placeholder="Window Cleaning Robots"></label>' +
        '<label>One-line description <span class="admin-muted">(optional)</span><input name="description" type="text" maxlength="' + LIMITS.categoryDescription + '" value="' + esc(c.description) + '"></label>' +
        iconSelect('icon', c.icon) +
        '<button class="btn btn-primary" type="submit">' + (isNew ? 'Add category' : 'Save changes') + '</button></form>';
}

function categoriesPage(session, flash, message) {
    const all = categories.all();
    const rows = all.map(function(c) {
        const count = categories.productCount(c.id);
        if (c.builtin) {
            return '<tr><td><strong>' + esc(c.label) + '</strong> <span class="admin-badge is-draft">Built in</span><br><span class="admin-muted">' + esc(c.description) + '</span></td><td>' + count + '</td><td class="admin-muted">Cannot be changed</td></tr>';
        }
        return '<tr><td><strong>' + esc(c.label) + '</strong><br><span class="admin-muted">' + esc(c.description) + '</span>' +
            '<details class="admin-inline"><summary>Edit</summary>' + categoryForm(session, c) + '</details></td><td>' + count + '</td>' +
            '<td class="admin-actions"><form method="post" action="' + BASE + '/categories/' + esc(c.id) + '/delete" data-confirm="Delete the category ' + esc(c.label) + '?"><input type="hidden" name="_csrf" value="' + esc(session.csrf) + '"><button class="btn btn-danger" type="submit">Delete</button></form></td></tr>';
    }).join('');
    const body = '<div class="admin-head"><h1>Categories</h1></div>' +
        (message ? '<p class="admin-error" role="alert">' + esc(message) + '</p>' : '') +
        '<section class="admin-card"><h2>Add a category</h2><p class="admin-muted">A category is a group of products. Once it has a published product it gets its own section on the Products page, a card at the top and a link in the Products menu.</p>' + categoryForm(session, null) + '</section>' +
        '<section class="admin-card"><h2>All categories</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Category</th><th>Products</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="admin-muted">You can add up to ' + LIMITS.customCategories + ' categories of your own. To remove one, move or delete its products first.</p></section>';
    return page('Categories', body, { session: session, flash: flash });
}

async function categoryAction(req, res, session, action, id) {
    const body = await readUrlencoded(req, 10 * 1024).catch(function() { return null; });
    if (!body || !auth.csrfOk(session, body.fields._csrf)) return send(res, 403, 'Forbidden', {}, 'text/plain');
    try {
        if (action === 'create') await categories.create(body.fields);
        else if (action === 'update') await categories.update(id, body.fields);
        else if (action === 'delete') await categories.remove(id);
    } catch (e) {
        return send(res, 400, categoriesPage(session, null, e.message));
    }
    return redirect(res, BASE + '/categories?flash=' + (action === 'delete' ? 'catdeleted' : 'catsaved'));
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

    // ---- login
    if (sub === '/login') {
        if (method === 'GET') return session ? redirect(res, BASE) : send(res, 200, loginPage('', siteKey, query.get('flash')));
        if (method === 'POST') {
            let body;
            try { body = await readUrlencoded(req, 10 * 1024); } catch (e) { return send(res, 400, loginPage('The request was too large.', siteKey)); }
            const email = auth.normEmail(body.fields.email);
            const ip = clientIp(req);
            if (auth.isLocked(ip, email)) return send(res, 429, loginPage('Too many attempts. Wait 15 minutes and try again.', siteKey));
            const human = await requireHuman(body.fields['cf-turnstile-response'], req);
            if (!human.ok) return send(res, 400, loginPage(human.error, siteKey));
            const admin = auth.findAdmin(email);
            const ok = auth.checkPassword(admin, String(body.fields.password || ''));
            if (!ok) {
                auth.recordFailure(ip, email);
                await new Promise(function(r) { setTimeout(r, 400); });
                return send(res, 401, loginPage('That email or password is not right. If you have not set a password yet, use "Set a password" below.', siteKey));
            }
            auth.recordSuccess(ip, email);
            return redirect(res, BASE, { 'Set-Cookie': auth.sessionCookie(req, auth.createSession(admin)) });
        }
        return send(res, 405, 'Method not allowed', { Allow: 'GET, POST' }, 'text/plain');
    }

    // ---- first-time password / forgotten password (no login needed)
    if (sub === '/setup' || sub === '/setup/set' || sub.indexOf('/setup/') === 0) {
        const ip = clientIp(req);
        const done = function(email) { return redirect(res, BASE + '/login?flash=setup'); };

        // A link from the email: /site-admin/setup/<token>
        const linkMatch = sub.match(/^\/setup\/([A-Za-z0-9-]{20,40})$/);
        if (linkMatch && method === 'GET') {
            if (auth.isLocked(ip, 'setup')) return send(res, 429, setupPage({ message: 'Too many attempts. Wait 15 minutes and try again.' }));
            const acct = auth.accountForToken(linkMatch[1]);
            if (!acct) { auth.recordFailure(ip, 'setup'); return send(res, 400, setupPage({ message: 'That link is not valid or has expired. Ask for a new one below.', siteKey: siteKey })); }
            return send(res, 200, setPasswordPage(auth.normToken(linkMatch[1]), acct.email));
        }

        if (sub === '/setup/set' && method === 'POST') {
            const body = await readUrlencoded(req, 10 * 1024).catch(function() { return null; });
            if (!body) return send(res, 400, 'Bad request', {}, 'text/plain');
            if (auth.isLocked(ip, 'setup')) return send(res, 429, setupPage({ message: 'Too many attempts. Wait 15 minutes and try again.' }));
            const acct = auth.accountForToken(body.fields.token);
            if (!acct) { auth.recordFailure(ip, 'setup'); return send(res, 400, setupPage({ message: 'That link is not valid or has expired. Ask for a new one below.', siteKey: siteKey })); }
            const pw = String(body.fields.password || '');
            const problem = auth.passwordProblem(pw) || (pw !== String(body.fields.repeat || '') ? 'The two passwords do not match.' : '');
            if (problem) return send(res, 400, setPasswordPage(auth.normToken(body.fields.token), acct.email, problem));
            auth.setPassword(acct.email, pw);
            return done();
        }

        if (sub === '/setup') {
            if (method === 'GET') return send(res, 200, setupPage({ siteKey: siteKey }));
            if (method !== 'POST') return send(res, 405, 'Method not allowed', { Allow: 'GET, POST' }, 'text/plain');
            const body = await readUrlencoded(req, 10 * 1024).catch(function() { return null; });
            if (!body) return send(res, 400, 'Bad request', {}, 'text/plain');
            const email = auth.normEmail(body.fields.email);

            if (body.fields.action === 'code') {
                if (auth.isLocked(ip, 'setup')) return send(res, 429, setupPage({ message: 'Too many attempts. Wait 15 minutes and try again.', siteKey: siteKey }));
                const acct = auth.accountForToken(body.fields.code, email);
                const pw = String(body.fields.password || '');
                if (!acct) { auth.recordFailure(ip, 'setup'); await new Promise(function(r) { setTimeout(r, 400); }); return send(res, 400, setupPage({ message: 'That email and code do not match, or the code has expired or been used.', siteKey: siteKey })); }
                const problem = auth.passwordProblem(pw) || (pw !== String(body.fields.repeat || '') ? 'The two passwords do not match.' : '');
                if (problem) return send(res, 400, setupPage({ message: problem, siteKey: siteKey }));
                auth.setPassword(acct.email, pw);
                return done();
            }

            // action === 'link': email a one-time link. The answer is the same for any address.
            const human = await requireHuman(body.fields['cf-turnstile-response'], req);
            if (!human.ok) return send(res, 400, setupPage({ message: human.error, siteKey: siteKey }));
            const generic = 'If that is an admin address and email sending is set up, a link is on its way. It works once and expires in 30 minutes.';
            if (!mailer.smtpReady()) {
                return send(res, 200, setupPage({ ok: true, siteKey: siteKey, message: 'Email sending is not set up on this server yet, so no link can be sent. Ask your developer for an invite code and use the box below.' }));
            }
            const acct = auth.findAdmin(email);
            const base = siteBase(req);
            if (acct && base && auth.mayEmail(email, 3)) {
                const token = auth.createSetupToken(email, 30 * 60 * 1000);
                if (token) {
                    await mailer.sendDirect({
                        to: email,
                        subject: 'Set your BayBot admin password',
                        text: 'Hello,\n\nUse this link to set your password for the BayBot website admin:\n\n' + base + BASE + '/setup/' + token +
                            '\n\nThe link works once and expires in 30 minutes.\nIf you did not ask for this, ignore this email. Nothing changes.\n'
                    });
                }
            }
            return send(res, 200, setupPage({ ok: true, siteKey: siteKey, message: generic }));
        }
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
            const admin = auth.findAdmin(session.user);
            if (!auth.checkPassword(admin, String(body.fields.current || ''))) return send(res, 400, accountPage(session, 'The current password is not right.'));
            const problem = auth.passwordProblem(String(body.fields.next || ''));
            if (problem) return send(res, 400, accountPage(session, problem));
            auth.setPassword(admin.email, String(body.fields.next));
            // every session for this account (including this one) ends, so log in again
            return redirect(res, BASE + '/login?flash=password', { 'Set-Cookie': auth.sessionCookie(req, '', true) });
        }
    }

    // ---- categories
    if (sub === '/categories' && method === 'GET') return send(res, 200, categoriesPage(session, query.get('flash')));
    if (sub === '/categories' && method === 'POST') return categoryAction(req, res, session, 'create');
    const cm = sub.match(/^\/categories\/([a-z0-9-]{1,60})(\/delete)?$/);
    if (cm && method === 'POST') return categoryAction(req, res, session, cm[2] ? 'delete' : 'update', cm[1]);

    // ---- preview of an unsaved form (and its images)
    if (sub === '/preview' && method === 'POST') return handlePreview(req, res, session);
    const pm = sub.match(/^\/preview\/([a-f0-9]{16})(?:\/img\/([mg][0-9]*\.webp))?$/);
    if (pm && method === 'GET') {
        const prev = getPreview(pm[1], session.user);
        if (!prev) return send(res, 404, page('Preview expired', '<p class="admin-error">This preview has expired. Go back to the form and choose Preview again.</p>', { session: session }));
        if (pm[2]) {
            const img = prev.images[pm[2]];
            if (!img) return send(res, 404, 'Not found', {}, 'text/plain');
            return send(res, 200, img, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' }, 'image/webp');
        }
        return sendPreviewPage(res, prev.product, query.get('layout'), BASE + '/preview/' + pm[1], true);
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
            return sendPreviewPage(res, product, query.get('layout'), BASE + '/products/' + product.id + '/preview', false);
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
