// Shared settings for the product admin.
//
// DATA_DIR holds everything the admin creates (products.json, uploaded images,
// the admin login, the session secret). It lives OUTSIDE the deployed code on
// the server (set DATA_DIR in .env.local), so deploying a new build never
// overwrites what the customer added. Locally it defaults to ./.data
const path = require('path');

const ROOT = path.join(__dirname, '..');

function dataDir() {
    return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, '.data');
}

// The four sections the Products page already has. The customer can add more
// in the admin (see lib/categories.js); these four cannot be renamed or deleted.
const CATEGORIES = {
    cleaning: { label: 'Cleaning Robots', description: 'Wet, dry, vacuum and industrial-grade floor care.', icon: 'broom' },
    delivery: { label: 'Delivery & Reception Robots', description: 'Commercial delivery, reception and in-venue advertising.', icon: 'bell-concierge' },
    industrial: { label: 'Industrial Transport Robots', description: 'Light, medium and heavy-payload autonomous transport.', icon: 'dolly' },
    quadruped: { label: 'Quadruped Robots', description: 'All-terrain autonomous mobility for complex environments.', icon: 'paw' }
};

// Icons the customer can pick for a new category (Font Awesome free solid names).
const ICONS = ['robot', 'broom', 'bell-concierge', 'dolly', 'paw', 'truck', 'hospital', 'utensils', 'industry', 'shield-halved', 'microchip', 'screwdriver-wrench', 'box-open', 'warehouse', 'building', 'seedling'];

const LAYOUTS = {
    showcase: {
        label: 'Showcase',
        help: 'Large hero, video, overview, feature grid, specifications. Best for most products.'
    },
    'spec-sheet': {
        label: 'Spec sheet',
        help: 'Specifications first, then features as a list. Best for technical or accessory products.'
    },
    gallery: {
        label: 'Gallery',
        help: 'Photo-led page with a large image gallery on top. Best when you have many good photos.'
    }
};

const LIMITS = {
    name: 80,
    tagline: 140,
    summary: 220,
    overview: 4000,
    features: 12,
    featureTitle: 80,
    featureText: 500,
    specs: 20,
    specLabel: 60,
    specValue: 200,
    chips: 12,
    chipText: 40,
    galleryImages: 8,
    categoryName: 40,
    categoryDescription: 160,
    customCategories: 12,
    imageBytes: 8 * 1024 * 1024
};

module.exports = { ROOT, dataDir, CATEGORIES, ICONS, LAYOUTS, LIMITS };
