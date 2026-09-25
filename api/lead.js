// Serverless function (Vercel Node runtime) that forwards "Chat with Us" lead
// details (name, email, phone) to a Google Sheet via a Google Apps Script Web
// App acting as a bridge - see /docs setup notes for how that's deployed.
// Configure SHEETS_WEBHOOK_URL and SHEETS_WEBHOOK_SECRET in the environment.
const MAX_FIELD_LENGTH = 200;

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const webhookUrl = process.env.SHEETS_WEBHOOK_URL;
    const webhookSecret = process.env.SHEETS_WEBHOOK_SECRET;
    if (!webhookUrl || !webhookSecret) {
        return res.status(500).json({ error: 'Lead capture is not configured yet.' });
    }

    let body;
    try {
        body = await readBody(req);
    } catch (err) {
        return res.status(400).json({ error: 'Invalid request body.' });
    }

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_FIELD_LENGTH) : '';
    const email = typeof body.email === 'string' ? body.email.trim().slice(0, MAX_FIELD_LENGTH) : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, MAX_FIELD_LENGTH) : '';

    if (!name || !email || !phone) {
        return res.status(400).json({ error: 'Name, email, and phone are all required.' });
    }

    // Vercel's edge network populates these geo/IP headers on every request
    // for free (no external API call needed). They're absent in local dev
    // (tools/dev-server.js), which is fine - the fields just come through
    // blank there.
    const h = req.headers || {};
    const ip = (h['x-forwarded-for'] || '').split(',')[0].trim() || h['x-real-ip'] || '';
    const geo = {
        city: h['x-vercel-ip-city'] ? decodeURIComponent(h['x-vercel-ip-city']) : '',
        region: h['x-vercel-ip-country-region'] || '',
        country: h['x-vercel-ip-country'] || '',
        latitude: h['x-vercel-ip-latitude'] || '',
        longitude: h['x-vercel-ip-longitude'] || '',
        timezone: h['x-vercel-ip-timezone'] || ''
    };
    const userAgent = typeof h['user-agent'] === 'string' ? h['user-agent'].slice(0, 300) : '';
    const referrer = typeof h['referer'] === 'string' ? h['referer'].slice(0, 300) : '';

    try {
        const upstream = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                secret: webhookSecret,
                name: name,
                email: email,
                phone: phone,
                source: 'contact-page-chat',
                submittedAt: new Date().toISOString(),
                ip: ip,
                city: geo.city,
                region: geo.region,
                country: geo.country,
                latitude: geo.latitude,
                longitude: geo.longitude,
                timezone: geo.timezone,
                userAgent: userAgent,
                referrer: referrer
            })
        });

        // Apps Script web apps always respond with HTTP 200, even when the
        // handler itself failed, so success/failure has to be read from the
        // JSON body rather than the HTTP status.
        const data = await upstream.json().catch(function() { return null; });
        if (!upstream.ok || !data || data.error) {
            console.error('Sheet webhook error', upstream.status, data);
            return res.status(502).json({ error: 'Could not save lead right now.' });
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Lead handler error', err);
        return res.status(502).json({ error: 'Could not save lead right now.' });
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
