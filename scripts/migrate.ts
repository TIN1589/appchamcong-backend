import pg from 'pg';
import fs from 'fs';
import path from 'path';

try {
  process.loadEnvFile?.('.env');
} catch {
  try {
    process.loadEnvFile?.('../.env');
  } catch {
    // Bỏ qua lỗi khi không có file .env trong container
  }
}

const isSupabase =
  process.env['DATABASE_URL']?.includes('supabase') ||
  process.env['POSTGRES_HOST']?.includes('supabase') ||
  process.env['POSTGRES_SSL'] === 'true';

const DB_CONFIG: pg.ClientConfig = process.env['DATABASE_URL']
  ? {
      connectionString: process.env['DATABASE_URL'],
      ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
    }
  : {
      host: process.env['POSTGRES_HOST'] ?? 'localhost',
      port: Number(process.env['POSTGRES_PORT'] ?? 5432),
      database: process.env['POSTGRES_DB'] ?? 'chamcong',
      user: process.env['POSTGRES_USER'] ?? 'chamcong_user',
      password: process.env['POSTGRES_PASSWORD'],
      ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
    };

const MIGRATIONS_DIR = path.join(process.cwd(), 'src/db/migrations');

async function getClient(): Promise<pg.Client> {
  const client = new pg.Client(DB_CONFIG);
  await client.connect();
  return client;
}

async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(20) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client: pg.Client): Promise<Set<string>> {
  const result = await client.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  return new Set(result.rows.map((r) => r.version));
}

async function runMigrations(): Promise<void> {
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && !f.includes('rollback'))
      .sort();

    let count = 0;
    for (const file of files) {
      const version = file.replace('.sql', '');
      if (applied.has(version)) {
        process.stdout.write(`⏭  ${version} (already applied)\n`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      process.stdout.write(`▶  Applying ${version}...\n`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version],
        );
        await client.query('COMMIT');
        process.stdout.write(`✅ ${version} applied\n`);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        process.stderr.write(`❌ Error in ${version}: ${String(err)}\n`);
        process.exit(1);
      }
    }

    if (count === 0) {
      process.stdout.write('✅ Database is up to date\n');
    } else {
      process.stdout.write(`✅ Applied ${count} migration(s)\n`);
    }
  } finally {
    await client.end();
  }
}

async function rollbackLast(): Promise<void> {
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);
    const result = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
    );
    const latest = result.rows[0];
    if (!latest) {
      process.stdout.write('Nothing to rollback\n');
      return;
    }

    const rollbackFile = path.join(
      MIGRATIONS_DIR,
      `${latest.version.replace(/^(\d+).*/, '$1')}_rollback.sql`,
    );

    if (!fs.existsSync(rollbackFile)) {
      process.stderr.write(`Rollback file not found: ${rollbackFile}\n`);
      process.exit(1);
    }

    const sql = fs.readFileSync(rollbackFile, 'utf-8');
    process.stdout.write(`▶  Rolling back ${latest.version}...\n`);

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'DELETE FROM schema_migrations WHERE version = $1',
        [latest.version],
      );
      await client.query('COMMIT');
      process.stdout.write(`✅ Rolled back ${latest.version}\n`);
    } catch (err) {
      await client.query('ROLLBACK');
      process.stderr.write(`❌ Rollback error: ${String(err)}\n`);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

const command = process.argv[2];
if (command === 'rollback') {
  void rollbackLast();
} else {
  void runMigrations();
}
