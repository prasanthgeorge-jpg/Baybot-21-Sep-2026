// Paste this into the Apps Script editor attached to the lead-capture Google
// Sheet (Extensions -> Apps Script), then deploy it as a Web App. See
// README.md's "Lead capture" section for the full step-by-step walkthrough.
//
// This script is NOT part of the website's own codebase - it runs inside
// Google's infrastructure, bound to the spreadsheet, and only exists to
// receive a POST from api/lead.js and append a row.

// Must match SHEETS_WEBHOOK_SECRET in Vercel / .env.local exactly. Generate
// your own random string here (e.g. `openssl rand -hex 16`) - this file is
// committed to the repo, so it must never hold the real secret in plain text.
var SHARED_SECRET = 'REPLACE_WITH_YOUR_OWN_RANDOM_SECRET';

function doPost(e) {
    try {
        var data = JSON.parse(e.postData.contents);

        if (data.secret !== SHARED_SECRET) {
            return jsonResponse({ error: 'Unauthorized' });
        }

        var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
        sheet.appendRow([
            new Date(),
            data.name || '',
            data.email || '',
            data.phone || '',
            data.source || '',
            data.ip || '',
            data.city || '',
            data.region || '',
            data.country || '',
            data.latitude || '',
            data.longitude || '',
            data.timezone || '',
            data.userAgent || '',
            data.referrer || ''
        ]);

        return jsonResponse({ ok: true });
    } catch (err) {
        return jsonResponse({ error: String(err) });
    }
}

// Apps Script web apps always answer with HTTP 200, so api/lead.js checks
// this JSON body's `ok`/`error` field rather than the HTTP status.
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
        'Timestamp', 'Name', 'Email', 'Phone', 'Source',
        'IP', 'City', 'Region', 'Country', 'Latitude', 'Longitude', 'Timezone',
        'User Agent', 'Referrer'
    ]]);
    sheet.getRange(1, 1, 1, 14).setFontWeight('bold');
}
