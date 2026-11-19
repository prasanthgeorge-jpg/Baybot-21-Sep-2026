#!/usr/bin/env bash
# PHASE 2 of the BayBot move to the Hetzner server that also hosts Holy Match: certificates and the final HTTPS site.
# Run on the server as root, ONLY after the DNS A records for the names it checks point at this server.
#
#   bash ~/baybot-phase2.sh --com-only     baybotdynamics.com + www.baybotdynamics.com only (do this first)
#   bash ~/baybot-phase2.sh                everything: also baybotdynamics.ai + www.baybotdynamics.ai (redirects to .com)
#
# It checks DNS first, gets the Let's Encrypt certificate(s), replaces the temporary HTTP-only BayBot site with the final one,
# and checks it. It only edits the BayBot site file (baybotdynamics.com.conf); the Holy Match site is never touched. If Apache
# rejects the new file the old one is put back. Safe to run again.
#   baybotdynamics.com        -> the website (port 5000)
#   www.baybotdynamics.com    -> redirect to https://baybotdynamics.com   (308)
#   baybotdynamics.ai, www.   -> redirect to https://baybotdynamics.com   (308)   [full mode only]
#   http:// on all of them    -> https://baybotdynamics.com               (301)
set -uo pipefail
MODE=all; [ "${1:-}" = "--com-only" ] && MODE=com
CONF=/etc/apache2/sites-available/baybotdynamics.com.conf
ACME=/var/www/baybot-acme
HERE_IP="${EXPECT_IP:-$(curl -4 -s -m 8 https://ifconfig.me 2>/dev/null)}"; HERE_IP="${HERE_IP:-$(hostname -I | tr ' ' '\n' | grep -E '^[0-9.]+$' | head -1)}"   # IPv4: what the DNS A records hold
STAMP=$(date +%Y%m%d-%H%M%S); SAVED="$CONF.phase1-$STAMP"
NAMES="baybotdynamics.com www.baybotdynamics.com"; [ "$MODE" = all ] && NAMES="$NAMES baybotdynamics.ai www.baybotdynamics.ai"

