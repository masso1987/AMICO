/**
 * Seed data.
 *
 * Always: the 4 SIM accounts (inactive), the MOCK provider with every capability
 * DISABLED and UNVERIFIED, all 14 routes DISABLED, the chart of accounts, and staff users.
 *
 * SEED_DEMO=1 (refused in production): marks mock capabilities verified "for simulation",
 * activates the SIMs, and enables four demo routes with approved pricing rules so the full
 * journey can be exercised. Every transaction in that mode is flagged simulated.
 */
import 'dotenv/config';
import * as argon2 from 'argon2';
import { maskMsisdn, ROUTE_DEFINITIONS, receivingSimOperator, ProviderCapability as Cap } from '@amico/contracts';
import { createPrismaClient } from '../src/prisma/client-factory';
import { encrypt } from '../src/common/crypto';
import { CHART_OF_ACCOUNTS } from '../src/ledger/postings';
import type { Operator, ProviderCapabilityKind } from '../src/generated/prisma/client';

const env = process.env;
if (!env.DATABASE_URL || !env.APP_ENCRYPTION_KEY) throw new Error('DATABASE_URL and APP_ENCRYPTION_KEY are required');
const demo = env.SEED_DEMO === '1';
if (demo && env.NODE_ENV === 'production') throw new Error('SEED_DEMO is forbidden in production');

const prisma = createPrismaClient(env.DATABASE_URL);
const key = env.APP_ENCRYPTION_KEY;

// Placeholder numbers. Replace through the admin SIM registry with the real lines.
const SIMS = [
  { code: 'SIM-MTN-BUSINESS', label: 'MTN Business SIM', operator: 'MTN', type: 'BUSINESS', method: 'API', msisdn: env.SEED_MTN_BUSINESS_MSISDN ?? '237670000001', providerCode: 'MOCK' },
  { code: 'SIM-ORANGE-BUSINESS', label: 'Orange Business SIM', operator: 'ORANGE', type: 'BUSINESS', method: 'API', msisdn: env.SEED_ORANGE_BUSINESS_MSISDN ?? '237690000001', providerCode: 'MOCK' },
  { code: 'SIM-MTN-NORMAL', label: 'Normal MTN SIM', operator: 'MTN', type: 'NORMAL', method: 'MANUAL_SOURCE', msisdn: env.SEED_MTN_NORMAL_MSISDN ?? '237670000002', providerCode: null },
  { code: 'SIM-ORANGE-NORMAL', label: 'Normal Orange SIM', operator: 'ORANGE', type: 'NORMAL', method: 'MANUAL_SOURCE', msisdn: env.SEED_ORANGE_NORMAL_MSISDN ?? '237690000002', providerCode: null },
] as const;

const STAFF = [
  { email: 'admin@amico.local', fullName: 'Dev Admin', roles: ['ADMIN'] },
  { email: 'finance@amico.local', fullName: 'Dev Finance', roles: ['FINANCE'] },
  { email: 'ops1@amico.local', fullName: 'Dev Operations 1', roles: ['OPERATIONS'] },
  { email: 'ops2@amico.local', fullName: 'Dev Operations 2', roles: ['OPERATIONS'] },
  { email: 'support@amico.local', fullName: 'Dev Support', roles: ['SUPPORT'] },
] as const;

const DEMO_ROUTES = ['MTN_MOMO__ORANGE_MONEY', 'ORANGE_MONEY__MTN_MOMO', 'MTN_AIRTIME__ORANGE_MONEY', 'MTN_MOMO__MTN_AIRTIME'];

