import { z } from 'zod';

try {
  process.loadEnvFile?.('.env');
} catch {
  try {
    process.loadEnvFile?.('../.env');
  } catch {
    // Bỏ qua lỗi khi không có file .env trong container
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TZ: z.string().default('UTC'),

  DATABASE_URL: z.string().optional(),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_DB: z.string().default('postgres'),
  POSTGRES_USER: z.string().default('postgres'),
  POSTGRES_PASSWORD: z.string().optional(),
  POSTGRES_SSL: z
    .union([z.string().toLowerCase().pipe(z.enum(['true', 'false'])).transform((v) => v === 'true'), z.boolean()])
    .default(false),

  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET phải ≥ 32 ký tự'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET phải ≥ 32 ký tự'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  CORS_ORIGIN: z.string().url(),

  WIFI_RESTRICTION: z
    .string()
    .toLowerCase()
    .pipe(z.enum(['true', 'false']))
    .transform((v) => v === 'true')
    .default('false'),
  ALLOWED_IPS: z.string().default(''),

  DEFAULT_STORE_ID: z.coerce.number().int().positive().default(1),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  EMAIL_HOST: z.string().optional(),
  EMAIL_PORT: z.coerce.number().optional(),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

function parseEnv(): z.infer<typeof envSchema> {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    process.stderr.write(`[STARTUP] Missing/invalid env vars:\n${formatted}\n`);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();

export type Env = typeof env;
