# Moving AMICO to a new shared VPS (same sub-domains)

This installs AMICO on a new Ubuntu server that also hosts other apps, keeping **amico.mboketech.com** (customer site) and **staff.amico.mboketech.com** (staff dashboard).

How AMICO lives next to the other apps:

| Piece | Where | Why it can't clash |
|---|---|---|
| Code | `/opt/amico`, owned by a dedicated Linux user `amico` | its own user and folder |
| Node.js 22 | `/opt/amico-node` | private copy: the server's other Node apps keep their version |
| API / customer site / staff dashboard | `127.0.0.1:3100 / 3101 / 3102` | local only, never exposed; ports checked before install |
| Redis | its own instance on `127.0.0.1:6380` | never evicts keys, doesn't share memory or settings with other apps' Redis |
| PostgreSQL | database `amico`, role `amico` in the existing server | other databases untouched |
| Processes | systemd units `amico-redis`, `amico-api`, `amico-worker`, `amico-web`, `amico-admin` | separate from pm2/other services |
| Web | one Nginx file `/etc/nginx/sites-available/amico` | only adds two `server_name` blocks |
| Uploads | `/var/lib/amico/uploads` | outside the code folder, survives updates |

If a port is taken, choose others in step 4 and use the same numbers everywhere after.

Choose one path now:

* **Path A: fresh install.** Empty database with the demo data (simulation). The quickest.
* **Path B: move the old server's data.** Staff accounts, transactions, settings and uploads come along. Needs the old server's `APP_ENCRYPTION_KEY` (without it, SIM numbers and staff 2-step secrets can't be read).

Commands marked **[admin]** run as your normal sudo user. Commands marked **[amico]** run as the `amico` user, which you open with `sudo -iu amico`.

---

## 1. Base packages [admin]

```bash
sudo apt update
sudo apt install -y --no-upgrade git curl ca-certificates xz-utils nginx certbot python3-certbot-nginx postgresql postgresql-contrib redis-server
```

`--no-upgrade` installs what's missing and leaves the versions other apps already use.

If Redis wasn't on this server before and no other app needs it, switch off the default instance (AMICO uses its own on 6380):

```bash
sudo systemctl disable --now redis-server
```

## 2. AMICO user, folders and private Node.js 22 [admin]

```bash
sudo adduser --system --group --home /home/amico --shell /bin/bash amico
sudo mkdir -p /opt/amico /opt/amico-node /var/lib/amico/uploads /opt/amico-backups
sudo chown amico:amico /opt/amico /var/lib/amico/uploads /opt/amico-backups
sudo chmod 750 /var/lib/amico/uploads

# Node.js 22 (latest 22.x), checksum verified, in /opt/amico-node
cd /tmp
FILE=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-x64.tar.xz$/{print $2}')
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$FILE"
curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep " $FILE\$" | sha256sum -c -
sudo tar -xJf "$FILE" -C /opt/amico-node --strip-components=1
sudo /opt/amico-node/bin/npm install -g pnpm@10.28.0 --prefix /opt/amico-node
echo 'export PATH=/opt/amico-node/bin:$PATH' | sudo tee -a /home/amico/.profile
/opt/amico-node/bin/node -v && /opt/amico-node/bin/pnpm -v
```

Expect `v22.x.x` and `10.28.0`. On an ARM server, replace `linux-x64` with `linux-arm64`.

## 3. Get the code from GitHub [amico]

The repository is private, so give this server a **read-only deploy key**. That's safer than a personal token.

```bash
sudo -iu amico
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/amico_deploy -N "" -C "amico@new-vps"
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/amico_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
cat ~/.ssh/amico_deploy.pub
```

On GitHub, open **masso1987/AMICO → Settings → Deploy keys → Add deploy key**. Paste the line that was printed, leave "Allow write access" **unchecked**, and save. Then, still as amico:

```bash
ssh -o StrictHostKeyChecking=accept-new -T git@github.com   # expect: "successfully authenticated"
git clone -b platform-v2 git@github.com:masso1987/AMICO.git /opt/amico
cd /opt/amico && git log --oneline -1
exit
```

## 4. Check the server [admin]

```bash
bash /opt/amico/scripts/server-preflight.sh
```

This only reads and reports. It shows which ports other apps use, the Nginx sites, PostgreSQL, Redis's eviction policy, RAM/disk and DNS. Warnings that `/opt/amico`, `/opt/amico-node` or the `amico` user already exist are expected now.

* If 3100, 3101, 3102 or 6380 is taken, pick free ports and re-check them: `bash /opt/amico/scripts/server-preflight.sh --ports "3200 3201 3202 6381"`. Use your numbers in steps 6 and 8.
* If it says less than 1.5 GB of RAM is available, add swap before building:
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

## 5. Database [admin]

```bash
DB_PASS=$(openssl rand -hex 24); echo "Database password: $DB_PASS"   # keep it for step 6
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE amico LOGIN PASSWORD '$DB_PASS';
CREATE DATABASE amico OWNER amico;
SQL
```

**Path B only: bring the old data.**

1. On the **old** server, stop AMICO so nothing changes, then dump the database. The dump uses the app's own login, so it works even without a `postgres` user:
   ```bash
   cd /opt/amico     # the old server's AMICO folder
   pm2 stop all 2>/dev/null || sudo systemctl stop 'amico*'
   pg_dump "$(grep ^DATABASE_URL apps/api/.env | cut -d= -f2- | tr -d '"' | sed 's/?.*//')" --no-owner --no-acl -Fc -f /tmp/amico.dump
   tar -czf /tmp/amico-uploads.tgz -C apps/api uploads 2>/dev/null || echo "no uploads folder"
   grep -E '^(APP_ENCRYPTION_KEY|JWT_SECRET|CALLBACK_SHARED_SECRET)=' apps/api/.env
   ```
   Copy the three printed lines somewhere safe: you need `APP_ENCRYPTION_KEY` in step 6.
2. On the **new** server [admin], fetch and restore. Replace `user@OLD_IP` with the old server's login:
   ```bash
   scp user@OLD_IP:/tmp/amico.dump user@OLD_IP:/tmp/amico-uploads.tgz /tmp/
   PGPASSWORD="$DB_PASS" pg_restore -h 127.0.0.1 -U amico -d amico --no-owner --role=amico /tmp/amico.dump
   sudo tar -xzf /tmp/amico-uploads.tgz -C /var/lib/amico/uploads --strip-components=1 && sudo chown -R amico:amico /var/lib/amico/uploads
   ```

## 6. Configuration files [amico]

```bash
sudo -iu amico
cd /opt/amico
```

Path A generates new secrets. **For Path B, replace the three generated values with the old server's lines** (same `APP_ENCRYPTION_KEY`, otherwise staff can't sign in with their authenticator and SIM numbers are unreadable).

