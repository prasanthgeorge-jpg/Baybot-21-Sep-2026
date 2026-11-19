#!/usr/bin/env bash
# Makes the BayBot apps' CODE read-only for the user that runs them, so an attacker who gets code running inside an app
# cannot rewrite the app to leave a backdoor. Run as root on the server; safe to run again. Re-run it after every deployment.
#   bash /root/baybot-lockdown.sh
# Code (root-owned, read-only for baybot):  ~/baybot-new  ~/open-crm  ~/baybot-caller
# Still writable by baybot (needed to run):  ~/baybot-data  ~/open-crm-data  ~/baybot-caller-data  ~/.pm2  and the two settings files
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
H=/home/baybot
for d in baybot-new open-crm baybot-caller; do
  [ -d "$H/$d" ] || { echo "skip $d (not there)"; continue; }
  chown -R root:baybot "$H/$d"
  chmod -R u=rwX,g=rX,o= "$H/$d"           # X keeps the run bit only on folders and files that already have it
  echo "locked  $H/$d"
done
for f in "$H/baybot-new/.env.local" "$H/baybot-caller/backend/.env"; do   # settings the owner edits (passwords, keys)
  [ -f "$f" ] && { chown baybot:baybot "$f"; chmod 600 "$f"; echo "kept writable (settings): $f"; }
done
# restart as baybot so the apps start from the locked files, then check them
su - baybot -c 'pm2 restart all >/dev/null 2>&1; sleep 6; pm2 ls | grep -E "baybot|open-crm" | awk "{print \"  \"\$4, \$10, \$12}"'
echo "--- proof: can the running user change app code?"
for f in "$H/baybot-new/server.js" "$H/open-crm/backend/server.py" "$H/baybot-caller/backend/app.py"; do
  su - baybot -c "echo x >> '$f'" 2>/dev/null && echo "  PROBLEM: baybot could write $f" || echo "  refused (good): $f"
done
su - baybot -c "touch $H/baybot-data/.w && rm $H/baybot-data/.w" && echo "  can still write its data folder (good)"
