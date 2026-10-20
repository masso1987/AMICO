#!/usr/bin/env bash
# AMICO — read-only check of a shared server before installing. Changes nothing.
#
# Usage:   bash server-preflight.sh [--ports "3100 3101 3102 6380"]
# Prints:  OS, CPU/RAM/disk, ports already taken, Nginx sites, PostgreSQL, Redis, Node, pm2,
#          and whether the AMICO ports, Linux user and folders are free. Ends with a verdict.
set -uo pipefail

PORTS="3100 3101 3102 6380"
[[ "${1:-}" == "--ports" ]] && PORTS="$2"
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; WARN=$((WARN+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; BAD=$((BAD+1)); }
hdr()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
WARN=0; BAD=0

hdr "System"
. /etc/os-release 2>/dev/null && echo "  $PRETTY_NAME, kernel $(uname -r)"
echo "  CPU: $(nproc) cores · RAM: $(free -h | awk '/Mem:/{print $2" total, "$7" available"}') · Disk /: $(df -h / | awk 'NR==2{print $4" free of "$2}')"
avail_mb=$(free -m | awk '/Mem:/{print $7}')
[[ "$avail_mb" -lt 1500 ]] && warn "Less than 1.5 GB RAM available. Building the apps needs about 1.5 GB; add swap if the build is killed."

hdr "Ports already listening (what other apps use)"
sudo ss -ltnp 2>/dev/null | awk 'NR>1{print "  "$4"  "$6}' | sed 's/users:((//; s/,pid=.*//' | sort -u

hdr "Ports planned for AMICO: $PORTS"
for p in $PORTS; do
  if sudo ss -ltn "sport = :$p" 2>/dev/null | grep -q LISTEN; then bad "Port $p is already used. Pick another one (see the guide)."; else ok "Port $p is free"; fi
done
for p in 80 443; do
  sudo ss -ltnp "sport = :$p" 2>/dev/null | grep -q LISTEN && echo "  port $p: $(sudo ss -ltnp "sport = :$p" | awk 'NR==2{print $6}' | sed 's/users:((//; s/,pid=.*//')" || echo "  port $p: free"
done

hdr "Web server"
if command -v nginx >/dev/null; then
  ok "Nginx $(nginx -v 2>&1 | cut -d/ -f2) installed"
  echo "  Enabled sites: $(ls /etc/nginx/sites-enabled 2>/dev/null | tr '\n' ' ')"
  grep -rlsE 'server_name[^;]*amico' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | while read -r f; do warn "An Nginx file already mentions amico: $f"; done
  sudo nginx -t >/dev/null 2>&1 && ok "Current Nginx configuration is valid" || bad "Current Nginx configuration has errors (sudo nginx -t). Fix them before adding AMICO."
else
  if sudo ss -ltn 'sport = :80' | grep -q LISTEN; then bad "Port 80 is used but Nginx isn't installed (Apache? Caddy? Docker?). The guide assumes Nginx in front."; else warn "Nginx not installed (the guide installs it)."; fi
fi
command -v certbot >/dev/null && ok "certbot installed" || warn "certbot not installed (the guide installs it)."

hdr "PostgreSQL"
if command -v psql >/dev/null && id postgres >/dev/null 2>&1; then
  ok "PostgreSQL $(psql -V | awk '{print $3}') installed"
  sudo -u postgres psql -Atc "select 1" >/dev/null 2>&1 && ok "Reachable as the postgres user" || bad "Can't connect as the postgres user (sudo -u postgres psql)."
  sudo -u postgres psql -Atc "select 1 from pg_roles where rolname='amico'" 2>/dev/null | grep -q 1 && warn "A database role named amico already exists."
  sudo -u postgres psql -Atc "select 1 from pg_database where datname='amico'" 2>/dev/null | grep -q 1 && warn "A database named amico already exists."
elif sudo ss -ltn 'sport = :5432' | grep -q LISTEN; then
  warn "Something listens on 5432 but there is no local postgres user (Docker?). You'll need that server's admin login to create the amico database."
else
  warn "PostgreSQL not installed (the guide installs it)."
fi

hdr "Redis"
if command -v redis-cli >/dev/null && redis-cli -p 6379 ping >/dev/null 2>&1; then
  policy=$(redis-cli -p 6379 config get maxmemory-policy 2>/dev/null | tail -1)
  echo "  Existing Redis on 6379, maxmemory-policy: ${policy:-unknown}"
  [[ "$policy" != "noeviction" ]] && warn "The shared Redis can evict keys ($policy). AMICO's job queue must never lose keys, so the guide gives AMICO its own Redis on port 6380."
else
  echo "  No Redis answering on 6379."
fi
command -v redis-server >/dev/null && ok "redis-server binary present" || warn "redis-server not installed (the guide installs it)."

hdr "Node.js and process managers"
command -v node >/dev/null && echo "  System Node: $(node -v) (left untouched; AMICO gets its own Node 22 in /opt/amico-node)" || echo "  No system Node (fine: AMICO gets its own Node 22)."
[[ -x /opt/amico-node/bin/node ]] && ok "AMICO's Node already installed: $(/opt/amico-node/bin/node -v)"
command -v pm2 >/dev/null && echo "  pm2 present (other apps). AMICO uses systemd units instead, so they don't mix."
systemctl list-units --type=service --all 'amico*' --no-legend 2>/dev/null | grep -q amico && warn "systemd units named amico* already exist: $(systemctl list-units --type=service --all 'amico*' --no-legend | awk '{print $1}' | tr '\n' ' ')"

hdr "AMICO user and folders"
id amico >/dev/null 2>&1 && warn "Linux user amico already exists." || ok "Linux user amico is free"
for d in /opt/amico /opt/amico-node /var/lib/amico; do [[ -e $d ]] && warn "$d already exists." || ok "$d is free"; done

hdr "DNS"
ip=$(curl -s -4 --max-time 5 https://ifconfig.me || true)
echo "  This server's public IPv4: ${ip:-unknown}"
for h in amico.mboketech.com staff.amico.mboketech.com; do
  r=$(getent ahostsv4 "$h" | awk 'NR==1{print $1}')
  [[ -n "$r" && "$r" == "$ip" ]] && ok "$h → $r (this server)" || echo "  $h → ${r:-no record} (still the old server until you switch DNS)"
done

hdr "Verdict"
if [[ $BAD -gt 0 ]]; then printf '  \033[31m%d blocking problem(s)\033[0m, %d warning(s). Fix the ✗ lines first.\n' "$BAD" "$WARN"; exit 1
else printf '  \033[32mNo blocking problem\033[0m, %d warning(s) to read.\n' "$WARN"; fi
