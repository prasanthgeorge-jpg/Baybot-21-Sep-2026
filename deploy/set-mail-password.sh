#!/usr/bin/env bash
# Set the Zoho app password the website uses to send its form emails, and test it.
#
# Run it on the server as devuser (no sudo):   bash ~/set-mail-password.sh
#
# The site signs in to Zoho as ONE mailbox that you can make an app password for (for example
# georgep@baybotdynamics.com, or the Gmail account the old site used). Requests can still be delivered to other addresses such as info@
# (MAIL_TO), whose mailbox the site never signs in to. The password is the "App Password" made in
# Zoho for the sending mailbox (Zoho Accounts -> Security -> App Passwords), not its normal password. It is asked for twice without
# being shown and written only to ~/baybot-new/.env.local (readable by devuser only). It never
# goes into the shell history, the repo or any chat. The script then checks that Zoho accepts the
# login (nothing is sent) and restarts the site. If Zoho rejects the current server name it also
# tries the other Zoho name (smtp.zoho.com <-> smtppro.zoho.com) and saves the one that works.
# Run it again any time to change the password.
set -euo pipefail

ENV_FILE="${ENV_FILE:-$HOME/baybot-new/.env.local}"
APP="${APP:-baybot-new}"
SITE_DIR="$(dirname "$ENV_FILE")"

getv() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true; }
setv() {   # setv KEY VALUE: replace or add one line, leave every other setting as it is
  # The app folder is read-only for this user, so the file is rewritten in place, never replaced.
  local tmp; tmp="$(mktemp "${TMPDIR:-/tmp}/envset.XXXXXX")"
  grep -v "^$1=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"; cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

[ -f "$ENV_FILE" ] || { echo "Cannot find $ENV_FILE"; exit 1; }
USER_="$(getv SMTP_USER)"; HOST="$(getv SMTP_HOST)"; PORT="$(getv SMTP_PORT)"; PORT="${PORT:-587}"
HOST="${HOST:-smtp.zoho.com}"
echo "Requests are delivered to: $(getv MAIL_TO)"
read -r -p "Mailbox the site signs in to and sends from [${USER_:-none}]: " NEWU
NEWU="$(printf '%s' "$NEWU" | tr -d '[:space:]')"
USER_="${NEWU:-$USER_}"
case "$USER_" in ?*@?*.?*) ;; *) echo "That does not look like an email address."; exit 1 ;; esac
DEFAULT_HOST="$HOST"; case "$USER_" in *@gmail.com|*@googlemail.com) DEFAULT_HOST="smtp.gmail.com" ;; esac
read -r -p "Mail server [$DEFAULT_HOST]: " NEWH
HOST="$(printf '%s' "${NEWH:-$DEFAULT_HOST}" | tr -d '[:space:]')"
[ "$HOST" = "$(getv SMTP_HOST)" ] || { setv SMTP_HOST "$HOST"; echo "Mail server set to $HOST"; }
echo "Sending mailbox: $USER_   server: $HOST:$PORT"
echo "Enter the APP password made for $USER_ (nothing shows as you type)."

read -r -s -p "App password: " pw1; echo
read -r -s -p "Type it again: " pw2; echo
[ -n "$pw1" ]       || { echo "The password is empty. Nothing changed."; exit 1; }
[ "$pw1" = "$pw2" ] || { echo "The two entries differ. Nothing changed."; exit 1; }
case "$pw1" in *$'\n'*) echo "The password cannot contain a line break."; exit 1 ;; esac
case "${pw1:0:1}${pw1: -1}" in
  \"*|\'*|*\"|*\') echo "The site strips a quote mark at the start or end of a setting, so the password cannot start or end with one."; exit 1 ;;
esac

umask 077
setv SMTP_PASS "$pw1"
unset pw1 pw2
# Zoho only accepts mail whose From address is the mailbox that signed in (or an alias of it).
if [ "$USER_" != "$(getv SMTP_USER)" ]; then setv SMTP_USER "$USER_"; setv MAIL_FROM "BayBot Website <$USER_>"; echo "Sending mailbox set to $USER_ (From: BayBot Website <$USER_>)"; fi
echo "Saved the password in $ENV_FILE"
[ "${NO_VERIFY:-0}" = "1" ] && exit 0

# Does Zoho accept the login? (logs in and disconnects; no email is sent)
check() {   # check HOST -> prints OK or the reason
  ( cd "$SITE_DIR" && SMTP_HOST_TRY="$1" SMTP_PORT_TRY="$PORT" SMTP_USER_TRY="$USER_" SMTP_PASS_TRY="$(getv SMTP_PASS)" node -e '
    const nm = require("nodemailer"), p = Number(process.env.SMTP_PORT_TRY);
    nm.createTransport({ host: process.env.SMTP_HOST_TRY, port: p, secure: p === 465, connectionTimeout: 15000, greetingTimeout: 15000,
      auth: { user: process.env.SMTP_USER_TRY, pass: process.env.SMTP_PASS_TRY } })
      .verify().then(() => console.log("OK"), e => console.log(String(e.response || e.message || (e.errors && e.errors[0] && e.errors[0].message) || e).split("\n")[0]));' )
}
echo "Checking the login with the mail server ($HOST)..."
RESULT="$(check "$HOST")"
if [ "$RESULT" != "OK" ]; then
  case "$HOST" in smtp.zoho.*) ALT="${HOST/smtp./smtppro.}" ;; smtppro.zoho.*) ALT="${HOST/smtppro./smtp.}" ;; *) ALT="" ;; esac
  if [ -n "$ALT" ]; then
    echo "  $HOST said: $RESULT"; echo "Trying $ALT..."
    if [ "$(check "$ALT")" = "OK" ]; then HOST="$ALT"; RESULT="OK"; setv SMTP_HOST "$HOST"; echo "  That one works, so SMTP_HOST is now $HOST"; fi
  fi
fi

if [ "$RESULT" != "OK" ]; then
  echo; echo "The mail server did not accept the login: $RESULT"
  echo "Check that: (1) this is an App Password made for $USER_, not the normal password, (2) IMAP/SMTP access is on for the mailbox,"
  echo "(3) the server region matches (.com / .eu / .in / .com.au). The password was saved; run this script again to change it."
  exit 1
fi
echo "The mail server accepted the login."
[ "${SKIP_RESTART:-0}" = "1" ] && exit 0
pm2 restart "$APP" >/dev/null && sleep 3
echo "Restarted $APP. Website forms (Get in Touch, Parts, chat leads) now send through Zoho to: $(getv MAIL_TO)"