async function main() {
  // ---- staff
  const password = env.SEED_STAFF_PASSWORD ?? 'ChangeMe!2026';
  const staffIds: Record<string, string> = {};
  for (const s of STAFF) {
    const row = await prisma.staffUser.upsert({
      where: { email: s.email },
      update: {},
      create: { email: s.email, fullName: s.fullName, roles: [...s.roles], passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
    });
    staffIds[s.email] = row.id;
  }

  // ---- SIM accounts (no PINs, no secrets)
  const simIds: Record<string, string> = {};
  for (const s of SIMS) {
    const row = await prisma.simAccount.upsert({
      where: { code: s.code },
      update: {},
      create: {
        code: s.code, label: s.label, operator: s.operator, type: s.type, processingMethod: s.method,
        msisdnEncrypted: encrypt(s.msisdn, key), msisdnMasked: maskMsisdn(s.msisdn), providerCode: s.providerCode,
        active: demo, notes: demo ? 'Demo seed: placeholder number, simulation only.' : 'Placeholder number — replace before use.',
      },
    });
    simIds[`${s.operator}:${s.type}`] = row.id;
  }

  // ---- mock provider and capabilities
  const provider = await prisma.provider.upsert({
    where: { code: 'MOCK' },
    update: {},
    create: { code: 'MOCK', name: 'Mock provider (simulation only)', simulated: true },
  });
  for (const operator of ['MTN', 'ORANGE'] as Operator[]) {
    for (const capability of Object.values(Cap) as ProviderCapabilityKind[]) {
      await prisma.providerCapability.upsert({
        where: { providerId_operator_capability: { providerId: provider.id, operator, capability } },
        update: {},
        create: {
          providerId: provider.id, operator, capability,
          enabled: demo, verifiedAt: demo ? new Date() : null, verifiedById: demo ? staffIds['admin@amico.local'] : null,
          notes: demo ? 'Verified for SIMULATION only (demo seed).' : 'Not verified.',
        },
      });
    }
  }

  // ---- service catalogue: every route DISABLED
  for (const r of ROUTE_DEFINITIONS) {
    const simOp = receivingSimOperator(r);
    await prisma.service.upsert({
      where: { code: r.code },
      update: {},
      create: {
        code: r.code, name: r.name, sourceAsset: r.source, destinationAsset: r.destination,
        processingMethod: r.processingMethod, status: 'DISABLED',
        requiredCapabilities: r.requiredCapabilities.map((c) => ({ operator: c.operator, capability: c.capability })),
        receivingSimId: simOp ? simIds[`${simOp}:NORMAL`] : null,
        verificationNotes: r.verificationNotes,
        dualApprovalThreshold: 50_000,
      },
    });
  }

  // ---- chart of accounts, both books
  for (const book of ['REAL', 'SIMULATED'] as const) {
    for (const a of CHART_OF_ACCOUNTS) {
      await prisma.ledgerAccount.upsert({
        where: { code_book: { code: a.code, book } },
        update: {},
        create: { code: a.code, name: a.name, type: a.type, book },
      });
    }
  }

  if (demo) await seedDemo(provider.id, staffIds);
  console.log(`Seed complete${demo ? ' (DEMO — simulation only)' : ''}.`);
}

async function seedDemo(providerId: string, staff: Record<string, string>) {
  const maker = staff['finance@amico.local']!;
  const checker = staff['admin@amico.local']!;
  const now = new Date();

  for (const code of DEMO_ROUTES) {
    const service = await prisma.service.findUniqueOrThrow({ where: { code } });
    const exists = await prisma.pricingRule.findFirst({ where: { serviceId: service.id } });
    if (!exists) {
      const airtime = service.sourceAsset.endsWith('_AIRTIME');
      await prisma.pricingRule.create({
        data: {
          serviceId: service.id, version: 1, status: 'ACTIVE', feeType: 'PERCENTAGE_PLUS_FIXED',
          percentageBps: 100, fixedFee: 50, minFee: 100, maxFee: 2_000, minAmount: 500, maxAmount: 500_000,
          deductionMethod: 'DEDUCT_FROM_DESTINATION',
          // DEMO value only — a real airtime conversion rate must be verified (assumption B6).
          conversionRatePpm: airtime ? 850_000 : 1_000_000,
          effectiveFrom: now, changeReason: 'Demo seed (simulation)', createdById: maker, approvedById: checker, approvedAt: now,
        },
      });
    }
    await prisma.service.update({ where: { id: service.id }, data: { status: 'ENABLED' } });
  }

  // Provider fees: ESTIMATE values, clearly marked; demo services allow estimates.
  for (const operator of ['MTN', 'ORANGE'] as Operator[]) {
    for (const capability of ['DISBURSE', 'AIRTIME_TOPUP'] as ProviderCapabilityKind[]) {
      const exists = await prisma.providerFeeRule.findFirst({ where: { providerId, operator, capability } });
      if (exists) continue;
      await prisma.providerFeeRule.create({
        data: {
          providerId, operator, capability, version: 1, status: 'ACTIVE', feeType: 'FIXED', fixedFee: capability === 'DISBURSE' ? 100 : 0,
          source: 'ESTIMATE', evidenceReference: null, deductedAtSettlement: false,
          changeReason: 'Demo seed: placeholder estimate, not a real tariff', createdById: maker, approvedById: checker, approvedAt: now,
        },
      });
    }
    // Collections: no provider fee in the mock.
    const collect = await prisma.providerFeeRule.findFirst({ where: { providerId, operator, capability: 'COLLECT' } });
    if (!collect) {
      await prisma.providerFeeRule.create({
        data: {
          providerId, operator, capability: 'COLLECT', version: 1, status: 'ACTIVE', feeType: 'FIXED', fixedFee: 0,
          source: 'ESTIMATE', deductedAtSettlement: false, changeReason: 'Demo seed', createdById: maker, approvedById: checker, approvedAt: now,
        },
      });
    }
  }
  await prisma.service.updateMany({ where: { code: { in: DEMO_ROUTES } }, data: { allowEstimatedProviderFee: true } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
