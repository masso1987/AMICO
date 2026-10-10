<p align="center"><img src="docs/brand/amico-logo.jpg" alt="AMICO Cameroon" width="220"></p>

# AMICO — mobile money & airtime exchange platform

**AMICO Cameroon** · Alpha Multi-Integrated Corporation. Brand tokens: [`packages/brand`](packages/brand/src/index.ts), guide: [`docs/brand/BRAND.md`](docs/brand/BRAND.md).

Monorepo for the Cameroon MoMo / Orange Money / airtime exchange platform described in [`docs/DEV_PLAN.md`](docs/DEV_PLAN.md). This first increment delivers **phases P1–P2 and the backend half of P3/P4**: the authoritative API, its data model, the pricing engine, the transaction state machine, manual airtime verification, mock providers and the tests that prove the financial controls.

> **Simulation only.** Real-money processing is impossible in this build: only the mock adapter exists, every transaction is flagged `simulated`, and the production config refuses simulation mode. Real adapters are added after gate G2 (see [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md)).

## What is in the box

```
apps/
  web/                 Next.js customer web app (sign-up, quotes, payment, tracking, receipts)
  api/                 NestJS REST API + BullMQ worker (same image, two entrypoints)
    prisma/            schema.prisma, migrations (incl. DB-level financial controls), seed
    src/               modules — see "API map" below
    test/              e2e tests against real Postgres
packages/
  contracts/           enums, state-machine whitelist, route catalogue, Zod schemas (shared by every app)
  pricing/             pure integer quote & fee engine (API/worker only — never in clients)
  providers/           capability-based adapter interface, registry, mock adapter
  brand/               AMICO name, colours, typography tokens for every client
docs/                  DEV_PLAN.md, ASSUMPTIONS.md (assumptions + route feasibility), brand/ (logo, brand guide)
infra/docker/          API Dockerfile, staging/prod compose
docker-compose.yml     local Postgres + Redis (+ optional API container)
```

Not yet built: the Next.js admin dashboard and the Expo mobile app, OTP phone verification and staff TOTP (stubs marked `TODO(P1)`), object storage and malware scanning for evidence (`TODO(P5)`), real provider adapters (P5).

## Quick start

Requirements: Node 22, pnpm 10, Postgres 16, Redis 7 (or Docker).

```bash
pnpm install
docker compose up -d db redis                 # or use local Postgres/Redis
cp apps/api/.env.example apps/api/.env        # then fill APP_ENCRYPTION_KEY, JWT_SECRET, CALLBACK_SHARED_SECRET
#   openssl rand -base64 32   → APP_ENCRYPTION_KEY
#   openssl rand -base64 48   → JWT_SECRET
pnpm --filter @amico/api exec prisma generate
pnpm --filter @amico/api exec prisma migrate deploy
pnpm --filter @amico/api prisma:seed          # SEED_DEMO=1 in .env enables 4 demo routes on the mock
pnpm build
pnpm dev:api                                  # http://localhost:3000, Swagger at /docs
cp apps/web/.env.example apps/web/.env.local  # API_URL=http://localhost:3000
pnpm --filter @amico/web dev                  # http://localhost:3001 — the customer web app
```

The web app never calls the API from the browser: its own server routes hold the session in an httpOnly cookie and forward only customer endpoints (`apps/web/src/app/api/proxy`). All prices and fees come from the API; the web app only displays them.

Seeded staff (dev only, password from `SEED_STAFF_PASSWORD`, default `ChangeMe!2026`):
`admin@`, `finance@`, `ops1@`, `ops2@`, `support@amico.local`.

Everything in containers: `docker compose --profile app up --build`.

## Tests

```bash
pnpm turbo run test --filter='./packages/*'   # contracts, pricing (property tests + coverage), providers
pnpm --filter @amico/api test                 # ledger unit tests + 25 e2e journeys on a fresh amico_test DB
```

The e2e suite recreates `amico_test` from the committed migrations (override with `TEST_DATABASE_URL`), runs jobs inline (`USE_QUEUE=false`) and covers: fee types and limits, quote expiry, fee change after a quote, manual approval / rejection, wrong or partial airtime, duplicate staff clicks, dual approval, duplicate callbacks, failed / uncertain / never-resolving payouts, refunds with maker-checker, unauthorized fee changes and SIM access, disabled services and capabilities, ledger immutability and reconciliation.

### Mock provider outcomes

The mock decides by the **last two digits of the amount it is asked to move**:

| Ending | Outcome |
| --- | --- |
| `…13` | FAILED immediately |
| `…17` | UNKNOWN (timeout) → status query says SUCCEEDED |
| `…19` | UNKNOWN (timeout) → status query says FAILED |
| `…23` | PENDING → status query says SUCCEEDED |
| `…29` | UNKNOWN forever → escalates to `UNDER_REVIEW` after 5 checks |
| anything else | SUCCEEDED |

## How money is protected

