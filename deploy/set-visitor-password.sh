#!/usr/bin/env bash
# Set the password for the visitor API (https://baybotdynamics.com/visitors) on the server.
#
# Run it on the server as devuser (no sudo needed):   bash ~/baybot-new/deploy/set-visitor-password.sh
#
# It asks for the password twice, without showing it, writes it to ~/baybot-new/.env.local
# (readable by devuser only) and restarts the site. The password never goes into the shell
# history, the repo or any chat. Run it again any time to change the password.
set -euo pipefail

ENV_FILE="${ENV_FILE:-$HOME/baybot-new/.env.local}"
APP="${APP:-baybot-new}"
KEY="VISITOR_API_PASSWORD"

read -r -s -p "Visitor API password: " pw1; echo
read -r -s -p "Type it again:        " pw2; echo
[ -n "$pw1" ]            || { echo "The password is empty. Nothing changed."; exit 1; }
[ "$pw1" = "$pw2" ]      || { echo "The two entries differ. Nothing changed."; exit 1; }
case "$pw1" in *$'\n'*) echo "The password cannot contain a line break."; exit 1 ;; esac
case "${pw1:0:1}${pw1: -1}" in
  \"*|\'*|*\"|*\') echo "The server strips quote marks at the start and end of a setting, so the password cannot start or end with a quote."; exit 1 ;;
esac

umask 077
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
# The app folder is read-only for this user, so the settings file cannot be replaced, only rewritten in place.
TMP="$(mktemp "${TMPDIR:-/tmp}/envset.XXXXXX")"; trap 'rm -f "$TMP"' EXIT
grep -v "^${KEY}=" "$ENV_FILE" > "$TMP" || true     # keep every other setting exactly as it is
printf '%s=%s\n' "$KEY" "$pw1" >> "$TMP"
cat "$TMP" > "$ENV_FILE"; rm -f "$TMP"
unset pw1 pw2
echo "Saved to $ENV_FILE"

[ "${SKIP_RESTART:-0}" = "1" ] && exit 0
pm2 restart "$APP" >/dev/null && sleep 3
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/visitors || true)"
case "$code" in
  401) echo "Done. The visitor API is on and asking for the password (HTTP 401 without it)." ;;
  503) echo "The site restarted but still reports the API as not set up. Check $ENV_FILE." ;;
  *)   echo "The site restarted. /visitors answered HTTP $code (expected 401)." ;;
esac
