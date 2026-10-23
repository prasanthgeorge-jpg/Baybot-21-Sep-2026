// Data for the "Not sure which robot you need?" selector on the Products page. The built-in
// PUDU robots are listed in script.js; this adds every other published product (Tennant,
// forklift, lawn mowers, anything added in the admin) so the selector recommends them too.
const store = require('./store');

const SMALL_TENNANT = ['T1', 'T1B', 'T2', 'CS5', 'CS16', 'T260', 'T291', 'T581', 'I-MOP'];

function sizesFor(p) {
    const n = String(p.name || '').replace(/^Tennant\s+/i, '');
    const tag = String(p.tagline || '').toLowerCase();
    switch (p.category) {
        case 'forklift': return ['medium', 'large'];
        case 'lawn-mowers': return ['small', 'medium', 'large'];
        case 'restroom-cleaning': return ['medium', 'large'];
        case 'robotic-scrubbers': return /T380|X2|X4/.test(n) ? ['small', 'medium'] : /T7AMR/.test(n) ? ['medium', 'large'] : ['large'];
        case 'robotic-sweepers': return ['large'];
        case 'robotic-vacuums': return ['small', 'medium'];
        case 'walk-behind-scrubbers': return SMALL_TENNANT.some(function(s) { return n.toUpperCase().indexOf(s) === 0; }) ? ['small', 'medium'] : ['medium', 'large'];
        case 'ride-on-scrubbers': return ['medium', 'large'];
        case 'sweepers': return tag.indexOf('walk') !== -1 ? ['small', 'medium'] : ['medium', 'large'];
        case 'sweeper-scrubbers': return ['large'];
        case 'burnishers-floor-machines': return ['medium', 'large'];
        case 'extractors': return tag.indexOf('ride') !== -1 ? ['large'] : ['small', 'medium'];
        case 'vacuums': case 'specialty-cleaning': return ['small', 'medium'];
        default: return ['small', 'medium', 'large'];
    }
}

function needsFor(p) {
    switch (p.category) {
        case 'forklift': return ['pallet', 'transport'];
        case 'lawn-mowers': return ['mowing'];
        case 'restroom-cleaning': return ['restroom', 'cleaning'];
        case 'delivery': return ['delivery'];
        case 'industrial': return ['transport'];
        case 'quadruped': return ['inspection', 'security'];
        default: return /scrubber|sweeper|vacuum|burnish|extractor|specialty|cleaning/.test(p.category) ? ['cleaning'] : [];
    }
}

function industriesFor(p, sizes) {
    if (p.category === 'forklift') return ['warehouse', 'manufacturing', 'commercial'];
    if (p.category === 'lawn-mowers') return ['commercial', 'hospitality', 'manufacturing', 'security'];
    if (p.category === 'restroom-cleaning') return ['healthcare', 'hospitality', 'commercial'];
    const out = [];
    if (sizes.indexOf('small') !== -1 || sizes.indexOf('medium') !== -1) out.push('healthcare', 'hospitality', 'commercial');
    if (sizes.indexOf('large') !== -1) out.push('warehouse', 'manufacturing', 'commercial');
    return out.filter(function(v, i) { return out.indexOf(v) === i; });
}

function extra(render) {
    return store.published().map(function(p) {
        const needs = needsFor(p);
        if (!needs.length) return null;
        const sizes = sizesFor(p);
        return {
            name: p.name, href: render.pageUrl(p), img: render.imgUrl(p, p.image || ''),
            desc: String(p.tagline || p.summary || '').slice(0, 80),
            needs: needs, sizes: sizes, industries: industriesFor(p, sizes),
            robot: p.brand !== 'tennant' || /^robotic-/.test(p.category), brand: p.brand === 'tennant' ? 'Tennant' : p.brand === 'hivebotics' ? 'Hivebotics' : 'PUDU'
        };
    }).filter(Boolean);
}

module.exports = { extra };
