/**
 * Environment configuration — validate at startup (fail fast) [10-backend.md]
 * Dùng zod để parse và validate toàn bộ env vars
 */
import { z } from 'zod';

// Tự động nạp .env nếu chạy local ngoài docker (Node 20+)
try {
  process.loadEnvFile?.('.env');
} catch {
  try {
    process.loadEnvFile?.('../.env');
  } catch {
    // Không có file .env hoặc đang chạy trong container
  }
}

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TZ: z.string().default('UTC'),

  // Database (Hỗ trợ cả chuỗi DATABASE_URL của Supabase lẫn config từng trường)
  DATABASE_URL: z.string().optional(),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_DB: z.string().default('postgres'),
  POSTGRES_USER: z.string().default('postgres'),
  POSTGRES_PASSWORD: z.string().optional(),
  POSTGRES_SSL: z
    .union([z.string().toLowerCase().pipe(z.enum(['true', 'false'])).transform((v) => v === 'true'), z.boolean()])
    .default(false),

  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET phải ≥ 32 ký tự'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET phải ≥ 32 ký tự'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // CORS
  CORS_ORIGIN: z.string().url(),

  // WiFi restriction [A3]
  WIFI_RESTRICTION: z
    .string()
    .toLowerCase()
    .pipe(z.enum(['true', 'false']))
    .transform((v) => v === 'true')
    .default('false'),
  ALLOWED_IPS: z.string().default(''),

  // Store
  DEFAULT_STORE_ID: z.coerce.number().int().positive().default(1),

  // Seed admin (chỉ dùng khi seed, không expose ra API)
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),

  // Telegram (optional, Phase 3)
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // Email (optional, Phase 3)
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
    // eslint kullanımı kasıtlı: startup sırasında hata vermek için
    // Dùng process.stderr để tránh vô tình bị log interceptor
    process.stderr.write(`[STARTUP] Missing/invalid env vars:\n${formatted}\n`);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();

export type Env = typeof env;
