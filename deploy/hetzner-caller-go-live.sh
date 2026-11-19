#!/usr/bin/env bash
# Puts the BayBot AI caller on the internet at https://caller.baybotdynamics.com (its own address, its own certificate).
# Run as root on the server:   bash /root/baybot-caller-go-live.sh
# Needs the DNS A record for caller.baybotdynamics.com to point at this server first; until then it changes nothing.
# Why its own address and not a /caller/ path on the website: the caller keeps its login in the browser's local storage, which is
# shared by everything on one address. On its own address, scripts on the public website cannot read the caller's login.
# Only a NEW Apache site file is added. The Holy Match site and the BayBot website site are not touched. If Apache rejects it,
# everything is undone automatically.
set -uo pipefail
SITE=caller.baybotdynamics.com
CONF=/etc/apache2/sites-available/$SITE.conf
ACME=/var/www/baybot-acme
STAMP=$(date +%Y%m%d-%H%M%S); BACKUP=/home/baybot/backups/apache-before-caller-$STAMP
HERE_IP="${EXPECT_IP:-$(curl -4 -s -m 8 https://ifconfig.me 2>/dev/null)}"; HERE_IP="${HERE_IP:-$(hostname -I | tr ' ' '\n' | grep -E '^[0-9.]+$' | head -1)}"
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
undo() { echo "UNDO: removing the $SITE site"; a2dissite -q "$SITE" 2>/dev/null; rm -f "$CONF"; apachectl configtest 2>&1 | tail -1; systemctl reload apache2; echo "Apache is as it was. Backup: $BACKUP"; exit 1; }

echo "1/5 Is the caller running on this machine?"
curl -fsS -m 8 http://127.0.0.1:8200/api/health >/dev/null || { echo "   No. Run: su - baybot -c 'pm2 list'"; exit 2; }
echo "2/5 Does DNS point here?"
ns="$(dig +short NS baybotdynamics.com @1.1.1.1 | head -1)"; got="$(dig +short @"${ns:-1.1.1.1}" "$SITE" A | tail -1)"
[ "$got" = "$HERE_IP" ] || { echo "   WAITING: $SITE -> ${got:-nothing} (needs $HERE_IP). Nothing was changed."; exit 4; }
echo "   ok: $SITE -> $got"
[ -e "$CONF" ] && { echo "$CONF already exists; not overwriting. Remove it first if you want to redo this."; exit 5; }
apachectl configtest >/dev/null 2>&1 || { echo "Apache's config was already invalid before I touched it. Nothing changed."; exit 1; }

echo "3/5 Backing up Apache and adding the HTTP site (certificate check only)"
mkdir -p "$BACKUP" && tar czf "$BACKUP/apache2.tar.gz" -C /etc apache2 && chown -R baybot:baybot /home/baybot/backups
mkdir -p "$ACME/.well-known/acme-challenge"; chmod -R a+rX "$ACME"
cat > "$CONF" <<CONF1
<VirtualHost *:80>
    ServerName $SITE
    Alias /.well-known/acme-challenge/ $ACME/.well-known/acme-challenge/
    <Directory $ACME/.well-known/acme-challenge/>
        Require all granted
    </Directory>
    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
</VirtualHost>
CONF1
a2ensite -q "$SITE"; apachectl configtest >/dev/null 2>&1 || { apachectl configtest; undo; }; systemctl reload apache2 || undo

echo "4/5 Certificate for $SITE only"
ACCOUNT_FLAG="--register-unsafely-without-email"; ls /etc/letsencrypt/accounts/*/directory/* >/dev/null 2>&1 && ACCOUNT_FLAG=""
certbot certonly --webroot -w "$ACME" -d "$SITE" --cert-name "$SITE" --non-interactive --agree-tos $ACCOUNT_FLAG || undo

echo "5/5 Final site: HTTPS, security headers, the caller behind it"
cat >> "$CONF" <<CONF2

<VirtualHost *:443>
    ServerName $SITE
    SSLEngine on
    SSLProtocol -all +TLSv1.2 +TLSv1.3
    SSLCertificateFile /etc/letsencrypt/live/$SITE/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$SITE/privkey.pem
    Header always set Strict-Transport-Security "max-age=604800"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "DENY"
    Header always set Referrer-Policy "same-origin"
    Header always set X-Robots-Tag "noindex, nofollow"
    Header always set Cache-Control "no-store" "expr=%{REQUEST_URI} =~ m#^/api/#"
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    # The caller's "too many wrong passwords" lock trusts the first address in X-Forwarded-For. Throw away whatever the visitor
    # sent, so the only address left is the real one that Apache adds. Otherwise a visitor could dodge the lock with fake ones.
    RequestHeader unset X-Forwarded-For
    ProxyPass / http://127.0.0.1:8200/ timeout=300
    ProxyPassReverse / http://127.0.0.1:8200/
    LimitRequestBody 20000000
    ErrorLog \${APACHE_LOG_DIR}/$SITE-error.log
    CustomLog \${APACHE_LOG_DIR}/$SITE-access.log combined
</VirtualHost>
CONF2
apachectl configtest >/dev/null 2>&1 || { apachectl configtest; undo; }; systemctl reload apache2 || undo
echo "--- checks from this machine"
for t in "https://$SITE/" "https://$SITE/api/health" "https://$SITE/api/session" "http://$SITE/"; do
  host="${t#*://}"; host="${host%%/*}"; printf '  %-44s ' "$t"; curl -s -o /dev/null -m 15 -w '%{http_code} %{redirect_url}\n' --resolve "$host:443:127.0.0.1" --resolve "$host:80:127.0.0.1" "$t"
done
printf '  Holy Match: '; curl -s -o /dev/null -m 15 -w '%{http_code}\n' --resolve holymatchusa.com:443:127.0.0.1 https://holymatchusa.com/
echo "Done. https://$SITE is live (login required). To remove it: a2dissite $SITE && rm $CONF && systemctl reload apache2"
