// Delivers website form submissions (Get in Touch, Parts, chat leads) in one
// place, so every one of them reaches the same inbox:
//   1. SMTP straight to MAIL_TO, when SMTP_* are configured; otherwise
//   2. the Google Apps Script "demo" webhook (DEMO_SHEETS_WEBHOOK_URL), which
//      logs a sheet row and emails the same address the Schedule Demo form
//      uses; otherwise
//   3. reports "not configured", and the browser falls back to the visitor's
//      email app.
// Files starting with "_" in api/ are helpers, not routes.
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

// Fallback: the demo webhook (Google Apps Script -> sheet row + email). The
// request type travels in the "demoType" column, e.g. "Chat lead".
async function sendViaWebhook(req, options) {
    const url = process.env.DEMO_SHEETS_WEBHOOK_URL;
    const secret = process.env.DEMO_SHEETS_WEBHOOK_SECRET;
    if (!url || !secret) return { ok: false, notConfigured: true };

    const h = (req && req.headers) || {};
    const field = function(label) {
        const pair = (options.fields || []).filter(function(p) { return p[0] === label; })[0];
        return pair ? String(pair[1] == null ? '' : pair[1]).trim() : '';
    };
    const message = (options.fields || [])
        .filter(function(p) { return ['Name', 'Email', 'Phone'].indexOf(p[0]) === -1 && String(p[1] || '').trim(); })
        .map(function(p) { return p[0] + ': ' + String(p[1]).trim(); })
        .join('\n');

    try {
        const upstream = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                secret: secret,
                submittedAt: new Date().toISOString(),
                ip: (h['x-forwarded-for'] || '').split(',')[0].trim() || h['x-real-ip'] || '',
                city: h['x-vercel-ip-city'] ? decodeURIComponent(h['x-vercel-ip-city']) : '',
                region: h['x-vercel-ip-country-region'] || '',
                country: h['x-vercel-ip-country'] || '',
                userAgent: typeof h['user-agent'] === 'string' ? h['user-agent'].slice(0, 300) : '',
                referrer: typeof h['referer'] === 'string' ? h['referer'].slice(0, 300) : '',
                demoType: options.kind || 'Website request',
                name: field('Name'),
                email: field('Email'),
                phone: field('Phone'),
                company: '',
                industry: '',
                message: message || '-'
            })
        });
        const result = await upstream.json().catch(function() { return null; });
        if (!upstream.ok || !result || result.error) {
            console.error('Webhook delivery failed', upstream.status, result);
            return { ok: false, error: 'Could not send your message right now.' };
        }
        return { ok: true };
    } catch (err) {
        console.error('Webhook delivery error:', err && err.message);
        return { ok: false, error: 'Could not send your message right now.' };
    }
}

// Entry point for the form endpoints: SMTP when configured, else the webhook.
async function deliverRequest(req, options) {
    if (isConfigured()) return sendRequestEmail(req, options);
    return sendViaWebhook(req, options);
}

module.exports = { deliverRequest, sendRequestEmail, isConfigured, oneLine, validEmail };
