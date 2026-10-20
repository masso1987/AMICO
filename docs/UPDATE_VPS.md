# Updating the VPS to `platform-v2`

This update brings the Sahel Night design (customer site and staff dashboard, English and French), offers showcase, bundles, sell credit at one configurable rate, cancellation and refund rules, maintenance notices, MTN / Orange SMS and WhatsApp, monitoring and alerts, roles and access, and the customisable dashboard.

It adds two database migrations: `20261011000000_staff_2fa` (if your server doesn't have it yet) and `20261016000000_platform`. No new environment variables are needed.

## Before you start

| Need | Check with |
|---|---|
| SSH access to the VPS as the user that runs AMICO | `whoami` |
| The AMICO folder (the one with `apps/`, `packages/`, `.git`) | `ls /opt/amico` (use your real path) |
| Node.js 22 or newer | `node -v` |
| pnpm 10 | `pnpm -v` (if missing: `corepack enable && corepack prepare pnpm@10.28.0 --activate`) |
| `pg_dump` for the backup | `pg_dump --version` (if missing: `sudo apt install postgresql-client`) |
| GitHub access from the VPS (the same way you cloned) | `cd /opt/amico && git fetch origin` |

Stop if `git status` shows changes to tracked files. Run `git stash` or commit them first, otherwise the script refuses to continue.

## Step 1. Get the script

The script is part of the branch, so fetch it first:

```bash
cd /opt/amico                         # your AMICO folder
git fetch origin platform-v2
git checkout platform-v2               # first time: git checkout -b platform-v2 origin/platform-v2
```

## Step 2. Run the update

```bash
cd /opt/amico
bash scripts/vps-update.sh --seed
```

Options:

| Option | Meaning | Default |
|---|---|---|
| `--dir PATH` | AMICO folder, if you run the script from elsewhere | the current folder |
| `--branch NAME` | Branch to deploy | `platform-v2` |
| `--seed` | Re-run the seed: adds the built-in roles, the demo bundles and offers, and the three message gateways in **test mode**. It only adds what is missing and never changes existing records. Use it on the simulation server. | off |
| `--no-restart` | Build everything but don't restart the processes | restarts |

What it does and where things go:

1. Checks Node, pnpm and `apps/api/.env`.
2. **Backs up the database** to `/opt/amico/backups/amico-YYYYMMDD-HHMMSS.sql.gz`. It refuses to continue without `pg_dump`.
3. Fetches `platform-v2` and fast-forwards to it.
4. `pnpm install`, then builds the shared packages.
5. `prisma generate` and `prisma migrate deploy` (applies the new migrations).
6. With `--seed`, runs `apps/api/prisma/seed.ts` with your `apps/api/.env`.
7. Builds the API, the customer site and the staff dashboard.
8. Restarts every pm2 process or systemd unit whose name starts with `amico`, then checks the API `/health` and ports 3001 (customer site) and 3002 (staff dashboard).

If your processes have other names, the script tells you. Restart them the way you started them, for example `pm2 restart all`.

## Step 3. Allow uploads in Nginx

Offer images (up to 1 MB) and customers' transfer screenshots go through Nginx. Its default limit is 1 MB, which blocks them. In **both** server blocks (`amico.mboketech.com` and `staff.amico.mboketech.com`), add:

```nginx
client_max_body_size 6m;
```

Then run:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Step 4. After the update, in the staff dashboard

1. **Sign in again.** Two-step sign-in is now required, so each staff member scans a QR code with an authenticator app the first time.
2. **Sell-credit rate** (Catalogue → Sell-credit rate): set the percentage (for example 85) and the range **1 000 – 500 000 FCFA**. A second person approves it, and the same rate applies to MTN and Orange. Do this even if selling credit already worked, because an older rule may still have a 500 FCFA minimum.
3. **SMS and WhatsApp** (Platform → SMS and WhatsApp): enter each gateway's credentials. Keep **test mode** until "Send test" reaches your own phone, then switch to live.
4. **Your alerts** (People → My account): add your phone number and choose SMS and/or WhatsApp alerts.
5. **Dashboard**: click "Customise dashboard" to choose and order your widgets.

## If something goes wrong

**`prisma migrate deploy` says P3005 "The database schema is not empty".** The database was created without Prisma's migration history. Mark the migrations that are already in the database as applied, then run the script again:

```bash
cd /opt/amico/apps/api
npx prisma migrate resolve --applied 20261010000000_init
npx prisma migrate resolve --applied 20261010000100_financial_controls
# only if the staff 2FA columns already exist:
npx prisma migrate resolve --applied 20261011000000_staff_2fa
```

**Roll back.** Restore the backup the script made, check out the previous branch, then rebuild:

```bash
cd /opt/amico
gunzip -c backups/amico-YYYYMMDD-HHMMSS.sql.gz | psql "$(grep ^DATABASE_URL apps/api/.env | cut -d= -f2- | sed 's/?.*//')"
git checkout main        # or the branch you were on before
pnpm install --frozen-lockfile
pnpm turbo run build --filter='./packages/*'
(cd apps/api && npx prisma generate)
pnpm turbo run build --filter=@amico/api --filter=@amico/web --filter=@amico/admin
pm2 restart all          # or restart your systemd units
```

(The older branches don't have `scripts/vps-update.sh`, so these are its steps by hand.)

Restore into an empty database. If tables already exist, drop and recreate the database first (`DROP DATABASE amico; CREATE DATABASE amico OWNER amico;` as the postgres user).

**Logs.** pm2: `pm2 logs amico-api --lines 100`. systemd: `journalctl -u amico-api -n 100`.
