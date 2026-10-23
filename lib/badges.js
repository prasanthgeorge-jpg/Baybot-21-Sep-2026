// "Authorized Distributor" certified logo badge, shown on the home page, the Products page,
// brand bands, and every product page. Designed as a certified partner emblem with
// a vector seal crest and two-tier authoritative typography.
const BADGE = '<span class="distributor-badge" role="status" aria-label="Authorized Distributor">' +
    '<span class="distributor-seal" aria-hidden="true">' +
    '<svg class="distributor-seal-svg" viewBox="0 0 36 36" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
    '<linearGradient id="distSealGold" x1="0%" y1="0%" x2="100%" y2="100%">' +
    '<stop offset="0%" stop-color="#FFF5B8"/>' +
    '<stop offset="35%" stop-color="#FFD700"/>' +
    '<stop offset="70%" stop-color="#D4AF37"/>' +
    '<stop offset="100%" stop-color="#AA7C11"/>' +
    '</linearGradient>' +
    '<linearGradient id="distShieldFill" x1="0%" y1="0%" x2="100%" y2="100%">' +
    '<stop offset="0%" stop-color="#2563eb"/>' +
    '<stop offset="100%" stop-color="#0f2b6b"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<circle cx="18" cy="18" r="17" fill="#071530" stroke="url(#distSealGold)" stroke-width="1.4"/>' +
    '<circle cx="18" cy="18" r="14.2" stroke="url(#distSealGold)" stroke-width="0.8" stroke-dasharray="1.5 1.5"/>' +
    '<path d="M 18 7 L 26 11 C 26 19 18 25 18 26 C 18 25 10 19 10 11 Z" fill="url(#distShieldFill)" stroke="url(#distSealGold)" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<polygon points="18,9 18.5,10.4 20,10.4 18.8,11.3 19.2,12.7 18,11.8 16.8,12.7 17.2,11.3 16,10.4 17.5,10.4" fill="url(#distSealGold)"/>' +
    '<path d="M 14 16.5 L 16.8 19.5 L 22.2 13.5" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>' +
    '</span>' +
    '<span class="distributor-text">' +
    '<span class="distributor-main">Authorized Distributor</span>' +
    '</span>' +
    '<span class="distributor-check" aria-hidden="true"><i class="fas fa-certificate"></i></span>' +
    '</span>';

const MARK = 'class="distributor-badge"';

function addBadges(html, relPath) {
    const rel = String(relPath || '');
    if (rel === 'index.html' && html.indexOf('<div class="hero-content">') !== -1 && !/<div class="hero-content">\s*<span class="distributor-badge"/.test(html)) {
        return html.replace(/(<div class="hero-content">\s*)/, function(m, a) { return a + BADGE + '\n                    '; });
    }
    if (rel === 'products.html') {
        // header badge only; the brand bands carry their own badges
        const headerMatch = html.match(/<section class="page-header">[\s\S]*?<\/section>/);
        if (headerMatch && headerMatch[0].indexOf('distributor-badge') !== -1) return html;
        return html.replace(/(<section class="page-header">[\s\S]*?<h1>[\s\S]*?<\/h1>)/, function(m) { return m + '\n                ' + BADGE; });
    }
    if (html.indexOf(MARK) !== -1) return html;
    if (/^product-hivebotics-/.test(rel)) return html;   // not a distributor relationship
    if (/^product-[a-z0-9-]+\.html$/.test(rel)) {
        return html.replace(/(<div class="product-hero-text">\s*<span class="section-label">[^<]*<\/span>)/, function(m) { return m + '\n                        ' + BADGE; });
    }
    return html;
}

module.exports = { addBadges, BADGE };
