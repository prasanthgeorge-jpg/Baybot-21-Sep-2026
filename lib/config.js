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

// Same four sections the Products page already has.
const CATEGORIES = {
    cleaning: { label: 'Cleaning Robots', cardLabel: 'Cleaning Robots' },
    delivery: { label: 'Delivery & Reception Robots', cardLabel: 'Delivery & Reception Robots' },
    industrial: { label: 'Industrial Transport Robots', cardLabel: 'Industrial Transport Robots' },
    quadruped: { label: 'Quadruped Robots', cardLabel: 'Quadruped Robots' }
};

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
    imageBytes: 8 * 1024 * 1024
};

module.exports = { ROOT, dataDir, CATEGORIES, LAYOUTS, LIMITS };
