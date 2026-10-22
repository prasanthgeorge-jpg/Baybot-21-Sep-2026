// Public rendering of admin-created products: the product page in the chosen
// layout, the product card, and the injection of cards into products.html.
// Every value from the admin is escaped; descriptions are plain text, so a
// customer can never put markup or script on the site.
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');
const store = require('./store');
const categories = require('./categories');
const badges = require('./badges');

function esc(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Plain text -> paragraphs; single newlines become line breaks.
function paragraphs(textValue) {
    return String(textValue || '').split(/\n{2,}/).map(function(p) { return p.trim(); }).filter(Boolean)
        .map(function(p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
}

// Saved photos live in /uploads. While previewing an unsaved form, new photos are
// held in memory and named "preview:<n>.webp".
function imgUrl(p, file) {
    if (!file) return '';
    if (String(file).indexOf('preview:') === 0) return '/site-admin/preview/' + p.previewId + '/img/' + String(file).slice(8);
    if (/^(\/|assets\/|https?:)/.test(file)) return file;
    return '/uploads/' + p.id + '/' + file;
}
function catLabel(p) {
    if (p.categoryLabel) return p.categoryLabel;
    const c = categories.get(p.category);
    return c ? c.label : 'Products';
}
function pageUrl(p) { return 'product-' + p.slug + '.html'; }

// ---- page shell (head, navigation, footer) taken from products.html ----------------
let shellCache = null;
function shell() {
    const file = path.join(ROOT, 'products.html');
    const stat = fs.statSync(file);
    if (shellCache && shellCache.mtimeMs === stat.mtimeMs) return shellCache;
    const html = fs.readFileSync(file, 'utf8');
    const open = html.indexOf('<main id="main">');
    const close = html.indexOf('</main>');
    if (open === -1 || close === -1) throw new Error('products.html has no <main id="main"> block');
    shellCache = {
        mtimeMs: stat.mtimeMs,
        before: html.slice(0, open),
        after: html.slice(close + '</main>'.length)
    };
    return shellCache;
}

function setHead(head, opts) {
    let h = head;
    const set = function(re, tag) { h = re.test(h) ? h.replace(re, tag) : h.replace('</head>', '    ' + tag + '\n</head>'); };
    set(/<title>[\s\S]*?<\/title>/, '<title>' + esc(opts.title) + '</title>');
    set(/<meta name="description"[^>]*>/, '<meta name="description" content="' + esc(opts.description) + '">');
    set(/<meta name="robots"[^>]*>/, '<meta name="robots" content="' + esc(opts.robots) + '">');
    set(/<link rel="canonical"[^>]*>/, '<link rel="canonical" href="' + esc(opts.canonical) + '">');
    set(/<meta property="og:title"[^>]*>/, '<meta property="og:title" content="' + esc(opts.title) + '">');
    set(/<meta property="og:description"[^>]*>/, '<meta property="og:description" content="' + esc(opts.description) + '">');
    set(/<meta property="og:type"[^>]*>/, '<meta property="og:type" content="product">');
    h = h.replace(/<base [^>]*>/g, '');
    return h.replace('<head>', '<head>\n    <base href="/">');
}

// ---- building blocks ------------------------------------------------------------
function breadcrumb(p) {
    return '<nav class="breadcrumb breadcrumb-left" aria-label="Breadcrumb">' +
        '<a href="index.html">Home</a><span aria-hidden="true">/</span>' +
        '<a href="products.html">Products</a><span aria-hidden="true">/</span>' +
        '<a href="products.html#' + esc(p.category) + '">' + esc(catLabel(p)) + '</a><span aria-hidden="true">/</span>' +
        '<span aria-current="page">' + esc(p.name) + '</span></nav>';
}

function heroText(p) {
    return '<div class="product-hero-text">' +
        '<span class="section-label">' + esc(catLabel(p)) + '</span>' +
        '<h1>' + esc(p.name) + '</h1>' +
        (p.tagline ? '<p class="product-hero-title">' + esc(p.tagline) + '</p>' : '') +
        '<div class="rich-text product-hero-summary"><p>' + esc(p.summary) + '</p></div>' +
        '<div class="product-hero-cta">' +
        '<a href="schedule-demo.html" class="btn btn-primary btn-lg">Request a Demo</a>' +
        (p.videoId ? '<a href="#video" class="btn btn-outline btn-lg"><i class="fas fa-circle-play" aria-hidden="true"></i> Watch Video</a>' : '') +
        '</div></div>';
}

function heroMedia(p) {
    if (!p.image) return '';
    return '<div class="product-hero-media"><img src="' + imgUrl(p, p.image) + '" alt="' + esc(p.name) + '"></div>';
}

function video(p) {
    if (!p.videoId) return '';
    const id = esc(p.videoId);
    return '<section class="product-video-section" id="video" aria-labelledby="video-heading"><div class="container">' +
        '<div class="section-header text-center"><span class="section-label light">Video</span>' +
        '<h2 class="section-title light" id="video-heading">Watch the ' + esc(p.name) + ' in Action</h2></div>' +
        '<div class="video-embed" data-video-id="' + id + '" data-title="' + esc(p.name) + ' in action">' +
        '<a class="video-embed-poster" href="https://www.youtube.com/watch?v=' + id + '" target="_blank" rel="noopener">' +
        '<img src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="" loading="lazy" decoding="async">' +
        '<span class="video-embed-play" aria-hidden="true"><i class="fas fa-play"></i></span>' +
        '<span class="visually-hidden">Play video: ' + esc(p.name) + ' in action</span></a></div></div></section>';
}

function overview(p) {
    if (!p.overview && !p.deployedIn.length) return '';
    return '<section class="about-section" id="overview" aria-labelledby="overview-heading"><div class="container">' +
        '<div class="product-overview"><span class="section-label">Overview</span>' +
        '<h2 class="section-title" id="overview-heading">About the ' + esc(p.name) + '</h2>' +
        (p.overview ? '<div class="rich-text section-description">' + paragraphs(p.overview) + '</div>' : '') +
        (p.deployedIn.length ? '<div class="industry-chips"><h3>Deployed In</h3><ul>' +
            p.deployedIn.map(function(c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>' : '') +
        '</div></div></section>';
}

function featuresGrid(p) {
    if (!p.features.length) return '';
    return '<section class="industries-section" id="features" aria-labelledby="features-heading"><div class="container">' +
        '<div class="section-header text-center"><span class="section-label">Key Features</span>' +
        '<h2 class="section-title" id="features-heading">What Sets the ' + esc(p.name) + ' Apart</h2></div>' +
        '<div class="product-feature-grid">' + p.features.map(function(f) {
            return '<div class="product-feature"><span class="product-feature-icon"><i class="fas fa-check" aria-hidden="true"></i></span>' +
                '<div><h3>' + esc(f.title) + '</h3>' + (f.text ? '<div class="rich-text">' + paragraphs(f.text) + '</div>' : '') + '</div></div>';
        }).join('') + '</div></div></section>';
}

function featuresList(p) {
    if (!p.features.length) return '';
    return '<ul class="pl-feature-list">' + p.features.map(function(f) {
        return '<li><i class="fas fa-check" aria-hidden="true"></i><div><h3>' + esc(f.title) + '</h3>' +
            (f.text ? '<div class="rich-text">' + paragraphs(f.text) + '</div>' : '') + '</div></li>';
    }).join('') + '</ul>';
}

function specs(p, id) {
    if (!p.specs.length) return '';
    return '<section class="about-section" id="' + (id || 'specs') + '" aria-labelledby="specs-heading"><div class="container">' +
        '<div class="section-header text-center"><span class="section-label">Specifications</span>' +
        '<h2 class="section-title" id="specs-heading">' + esc(p.name) + ' Specifications</h2></div>' +
        '<dl class="pl-specs">' + p.specs.map(function(s) {
            return '<div><dt>' + esc(s.label) + '</dt><dd>' + esc(s.value) + '</dd></div>';
        }).join('') + '</dl>' +
        '<p class="spec-note">Pricing and configuration are quoted per site. <a href="contact.html">Ask us for the specification sheet.</a></p>' +
        '</div></section>';
}

function gallery(p, big) {
    const all = [];
    if (big && p.image) all.push(p.image);
    (p.gallery || []).forEach(function(g) { all.push(g); });
    if (!all.length) return '';
    return '<section class="about-section" id="gallery" aria-label="' + esc(p.name) + ' photos"><div class="container">' +
        '<div class="pl-gallery' + (big ? ' pl-gallery-big' : '') + '">' + all.map(function(file, i) {
            return '<figure><img src="' + imgUrl(p, file) + '" alt="' + esc(p.name) + (i ? ' photo ' + (i + 1) : '') + '" loading="' + (i ? 'lazy' : 'eager') + '" decoding="async"></figure>';
        }).join('') + '</div></div></section>';
}

function cta(p) {
    return '<section class="cta-section"><div class="container text-center">' +
        '<h2 class="section-title">See the ' + esc(p.name) + ' in Your Space</h2>' +
        '<p class="section-description">Tell us about your facility and we\'ll arrange a demo, online or in person, along with specifications and pricing for your site.</p>' +
        '<div class="hero-cta"><a href="schedule-demo.html" class="btn btn-primary btn-lg">Request a Custom Demo</a>' +
        '<a href="contact.html" class="btn btn-outline btn-lg">Request Specifications</a></div></div></section>';
}

// ---- the three layouts ------------------------------------------------------------
const LAYOUT_RENDERERS = {
    showcase: function(p) {
        return '<section class="product-hero"><div class="container">' + breadcrumb(p) +
            '<div class="product-hero-grid">' + heroText(p) + heroMedia(p) + '</div></div></section>' +
            video(p) + overview(p) + featuresGrid(p) + gallery(p, false) + specs(p) + cta(p);
    },
    'spec-sheet': function(p) {
        return '<section class="product-hero pl-hero-compact"><div class="container">' + breadcrumb(p) +
            '<div class="product-hero-grid">' + heroText(p) + heroMedia(p) + '</div></div></section>' +
            specs(p) +
            (p.overview || p.features.length || p.deployedIn.length
                ? '<section class="industries-section" id="features"><div class="container"><div class="pl-two-col">' +
                    '<div>' + (p.overview ? '<span class="section-label">Overview</span><h2 class="section-title">About the ' + esc(p.name) + '</h2><div class="rich-text section-description">' + paragraphs(p.overview) + '</div>' : '') +
                    (p.deployedIn.length ? '<div class="industry-chips"><h3>Deployed In</h3><ul>' + p.deployedIn.map(function(c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>' +
                    '<div>' + (p.features.length ? '<span class="section-label">Key Features</span>' + featuresList(p) : '') + '</div>' +
                    '</div></div></section>' : '') +
            gallery(p, false) + video(p) + cta(p);
    },
    gallery: function(p) {
        return '<section class="product-hero pl-hero-center"><div class="container">' + breadcrumb(p) +
            '<div class="pl-hero-head">' + heroText(p) + '</div></div></section>' +
            gallery(p, true) +
            (p.overview || p.features.length || p.deployedIn.length
                ? '<section class="about-section" id="overview"><div class="container"><div class="pl-two-col">' +
                    '<div>' + (p.overview ? '<span class="section-label">Overview</span><h2 class="section-title">About the ' + esc(p.name) + '</h2><div class="rich-text section-description">' + paragraphs(p.overview) + '</div>' : '') +
                    (p.deployedIn.length ? '<div class="industry-chips"><h3>Deployed In</h3><ul>' + p.deployedIn.map(function(c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>' +
                    '<div>' + (p.features.length ? '<span class="section-label">Key Features</span>' + featuresList(p) : '') + '</div>' +
                    '</div></div></section>' : '') +
            specs(p) + video(p) + cta(p);
    }
};

// `preview` is false for the live page, true for a plain draft preview, or
// { bar: '<html>' } to show custom controls (layout tabs) in the preview bar.
function productMain(p, preview) {
    const render = LAYOUT_RENDERERS[p.layout] || LAYOUT_RENDERERS.showcase;
    let bar = '';
    if (preview) {
        bar = '<div class="pl-preview-bar" role="status">' +
            (preview.bar || 'Preview of an unpublished draft. Visitors cannot see this page yet.') + '</div>';
    }
    return bar + render(p);
}

// Full HTML page for a product.
function productPage(p, preview) {
    const s = shell();
    const title = p.name + ' | ' + (p.tagline || catLabel(p)) + ' | BayBot Dynamics';
    const head = setHead(s.before, {
        title: title,
        description: p.summary,
        robots: preview ? 'noindex, nofollow' : 'index, follow',
        canonical: pageUrl(p)
    });
    return head + '<main id="main">' + productMain(p, preview) + '</main>' + s.after;
}

// ---- cards on the Products page ------------------------------------------------------
function cardHtml(p) {
    const href = pageUrl(p);
    return '<article class="model-card" id="model-' + esc(p.slug) + '">' +
        '<a href="' + href + '" class="model-card-media" tabindex="-1" aria-hidden="true">' +
        (p.image ? '<img src="' + imgUrl(p, p.image) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async">' : '') + '</a>' +
        '<div class="model-card-body">' +
        (p.videoId ? '<div class="model-flags"><span class="model-video-flag"><i class="fas fa-circle-play" aria-hidden="true"></i> Video</span></div>' : '') +
        '<h3><a href="' + href + '">' + esc(p.name) + '</a></h3><p>' + esc(p.summary) + '</p>' +
        '<div class="model-actions"><a href="' + href + '" class="btn btn-primary">View Details<span class="visually-hidden"> about ' + esc(p.name) + '</span></a></div>' +
        '</div></article>';
}

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen'];

// Custom categories that currently have at least one published product. Empty
// categories stay hidden from visitors.
function visibleCustomCategories() {
    const live = store.published();
    return categories.customList().filter(function(c) { return live.some(function(p) { return p.category === c.id; }); });
}

function categorySection(c, items) {
    return '<section class="about-section" id="' + esc(c.id) + '"><div class="container">' +
        '<div class="section-header text-center"><span class="section-label">' + esc(c.label) + '</span>' +
        '<h2 class="section-title">' + esc(c.label) + '</h2>' +
        (c.description ? '<p class="section-description">' + esc(c.description) + '</p>' : '') + '</div>' +
        '<div class="model-grid">' + items.map(cardHtml).join('\n') + '</div></div></section>';
}

function familyCard(c, count) {
    return '<a href="#' + esc(c.id) + '" class="industry-card industry-card-link">' +
        '<div class="industry-icon"><i class="fas fa-' + esc(c.icon) + '"></i></div>' +
        '<h3>' + esc(c.label) + '</h3>' + (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
        '<span class="card-link">View ' + count + ' model' + (count === 1 ? '' : 's') + ' <i class="fas fa-arrow-down"></i></span></a>';
}

// Brand of a product. Products made before brands existed are PUDU.
function brandOf(p) { return p.brand === 'tennant' ? 'tennant' : 'pudu'; }

const BRAND_NAME = { pudu: 'PUDU', tennant: 'Tennant' };

// Dropdown at the top of each family section: choose PUDU robots or Tennant robots.
function brandSwitch(sectionId, nPudu, nTennant) {
    return '<div class="brand-switch" id="' + esc(sectionId) + '-brands">' +
        '<label class="brand-switch-label" for="bs-' + esc(sectionId) + '">Show</label>' +
        '<select class="brand-switch-select" id="bs-' + esc(sectionId) + '" data-brand-switch="' + esc(sectionId) + '" aria-label="Choose brand">' +
        '<option value="pudu">PUDU robots (' + nPudu + ')</option>' +
        '<option value="tennant">Tennant robots (' + nTennant + ')</option></select>' + badges.BADGE + '</div>';
}

// Section a Tennant product is listed in: its own category when that is one of the
// built-in families, otherwise the Cleaning family (Tennant robots are floor cleaners).
function sectionOfTennant(p) {
    return categories.builtinList().some(function(c) { return c.id === p.category; }) ? p.category : 'cleaning';
}

// Tennant block for one family section: a Tennant heading, then the robots grouped by
// their Tennant category (scrubbers, sweepers, vacuums).
function tennantBlock(sectionId, list) {
    const known = categories.all();
    let body = '';
    const loose = list.filter(function(p) { return !known.some(function(c) { return c.id === p.category && !categories.builtinList().some(function(b) { return b.id === c.id; }); }); });
    if (loose.length) body += '<div class="model-grid">' + loose.map(cardHtml).join('\n') + '</div>';
    known.forEach(function(c) {
        if (categories.builtinList().some(function(b) { return b.id === c.id; })) return;
        const mine = list.filter(function(p) { return p.category === c.id; });
        if (!mine.length) return;
        body += '<div class="brand-group" id="' + esc(c.id) + '"><h4>' + esc(c.label) + '</h4>' +
            (c.description ? '<p class="section-description">' + esc(c.description) + '</p>' : '') +
            '<div class="model-grid">' + mine.map(cardHtml).join('\n') + '</div></div>';
    });
    return body;
}

// Adds published custom products to the Products page. Inside each family section
// the PUDU robots come first, then the Tennant robots, each under its own heading
// with the "Official Distributor" badge.
function injectCards(html) {
    const items = store.published();
    let out = html;
    let added = 0;

    categories.builtinList().forEach(function(c) {
        const mine = items.filter(function(p) { return p.category === c.id && brandOf(p) === 'pudu'; });
        const ten = items.filter(function(p) { return brandOf(p) === 'tennant' && sectionOfTennant(p) === c.id; });
        const start = out.indexOf('<!-- MODELS:' + c.id + ':START');
        const end = out.indexOf('<!-- MODELS:' + c.id + ':END');
        if (start === -1 || end === -1) return;
        if (mine.length) {
            const closeDiv = out.lastIndexOf('</div>', end);
            if (closeDiv > start) out = out.slice(0, closeDiv) + mine.map(cardHtml).join('\n') + '\n' + out.slice(closeDiv);
        }
        const end2 = out.indexOf('<!-- MODELS:' + c.id + ':END');
        const endClose = out.indexOf('-->', end2) + 3;
        const nPudu = (out.slice(start, end2).match(/class="model-card"/g) || []).length;
        const tenBody = ten.length ? tennantBlock(c.id, ten)
            : '<p class="brand-empty">No Tennant robots in this family yet. Tennant floor-cleaning robots are listed under <a href="#cleaning-brands" data-brand-go="cleaning:tennant">Cleaning</a>.</p>';
        out = out.slice(0, endClose) + '</div>\n                <div class="brand-panel" id="' + c.id + '-tennant" data-brand-panel="tennant" hidden>' + tenBody + '</div>' + out.slice(endClose);
        out = out.slice(0, start) + brandSwitch(c.id, nPudu, ten.length) + '\n                <div class="brand-panel" id="' + c.id + '-pudu" data-brand-panel="pudu">' + out.slice(start);
        added += mine.length + ten.length;
        const re = new RegExp('(href="#' + c.id + '"[\\s\\S]{0,800}?View )(\\d+)( models?)');
        out = out.replace(re, function(m, a, n) {
            const total = Number(n) + mine.length + ten.length;
            return a + total + ' model' + (total === 1 ? '' : 's');
        });
    });

    // Top tab bar: each family tab opens a small menu with PUDU and Tennant.
    out = out.replace(/<a href="#(cleaning|delivery|industrial|quadruped)" class="category-tab">([\s\S]*?)<\/a>/g, function(m, id) {
        return '<div class="category-tab-wrap">' + m +
            '<div class="category-tab-menu" role="menu">' +
            '<a href="#' + id + '-pudu" role="menuitem" data-brand-go="' + id + ':pudu">PUDU robots</a>' +
            '<a href="#' + id + '-tennant" role="menuitem" data-brand-go="' + id + ':tennant">Tennant robots</a></div></div>';
    });

    // Custom categories with PUDU products get their own section and family card.
    const custom = categories.customList().filter(function(c) {
        return items.some(function(p) { return p.category === c.id && brandOf(p) === 'pudu'; });
    });
    if (custom.length) {
        const lastCard = out.indexOf('href="#quadruped" class="industry-card industry-card-link"');
        if (lastCard !== -1) {
            const endCard = out.indexOf('</a>', lastCard) + 4;
            out = out.slice(0, endCard) + '\n' + custom.map(function(c) {
                return familyCard(c, items.filter(function(p) { return p.category === c.id && brandOf(p) === 'pudu'; }).length);
            }).join('\n') + out.slice(endCard);
        }
        const cta0 = out.indexOf('<!-- CTA -->');
        const sections = custom.map(function(c) {
            return categorySection(c, items.filter(function(p) { return p.category === c.id && brandOf(p) === 'pudu'; }));
        }).join('\n\n');
        if (cta0 !== -1) out = out.slice(0, cta0) + sections + '\n\n        ' + out.slice(cta0);
        custom.forEach(function(c) { added += items.filter(function(p) { return p.category === c.id && brandOf(p) === 'pudu'; }).length; });
    }

    if (added) {
        const families = 4 + custom.length;
        out = out.replace(/(\d+)( Robots Across )(Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen)( Families)/, function(m, n, mid, w, end) {
            return (Number(n) + added) + mid + (WORDS[families] || families) + end;
        });
    }
    return out;
}

// Adds each visible custom category and brand to the "Products" menu on every page.
function injectNav(html) {
    const items = store.published();
    const hasTennant = items.some(function(p) { return brandOf(p) === 'tennant'; });
    const custom = categories.customList().filter(function(c) {
        return items.some(function(p) { return p.category === c.id && brandOf(p) === 'pudu'; });
    });
    if (!custom.length && !hasTennant) return html;
    const needle = 'products.html#quadruped">';
    const i = html.indexOf(needle);
    if (i === -1) return html;
    const endLi = html.indexOf('</li>', i);
    if (endLi === -1) return html;
    const links = [];
    if (hasTennant && html.indexOf('products.html#cleaning-tennant') === -1) {
        links.push('<li><a href="products.html#cleaning-tennant">Tennant Robots</a></li>');
    }
    custom.forEach(function(c) {
        if (html.indexOf('products.html#' + esc(c.id)) === -1) {
            links.push('<li><a href="products.html#' + esc(c.id) + '">' + esc(c.label) + '</a></li>');
        }
    });
    if (!links.length) return html;
    const extra = links.join('\n                            ');
    return html.slice(0, endLi + 5) + '\n                            ' + extra + html.slice(endLi + 5);
}

module.exports = { esc, productPage, productMain, cardHtml, injectCards, injectNav, visibleCustomCategories, pageUrl, imgUrl, paragraphs, catLabel };
