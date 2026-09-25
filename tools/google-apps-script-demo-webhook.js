// Paste this into the Apps Script editor attached to the demo-request
// Google Sheet (Extensions -> Apps Script), then deploy it as a Web App.
// See README.md's "Schedule Demo notifications" section for the full
// step-by-step walkthrough. Same pattern as
// tools/google-apps-script-lead-webhook.js, but this one also emails your
// team via MailApp - no separate email service or API key needed, it sends
// from whichever Google account you deploy this under ("Execute as: Me").

// Must match DEMO_SHEETS_WEBHOOK_SECRET in Vercel / .env.local exactly.
// Generate your own (e.g. `openssl rand -hex 16`) - this file is committed
// to the repo, so it must never hold the real secret in plain text.
var SHARED_SECRET = 'REPLACE_WITH_YOUR_OWN_RANDOM_SECRET';

// Where the notification email for each demo request should land.
var NOTIFY_EMAIL = 'georgep@baybotdynamics.com';

function doPost(e) {
    try {
        var data = JSON.parse(e.postData.contents);

        if (data.secret !== SHARED_SECRET) {
            return jsonResponse({ error: 'Unauthorized' });
        }

        var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
        sheet.appendRow([
            new Date(),
            data.demoType || '',
            data.name || '',
            data.email || '',
            data.phone || '',
            data.company || '',
            data.industry || '',
            data.message || '',
            data.ip || '',
            data.city || '',
            data.region || '',
            data.country || '',
            data.userAgent || '',
            data.referrer || ''
        ]);

        sendNotificationEmail(data);

        return jsonResponse({ ok: true });
    } catch (err) {
        return jsonResponse({ error: String(err) });
    }
}

function sendNotificationEmail(data) {
    var subject = 'New demo request: ' + (data.name || 'Unknown') +
        (data.company ? ' (' + data.company + ')' : '');

    var lines = [
        'A new demo request came in through the website.',
        '',
        'Demo type: ' + (data.demoType || '-'),
        'Name: ' + (data.name || '-'),
        'Email: ' + (data.email || '-'),
        'Phone: ' + (data.phone || '-'),
        'Company: ' + (data.company || '-'),
        'Industry: ' + (data.industry || '-'),
        '',
        'What they want to automate:',
        data.message || '-',
        '',
        '---',
        'IP: ' + (data.ip || '-'),
        'Location: ' + [data.city, data.region, data.country].filter(String).join(', ') || '-',
        'Submitted: ' + (data.submittedAt || new Date().toISOString())
    ];

    MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        replyTo: data.email || undefined,
        subject: subject,
        body: lines.join('\n')
    });
}

// Apps Script web apps always answer with HTTP 200, so api/demo-request.js
// checks this JSON body's `ok`/`error` field rather than the HTTP status.
function jsonResponse(obj) {
    return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

// One-time helper: select this function in the dropdown next to "Debug" at
// the top of the editor, then click "Run", to label the columns. Safe to run
// more than once - it only ever overwrites row 1.
function setupHeaderRow() {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    sheet.getRange(1, 1, 1, 14).setValues([[
        'Timestamp', 'Demo Type', 'Name', 'Email', 'Phone', 'Company', 'Industry', 'Message',
        'IP', 'City', 'Region', 'Country', 'User Agent', 'Referrer'
    ]]);
    sheet.getRange(1, 1, 1, 14).setFontWeight('bold');
}
