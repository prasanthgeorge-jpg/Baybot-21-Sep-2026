#!/usr/bin/env bash
# Deploy this folder to the BayBot website on the Hetzner server (pm2 app "baybot-new", user "baybot").
#
#   tools/deploy.sh          show what would change, ask before doing it
#   tools/deploy.sh --yes    skip the question
#   tools/deploy.sh --dry    show what would change and stop
#
# The apps' code on the server is read-only for the user that runs them (see deploy/hetzner-lockdown.sh), so this logs in as
# root with the server key, uploads only the files that differ, keeps the old copies, hands the folder back to root (read-only
# for baybot), and restarts the website. Nothing is ever deleted on the server. node_modules, .git, .data and .env* are never
# touched (the website's settings live in ~baybot/baybot-new/.env.local on the server). This script is not uploaded.
set -euo pipefail

HOST="${BAYBOT_HOST:-178.156.162.45}"
KEY="${BAYBOT_KEY:-$HOME/.ssh/holymatch_ed25519}"
REMOTE_DIR="${BAYBOT_REMOTE_DIR:-/home/baybot/baybot-new}"
APP="${BAYBOT_PM2_APP:-baybot-new}"
SITE_URL="${BAYBOT_SITE_URL:-https://baybotdynamics.com}"

MODE="ask"
case "${1:-}" in --yes) MODE="yes" ;; --dry) MODE="dry" ;; "") ;; *) echo "Unknown option: $1"; exit 2 ;; esac

cd "$(dirname "$0")/.."
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 "root@$HOST")
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

LIST_FILES='find . -type f -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./.data/*" -not -path "./tools/deploy.sh" -not -name ".DS_Store" -not -name ".env*" -print0 | sort -z'

echo "== Comparing local files with root@$HOST:$REMOTE_DIR"
eval "$LIST_FILES" | xargs -0 shasum -a 256 | sed 's#  \./#  #' > "$TMP/local.sha"
"${SSH[@]}" "cd $REMOTE_DIR && $LIST_FILES | xargs -0 sha256sum | sed 's#  \./#  #'" > "$TMP/remote.sha"

python3 - "$TMP/local.sha" "$TMP/remote.sha" "$TMP" <<'PY'
import sys
def load(p):
    d = {}
    for line in open(p):
        h, _, f = line.rstrip("\n").partition("  ")
        d[f] = h
    return d
L, R = load(sys.argv[1]), load(sys.argv[2])
changed = sorted(f for f in L if f in R and L[f] != R[f])
new = sorted(f for f in L if f not in R)
open(sys.argv[3] + "/upload.txt", "w").write("\n".join(changed + new))
open(sys.argv[3] + "/backup.txt", "w").write("\n".join(changed))
for f in changed: print("  changed ", f)
for f in new: print("  new     ", f)
print("  %d changed, %d new, %d identical" % (len(changed), len(new), len(L) - len(changed) - len(new)))
PY

if [ ! -s "$TMP/upload.txt" ]; then echo "Server is already up to date."; exit 0; fi
[ "$MODE" = "dry" ] && exit 0
if [ "$MODE" = "ask" ]; then
  read -r -p "Upload these files and restart $APP? [y/N] " ans
  case "$ans" in y|Y|yes|YES) ;; *) echo "Cancelled."; exit 1 ;; esac
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BK="/home/baybot/backups/$APP-$STAMP"
if [ -s "$TMP/backup.txt" ]; then
  echo "== Keeping the server's current copies in $BK"
  "${SSH[@]}" "mkdir -p $BK && cd $REMOTE_DIR && tar cf - -T - | tar xf - -C $BK && chown -R baybot:baybot /home/baybot/backups" < "$TMP/backup.txt"
fi

echo "== Uploading"
COPYFILE_DISABLE=1 tar czf - -T "$TMP/upload.txt" | "${SSH[@]}" "cd $REMOTE_DIR && tar xzf - --no-same-owner 2>/dev/null"
# If package.json or the lock file changed, install the packages as the app user first (node_modules is root-owned afterwards).
if grep -q -E '^package(-lock)?\.json$' "$TMP/upload.txt"; then
  echo "== Packages changed: installing them"
  "${SSH[@]}" "chown -R baybot:baybot $REMOTE_DIR && su - baybot -c 'cd $REMOTE_DIR && npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -1'"
fi

echo "== Making the code read-only for the app user again, then restarting $APP"
"${SSH[@]}" "chown -R root:baybot $REMOTE_DIR && chmod -R u=rwX,g=rX,o= $REMOTE_DIR && chown baybot:baybot $REMOTE_DIR/.env.local && chmod 600 $REMOTE_DIR/.env.local \
  && su - baybot -c 'cd $REMOTE_DIR && node -e \"require(\\\"./lib/render.js\\\")\" && pm2 restart $APP >/dev/null && sleep 4 && pm2 ls | grep $APP | cut -c1-100' \
  && curl -s -o /dev/null -w 'app answers: %{http_code}\n' http://127.0.0.1:5000/"

echo "== Checking $SITE_URL (works once DNS points at the server)"
sleep 2
curl -sL -m 20 -o /dev/null -w "public home page: %{http_code}\n" "$SITE_URL/" || true
echo "Done. To go back: copy the files from $BK on the server over $REMOTE_DIR, then run: bash /root/baybot-lockdown.sh"