[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
echo "This server's address: $HERE_IP   (mode: $MODE)"
echo "1/5 Checking that DNS points here..."
bad=0
for n in $NAMES; do
  root="${n#www.}"; ns="$(dig +short NS "$root" @1.1.1.1 | head -1)"           # ask the domain's own nameserver: no stale cache
  got="$(dig +short @"${ns:-1.1.1.1}" "$n" A | tail -1)"
  if [ "$got" = "$HERE_IP" ]; then echo "   ok      $n -> $got"; else echo "   WAITING $n -> ${got:-nothing} (needs $HERE_IP)"; bad=1; fi
done
[ "$bad" = 0 ] || { echo "DNS is not ready for every name yet. Nothing was changed. Run this again in a few minutes."; exit 1; }

echo "2/5 Certificates (Let's Encrypt)..."
ACCOUNT_FLAG="--register-unsafely-without-email"; ls /etc/letsencrypt/accounts/*/directory/* >/dev/null 2>&1 && ACCOUNT_FLAG=""
certbot certonly --webroot -w "$ACME" -d baybotdynamics.com -d www.baybotdynamics.com --cert-name baybotdynamics.com --non-interactive --agree-tos $ACCOUNT_FLAG || { echo "Certificate for baybotdynamics.com failed. Nothing was changed."; exit 1; }
if [ "$MODE" = all ]; then
  certbot certonly --webroot -w "$ACME" -d baybotdynamics.ai -d www.baybotdynamics.ai --cert-name baybotdynamics.ai --non-interactive --agree-tos $ACCOUNT_FLAG || { echo "Certificate for baybotdynamics.ai failed. Nothing was changed."; exit 1; }
fi

echo "3/5 Putting the final site in place (the previous file is saved as $SAVED)..."
cp -a "$CONF" "$SAVED"
ALIASES="www.baybotdynamics.com"; [ "$MODE" = all ] && ALIASES="$ALIASES baybotdynamics.ai www.baybotdynamics.ai"
{
cat <<CONF2
# BayBot website: final. This file only; the Holy Match site is a separate file and is not touched.
<VirtualHost *:80>
    ServerName baybotdynamics.com
    ServerAlias $ALIASES
    Alias /.well-known/acme-challenge/ /var/www/baybot-acme/.well-known/acme-challenge/
    <Directory /var/www/baybot-acme/.well-known/acme-challenge/>
        Require all granted
    </Directory>
    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
    RewriteRule ^ https://baybotdynamics.com%{REQUEST_URI} [R=301,L]
    ErrorLog \${APACHE_LOG_DIR}/baybotdynamics-error.log
    CustomLog \${APACHE_LOG_DIR}/baybotdynamics-access.log combined
</VirtualHost>

<VirtualHost *:443>
    ServerName baybotdynamics.com
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/baybotdynamics.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/baybotdynamics.com/privkey.pem
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    # Browser-side protections. The app already sets nosniff, frame and referrer rules; these fill any gap and add the rest.
    Header always setifempty X-Content-Type-Options "nosniff"
    Header always setifempty X-Frame-Options "SAMEORIGIN"
    Header always setifempty Referrer-Policy "strict-origin-when-cross-origin"
    Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    Header always set Strict-Transport-Security "max-age=604800"
    Header always unset X-Powered-By
    RedirectMatch permanent ^/term/?\$ /terms
    ProxyPass /.well-known/acme-challenge/ !
    ProxyPass / http://127.0.0.1:5000/
    ProxyPassReverse / http://127.0.0.1:5000/
    ErrorLog \${APACHE_LOG_DIR}/baybotdynamics-error.log
    CustomLog \${APACHE_LOG_DIR}/baybotdynamics-access.log combined
</VirtualHost>

<VirtualHost *:443>
    ServerName www.baybotdynamics.com
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/baybotdynamics.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/baybotdynamics.com/privkey.pem
    Redirect 308 / https://baybotdynamics.com/
</VirtualHost>
CONF2
if [ "$MODE" = all ]; then cat <<CONF3

<VirtualHost *:443>
    ServerName baybotdynamics.ai
    ServerAlias www.baybotdynamics.ai
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/baybotdynamics.ai/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/baybotdynamics.ai/privkey.pem
    Redirect 308 / https://baybotdynamics.com/
</VirtualHost>
CONF3
fi
} > "$CONF"
if ! apachectl configtest >/dev/null 2>&1 || ! systemctl reload apache2; then
  echo "Apache rejected the final file; putting the previous one back."; cp -a "$SAVED" "$CONF"; apachectl configtest 2>&1 | tail -1; systemctl reload apache2; exit 1
fi

echo "4/5 Checking from this machine..."
CHECKS="https://baybotdynamics.com/ https://baybotdynamics.com/products https://www.baybotdynamics.com/x?b=2 http://baybotdynamics.com/"
[ "$MODE" = all ] && CHECKS="$CHECKS https://baybotdynamics.ai/x?a=1 http://baybotdynamics.ai/"
for t in $CHECKS; do
  host="${t#*://}"; host="${host%%/*}"
  printf '%-40s ' "$t"; curl -s -o /dev/null -m 15 -w '%{http_code} %{redirect_url}\n' --resolve "$host:443:127.0.0.1" --resolve "$host:80:127.0.0.1" "$t"
done
echo "5/5 Holy Match still fine?"
printf 'holymatchusa.com                         '; curl -s -o /dev/null -m 15 -w '%{http_code}\n' --resolve holymatchusa.com:443:127.0.0.1 https://holymatchusa.com/
echo "Certificates renew by themselves (certbot timer). To undo this step: cp $SAVED $CONF && systemctl reload apache2"
