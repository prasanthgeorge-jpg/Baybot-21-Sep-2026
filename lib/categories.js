// Product categories: the four built-in ones plus any the customer adds in the
// admin. Custom categories are stored in products.json next to the products.
const { CATEGORIES, ICONS, LIMITS } = require('./config');
const store = require('./store');

const RESERVED = ['products', 'main', 'overview', 'features', 'video', 'specs', 'gallery', 'related', 'new', '__new__'];

function builtinList() {
    return Object.keys(CATEGORIES).map(function(id) {
        return { id: id, label: CATEGORIES[id].label, description: CATEGORIES[id].description, icon: CATEGORIES[id].icon, builtin: true };
    });
}
function customList() {
    return (store.load().categories || []).map(function(c) {
        return { id: c.id, label: c.label, description: c.description || '', icon: c.icon || 'robot', builtin: false, createdAt: c.createdAt };
    });
}
function all() { return builtinList().concat(customList()); }
function get(id) { return all().filter(function(c) { return c.id === id; })[0] || null; }

function line(value, max) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max); }

// { value, errors } for a category's editable fields.
function validate(input) {
    const errors = [];
    const v = {
        label: line(input.label, LIMITS.categoryName),
        description: line(input.description, LIMITS.categoryDescription),
        icon: ICONS.indexOf(String(input.icon || '')) !== -1 ? String(input.icon) : 'robot'
    };
    if (!v.label) errors.push('Enter a category name.');
    return { value: v, errors: errors };
}

function idTaken(data, id) {
    return RESERVED.indexOf(id) !== -1 || Boolean(CATEGORIES[id]) || (data.categories || []).some(function(c) { return c.id === id; });
}
function sameLabelExists(data, label, exceptId) {
    const l = label.toLowerCase();
    return builtinList().some(function(c) { return c.label.toLowerCase() === l; }) ||
        (data.categories || []).some(function(c) { return c.label.toLowerCase() === l && c.id !== exceptId; });
}

// Creates a category and returns it. Rejects duplicates and over-long lists.
function create(input) {
    const r = validate(input);
    if (r.errors.length) return Promise.reject(new Error(r.errors[0]));
    return store.mutate(function(data) {
        data.categories = data.categories || [];
        if (data.categories.length >= LIMITS.customCategories) throw new Error('You can have at most ' + LIMITS.customCategories + ' extra categories.');
        if (sameLabelExists(data, r.value.label)) throw new Error('A category with that name already exists.');
        let base = store.slugify(r.value.label) || 'category';
        let id = base;
        for (let n = 2; idTaken(data, id) && n < 200; n++) id = base + '-' + n;
        const cat = { id: id, label: r.value.label, description: r.value.description, icon: r.value.icon, createdAt: new Date().toISOString() };
        data.categories.push(cat);
        return cat;
    });
}

function update(id, input) {
    const r = validate(input);
    if (r.errors.length) return Promise.reject(new Error(r.errors[0]));
    return store.mutate(function(data) {
        const cat = (data.categories || []).filter(function(c) { return c.id === id; })[0];
        if (!cat) throw new Error('That category does not exist (built-in categories cannot be changed).');
        if (sameLabelExists(data, r.value.label, id)) throw new Error('A category with that name already exists.');
        cat.label = r.value.label; cat.description = r.value.description; cat.icon = r.value.icon;
        return cat;
    });
}

function productCount(id) {
    return store.load().products.filter(function(p) { return p.category === id; }).length;
}

function remove(id) {
    return store.mutate(function(data) {
        const cat = (data.categories || []).filter(function(c) { return c.id === id; })[0];
        if (!cat) throw new Error('That category does not exist (built-in categories cannot be deleted).');
        const used = data.products.filter(function(p) { return p.category === id; }).length;
        if (used) throw new Error('This category still has ' + used + ' product' + (used === 1 ? '' : 's') + '. Move or delete them first.');
        data.categories = data.categories.filter(function(c) { return c.id !== id; });
        return true;
    });
}

module.exports = { all, get, builtinList, customList, create, update, remove, validate, productCount, ICONS };
