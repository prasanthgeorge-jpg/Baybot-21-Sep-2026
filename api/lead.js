// Serverless function (Vercel Node runtime) that emails the "Chat with Us"
// lead details (name, email, phone) to MAIL_TO - the same inbox as every other
// form (see api/_mail.js).
const { requireHuman } = require('./_captcha');
const { deliverRequest, oneLine, validEmail } = require('./_mail');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let body;
    try {
        body = await readBody(req);
    } catch (err) {
        return res.status(400).json({ error: 'Invalid request body.' });
    }

    const human = await requireHuman(body.captcha, req);
    if (!human.ok) return res.status(400).json({ error: human.error, captcha: false });

    const name = oneLine(body.name, 200);
    const email = oneLine(body.email, 254);
    const phone = oneLine(body.phone, 60);

    if (!name || !validEmail(email) || !phone) {
        return res.status(400).json({ error: 'Name, a valid email, and phone are all required.' });
    }

    const result = await deliverRequest(req, {
        kind: 'Chat lead',
        subject: 'New chat lead: ' + name,
        intro: 'Someone started a chat with the website assistant and left their details.',
        replyTo: email,
        fields: [['Name', name], ['Email', email], ['Phone', phone]]
    });

    if (result.notConfigured) return res.status(500).json({ error: 'Email sending is not configured yet.' });
    if (!result.ok) return res.status(502).json({ error: result.error });
    return res.status(200).json({ ok: true });
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