| Control | Where |
| --- | --- |
| Integer FCFA only; BigInt intermediates; explicit rounding (fees up, delivery down) | `packages/pricing` |
| Platform fee and provider fee are separate fields, rules, approvals and ledger accounts | `PricingRule` vs `ProviderFeeRule` |
| Unknown provider fee → quote refused; estimate → labelled, and only if the service allows it | `calculateQuote` |
| Provider fee deducted at settlement is shown once and never charged twice | `payoutInstructionAmount` vs `expectedDelivered` |
| Accepted quote terms are snapshotted; a rule change forces a new confirmation | `Transaction.acceptedTerms`, `checkQuoteAcceptable` |
| Only whitelisted state transitions, under a row lock, each with a history row | `packages/contracts/state-machine`, `TransactionStateService` |
| `COMPLETED` only after a status query confirms delivery | `ProcessingService.checkStatus` |
| UNKNOWN outcomes are status-queried, never blindly retried; escalate after 5 checks | `ProcessingService` |
| Unique `payoutSlot` makes two live payouts for one transaction impossible | DB unique index |
| Customer reference/screenshot never counts as receipt; staff record amount + evidence note | `VerificationService` |
| Amount mismatch → `UNDER_REVIEW`, no payout | `VerificationService.decide` |
| Dual approval above the service threshold, second approver must differ | `VerificationService.secondApproval` |
| Optimistic version on every staff action → duplicate clicks get 409 | `ManualVerification.version` |
| Maker-checker on pricing rules, provider fee rules, refunds | `PricingService`, `RefundsService` |
| Append-only ledger, history and audit (DB triggers); balanced journals (deferred trigger) | `migrations/…_financial_controls` |
| Separate `SIMULATED` ledger book; simulated txn can't use a real adapter and vice versa | `LedgerBook`, `ProcessingService.adapter` |
| SIM numbers AES-256-GCM encrypted, masked by default, reveal audited; no PIN fields accepted | `sims.module.ts` |
| Services hidden unless enabled + capabilities verified + priced + receiving SIM active | `CatalogueService.availability` |

## API map (Swagger at `/docs`)

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/customer/register`, `/auth/customer/login`, `/auth/staff/login` |
| Customer | `GET /services`, `POST /quotes`, `POST /transactions` (needs `Idempotency-Key`), `GET /transactions`, `GET /transactions/:id`, `POST /transactions/:id/source-reference`, `POST /evidence`, `GET /notifications` |
| Verification | `GET /admin/verifications`, `GET /admin/verifications/:id`, `POST …/:id/decision?version=`, `POST …/:id/second-approval?version=`, `GET …/evidence/:fileId` |
| Catalogue | `GET /admin/services`, `POST /admin/services/:id/enable|disable`, `PATCH /admin/services/:id` |
| Pricing | `GET|POST /admin/pricing-rules`, `POST …/:id/approve|reject|retire`, `POST /admin/pricing/simulate`, `GET|POST /admin/provider-fee-rules`, `POST …/:id/approve` |
| SIMs & providers | `GET /admin/sim-accounts`, `POST …/:id/reveal`, `PATCH …/:id`, `GET …/:id/history`, `GET /admin/providers`, `POST /admin/providers/capabilities/:id/verify|disable` |
| Operations | `GET /admin/transactions?state=…`, `GET /admin/transactions/:id`, `POST /admin/transactions/:id/refunds`, `GET /admin/refunds`, `POST /admin/refunds/:id/approve|confirm-manual` |
| Reports & audit | `GET /admin/reports/revenue?period=day|month`, `GET /admin/reports/reconciliation`, `GET /admin/audit-logs` |
| System | `POST /callbacks/:providerCode` (HMAC-signed; triggers a status query only), `GET /health` |

## Database migrations — please verify once

The two migrations in `apps/api/prisma/migrations` were produced from `schema.prisma` without Prisma's schema engine (it could not be downloaded in the build environment) and were applied and tested against Postgres 16 there. On a machine with normal network access, confirm they match the schema exactly:

```bash
cd apps/api
createdb amico_shadow
SHADOW_DATABASE_URL=postgresql://…/amico_shadow pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
```

Exit code 0 means no drift. CI runs the same check on every push.

## Deployment

- Image: `docker build -f infra/docker/api.Dockerfile -t amico-api .`
- Staging/production: `infra/docker/compose.staging.yml` runs the API (`RUN_WORKERS=false`) and a separate worker (`node dist/worker.js`). Secrets come from the environment or a secret manager — never from a committed `.env`.
- Run `prisma migrate deploy` before starting a new release. Grant the app's DB role no `UPDATE`/`DELETE` on ledger, history and audit tables (the triggers enforce it regardless).
- Keep `SIMULATION_MODE=true` on staging until real adapters exist; the API refuses to start in production with it on.

## Next steps (from the dev plan)

1. Admin dashboard (Next.js) on top of the existing admin endpoints — verification queue first.
2. Customer web (Next.js) and Expo app on `@amico/contracts`, with the SIMULATION banner.
3. OTP phone verification, staff TOTP, refresh-token rotation.
4. Real adapters once G0 answers the provider questions in `docs/ASSUMPTIONS.md`.
