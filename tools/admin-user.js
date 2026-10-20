#!/usr/bin/env node
// Creates or resets the login for the product admin (/site-admin).
//
//   node tools/admin-user.js
//
// It asks for a username and a password (hidden while you type) and stores a
// scrypt hash in DATA_DIR/admin.json. There is no default account: until this
// has been run, nobody can log in. Run it on the server, with the same
// DATA_DIR as the website (it reads .env.local).
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load .env.local / .env so DATA_DIR matches the running site.
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

function ask(question, hidden) {
    return new Promise(function(resolve) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
            rl._writeToOutput = function(str) { if (str.indexOf(question) === 0) rl.output.write(str); else rl.output.write(''); };
        }
        rl.question(question, function(answer) {
            rl.close();
            if (hidden) process.stdout.write('\n');
            resolve(answer);
        });
    });
}

(async function main() {
    console.log('Product admin login. Data folder: ' + dataDir());
    const existing = auth.readAdmin();
    if (existing) console.log('An account named "' + existing.username + '" exists. It will be replaced.');
    const username = (await ask('Username: ', false)).trim();
    if (!/^[A-Za-z0-9._@-]{3,60}$/.test(username)) { console.error('Use 3 to 60 letters, numbers or . _ @ -'); process.exit(1); }
    const p1 = await ask('Password: ', true);
    const problem = auth.passwordProblem(p1);
    if (problem) { console.error(problem); process.exit(1); }
    const p2 = await ask('Repeat password: ', true);
    if (p1 !== p2) { console.error('The two passwords do not match.'); process.exit(1); }
    auth.writeAdmin(username, p1);
    console.log('Saved. Log in at /site-admin with username "' + username + '".');
}());
