// "Official Distributor" badge, shown on the home page, the Products page and
// every product page (built-in and admin-made). Text only: no brand logos.
// Added at serve time, so no generated page has to be edited.
const BADGE = '<span class="distributor-badge"><i class="fas fa-circle-check" aria-hidden="true"></i> Official Distributor</span>';
const MARK = 'class="distributor-badge"';

function addBadges(html, relPath) {
    if (html.indexOf(MARK) !== -1) return html;
    const rel = String(relPath || '');
    if (rel === 'index.html') {
        return html.replace(/(<div class="hero-content">\s*)/, function(m, a) { return a + BADGE + '\n                    '; });
    }
    if (rel === 'products.html') {
        return html.replace(/(<section class="page-header">[\s\S]*?<h1>[\s\S]*?<\/h1>)/, function(m) { return m + '\n                ' + BADGE; });
    }
    if (/^product-[a-z0-9-]+\.html$/.test(rel)) {
        return html.replace(/(<div class="product-hero-text">\s*<span class="section-label">[^<]*<\/span>)/, function(m) { return m + '\n                        ' + BADGE; });
    }
    return html;
}

module.exports = { addBadges, BADGE };
