#!/usr/bin/env bash
# READ-ONLY look at a server before BayBot is moved onto it. Changes nothing, installs nothing,
# and prints no passwords, keys or settings values (only names and sizes).
#
# Run it from your Mac (it sends the script to the server over SSH and runs it there):
#   ssh -i ~/.ssh/holymatch_ed25519 root@178.156.162.45 'bash -s' < deploy/inventory-new-server.sh
# Then paste the output back to Claude.
set -u
h() { printf '\n== %s\n' "$1"; }

h "System"
. /etc/os-release 2>/dev/null; echo "OS: ${PRETTY_NAME:-unknown}   kernel: $(uname -r)   uptime: $(uptime -p)"
echo "CPU cores: $(nproc)"; free -m | awk 'NR==1||NR==2||NR==3'
echo "Disk:"; df -h / | tail -1
echo "Pending reboot: $([ -f /var/run/reboot-required ] && echo YES || echo no)"

h "Load and what is using memory (top 6)"
uptime | sed 's/.*load average/load average/'
ps -eo pid,user,rss,comm --sort=-rss | head -7 | awk '{printf "%-8s %-10s %7.0f MB  %s\n",$1,$2,$3/1024,$4}' | sed '1s/.*/PID      USER        RSS      CMD/'

h "Runtimes"
for c in node npm python3 pip3 pm2 git certbot apache2 nginx docker sqlite3 mongod; do
  if command -v $c >/dev/null 2>&1; then printf '%-9s %s\n' "$c" "$($c --version 2>&1 | head -1)"; else printf '%-9s (not installed)\n' "$c"; fi
done
python3 -c 'import venv, ensurepip; print("python venv module: ok")' 2>&1 | tail -1

h "Listening ports (who owns them)"
ss -ltnp 2>/dev/null | awk 'NR==1 || /LISTEN/' | awk '{print $4, $6}' | sed 's/users:(("\([^"]*\)".*/\1/' | sort -u | head -30

h "Apache: modules BayBot needs"
for m in proxy proxy_http ssl rewrite headers; do printf '%-11s %s\n' "$m" "$(apache2ctl -M 2>/dev/null | grep -q " ${m}_module" && echo enabled || echo 'NOT enabled')"; done

h "Apache: enabled sites (names, ports, proxy targets only)"
for f in /etc/apache2/sites-enabled/*.conf; do
  [ -e "$f" ] || continue
  echo "--- $(basename "$f")"
  grep -E "^\s*(ServerName|ServerAlias|<VirtualHost|ProxyPass |DocumentRoot|Redirect)" "$f" | sed 's/^\s*//' | head -14
done

h "Users with a home folder, and pm2 apps"
awk -F: '$3>=1000 && $3<65000 {print $1}' /etc/passwd | tr '\n' ' '; echo
for u in root $(awk -F: '$3>=1000 && $3<65000 {print $1}' /etc/passwd); do
  out="$(su - "$u" -c 'pm2 jlist 2>/dev/null' 2>/dev/null | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print(", ".join("%s(%s, %.0fMB)"%(p["name"],p["pm2_env"]["status"],p["monit"]["memory"]/1048576) for p in d))
except Exception: pass' 2>/dev/null)"
  [ -n "$out" ] && echo "pm2 as $u: $out"
done
systemctl is-enabled pm2-root 2>/dev/null | sed 's/^/pm2-root on boot: /'

h "Web roots and app folders (names and sizes only)"
du -sh /var/www/* 2>/dev/null | head -12
ls -d /home/*/ 2>/dev/null

h "Firewall, SSH and certificates"
echo "ufw: $(ufw status 2>/dev/null | head -1)"
grep -E "^\s*(Port|PermitRootLogin|PasswordAuthentication)" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/* 2>/dev/null | sed 's#.*/##' | head -6
ls /etc/letsencrypt/live 2>/dev/null | grep -v README | sed 's/^/certificate for: /'
systemctl list-timers --no-pager 2>/dev/null | grep -i certbot | head -2 | awk '{print "certbot timer:", $1, $2}'

h "Backups and snapshots hints"
ls -d /root/backups /home/*/backups /var/backups 2>/dev/null | head -4
echo; echo "Done. Nothing was changed."
