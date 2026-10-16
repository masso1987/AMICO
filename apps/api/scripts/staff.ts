/**
 * Staff account commands for the server (no dashboard needed). Every change is audited as SYSTEM.
 *
 *   pnpm --filter @amico/api staff create-admin --email you@company.cm --name "Your Name"
 *   pnpm --filter @amico/api staff reset-password --email someone@company.cm
 *   pnpm --filter @amico/api staff reset-2fa --email someone@company.cm      # lost phone
 *   pnpm --filter @amico/api staff deactivate-demo                           # switch off *@amico.local
 *   pnpm --filter @amico/api staff list
 *
 * Temporary passwords are printed once and must be replaced at first sign-in.
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createPrismaClient } from '../src/prisma/client-factory';
import { hashPassword, temporaryPassword } from '../src/auth/staff-auth';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { email: { type: 'string' }, name: { type: 'string' } },
});
const [command] = positionals;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (run from apps/api with its .env)');
const prisma = createPrismaClient(process.env.DATABASE_URL);

const audit = (action: string, entityId: string | null, after?: object) =>
  prisma.auditLog.create({ data: { actorType: 'SYSTEM', actorId: 'cli', action, entityType: 'StaffUser', entityId, after: after ?? undefined } });

function need(v: string | undefined, flag: string): string {
  if (!v?.trim()) {
    console.error(`Missing --${flag}`);
    process.exit(2);
  }
  return v.trim();
}

async function byEmail(email: string) {
  const s = await prisma.staffUser.findUnique({ where: { email: email.toLowerCase() } });
  if (!s) {
    console.error(`No staff account for ${email}`);
    process.exit(1);
  }
  return s;
}

function printPassword(email: string, password: string) {
  console.log(`\n  Sign in at the staff dashboard as ${email}`);
  console.log(`  Temporary password: ${password}`);
  console.log('  You will set up the authenticator app and choose a new password at first sign-in.\n');
}

async function main() {
  switch (command) {
    case 'create-admin': {
      const email = need(values.email, 'email').toLowerCase();
      const fullName = need(values.name, 'name');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Not an email address');
      if (await prisma.staffUser.findUnique({ where: { email } })) throw new Error(`${email} already exists. Use reset-password instead.`);
      const password = temporaryPassword();
      const s = await prisma.staffUser.create({ data: { email, fullName, roles: ['ADMIN'], passwordHash: await hashPassword(password), mustChangePassword: true } });
      await audit('staff.created', s.id, { email, fullName, roles: ['ADMIN'], via: 'cli' });
      console.log(`Created administrator ${email}.`);
      printPassword(email, password);
      break;
    }
    case 'reset-password': {
      const s = await byEmail(need(values.email, 'email'));
      const password = temporaryPassword();
      await prisma.staffUser.update({ where: { id: s.id }, data: { passwordHash: await hashPassword(password), mustChangePassword: true, active: true, sessionVersion: { increment: 1 } } });
      await audit('staff.password.reset', s.id, { via: 'cli' });
      printPassword(s.email, password);
      break;
    }
    case 'reset-2fa': {
      const s = await byEmail(need(values.email, 'email'));
      await prisma.staffUser.update({ where: { id: s.id }, data: { totpSecretEncrypted: null, totpEnabledAt: null, totpLastStep: null, sessionVersion: { increment: 1 } } });
      await audit('staff.2fa.reset', s.id, { via: 'cli' });
      console.log(`Two-step sign-in reset for ${s.email}. They set up a new authenticator at their next sign-in.`);
      break;
    }
    case 'deactivate-demo': {
      const realAdmins = await prisma.staffUser.count({ where: { active: true, roles: { has: 'ADMIN' }, NOT: { email: { endsWith: '@amico.local' } } } });
      if (realAdmins === 0) throw new Error('Create your own administrator first (create-admin), then run this again.');
      const demo = await prisma.staffUser.findMany({ where: { email: { endsWith: '@amico.local' }, active: true } });
      for (const s of demo) {
        await prisma.staffUser.update({ where: { id: s.id }, data: { active: false, sessionVersion: { increment: 1 } } });
        await audit('staff.updated', s.id, { active: false, reason: 'Demo account switched off', via: 'cli' });
      }
      console.log(demo.length ? `Deactivated: ${demo.map((s) => s.email).join(', ')}` : 'No active demo accounts.');
      break;
    }
    case 'list': {
      const rows = await prisma.staffUser.findMany({ orderBy: { email: 'asc' } });
      console.table(rows.map((s) => ({ email: s.email, roles: s.roles.join(','), active: s.active, twoStep: s.totpEnabledAt ? 'on' : 'not set up', lastLogin: s.lastLoginAt?.toISOString() ?? '-' })));
      break;
    }
    default:
      console.error('Usage: staff <create-admin --email --name | reset-password --email | reset-2fa --email | deactivate-demo | list>');
      process.exit(2);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
