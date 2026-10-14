// Cloudflare Turnstile robot check, shared by the form endpoints (same
// approach as the Holy Match USA site). Files starting with "_" in api/ are
// helpers, not routes: Vercel does not expose them and server.js refuses them.
//
// With TURNSTILE_SECRET_KEY unset the check is skipped, so the site keeps
// working until keys are configured. Set TURNSTILE_SITE_KEY (shown in the
// browser by api/captcha-config.js) and TURNSTILE_SECRET_KEY together.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function requireHuman(token, req) {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) return { ok: true, skipped: true };

    if (typeof token !== 'string' || !token || token.length > 2048) {
        return { ok: false, error: 'Please confirm you are not a robot.' };
    }

    const form = new URLSearchParams({ secret: secret, response: token });
    const h = (req && req.headers) || {};
    const ip = (h['x-forwarded-for'] || '').split(',')[0].trim() || h['x-real-ip'] || '';
    if (ip) form.set('remoteip', ip);

    try {
        const controller = new AbortController();
        const timer = setTimeout(function() { controller.abort(); }, 8000);
        const response = await fetch(VERIFY_URL, { method: 'POST', body: form, signal: controller.signal });
        clearTimeout(timer);
        const result = await response.json().catch(function() { return {}; });
        if (!result.success) return { ok: false, error: 'The robot check failed. Please try again.' };
        return { ok: true };
    } catch (err) {
        console.error('Turnstile check failed', err);
        return { ok: false, error: 'We could not run the robot check. Please try again.' };
    }
}

module.exports = { requireHuman };
