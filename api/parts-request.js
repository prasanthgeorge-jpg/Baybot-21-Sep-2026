// Serverless function that forwards Parts Store requests to the same Google
// Apps Script bridge (sheet row + email to the team) used by
// api/demo-request.js, so it needs no extra deployment or secrets: it reads
// DEMO_SHEETS_WEBHOOK_URL / DEMO_SHEETS_WEBHOOK_SECRET. Requests are tagged
// "Parts request" in the Demo Type column, with the robot model and serial
// number folded into the message so they show in the sheet and the email.
const MAX_FIELD_LENGTH = 300;
const MAX_MESSAGE_LENGTH = 3000;

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const webhookUrl = process.env.DEMO_SHEETS_WEBHOOK_URL;
    const webhookSecret = process.env.DEMO_SHEETS_WEBHOOK_SECRET;
    if (!webhookUrl || !webhookSecret) {
        return res.status(500).json({ error: 'Parts request capture is not configured yet.' });
    }

    let body;
    try {
        body = await readBody(req);
    } catch (err) {
        return res.status(400).json({ error: 'Invalid request body.' });
    }

    const field = function(key, max) {
        return typeof body[key] === 'string' ? body[key].trim().slice(0, max || MAX_FIELD_LENGTH) : '';
    };

    const model = field('model');
    const serial = field('serial');
    const parts = field('message', MAX_MESSAGE_LENGTH);

    if (!field('name') || !field('email') || !parts) {
        return res.status(400).json({ error: 'Name, email, and the parts needed are required.' });
    }

    const data = {
        demoType: 'Parts request',
        name: field('name'),
        email: field('email'),
        phone: '',
        company: '',
        industry: '',
        model: model,
        serial: serial,
        message: 'Robot model: ' + (model || '-') + '\n' +
            'Serial number: ' + (serial || '-') + '\n\n' +
            'Parts needed:\n' + parts
    };

    const h = req.headers || {};
    const ip = (h['x-forwarded-for'] || '').split(',')[0].trim() || h['x-real-ip'] || '';
    const geo = {
        city: h['x-vercel-ip-city'] ? decodeURIComponent(h['x-vercel-ip-city']) : '',
        region: h['x-vercel-ip-country-region'] || '',
        country: h['x-vercel-ip-country'] || ''
    };
    const userAgent = typeof h['user-agent'] === 'string' ? h['user-agent'].slice(0, 300) : '';
    const referrer = typeof h['referer'] === 'string' ? h['referer'].slice(0, 300) : '';

    try {
        const upstream = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({
                secret: webhookSecret,
                submittedAt: new Date().toISOString(),
                ip: ip,
                city: geo.city,
                region: geo.region,
                country: geo.country,
                userAgent: userAgent,
                referrer: referrer
            }, data))
        });

        // Apps Script web apps always respond with HTTP 200, even when the
        // handler itself failed, so success/failure has to be read from the
        // JSON body rather than the HTTP status.
        const result = await upstream.json().catch(function() { return null; });
        if (!upstream.ok || !result || result.error) {
            console.error('Parts webhook error', upstream.status, result);
            return res.status(502).json({ error: 'Could not submit your request right now.' });
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Parts request handler error', err);
        return res.status(502).json({ error: 'Could not submit your request right now.' });
    }
};

async function readBody(req) {
    if (req.body) {
        return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
}
