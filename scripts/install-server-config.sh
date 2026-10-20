#!/usr/bin/env bash
# AMICO — writes the server files for a shared VPS: a private Redis, four systemd services and one Nginx site.
# It never edits other apps' files and refuses to overwrite existing AMICO files unless you pass --force.
#
# Files written (all need sudo):
#   /etc/redis/redis-amico.conf              private Redis for AMICO (port 6380, noeviction, AOF on disk)
#   /etc/systemd/system/amico-redis.service  runs that Redis
#   /etc/systemd/system/amico-api.service    API          (127.0.0.1:API_PORT)
#   /etc/systemd/system/amico-worker.service background jobs, SMS, maintenance notices, monitoring
#   /etc/systemd/system/amico-web.service    customer site (127.0.0.1:WEB_PORT)
#   /etc/systemd/system/amico-admin.service  staff dashboard (127.0.0.1:ADMIN_PORT)
#   /etc/nginx/sites-available/amico         both sub-domains (HTTP; certbot adds HTTPS) + link in sites-enabled
#
# Usage (defaults shown):
#   sudo bash scripts/install-server-config.sh \
#     --dir /opt/amico --user amico --node /opt/amico-node/bin/node \
#     --api-port 3100 --web-port 3101 --admin-port 3102 --redis-port 6380 \
#     --domain amico.mboketech.com --staff-domain staff.amico.mboketech.com [--force]
# Then:  sudo systemctl daemon-reload && sudo nginx -t && sudo systemctl reload nginx
# Full guide: docs/DEPLOY_NEW_VPS.md
set -euo pipefail

DIR=/opt/amico; RUN_USER=amico; NODE=/opt/amico-node/bin/node
API_PORT=3100; WEB_PORT=3101; ADMIN_PORT=3102; REDIS_PORT=6380
DOMAIN=amico.mboketech.com; STAFF_DOMAIN=staff.amico.mboketech.com; FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;; --user) RUN_USER="$2"; shift 2 ;; --node) NODE="$2"; shift 2 ;;
    --api-port) API_PORT="$2"; shift 2 ;; --web-port) WEB_PORT="$2"; shift 2 ;; --admin-port) ADMIN_PORT="$2"; shift 2 ;;
    --redis-port) REDIS_PORT="$2"; shift 2 ;; --domain) DOMAIN="$2"; shift 2 ;; --staff-domain) STAFF_DOMAIN="$2"; shift 2 ;;
    --force) FORCE=1; shift ;; -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
    *) echo "Unknown option $1 (see --help)"; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
id "$RUN_USER" >/dev/null 2>&1 || { echo "Linux user $RUN_USER does not exist (create it first, see the guide)."; exit 1; }
[[ -x "$NODE" ]] || { echo "Node not found at $NODE (install it first, see the guide)."; exit 1; }
command -v redis-server >/dev/null || { echo "redis-server is not installed: sudo apt install -y redis-server"; exit 1; }
[[ -d /etc/nginx/sites-available ]] || { echo "Nginx is not installed: sudo apt install -y nginx"; exit 1; }

write() { # write <path> (content on stdin)
  if [[ -e "$1" && $FORCE -eq 0 ]]; then echo "  exists, kept: $1 (use --force to replace)"; cat >/dev/null; return; fi
  cat > "$1"; echo "  wrote: $1"
}

echo "Redis (private to AMICO, port $REDIS_PORT)"
install -d -o redis -g redis -m 750 /var/lib/redis-amico
write /etc/redis/redis-amico.conf <<CONF
# AMICO's own Redis: job queue and rate limits. Never evicts keys (BullMQ needs that).
bind 127.0.0.1 ::1
port $REDIS_PORT
protected-mode yes
daemonize no
supervised systemd
dir /var/lib/redis-amico
appendonly yes
appendfsync everysec
maxmemory 256mb
maxmemory-policy noeviction
CONF
chown redis:redis /etc/redis/redis-amico.conf; chmod 640 /etc/redis/redis-amico.conf
write /etc/systemd/system/amico-redis.service <<UNIT
[Unit]
Description=AMICO Redis (port $REDIS_PORT)
After=network.target

[Service]
User=redis
Group=redis
ExecStart=$(command -v redis-server) /etc/redis/redis-amico.conf
Restart=always
LimitNOFILE=10032

[Install]
WantedBy=multi-user.target
UNIT

echo "AMICO services"
node_unit() { # name description workdir exec [extra env lines]
  write "/etc/systemd/system/$1.service" <<UNIT
[Unit]
Description=$2
After=network.target postgresql.service amico-redis.service
Wants=amico-redis.service

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$3
Environment=PATH=$(dirname "$NODE"):/usr/bin:/bin
$5
ExecStart=$4
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
}
node_unit amico-api "AMICO API" "$DIR/apps/api" "$NODE dist/main.js" "Environment=RUN_WORKERS=false
Environment=PORT=$API_PORT
Environment=HOST=127.0.0.1"
node_unit amico-worker "AMICO background worker" "$DIR/apps/api" "$NODE dist/worker.js" "Environment=RUN_WORKERS=true"
node_unit amico-web "AMICO customer site" "$DIR/apps/web" "$NODE $DIR/apps/web/node_modules/next/dist/bin/next start -p $WEB_PORT -H 127.0.0.1" "Environment=NODE_ENV=production
Environment=API_URL=http://127.0.0.1:$API_PORT"
node_unit amico-admin "AMICO staff dashboard" "$DIR/apps/admin" "$NODE $DIR/apps/admin/node_modules/next/dist/bin/next start -p $ADMIN_PORT -H 127.0.0.1" "Environment=NODE_ENV=production
Environment=API_URL=http://127.0.0.1:$API_PORT"

echo "Nginx site"
write /etc/nginx/sites-available/amico <<NGINX
# AMICO — customer site and staff dashboard. certbot --nginx adds the HTTPS parts.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:$WEB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name $STAFF_DOMAIN;
    client_max_body_size 6m;
    add_header X-Robots-Tag "noindex, nofollow" always;

    location / {
        proxy_pass http://127.0.0.1:$ADMIN_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
}
NGINX
ln -sfn /etc/nginx/sites-available/amico /etc/nginx/sites-enabled/amico

echo
echo "Next: sudo systemctl daemon-reload && sudo nginx -t && sudo systemctl reload nginx"
