// Sends website form submissions straight to one mailbox over SMTP - no Google
// Sheet or Apps Script in the middle. Used by api/contact-request.js,
// api/parts-request.js and api/lead.js, so every one of those requests lands
// in the same inbox. Files starting with "_" in api/ are helpers, not routes.
//
// Environment (see .env.local.example):
//   MAIL_TO     the one inbox that receives every request, e.g. info@baybotdynamics.com
//   SMTP_HOST   e.g. smtp.zoho.com or smtp.gmail.com
//   SMTP_PORT   587 (STARTTLS, default) or 465 (SSL)
//   SMTP_USER   the mailbox that signs in to send
//   SMTP_PASS   its password or app password
//   MAIL_FROM   optional "BayBot Website <address>"; defaults to SMTP_USER
const nodemailer = require('nodemailer');

let transport;

function isConfigured() {
    const e = process.env;
    return Boolean(e.MAIL_TO && e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS);
}

function getTransport() {
    if (!transport) {
        const port = Number(process.env.SMTP_PORT) || 587;
        transport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: port,
            secure: port === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000
        });
    }
    return transport;
}

// Header values must never contain line breaks (header injection).
function oneLine(value, max) {
    return String(value == null ? '' : value).replace(/[\r\n\u2028\u2029]+/g, ' ').trim().slice(0, max || 200);
}

function validEmail(value) {
    return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(value) && value.length <= 254;
}

// Where the visitor came from. Vercel adds the geo headers; on the VPS only the
// forwarded IP is available, and fields it cannot fill are left out.
function requestMeta(req) {
    const h = (req && req.headers) || {};
    const ip = (h['x-forwarded-for'] || '').split(',')[0].trim() || h['x-real-ip'] || '';
    const city = h['x-vercel-ip-city'] ? decodeURIComponent(h['x-vercel-ip-city']) : '';
    const place = [city, h['x-vercel-ip-country-region'], h['x-vercel-ip-country']].filter(Boolean).join(', ');
    return [
        ip ? 'IP: ' + ip : '',
        place ? 'Location: ' + place : '',
        typeof h['referer'] === 'string' ? 'Page: ' + oneLine(h['referer'], 300) : '',
        'Received: ' + new Date().toISOString()
    ].filter(Boolean);
}

// fields: array of [label, value]. Empty values are skipped.
async function sendRequestEmail(req, options) {
    if (!isConfigured()) return { ok: false, notConfigured: true };

    const replyTo = validEmail(options.replyTo || '') ? options.replyTo : undefined;
    const lines = [options.intro, ''];
    (options.fields || []).forEach(function(pair) {
        const value = String(pair[1] == null ? '' : pair[1]).trim();
        if (!value) return;
        lines.push(value.indexOf('\n') === -1 ? pair[0] + ': ' + value : pair[0] + ':\n' + value);
    });
    lines.push('', '---');
    Array.prototype.push.apply(lines, requestMeta(req));

    try {
        await getTransport().sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to: process.env.MAIL_TO,
            replyTo: replyTo,
            subject: oneLine(options.subject, 200),
            text: lines.join('\n')
        });
        return { ok: true };
    } catch (err) {
        console.error('Mail send failed:', err && err.message);
        transport = undefined;
        return { ok: false, error: 'Could not send your message right now.' };
    }
}

module.exports = { sendRequestEmail, isConfigured, oneLine, validEmail };
