/* Recreates the test database from the committed migrations, then runs the demo seed. */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export default async function globalSetup() {
  require('./env');
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const admin = new URL(url.toString());
  admin.pathname = '/postgres';
  admin.search = '';

  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await c.query(`CREATE DATABASE "${dbName}"`);
  await c.end();

  const db = new Client({ connectionString: process.env.DATABASE_URL!.replace('?schema=public', '') });
  await db.connect();
  const dir = join(__dirname, '..', 'prisma', 'migrations');
  for (const m of readdirSync(dir).filter((d) => /^\d+_/.test(d)).sort()) {
    await db.query(readFileSync(join(dir, m, 'migration.sql'), 'utf8'));
  }
  await db.end();

  execFileSync('npx', ['ts-node', '--transpile-only', 'prisma/seed.ts'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, SEED_DEMO: '1', SEED_STAFF_PASSWORD: 'Test-Password-2026' },
    stdio: 'inherit',
  });
}
