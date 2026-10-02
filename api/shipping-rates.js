// Serverless function (Vercel Node runtime) that quotes shipping for the
// Parts Store checkout (currently just the NavSense LiDAR Module).
//
// Live carrier rates require real developer credentials that are NOT yet
// configured for this project (see README.md "Shipping rates" section for
// how to get them). Until USPS_CONSUMER_KEY/USPS_CONSUMER_SECRET and
// UPS_CLIENT_ID/UPS_CLIENT_SECRET/UPS_ACCOUNT_NUMBER are set in the
// environment, this always falls back to a simulated, ZIP-zone-distance
// estimate (same math the checkout page used before this endpoint existed)
// and says so in the response's `source` field - it never pretends a
// simulated number is a real carrier quote.
//
// NOTE: the USPS and UPS request/response shapes below are written to match
// each carrier's current public API reference as of when this was written.
// Carrier APIs do change field names and versions occasionally - run a real
// sandbox request against each one before relying on this in production and
// adjust field names if their docs have moved on.

const ORIGIN_ZIP = process.env.SHIP_FROM_ZIP || '33570'; // Ruskin, FL (BayBot Dynamics)

// NavSense LiDAR Module packaging, used for weight/dimension-based rating.
const PACKAGE = {
    weightLb: 2.5,
    lengthIn: 10,
    widthIn: 8,
    heightIn: 6
};

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

    const zip = typeof body.zip === 'string' ? body.zip.trim() : '';
    const qty = Math.max(1, Math.min(99, parseInt(body.qty, 10) || 1));

    if (!/^\d{5}$/.test(zip)) {
        return res.status(400).json({ error: 'A valid 5-digit destination ZIP code is required.' });
    }

    const weightLb = PACKAGE.weightLb * qty;

    const uspsConfigured = !!(process.env.USPS_CONSUMER_KEY && process.env.USPS_CONSUMER_SECRET);
    const upsConfigured = !!(process.env.UPS_CLIENT_ID && process.env.UPS_CLIENT_SECRET && process.env.UPS_ACCOUNT_NUMBER);

    let usps = null;
    let ups = null; // { 'ups-ground': {...}, 'ups-2day': {...}, 'ups-overnight': {...} }
    let liveErrors = [];

    if (uspsConfigured) {
        try {
            usps = await getLiveUspsRate(ORIGIN_ZIP, zip, weightLb);
        } catch (err) {
            console.error('USPS live rate failed, falling back to simulated:', err.message);
            liveErrors.push('usps');
        }
    }

    if (upsConfigured) {
        try {
            ups = await getLiveUpsRates(ORIGIN_ZIP, zip, weightLb, PACKAGE);
        } catch (err) {
            console.error('UPS live rate failed, falling back to simulated:', err.message);
            liveErrors.push('ups');
        }
    }

    const simulated = computeSimulatedRates(ORIGIN_ZIP, zip);

    const result = {
        usps: usps || simulated.usps,
        'ups-ground': (ups && ups['ups-ground']) || simulated['ups-ground'],
        'ups-2day': (ups && ups['ups-2day']) || simulated['ups-2day'],
        'ups-overnight': (ups && ups['ups-overnight']) || simulated['ups-overnight'],
        source: {
            usps: usps ? 'live' : (uspsConfigured ? 'simulated-fallback' : 'simulated'),
            ups: ups ? 'live' : (upsConfigured ? 'simulated-fallback' : 'simulated')
        }
    };

    return res.status(200).json(result);
};

// ---------------------------------------------------------------------
// Simulated fallback - identical formula the checkout page used to run
// entirely client-side, kept here so behavior doesn't change for anyone
// without live credentials configured.
// ---------------------------------------------------------------------
function computeSimulatedRates(originZip, destZip) {
    const originDigit = parseInt(originZip.charAt(0), 10);
    const destDigit = parseInt(destZip.charAt(0), 10);
    const zoneDiff = Math.abs(originDigit - destDigit);

    function daysLabelForZone(z) {
        if (z <= 1) return '2-3 business days';
        if (z <= 4) return '3-4 business days';
        return '4-5 business days';
    }

    return {
        usps: { price: round2(8.50 + 1.25 * zoneDiff), days: daysLabelForZone(zoneDiff) },
        'ups-ground': { price: round2(11.00 + 1.75 * zoneDiff), days: daysLabelForZone(zoneDiff) },
        'ups-2day': { price: round2(28.00 + 3.00 * zoneDiff), days: '2 business days' },
        'ups-overnight': { price: round2(52.00 + 4.50 * zoneDiff), days: '1 business day' }
    };
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------
// USPS - api.usps.com (OAuth2 client credentials + Domestic Prices API)
// Docs: https://developers.usps.com
// ---------------------------------------------------------------------
async function getUspsToken() {
    const resp = await fetch('https://api.usps.com/oauth2/v3/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: process.env.USPS_CONSUMER_KEY,
            client_secret: process.env.USPS_CONSUMER_SECRET
        })
    });
    if (!resp.ok) throw new Error('USPS token request failed: ' + resp.status);
    const data = await resp.json();
    if (!data.access_token) throw new Error('USPS token response missing access_token');
    return data.access_token;
}

