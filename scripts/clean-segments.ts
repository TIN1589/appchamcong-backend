import pg from 'pg';

try {
  process.loadEnvFile?.('.env');
} catch {}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log('Connected to DB');

  await client.query(`
    DELETE FROM shift_template_segments a
    USING shift_template_segments b
    WHERE a.ctid < b.ctid
      AND a.template_id = b.template_id
      AND a.start_time = b.start_time
      AND a.end_time = b.end_time
      AND a.sort_order = b.sort_order;
  `);

  const clean = await client.query(`
    SELECT t.name, s.start_time, s.end_time, s.sort_order 
    FROM shift_templates t 
    JOIN shift_template_segments s ON t.id = s.template_id 
    ORDER BY t.name, s.sort_order
  `);

  console.log('Cleaned template segments:', clean.rows);
  await client.end();
}

main().catch(console.error);
