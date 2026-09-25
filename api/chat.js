// Serverless function (Vercel Node runtime) that proxies chat messages to
// Google's Gemini API. Keeps GEMINI_API_KEY server-side only - it must never
// be sent to the browser. Configure it in Vercel: Project Settings ->
// Environment Variables -> GEMINI_API_KEY (and optionally GEMINI_MODEL).
const SYSTEM_PROMPT = require('./systemPrompt');

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2000;
const UNAVAILABLE_MESSAGE =
    'The assistant is temporarily unavailable. Please try again or email info@baybotdynamics.com.';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Chat is not configured yet (missing GEMINI_API_KEY).' });
    }

    let body;
    try {
        body = await readBody(req);
    } catch (err) {
        return res.status(400).json({ error: 'Invalid request body.' });
    }

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: 'Message is too long.' });
    }

    const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_MESSAGES) : [];
    const contents = history
        .filter(function(m) {
            return m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string';
        })
        .map(function(m) {
            return { role: m.role, parts: [{ text: m.text.slice(0, MAX_MESSAGE_LENGTH) }] };
        });
    contents.push({ role: 'user', parts: [{ text: message }] });

    // The lead's contact details, captured client-side before the chat opens.
    // Only sent on the first message of a session - folded into the system
    // instruction so the assistant can address the visitor by name; later
    // turns already carry that context via the conversation history above.
    let systemText = SYSTEM_PROMPT;
    const lead = body.lead && typeof body.lead === 'object' ? body.lead : null;
    if (lead) {
        const leadName = typeof lead.name === 'string' ? lead.name.slice(0, 100) : '';
        const leadEmail = typeof lead.email === 'string' ? lead.email.slice(0, 200) : '';
        const leadPhone = typeof lead.phone === 'string' ? lead.phone.slice(0, 50) : '';
        systemText += '\n\nThe visitor you are chatting with has shared these details - ' +
            'address them by name where natural, and do not just read the details back to them:\n' +
            'Name: ' + leadName + '\nEmail: ' + leadEmail + '\nPhone: ' + leadPhone;
    }

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL +
        ':generateContent?key=' + apiKey;

    try {
        const upstream = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: contents,
                systemInstruction: { parts: [{ text: systemText }] },
                generationConfig: { temperature: 0.4, maxOutputTokens: 512 }
            })
        });

        const data = await upstream.json();

        if (!upstream.ok) {
            console.error('Gemini API error', upstream.status, data);
            return res.status(502).json({ error: UNAVAILABLE_MESSAGE });
        }

        const candidate = data && data.candidates && data.candidates[0];
        const parts = candidate && candidate.content && candidate.content.parts;
        const reply = Array.isArray(parts) ? parts.map(function(p) { return p.text || ''; }).join('') : '';

        if (!reply) {
            const blocked = data && data.promptFeedback && data.promptFeedback.blockReason;
            return res.status(200).json({
                reply: blocked
                    ? "I can't help with that question. Could you rephrase it?"
                    : "Sorry, I didn't quite catch that. Could you rephrase your question?"
            });
        }

        return res.status(200).json({ reply: reply });
    } catch (err) {
        console.error('Chat handler error', err);
        return res.status(502).json({ error: UNAVAILABLE_MESSAGE });
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
