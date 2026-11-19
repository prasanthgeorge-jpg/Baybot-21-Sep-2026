#!/usr/bin/env bash
# Puts the CRM on the internet at https://crm.baybotdynamics.com (certificate + Apache site). Run as root on the server:
#   bash /root/baybot-crm-go-live.sh
# It REFUSES to do anything until both are true, so nobody can take over a CRM that has no owner yet:
#   1. the owner account exists (created through the private tunnel; the CRM reports "configured": true), and
#   2. the DNS record for crm.baybotdynamics.com points at this server.
# The real work is the CRM's own install script (new Apache site only, certificate for this one name, graceful reload,
# automatic undo if Apache rejects the file). The Holy Match site and the BayBot website site are not touched.
set -uo pipefail
SITE=crm.baybotdynamics.com
HERE_IP="${EXPECT_IP:-$(curl -4 -s -m 8 https://ifconfig.me 2>/dev/null)}"; HERE_IP="${HERE_IP:-$(hostname -I | tr ' ' '\n' | grep -E '^[0-9.]+$' | head -1)}"
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
echo "1/4 Is the CRM running on this machine?"
curl -fsS -m 8 http://127.0.0.1:8002/api/auth/policy >/dev/null || { echo "   No. Run: su - baybot -c 'pm2 list'"; exit 2; }
echo "2/4 Has the owner account been created?"
if ! curl -fsS -m 8 http://127.0.0.1:8002/api/setup/status | python3 -c 'import sys,json; sys.exit(0 if json.load(sys.stdin).get("configured") else 1)'; then
  echo "   NOT YET. The CRM still has no owner, so putting it on the internet now would let the first visitor claim it."
  echo "   Create the owner first through the private tunnel:  ssh -L 18002:127.0.0.1:8002 baybot@$HERE_IP   then open http://localhost:18002"
  echo "   Nothing was changed."; exit 3
fi
echo "   yes"
echo "3/4 Does DNS point here?"
ns="$(dig +short NS baybotdynamics.com @1.1.1.1 | head -1)"; got="$(dig +short @"${ns:-1.1.1.1}" "$SITE" A | tail -1)"
if [ "$got" != "$HERE_IP" ]; then echo "   WAITING: $SITE -> ${got:-nothing} (needs $HERE_IP). Nothing was changed."; exit 4; fi
echo "   ok: $SITE -> $got"
echo "4/4 Installing the Apache site and certificate (the CRM's own script)"
SUDO_USER=baybot bash /home/baybot/open-crm/deploy/install-root.sh
