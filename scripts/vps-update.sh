#!/usr/bin/env bash
# AMICO — update an existing VPS install to a new branch (default: platform-v2).
#
# What it does, in order:
#   1. checks the tools and the API .env
#   2. backs up the database (gzip file in <app dir>/backups/)
#   3. fetches the branch from GitHub and fast-forwards to it
#   4. installs dependencies, builds the shared packages
#   5. generates the Prisma client and applies new database migrations
#   6. (optional, --seed) re-runs the seed: adds roles, demo bundles, offers and gateways that are missing
#   7. builds the API, the customer site and the staff dashboard
#   8. restarts the AMICO processes (pm2 or systemd, whichever it finds) and checks they answer
#
# Usage:   bash scripts/vps-update.sh [--dir /opt/amico] [--branch platform-v2] [--seed] [--no-restart]
# Full instructions: docs/UPDATE_VPS.md
set -euo pipefail

APP_DIR="$(pwd)"
BRANCH="platform-v2"
SEED=0
RESTART=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) APP_DIR="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --seed) SEED=1; shift ;;
    --no-restart) RESTART=0; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 2 ;;
  esac
done

step() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$*"; exit 1; }

cd "$APP_DIR" || fail "Folder not found: $APP_DIR"
[[ -d .git ]] || fail "$APP_DIR is not the AMICO git folder (no .git). Use --dir."
[[ -f apps/api/.env ]] || fail "apps/api/.env is missing. Create it before updating."

step "1/8 Checking tools"
command -v git >/dev/null || fail "git is not installed"
command -v node >/dev/null || fail "Node.js is not installed"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[[ "$NODE_MAJOR" -ge 22 ]] || fail "Node.js 22 or newer is needed (found $(node -v))"
command -v pnpm >/dev/null || fail "pnpm is not installed (run: corepack enable && corepack prepare pnpm@10.28.0 --activate)"
echo "node $(node -v), pnpm $(pnpm -v), branch target: $BRANCH"

# Read DATABASE_URL and PORT from the API .env without running anything else in it.
DATABASE_URL=$(grep -E '^DATABASE_URL=' apps/api/.env | head -1 | cut -d= -f2- | tr -d '"'"'")
API_PORT=$(grep -E '^PORT=' apps/api/.env | head -1 | cut -d= -f2- | tr -d '"'"'")
API_PORT=${API_PORT:-3000}
[[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL is empty in apps/api/.env"

step "2/8 Backing up the database"
mkdir -p backups
BACKUP="backups/amico-$(date +%Y%m%d-%H%M%S).sql.gz"
if command -v pg_dump >/dev/null; then
  # pg_dump does not understand Prisma's ?schema=public suffix.
  pg_dump "${DATABASE_URL%%\?*}" --no-owner | gzip > "$BACKUP"
  echo "Backup written: $APP_DIR/$BACKUP ($(du -h "$BACKUP" | cut -f1))"
else
  fail "pg_dump not found (install postgresql-client). Refusing to migrate without a backup."
fi

step "3/8 Fetching $BRANCH from GitHub"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  git status --short --untracked-files=no
  fail "There are local changes to tracked files. Commit or stash them first (git stash)."
fi
git fetch origin "$BRANCH"
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
git merge --ff-only "origin/$BRANCH"
echo "Now at: $(git log --oneline -1)"

step "4/8 Installing dependencies and building shared packages"
pnpm install --frozen-lockfile
pnpm turbo run build --filter='./packages/*'

step "5/8 Database: Prisma client and migrations"
( cd apps/api && npx prisma generate && npx prisma migrate deploy )

if [[ "$SEED" == "1" ]]; then
  step "6/8 Seeding missing roles, demo bundles, offers and gateways"
  ( cd apps/api && set -a && . ./.env && set +a && npx ts-node --transpile-only prisma/seed.ts )
else
  step "6/8 Seed skipped (add --seed to run it)"
fi

step "7/8 Building API, customer site and staff dashboard"
pnpm turbo run build --filter=@amico/api --filter=@amico/web --filter=@amico/admin

if [[ "$RESTART" == "0" ]]; then
  step "8/8 Restart skipped (--no-restart). Restart the AMICO processes yourself."
  exit 0
fi

step "8/8 Restarting AMICO"
RESTARTED=0
if command -v pm2 >/dev/null && pm2 jlist 2>/dev/null | grep -q '"name":"amico'; then
  for name in $(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).filter(p=>p.name.startsWith("amico")).forEach(p=>console.log(p.name)))'); do
    pm2 restart "$name" --update-env && RESTARTED=1
  done
  pm2 save >/dev/null
elif command -v systemctl >/dev/null && systemctl list-units --type=service --all 'amico*' --no-legend | grep -q amico; then
  for unit in $(systemctl list-units --type=service --all 'amico*' --no-legend | awk '{print $1}' | grep amico); do
    sudo systemctl restart "$unit" && RESTARTED=1 && echo "restarted $unit"
  done
fi
[[ "$RESTARTED" == "1" ]] || echo "No pm2 process or systemd unit named amico* was found. Restart the API, worker, web and admin the way you started them."

sleep 8
echo
if curl -fsS "http://127.0.0.1:${API_PORT}/health"; then echo "  <- API OK"; else echo "API did not answer on port ${API_PORT}. Check its logs."; fi
for port in 3001 3002; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/" || true)
  echo "port ${port}: HTTP ${code}"
done
echo
echo "Done. Backup kept at $APP_DIR/$BACKUP"
