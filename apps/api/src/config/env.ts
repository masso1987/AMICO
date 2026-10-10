import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    /** 127.0.0.1 on a shared server behind Nginx; 0.0.0.0 inside Docker. */
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    /** 32-byte key, base64. Encrypts SIM numbers and staff TOTP secrets at rest. */
    APP_ENCRYPTION_KEY: z.string().refine((k) => Buffer.from(k, 'base64').length === 32, 'APP_ENCRYPTION_KEY must be 32 bytes, base64'),
    JWT_SECRET: z.string().min(32),
    JWT_CUSTOMER_TTL: z.string().default('30m'),
    JWT_STAFF_TTL: z.string().default('15m'),
    /** When true every quote/transaction is simulated and only mock adapters load. Forbidden in production. */
    SIMULATION_MODE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /** Run BullMQ processors inside the API process (dev). In staging/prod run `worker` separately. */
    RUN_WORKERS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /** false = queue jobs are processed synchronously in-process (tests, no Redis). */
    USE_QUEUE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    UPLOAD_DIR: z.string().default('./uploads'),
    MAX_EVIDENCE_BYTES: z.coerce.number().int().default(5 * 1024 * 1024),
    CALLBACK_SHARED_SECRET: z.string().min(16).default('dev-callback-secret-change-me'),
  })
  .refine((e) => !(e.NODE_ENV === 'production' && e.SIMULATION_MODE), {
    message: 'SIMULATION_MODE must be false in production',
    path: ['SIMULATION_MODE'],
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export const ENV = Symbol('ENV');
