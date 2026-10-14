// Parts Store request form -> an email to MAIL_TO (see api/_mail.js), the same
// inbox as the Get in Touch form and the chat leads.
const { requireHuman } = require('./_captcha');
const { sendRequestEmail, oneLine, validEmail } = require('./_mail');

const MAX_MESSAGE_LENGTH = 3000;

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
    const model = oneLine(body.model, 200);
    const serial = oneLine(body.serial, 200);
    const parts = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH) : '';

    if (!name || !validEmail(email) || !parts) {
        return res.status(400).json({ error: 'Name, a valid email, and the parts needed are required.' });
    }

    const result = await sendRequestEmail(req, {
        subject: 'New parts request: ' + name,
        intro: 'A new parts request came in through the Parts Store form.',
        replyTo: email,
        fields: [['Name', name], ['Email', email], ['Robot model', model], ['Serial number', serial], ['Parts needed', parts]]
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
