import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

try {
  process.loadEnvFile?.('.env');
} catch {
  try {
    process.loadEnvFile?.('../.env');
  } catch {}
}

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const isSupabase =
  connectionString.includes('supabase') ||
  process.env['POSTGRES_HOST']?.includes('supabase') ||
  process.env['POSTGRES_SSL'] === 'true';

const client = new pg.Client({
  connectionString,
  ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
});

async function runBackup() {
  await client.connect();
  console.log('Connected to database for backup...');

  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  
  const backupDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFilePath = path.join(backupDir, `db_backup_${timestamp}.sql`);
  const writeStream = fs.createWriteStream(backupFilePath, { encoding: 'utf-8' });

  writeStream.write(`-- Database Backup Created At: ${now.toISOString()}\n`);
  writeStream.write(`-- Host: Supabase AWS ap-southeast-1\n\n`);
  writeStream.write(`BEGIN;\n\n`);

  // Query all tables in public schema
  const tablesRes = await client.query<{ table_name: string }>(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  for (const { table_name } of tablesRes.rows) {
    writeStream.write(`-- -----------------------------------------------------\n`);
    writeStream.write(`-- Table: ${table_name}\n`);
    writeStream.write(`-- -----------------------------------------------------\n`);

    const rowsRes = await client.query(`SELECT * FROM "${table_name}"`);
    if (rowsRes.rows.length === 0) {
      writeStream.write(`-- (0 rows)\n\n`);
      continue;
    }

    const columns = rowsRes.fields.map((f) => `"${f.name}"`).join(', ');

    for (const row of rowsRes.rows) {
      const values = rowsRes.fields.map((f) => {
        const val = (row as Record<string, unknown>)[f.name];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number' || typeof val === 'bigint') return val.toString();
        if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
        if (val instanceof Date) return `'${val.toISOString()}'`;
        if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
        return `'${String(val).replace(/'/g, "''")}'`;
      }).join(', ');

      writeStream.write(`INSERT INTO "${table_name}" (${columns}) VALUES (${values}) ON CONFLICT DO NOTHING;\n`);
    }
    writeStream.write(`\n`);
  }

  writeStream.write(`COMMIT;\n`);
  writeStream.end();

  console.log(`Backup completed successfully to: ${backupFilePath}`);
  await client.end();
}

runBackup().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
