# AMICO: project guide for Claude Code

AMICO Cameroon (Alpha Multi-Integrated Corporation) is a Cameroon platform for MTN MoMo / Orange Money / airtime: buy airtime, bundles (forfaits), sell credit (rachat de crédit), swap airtime, and MoMo ⇄ Orange Money. Owner: Ferdine Masso Tute (Douala). Repo: `masso1987/AMICO`. **Active branch: `platform-v2`**. `main` is older (e6a2329) and not merged yet.

Also read `AGENTS.md` (root and per app): Turborepo and Next.js 16 differ from older versions, so check the bundled docs in `node_modules/next/dist/docs/` before using Next APIs.

## Hard rules

- **Simulation only** until real provider contracts exist: `SIMULATION_MODE=true`, mock provider adapter. The API refuses `SIMULATION_MODE=true` with `NODE_ENV=production`, so servers run `NODE_ENV=staging`.
- **Money is integer FCFA.** All maths lives in `packages/pricing`. The front-ends only display numbers the API computed.
- **Maker-checker:** whoever drafts a pricing rule, refund or first verification can never approve it. This is enforced in API services, not only by permissions.
- **Append-only tables** (DB triggers): `AuditLog`, `LedgerEntry`, `LedgerJournal`, `TransactionStateHistory`.
- **Never use or store GitHub tokens** pasted in chat. The user posted a PAT twice and was told to revoke it.
- **Only MTN and Orange for now** (Camtel, Nexttel and YooMee later).
- **English first, French second**, everywhere customer- or staff-facing.
- When giving the user scripts, always include step-by-step usage: prerequisites, how to run, parameters, where output goes.

## Layout (pnpm 10 + Turborepo, Node ≥ 22)

| Path | What |
|---|---|
| `packages/contracts` | enums, `ROUTE_DEFINITIONS` (16 routes), product groups (`BUY_AIRTIME`, `BUNDLES`, `SELL_CREDIT`, `AIRTIME_SWAP`, `MONEY_EXCHANGE`), zod schemas, `PERMISSION_INFO`, `ROLE_PERMISSIONS`, number plan |
| `packages/pricing` | quote engine (integer FCFA) |
| `packages/providers` | adapter interface, registry, `MockProviderAdapter` (outcome by last two digits of the amount: 13 fail, 17/19 unknown, 23 pending, 29 never resolves). Its `recall` option makes status queries work across the API/worker processes |
| `packages/brand` | logo assets |
| `apps/api` | NestJS 11 + Prisma 7 (`prisma-client` generator → `src/generated/prisma`), PostgreSQL, Redis/BullMQ. `dist/main.js` = HTTP (run with `RUN_WORKERS=false`), `dist/worker.js` = jobs and scheduler loops |
| `apps/web` | customer site, Next.js 16, port 3001 in dev |
| `apps/admin` | staff dashboard, Next.js 16, port 3002 in dev |
| `docs/` | `DEV_PLAN.md`, `ASSUMPTIONS.md`, `UPDATE_VPS.md`, `DEPLOY_NEW_VPS.md` |
| `scripts/` | `vps-update.sh`, `server-preflight.sh` (read-only), `install-server-config.sh` (private Redis, systemd units, Nginx) |

## Front-end conventions (web and admin)

- **BFF:** the browser only calls `/api/proxy/<path>`, which attaches the httpOnly cookie token and forwards to the API.
  - web: cookie `amico_session`; allow-list in `apps/web/src/app/api/proxy/[...path]/route.ts`.
  - admin: cookie `amico_staff`; allows `admin/*` (underscores allowed), `auth/staff/me`, `offers/:id/image`.
  - Add new customer endpoints to the web allow-list.
- **i18n:** `src/i18n/{core,server,client,en,fr}.ts(x)` in each app. `en.ts` is the source of keys (`as const satisfies Record<string,string>`); `fr.ts` is `Record<MessageKey,string>`, so TypeScript rejects a missing key.
  - Dynamic keys use `` t(`state.${x}` as MessageKey) ``. When you add a state or code, add it to both files.
  - Locale cookie: web `amico_lang`, admin `amico_staff_lang`. `POST /api/lang` also saves it on the profile.
  - API strings (service names, alert titles, monitoring summaries) are English only.
