// Uploaded photos are checked (real image, sane size) and re-encoded as
// optimised WebP, so a customer cannot slow the site down with a 10 MB photo
// and cannot upload anything that is not an image.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { uploadsDir } = require('./store');

let sharp = null;
try { sharp = require('sharp'); } catch (e) { sharp = null; }

const ALLOWED = ['jpeg', 'png', 'webp', 'gif'];
const MAX_EDGE = 1600;

class ImageError extends Error {}

// Saves one image for a product. Returns the stored file name (e.g. "a1b2c3.webp").
async function saveImage(productId, buffer) {
    if (!sharp) throw new ImageError('Image processing is not installed on the server.');
    if (!buffer || !buffer.length) throw new ImageError('The image file is empty.');

    let meta;
    try { meta = await sharp(buffer, { limitInputPixels: 50 * 1000 * 1000 }).metadata(); }
    catch (e) { throw new ImageError('That file is not a readable image. Use a JPG, PNG or WebP photo.'); }
    if (ALLOWED.indexOf(meta.format) === -1) throw new ImageError('Use a JPG, PNG or WebP photo.');
    if (!meta.width || !meta.height || meta.width < 200 || meta.height < 200) {
        throw new ImageError('The image is too small. Use a photo at least 200 pixels wide and high.');
    }

    const out = await sharp(buffer, { limitInputPixels: 50 * 1000 * 1000 })
        .rotate()
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();

    const dir = path.join(uploadsDir(), productId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = crypto.randomBytes(8).toString('hex') + '.webp';
    fs.writeFileSync(path.join(dir, name), out, { mode: 0o600 });
    return name;
}

function removeImage(productId, name) {
    if (!/^[a-f0-9]{16}\.webp$/.test(String(name))) return;
    try { fs.unlinkSync(path.join(uploadsDir(), productId, name)); } catch (e) { /* already gone */ }
}

module.exports = { saveImage, removeImage, ImageError };
