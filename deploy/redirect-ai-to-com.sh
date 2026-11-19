#!/usr/bin/env bash
# Make https://baybotdynamics.com the one primary address.
#
#   baybotdynamics.ai, www.baybotdynamics.ai   -> https://baybotdynamics.com  (same path and query)
#   www.baybotdynamics.com                     -> https://baybotdynamics.com
#   http:// on any of them                     -> https://baybotdynamics.com
#
# Run on the server:   sudo bash ~/redirect-ai-to-com.sh            (temporary 307 redirects, safe to try)
#                      sudo bash ~/redirect-ai-to-com.sh --final    (permanent 308 redirects, once checked)
# Undo:                sudo bash ~/redirect-ai-to-com.sh --undo
#
# 307/308 keep the request method, so a form POST that lands on .ai is not turned into a GET.
# The old app on port 4000 is left running but no longer gets traffic from baybotdynamics.ai.
# Both certificates stay in place: .ai still needs its own for the HTTPS redirect, and certbot
# renews it the same way as before (apache authenticator).
set -euo pipefail

AV="${APACHE_SITES:-/etc/apache2/sites-available}"
KEEP="${BACKUP_ROOT:-/home/devuser/backups}"
AI="$AV/baybotdynamics.ai.conf"
COM="$AV/baybotdynamics.com.conf"
TEST="${TEST:-0}"   # TEST=1 skips the root check, configtest and reload (used to try the script on copies)

[ "$TEST" = "1" ] || [ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
reload() { [ "$TEST" = "1" ] || { apache2ctl configtest && systemctl reload apache2; }; }

if [ "${1:-}" = "--undo" ]; then
  BK="$(cat "$KEEP/last-redirect-path")"
  [ -f "$BK/baybotdynamics.ai.conf" ] && [ -f "$BK/baybotdynamics.com.conf" ] || { echo "No saved configs in $BK"; exit 1; }
  cp -a "$BK/baybotdynamics.ai.conf" "$BK/baybotdynamics.com.conf" "$AV/"
  reload; echo "Restored the configs saved in $BK."; exit 0
fi

STATUS=307; [ "${1:-}" = "--final" ] && STATUS=308
TARGET="https://baybotdynamics.com/"

# Keep the configs from before the FIRST run, so --undo always goes back to the original setup.
if [ ! -f "$KEEP/last-redirect-path" ] || [ ! -f "$(cat "$KEEP/last-redirect-path")/baybotdynamics.com.conf" ]; then
  BK="$KEEP/redirect-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$BK"
  cp -a "$AI" "$COM" "$BK/"; echo "$BK" > "$KEEP/last-redirect-path"
  echo "Saved the current configs to $BK"
fi
BK="$(cat "$KEEP/last-redirect-path")"
restore() { cp -a "$BK/baybotdynamics.ai.conf" "$BK/baybotdynamics.com.conf" "$AV/"; }

# 1. .ai: every request goes to .com, over HTTP and HTTPS.
cat > "$AI" <<EOF
<VirtualHost *:80>
    ServerName baybotdynamics.ai
    ServerAlias www.baybotdynamics.ai
    Redirect $STATUS / $TARGET
</VirtualHost>
<VirtualHost *:443>
    ServerName baybotdynamics.ai
    ServerAlias www.baybotdynamics.ai
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/baybotdynamics.ai/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/baybotdynamics.ai/privkey.pem
    Redirect $STATUS / $TARGET
    ErrorLog \${APACHE_LOG_DIR}/baybotdynamics-ai-error.log
    CustomLog \${APACHE_LOG_DIR}/baybotdynamics-ai-access.log combined
</VirtualHost>
EOF

# 2. .com: www.baybotdynamics.com gets its own HTTPS vhost that redirects to the bare domain.
python3 - "$COM" "$STATUS" "$TARGET" <<'PY'
import re, sys
path, status, target = sys.argv[1:4]
s = open(path).read()
s = re.sub(r"\n?# BEGIN www-to-apex.*?# END www-to-apex\n?", "\n", s, flags=re.S)   # drop a previous run's block
# take www out of the main HTTPS vhost's aliases
s = re.sub(r"(<VirtualHost \*:443>.*?)^[ \t]*ServerAlias www\.baybotdynamics\.com[ \t]*\n", r"\1", s, count=1, flags=re.S | re.M)
cert = re.search(r"SSLCertificateFile\s+(\S+)", s).group(1)
key = re.search(r"SSLCertificateKeyFile\s+(\S+)", s).group(1)
s = s.rstrip("\n") + f"""

# BEGIN www-to-apex (managed by redirect-ai-to-com.sh)
<VirtualHost *:443>
    ServerName www.baybotdynamics.com
    SSLEngine on
    SSLCertificateFile {cert}
    SSLCertificateKeyFile {key}
    Redirect {status} / {target}
</VirtualHost>
# END www-to-apex
"""
open(path, "w").write(s)
PY

# 3. Apply; if Apache dislikes the result, put the old configs back.
if ! reload; then restore; reload || true; echo "Apache rejected the new config. Old configs restored."; exit 1; fi
echo "Done: redirects use status $STATUS."

[ "$TEST" = "1" ] && exit 0
echo; echo "Checking (expect $STATUS and Location: $TARGET...):"
for u in http://baybotdynamics.ai/x?a=1 https://baybotdynamics.ai/x?a=1 https://www.baybotdynamics.ai/ http://www.baybotdynamics.com/ https://www.baybotdynamics.com/x; do
  printf '%-40s ' "$u"; curl -sI -m 15 "$u" | awk 'BEGIN{ORS=" "} /^HTTP/{print $2} /^[Ll]ocation/{print "->", $2}'; echo
done
printf '%-40s ' "https://baybotdynamics.com/"; curl -sI -m 15 https://baybotdynamics.com/ | head -1
echo "Undo any time with: sudo bash ~/redirect-ai-to-com.sh --undo"