- **Design "Sahel Night":**
  - Colours: night `#0E1116`, panels `#191B27`, lines `#2E3446`, ink `#F4F1EA`, muted `#8C93A6`, gold `#F09E32` / `#FFCB60`, bronze `#C9965F`, MTN `#FFCB05`, Orange `#FF7A1A`.
  - Fonts: Cinzel for headings and wordmark, DM Sans for body.
  - Tokens are in each app's `globals.css`.
- **Admin:** custom dashboard widgets from `GET /admin/dashboard` (layout saved with `PUT /admin/dashboard/layout`). Roles come from the DB (`/admin/access/roles`).

## Product rules already built

- **Sell credit:** one rate for MTN and Orange, 1 000 – 500 000 FCFA, drafted on the admin "Sell-credit rate" page and approved by a second person. `GET /public/sell-credit` exposes the rate to customers.
- **Switchn refund rules:** a failed delivery gives an automatic 100% refund request. Cancelling is free before payment; after payment the refund keeps the cancellation fee (`settings.cancellation.feeBps`, default 300 = 3%). Too late once payout has started.
- **Maintenance:** whole app or chosen services, bilingual messages, optional customer SMS/WhatsApp notice N minutes before (worker `tick`). `GET /status` drives the banners.
- **Messaging:** channels `SMS_MTN`, `SMS_ORANGE` and `WHATSAPP`, routed by number prefix with fallback, test/live mode, encrypted write-only secrets, broadcasts per customer language. Staff alerts go out by SMS/WhatsApp per account.
- **Staff:** TOTP 2-step sign-in is required. CLI: `pnpm --filter @amico/api staff create-admin|reset-password|reset-2fa|deactivate-demo|list`.

## Local development

PostgreSQL role `amico` / `amico_dev`, DB `amico`; Redis on 6379.

```bash
pnpm install
pnpm turbo run build --filter='./packages/*'
cp apps/api/.env.example apps/api/.env      # set APP_ENCRYPTION_KEY (openssl rand -base64 32), JWT_SECRET, SEED_DEMO=1
cd apps/api && npx prisma generate && npx prisma migrate deploy && npx ts-node --transpile-only prisma/seed.ts
pnpm --filter @amico/api build && (cd apps/api && RUN_WORKERS=false node dist/main.js & node dist/worker.js &)
API_URL=http://localhost:3000 pnpm --filter @amico/web dev      # :3001
API_URL=http://localhost:3000 pnpm --filter @amico/admin dev    # :3002
```

- Demo staff: `admin@amico.local`, `finance@`, `ops1@`, `ops2@`, `support@`, all with `SEED_STAFF_PASSWORD` (default `ChangeMe!2026`). Each must enrol TOTP and change the password at first sign-in.
- Migrations are hand-written SQL in `apps/api/prisma/migrations` (latest: `20261016000000_platform`). Seeded routes min/max come from pricing rules.

## Checks before committing

```bash
cd apps/api && npx jest --runInBand          # 78 tests (uses DB amico_test)
cd packages/providers && npx vitest run
cd apps/web && npx tsc --noEmit ; cd apps/admin && npx tsc --noEmit
pnpm turbo run build --filter=@amico/api --filter=@amico/web --filter=@amico/admin
```

Browser-test both apps in EN and FR at desktop and phone width (390 px). There must be no horizontal scroll.

## Deployment state (October 2026)

- **Old VPS:** Ubuntu, Nginx + certbot, `amico.mboketech.com` and `staff.amico.mboketech.com`. Runs an older branch.
- **Moving to a new shared VPS** (Vultr) with the **same sub-domains**, following `docs/DEPLOY_NEW_VPS.md`:
  - user `amico`, `/opt/amico`, private Node in `/opt/amico-node`;
  - ports 3100 (API), 3101 (web), 3102 (admin), private Redis on 6380 (noeviction);
  - systemd units `amico-{redis,api,worker,web,admin}`, DB `amico`.
- **Last open issue:** on the old server, `pg_dump` from `/opt/amico` failed because `apps/api/.env` isn't there. The old install keeps its `.env` elsewhere (or Postgres runs in Docker); the user was given commands to locate `DATABASE_URL`. To move data, the new server must use the old `APP_ENCRYPTION_KEY` (it encrypts SIM numbers and staff TOTP secrets).

## Next steps

1. Finish the VPS move: locate the old DB, dump, restore, cut over DNS, certbot.
2. Check `platform-v2` on the server, then merge it into `main`.
3. Mobile app (Expo) on the same API.
4. Real provider integrations (MTN MoMo Open API, Orange Money, SMS gateways) once contracts arrive; see `docs/ASSUMPTIONS.md` section B.