async function getLiveUspsRate(originZip, destZip, weightLb) {
    const token = await getUspsToken();
    const resp = await fetch('https://api.usps.com/prices/v3/base-rates/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({
            originZIPCode: originZip,
            destinationZIPCode: destZip,
            weight: weightLb,
            length: PACKAGE.lengthIn,
            width: PACKAGE.widthIn,
            height: PACKAGE.heightIn,
            mailClass: 'USPS_GROUND_ADVANTAGE',
            processingCategory: 'MACHINABLE',
            rateIndicator: 'SP',
            destinationEntryFacilityType: 'NONE',
            priceType: 'RETAIL'
        })
    });
    if (!resp.ok) throw new Error('USPS rate request failed: ' + resp.status);
    const data = await resp.json();

    // USPS's response shape nests the price a couple of different ways
    // depending on mail class / endpoint version - check the common spots.
    const price = data.totalBasePrice ?? data.rates?.[0]?.totalBasePrice ?? data.rates?.[0]?.price;
    if (typeof price !== 'number') throw new Error('USPS response did not contain a recognizable price');

    return { price: round2(price), days: '3-5 business days' };
}

// ---------------------------------------------------------------------
// UPS - onlinetools.ups.com (OAuth2 client credentials + Rating API /Shop)
// Docs: https://developer.ups.com/api/reference
// ---------------------------------------------------------------------
async function getUpsToken() {
    const basicAuth = Buffer.from(
        process.env.UPS_CLIENT_ID + ':' + process.env.UPS_CLIENT_SECRET
    ).toString('base64');

    const resp = await fetch('https://onlinetools.ups.com/security/v1/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + basicAuth
        },
        body: 'grant_type=client_credentials'
    });
    if (!resp.ok) throw new Error('UPS token request failed: ' + resp.status);
    const data = await resp.json();
    if (!data.access_token) throw new Error('UPS token response missing access_token');
    return data.access_token;
}

async function getLiveUpsRates(originZip, destZip, weightLb, pkg) {
    const token = await getUpsToken();
    const accountNumber = process.env.UPS_ACCOUNT_NUMBER;

    const resp = await fetch('https://onlinetools.ups.com/api/rating/v2409/Shop', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({
            RateRequest: {
                Request: { TransactionReference: { CustomerContext: 'BayBot Parts Store' } },
                Shipment: {
                    Shipper: {
                        ShipperNumber: accountNumber,
                        Address: { PostalCode: originZip, CountryCode: 'US' }
                    },
                    ShipFrom: { Address: { PostalCode: originZip, CountryCode: 'US' } },
                    ShipTo: { Address: { PostalCode: destZip, CountryCode: 'US' } },
                    Package: {
                        PackagingType: { Code: '02' }, // Customer Supplied Package
                        Dimensions: {
                            UnitOfMeasurement: { Code: 'IN' },
                            Length: String(pkg.lengthIn),
                            Width: String(pkg.widthIn),
                            Height: String(pkg.heightIn)
                        },
                        PackageWeight: {
                            UnitOfMeasurement: { Code: 'LBS' },
                            Weight: String(weightLb)
                        }
                    }
                }
            }
        })
    });
    if (!resp.ok) throw new Error('UPS rate request failed: ' + resp.status);
    const data = await resp.json();

    const shipments = data?.RateResponse?.RatedShipment;
    const list = Array.isArray(shipments) ? shipments : (shipments ? [shipments] : []);
    if (!list.length) throw new Error('UPS response contained no RatedShipment entries');

    const byServiceCode = {};
    list.forEach(function (rs) {
        const code = rs?.Service?.Code;
        const amount = parseFloat(rs?.TotalCharges?.MonetaryValue);
        if (code && !isNaN(amount)) byServiceCode[code] = amount;
    });

    // UPS service codes: 03 = Ground, 02 = 2nd Day Air, 01 = Next Day Air
    if (!byServiceCode['03'] && !byServiceCode['02'] && !byServiceCode['01']) {
        throw new Error('UPS response did not include Ground/2nd Day/Next Day rates');
    }

    return {
        'ups-ground': { price: round2(byServiceCode['03']), days: '1-5 business days' },
        'ups-2day': { price: round2(byServiceCode['02']), days: '2 business days' },
        'ups-overnight': { price: round2(byServiceCode['01']), days: '1 business day' }
    };
}

async function readBody(req) {
    if (req.body) {
        return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
}
