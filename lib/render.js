// Public rendering of admin-created products: the product page in the chosen
// layout, the product card, and the injection of cards into products.html.
// Every value from the admin is escaped; descriptions are plain text, so a
// customer can never put markup or script on the site.
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');
const store = require('./store');
const wizard = require('./wizard');
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
        (hasVideo(p) ? '<a href="#video" class="btn btn-outline btn-lg"><i class="fas fa-circle-play" aria-hidden="true"></i> Watch Video</a>' : '') +
        '</div></div>';
}

function heroMedia(p) {
    if (!p.image) return '';
    return '<div class="product-hero-media"><img src="' + imgUrl(p, p.image) + '" alt="' + esc(p.name) + '"></div>';
}

// A product has a video when it has a YouTube id or a direct video file (the maker's official video).
function hasVideo(p) { return Boolean(p.videoId || p.videoSrc); }

function video(p) {
    if (!hasVideo(p)) return '';
    const head = '<section class="product-video-section" id="video" aria-labelledby="video-heading"><div class="container">' +
        '<div class="section-header text-center"><span class="section-label light">Video</span>' +
        '<h2 class="section-title light" id="video-heading">Watch the ' + esc(p.name) + ' in Action</h2></div>';
    if (!p.videoId) {
        const src = String(p.videoSrc);
        if (!/^https:\/\/[a-z0-9.-]+\//i.test(src)) return '';
        const poster = /^https:\/\//i.test(p.videoPoster || '') ? ' poster="' + esc(p.videoPoster) + '"' : '';
        return head + '<div class="video-embed video-file"><video controls preload="none" playsinline' + poster + ' title="' + esc(p.name) + ' in action">' +
            '<source src="' + esc(src) + '" type="video/mp4"></video></div></div></section>';
    }
    const embed = function(vid, title) {
        const id = esc(vid);
        return '<div class="video-embed" data-video-id="' + id + '" data-title="' + esc(title) + '">' +
            '<a class="video-embed-poster" href="https://www.youtube.com/watch?v=' + id + '" target="_blank" rel="noopener">' +
            '<img src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="" loading="lazy" decoding="async">' +
            '<span class="video-embed-play" aria-hidden="true"><i class="fas fa-play"></i></span>' +
            '<span class="visually-hidden">Play video: ' + esc(title) + '</span></a></div>';
    };
    const more = (Array.isArray(p.extraVideos) ? p.extraVideos : []).filter(function(v) { return v && store.youtubeId('https://www.youtube.com/watch?v=' + v.id); }).slice(0, 6);
    return head + embed(p.videoId, p.name + ' in action') +
        (more.length ? '<h3 class="video-more-title">More videos</h3><div class="video-more">' +
            more.map(function(v) { return '<figure>' + embed(v.id, v.title || p.name) + '<figcaption>' + esc(v.title || '') + '</figcaption></figure>'; }).join('') + '</div>' : '') +
        '</div></section>';
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
        (hasVideo(p) ? '<div class="model-flags"><span class="model-video-flag"><i class="fas fa-circle-play" aria-hidden="true"></i> Video</span></div>' : '') +
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

// fold: on phones the models start hidden behind a "Show N models" button (long families make the page very tall)
function categorySection(c, items, fold) {
    const n = items.length;
    return '<section class="about-section' + (fold ? ' family-fold' : '') + '" id="' + esc(c.id) + '"><div class="container">' +
        '<div class="section-header text-center"><span class="section-label">' + esc(c.label) + '</span>' +
        '<h2 class="section-title">' + esc(c.label) + '</h2>' +
        (c.description ? '<p class="section-description">' + esc(c.description) + '</p>' : '') + '</div>' +
        (fold ? '<button type="button" class="family-fold-btn" aria-expanded="true" data-count="' + n + '"><span class="family-fold-text">Hide ' + n + ' model' + (n === 1 ? '' : 's') + '</span><i class="fas fa-chevron-up" aria-hidden="true"></i></button>' : '') +
        '<div class="model-grid">' + items.map(cardHtml).join('\n') + '</div></div></section>';
}

function familyCard(c, count) {
    return '<a href="#' + esc(c.id) + '" class="industry-card industry-card-link">' +
        '<div class="industry-icon"><i class="fas fa-' + esc(c.icon) + '"></i></div>' +
        '<h3>' + esc(c.label) + '</h3>' + (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
        '<span class="card-link">View ' + count + ' model' + (count === 1 ? '' : 's') + ' <i class="fas fa-arrow-down"></i></span></a>';
}

// Brand of a product. Products made before brands existed are PUDU.
function brandOf(p) { return p.brand === 'tennant' || p.brand === 'hivebotics' ? p.brand : 'pudu'; }

function brandHead(id, label, blurb, title, noBadge) {
    return '<div class="brand-band-head"><div><span class="section-label">' + esc(label) + '</span>' +
        '<h2 class="section-title" id="' + id + '-title">' + esc(title || (label + ' robots')) + '</h2>' +
        '<p class="section-description">' + esc(blurb) + '</p></div>' + (noBadge ? '' : badges.BADGE) + '</div>';
}

// Families (categories) of one brand that hold published products, in category order. Products
// with no known category fall into a plain "Other" group.
function brandFamilies(items, brand, otherLabel) {
    const mine = items.filter(function(p) { return brandOf(p) === brand; });
    const fams = categories.all().filter(function(c) { return mine.some(function(p) { return p.category === c.id; }); })
        .map(function(c) { return { id: c.id, label: c.label, description: c.description || '', icon: c.icon || 'robot', items: mine.filter(function(p) { return p.category === c.id; }) }; });
    const rest = mine.filter(function(p) { return !fams.some(function(f) { return f.id === p.category; }); });
    if (rest.length) fams.push({ id: brand + '-other', label: otherLabel, description: '', icon: 'robot', items: rest });
    return fams;
}

// The Products page is organised by brand: a PUDU band (its four families) and a Tennant
// band (its own families, such as scrubbers, sweepers and vacuums), each with the
// "Authorized Distributor" badge.
function injectCards(html) {
    const items = store.published();
    let out = html;
    out = out.replace('<script src="script.js', function(m) {
        return '<script>window.BB_WIZARD_EXTRA=' + JSON.stringify(wizard.extra(module.exports)).replace(/</g, '\\u003c') + ';</script>\n    ' + m;
    });
    let puduCount = 0;

    categories.builtinList().forEach(function(c) {
        const mine = items.filter(function(p) { return p.category === c.id && brandOf(p) === 'pudu'; });
        if (!mine.length) return;
        const end = out.indexOf('<!-- MODELS:' + c.id + ':END');
        if (end === -1) return;
        const closeDiv = out.lastIndexOf('</div>', end);
        if (closeDiv === -1) return;
        out = out.slice(0, closeDiv) + mine.map(cardHtml).join('\n') + '\n' + out.slice(closeDiv);
        puduCount += mine.length;
        const re = new RegExp('(href="#' + c.id + '"[\\s\\S]{0,800}?View )(\\d+)( models?)');
        out = out.replace(re, function(m, a, n) {
            const total = Number(n) + mine.length;
            return a + total + ' model' + (total === 1 ? '' : 's');
        });
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
        custom.forEach(function(c) { puduCount += items.filter(function(p) { return p.category === c.id && brandOf(p) === 'pudu'; }).length; });
    }

    const BRANDS = [
        { id: 'tennant', anchor: 'tennant-robots', label: 'Tennant', title: 'Tennant robots & machines', icon: 'broom', tab: 'Tennant', badge: true, other: 'Other Tennant Machines',
          blurb: 'Tennant autonomous floor-cleaning robots and its full range of scrubbers, sweepers, burnishers, extractors and vacuums, available through BayBot Dynamics.',
          cardText: 'Autonomous robots plus scrubbers, sweepers, burnishers, extractors and vacuums.', cardTitle: 'Tennant Robots &amp; Machines' },
        { id: 'hivebotics', anchor: 'hivebotics-robots', label: 'Hivebotics', title: 'Hivebotics robots', icon: 'shield-halved', tab: 'Hivebotics', badge: false, other: 'Other Hivebotics Robots',
          blurb: 'AI-powered autonomous restroom cleaning robots from Hivebotics.',
          cardText: 'AI-powered autonomous restroom cleaning robots.', cardTitle: 'Hivebotics Robots' }
    ].map(function(b) { b.fams = brandFamilies(items, b.id, b.other); b.count = b.fams.reduce(function(n, f) { return n + f.items.length; }, 0); return b; })
     .filter(function(b) { return b.count > 0; });
    if (!BRANDS.length || out.indexOf('id="pudu-robots"') !== -1) return out;
    const total = BRANDS.reduce(function(n, b) { return n + b.count; }, 0);
    const puduTotal = (out.match(/class="model-card"/g) || []).length;

    // 1. The PUDU family cards move out of the intro into the PUDU band; the intro gets one card per brand.
    let puduCards = '';
    out = out.replace(/<div class="industries-grid">([\s\S]*?)<\/a>\s*<\/div>\s*<\/div>\s*<\/section>/, function(m, inner) {
        puduCards = inner + '</a>';
        const card = function(anchor, icon, title, text, n) {
            return '<a href="#' + anchor + '" class="industry-card industry-card-link"><div class="industry-icon"><i class="fas fa-' + icon + '"></i></div><h3>' + title + '</h3><p>' + text +
                '</p><span class="card-link">View ' + n + ' models <i class="fas fa-arrow-down"></i></span></a>';
        };
        return '<div class="industries-grid">' +
            card('pudu-robots', 'robot', 'PUDU Robots', 'Cleaning, delivery &amp; reception, industrial transport, quadruped, forklift and mowing robots.', puduTotal) +
            BRANDS.map(function(b) { return card(b.anchor, b.icon, b.cardTitle, b.cardText, b.count); }).join('') +
            '</div></div></section>';
    });
    const words = { 2: 'Two', 3: 'Three', 4: 'Four' };
    out = out.replace(/\d+ Robots Across [A-Za-z]+ Families/, (puduTotal + total) + ' Products from ' + (BRANDS.length === 1 ? 'Two Official Brands' : (words[BRANDS.length + 1] + ' Brands')));
    out = out.replace('<section class="about-section" id="cleaning">', function(m) {
        return '<section class="brand-band" id="pudu-robots" aria-labelledby="pudu-robots-title"><div class="container">' +
            brandHead('pudu-robots', 'PUDU', 'Cleaning, delivery and reception, industrial transport, quadruped, forklift and lawn mowing robots from PUDU Technology.') +
            '<div class="industries-grid brand-families">' + puduCards + '</div></div></section>\n\n        ' + m;
    });

    // 2. One band per other brand, with its own families, before the call-to-action.
    BRANDS.forEach(function(b) {
        const cards = b.fams.map(function(f) { return familyCard({ id: f.id, label: f.label, description: f.description, icon: f.icon }, f.items.length); }).join('\n');
        const secs = b.fams.map(function(f) { return categorySection({ id: f.id, label: f.label, description: f.description }, f.items, true); }).join('\n\n');
        const band = '<section class="brand-band brand-band-' + b.id + '" id="' + b.anchor + '" aria-labelledby="' + b.anchor + '-title"><div class="container">' +
            brandHead(b.anchor, b.label, b.blurb, b.title, !b.badge) +
            '<div class="industries-grid brand-families">' + cards + '</div></div></section>\n\n' + secs;
        const cta = out.indexOf('<!-- CTA -->');
        if (cta !== -1) out = out.slice(0, cta) + band + '\n\n        ' + out.slice(cta);
    });

    // 3. Top tab bar: one tab per brand, each with a menu of its families.
    const puduFams = [['cleaning', 'Cleaning'], ['delivery', 'Delivery & Reception'], ['industrial', 'Industrial Transport'], ['quadruped', 'Quadruped']]
        .concat(custom.map(function(c) { return [c.id, c.label]; }));
    const menu = function(list) {
        return '<div class="category-tab-menu" role="menu">' + list.map(function(f) { return '<a href="#' + esc(f[0]) + '" role="menuitem">' + esc(f[1]) + '</a>'; }).join('') + '</div>';
    };
    const tabs = '<div class="category-tab-wrap"><a href="#pudu-robots" class="category-tab"><i class="fas fa-robot"></i> PUDU Robots</a>' + menu(puduFams) + '</div>\n' +
        BRANDS.map(function(b) {
            return '<div class="category-tab-wrap"><a href="#' + b.anchor + '" class="category-tab"><i class="fas fa-' + b.icon + '"></i> ' + b.tab + '</a>' + menu(b.fams.map(function(f) { return [f.id, f.label]; })) + '</div>';
        }).join('\n');
    out = out.replace(/(<nav class="category-tab-bar" id="categoryTabBar"[^>]*>\s*<div class="container">)[\s\S]*?(<\/div>\s*<\/nav>)/, function(m, a, b) { return a + '\n' + tabs + '\n' + b; });
    return out;
}

// Adds each visible custom category and brand to the "Products" menu on every page.
function injectNav(html) {
    const items = store.published();
    const hasTennant = items.some(function(p) { return brandOf(p) === 'tennant'; });
    const hasHive = items.some(function(p) { return brandOf(p) === 'hivebotics'; });
    const custom = categories.customList().filter(function(c) {
        return items.some(function(p) { return p.category === c.id && brandOf(p) === 'pudu'; });
    });
    if (!custom.length && !hasTennant && !hasHive) return html;
    const needle = 'products.html#quadruped">';
    const i = html.indexOf(needle);
    if (i === -1) return html;
    const endLi = html.indexOf('</li>', i);
    if (endLi === -1) return html;
    const links = [];
    custom.forEach(function(c) {
        if (html.indexOf('products.html#' + esc(c.id)) === -1) {
            links.push('<li><a href="products.html#' + esc(c.id) + '">' + esc(c.label) + '</a></li>');
        }
    });
    if (hasTennant && html.indexOf('products.html#tennant-robots') === -1) {
        links.push('<li><a href="products.html#tennant-robots">Tennant</a></li>');
    }
    if (hasHive && html.indexOf('products.html#hivebotics-robots') === -1) {
        links.push('<li><a href="products.html#hivebotics-robots">Autonomous Restroom Cleaner</a></li>');
    }
    if (!links.length) return html;
    const extra = links.join('\n                            ');
    return html.slice(0, endLi + 5) + '\n                            ' + extra + html.slice(endLi + 5);
}

module.exports = { esc, productPage, productMain, cardHtml, injectCards, injectNav, visibleCustomCategories, pageUrl, imgUrl, paragraphs, catLabel };