```bash
DB_PASS='paste the password from step 5'
cat > apps/api/.env <<EOF
# staging = a real server still in SIMULATION. Use production only with real providers and SIMULATION_MODE=false.
NODE_ENV=staging
PORT=3100
HOST=127.0.0.1
DATABASE_URL=postgresql://amico:${DB_PASS}@127.0.0.1:5432/amico?schema=public
REDIS_URL=redis://127.0.0.1:6380
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -hex 48)
CALLBACK_SHARED_SECRET=$(openssl rand -hex 24)
JWT_CUSTOMER_TTL=30m
JWT_STAFF_TTL=15m
SIMULATION_MODE=true
USE_QUEUE=true
UPLOAD_DIR=/var/lib/amico/uploads
MAX_EVIDENCE_BYTES=5242880
# Path A only (demo data). Remove these two lines after the first start.
SEED_DEMO=1
SEED_STAFF_PASSWORD=$(openssl rand -base64 12)
EOF
chmod 600 apps/api/.env
echo 'API_URL=http://127.0.0.1:3100' > apps/web/.env
echo 'API_URL=http://127.0.0.1:3100' > apps/admin/.env
grep SEED_STAFF_PASSWORD apps/api/.env    # Path A: the demo staff password
```

If you changed the API port in step 4, put it in `PORT=` and both `API_URL=` lines.

## 7. Install, migrate, build [amico]

```bash
cd /opt/amico
pnpm install --frozen-lockfile
pnpm turbo run build --filter='./packages/*'
cd apps/api
npx prisma generate
npx prisma migrate deploy          # Path B: applies only what the old database was missing
npx ts-node --transpile-only prisma/seed.ts   # Path A (demo data). Path B: also safe, it adds only the missing roles and gateways
cd /opt/amico
pnpm turbo run build --filter=@amico/api --filter=@amico/web --filter=@amico/admin
exit
```

The last command takes a few minutes and must end with `Tasks: … successful`.

## 8. Services and Nginx [admin]

```bash
cd /opt/amico
sudo bash scripts/install-server-config.sh \
  --api-port 3100 --web-port 3101 --admin-port 3102 --redis-port 6380 \
  --domain amico.mboketech.com --staff-domain staff.amico.mboketech.com
sudo systemctl daemon-reload
sudo systemctl enable --now amico-redis amico-api amico-worker amico-web amico-admin
sleep 10
systemctl --no-pager --type=service | grep amico
curl -s http://127.0.0.1:3100/health; echo
curl -s -o /dev/null -w "site %{http_code}\n" http://127.0.0.1:3101/
curl -s -o /dev/null -w "staff %{http_code}\n" http://127.0.0.1:3102/login
sudo nginx -t && sudo systemctl reload nginx
curl -s -o /dev/null -w "via nginx %{http_code}\n" -H "Host: amico.mboketech.com" http://127.0.0.1/
```

