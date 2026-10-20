#!/usr/bin/env node
// Manages who can log in to the product admin (/site-admin).
//
//   node tools/admin-user.js add bm@baybotdynamics.com georgep@baybotdynamics.com
//   node tools/admin-user.js invite bm@baybotdynamics.com     (new one-time code)
//   node tools/admin-user.js list
//   node tools/admin-user.js remove someone@baybotdynamics.com
//
// Admins are identified by email and start with NO password. Each one sets
// their own: on the login page they choose "Set a password", enter their email
// and either follow the emailed link (needs SMTP set up) or type the one-time
// invite code printed here. Codes work once and expire after 72 hours. Run this
// on the server so it uses the same DATA_DIR as the website (it reads .env.local).
const fs = require('fs');
const path = require('path');

['.env.local', '.env'].forEach(function(name) {
    const file = path.join(__dirname, '..', name);
    if (!fs.existsSync(file)) return;
    fs.readFileSync(file, 'utf8').split('\n').forEach(function(line) {
        const t = line.trim();
        if (!t || t[0] === '#') return;
        const i = t.indexOf('=');
        if (i < 0) return;
        const key = t.slice(0, i).trim();
        if (!(key in process.env)) process.env[key] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    });
});

const auth = require('../lib/auth');
const { dataDir } = require('../lib/config');

const INVITE_MS = 72 * 3600 * 1000;
const [command, ...args] = process.argv.slice(2);
const base = (process.env.SITE_URL || 'https://baybotdynamics.com').replace(/\/+$/, '');

function invite(email) {
    const token = auth.createSetupToken(email, INVITE_MS);
    console.log('  ' + email);
    console.log('    invite code : ' + auth.formatToken(token) + '   (works once, valid 72 hours)');
}

function usage() {
    console.log('Usage:\n  node tools/admin-user.js add <email> [more emails]\n  node tools/admin-user.js invite <email>\n  node tools/admin-user.js list\n  node tools/admin-user.js remove <email>');
    process.exit(1);
}

try {
    console.log('Data folder: ' + dataDir() + '\n');
    if (command === 'add' && args.length) {
        args.forEach(function(e) { auth.addAdmin(e); });
        console.log('Admins created. Give each person their code (or let them use the emailed link):\n');
        args.forEach(function(e) { invite(auth.normEmail(e)); });
        console.log('\nThey open ' + base + '/site-admin, choose "Set a password", enter their email and the code.');
    } else if (command === 'invite' && args.length === 1) {
        if (!auth.findAdmin(args[0])) { console.error('No admin with that email. Add it first: node tools/admin-user.js add ' + args[0]); process.exit(1); }
        invite(auth.normEmail(args[0]));
    } else if (command === 'list') {
        const all = auth.listAdmins();
        if (!all.length) console.log('No admins yet. Add some: node tools/admin-user.js add <email>');
        all.forEach(function(a) {
            console.log(a.email + '  -  ' + (a.hash ? 'password set ' + String(a.passwordSetAt || '').slice(0, 10) : 'NO PASSWORD YET') +
                (a.setupTokenHash && a.setupExpires > Date.now() ? '  (invite pending)' : ''));
        });
    } else if (command === 'remove' && args.length === 1) {
        console.log(auth.removeAdmin(args[0]) ? 'Removed ' + auth.normEmail(args[0]) + '. Their sessions stop working immediately.' : 'No admin with that email.');
    } else {
        usage();
    }
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
