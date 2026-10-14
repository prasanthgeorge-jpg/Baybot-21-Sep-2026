// Tells the browser whether to show the robot check, and with which public
// site key. The site key is public by design; the secret key never leaves the
// server. An empty siteKey means the check is switched off.
module.exports = function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ siteKey: process.env.TURNSTILE_SITE_KEY || '' });
};