Expect all five units `running`, `"status":"ok"` from the health check, and `200` for the other three. The script refuses to overwrite existing AMICO files. Add `--force` only to regenerate them on purpose.

If the server uses a firewall, open only HTTP/HTTPS. The AMICO ports stay local:

```bash
sudo ufw status | grep -q "Status: active" && sudo ufw allow 'Nginx Full'
```

## 9. Switch the sub-domains and turn on HTTPS

1. At your DNS provider, change the **A records** of `amico` and `staff.amico` (zone `mboketech.com`) to the **new server's IP**.
2. Wait until both names answer with the new IP. It usually takes a few minutes, up to the record's TTL:
   ```bash
   dig +short amico.mboketech.com staff.amico.mboketech.com
   ```
3. Get the certificates [admin]. Certbot edits only the `amico` Nginx file and sets up renewal:
   ```bash
   sudo certbot --nginx -d amico.mboketech.com -d staff.amico.mboketech.com --redirect -m YOUR_EMAIL --agree-tos -n   # YOUR_EMAIL: where Let's Encrypt sends expiry warnings
   sudo certbot renew --dry-run
   ```

Sign-in only works over HTTPS (secure cookies), so test logins after this step.

## 10. First sign-in

* **Path A:** open https://staff.amico.mboketech.com and sign in as `admin@amico.local` with the `SEED_STAFF_PASSWORD` from step 6. Then:
  * Scan the QR code with your authenticator app and choose your own password.
  * Create real accounts [amico]:
    ```bash
    cd /opt/amico/apps/api
    pnpm staff create-admin --email you@company.cm --name "Your Name"
    pnpm staff deactivate-demo     # switches off the *@amico.local accounts once you have yours
    ```
  * Remove the `SEED_DEMO` and `SEED_STAFF_PASSWORD` lines from `apps/api/.env`.
* **Path B:** sign in with your existing account and authenticator.

Then, in the staff dashboard: set the sell-credit rate, configure the SMS/WhatsApp gateways (keep test mode until a test reaches your phone) and add your phone for alerts under My account.

## 11. Retire the old server

Once the new one works:

```bash
# on the OLD server
pm2 delete all 2>/dev/null; sudo systemctl disable --now 'amico*' 2>/dev/null
sudo rm /etc/nginx/sites-enabled/amico* && sudo nginx -t && sudo systemctl reload nginx
```

Keep `/tmp/amico.dump` (Path B) for a few weeks.

---

## Day-to-day

| Task | Command |
|---|---|
| Status | `systemctl status amico-api amico-worker amico-web amico-admin amico-redis` |
| Live logs | `journalctl -u amico-api -f` (or `amico-worker`, `amico-web`, `amico-admin`) |
| Restart | `sudo systemctl restart amico-api amico-worker amico-web amico-admin` |
| Update to the latest code | `sudo -iu amico bash -lc 'cd /opt/amico && bash scripts/vps-update.sh --no-restart'` then `sudo systemctl restart amico-api amico-worker amico-web amico-admin` |
| Manual backup | `sudo -iu amico bash -lc 'pg_dump "$(grep ^DATABASE_URL /opt/amico/apps/api/.env | cut -d= -f2- | sed "s/?.*//")" -Fc -f /opt/amico-backups/amico-$(date +%F).dump'` |
| Staff lost their phone | `sudo -iu amico bash -lc 'cd /opt/amico/apps/api && pnpm staff reset-2fa --email them@company.cm'` |

`vps-update.sh` backs up the database to `/opt/amico/backups/` before every update.

## If something fails

| Symptom | Fix |
|---|---|
| `amico-api` keeps restarting | `journalctl -u amico-api -n 50`. "Invalid environment configuration" names the wrong `.env` line. |
| 502 Bad Gateway in the browser | The site or dashboard isn't running on the port Nginx expects. Compare `systemctl status amico-web` with `/etc/nginx/sites-available/amico`. |
| Sign-in does nothing | You're on `http://`. Finish step 9 (HTTPS). |
| Build is "Killed" | Not enough RAM. Add the swap from step 4 and rerun step 7. |
| `pg_restore` errors about roles | Harmless with `--no-owner --role=amico`. Check the data with `PGPASSWORD=... psql -h 127.0.0.1 -U amico -d amico -c 'select count(*) from "Transaction"'`. |
| Uploads refused (413) | The `client_max_body_size 6m` line is missing from the Nginx file. |
