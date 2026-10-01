import pg from 'pg';
import bcrypt from 'bcrypt';

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

const ADMIN_EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@chamcong.local';
const ADMIN_PASSWORD = process.env['SEED_ADMIN_PASSWORD'] ?? 'Admin@1234!';
const BCRYPT_ROUNDS = 12;

async function seed(): Promise<void> {
  const client = new pg.Client(DB_CONFIG);
  await client.connect();

  try {
    process.stdout.write('🌱 Starting seed...\n');

    process.stdout.write('  Hashing passwords (bcrypt cost=12, takes a moment)...\n');
    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);
    const staffHash = await bcrypt.hash('Staff@1234!', BCRYPT_ROUNDS);

    await client.query('BEGIN');
    try {
      await client.query(`
        INSERT INTO stores (id, name, address, lat, lng, radius_m)
        VALUES (1, 'Quán Demo F&B', '123 Nguyễn Huệ, Quận 1, TP.HCM', 10.7769, 106.7009, 50)
        ON CONFLICT DO NOTHING
      `);

      await client.query(`
        INSERT INTO users (
          id, store_id, email, password_hash, role, full_name, phone,
          hourly_rate, leave_balance, must_change_password
        ) VALUES (
          '00000000-0000-0000-0000-000000000001', 1,
          $1, $2, 'admin', 'Quản lý', '0900000000', 50000, 12, true
        ) ON CONFLICT (store_id, email) DO UPDATE SET password_hash = $2
      `, [ADMIN_EMAIL, adminHash]);

      const staffList = [
        { id: '00000000-0000-0000-0000-000000000002', email: 'nguyen.an@chamcong.local', name: 'Nguyễn Văn An', phone: '0911111111', rate: 30000, leave: 12 },
        { id: '00000000-0000-0000-0000-000000000003', email: 'tran.binh@chamcong.local', name: 'Trần Thị Bình', phone: '0922222222', rate: 30000, leave: 12 },
        { id: '00000000-0000-0000-0000-000000000004', email: 'le.cuong@chamcong.local', name: 'Lê Văn Cường', phone: '0933333333', rate: 30000, leave: 10 },
      ];

      for (const staff of staffList) {
        await client.query(`
          INSERT INTO users (
            id, store_id, email, password_hash, role, full_name, phone,
            hourly_rate, leave_balance, must_change_password
          ) VALUES ($1, 1, $2, $3, 'staff', $4, $5, $6, $7, true)
          ON CONFLICT (store_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
        `, [staff.id, staff.email, staffHash, staff.name, staff.phone, staff.rate, staff.leave]);
      }

      const templates = [
        { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Ca sáng', color: '#6C4CF1', segs: [{ s: '07:00', e: '12:00' }] },
        { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Ca chiều', color: '#4F6BFF', segs: [{ s: '12:00', e: '17:00' }] },
        { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Ca tối', color: '#2CA7FF', segs: [{ s: '17:00', e: '22:00' }] },
        { id: 'aaaaaaaa-0000-0000-0000-000000000004', name: 'Ca gãy (trưa-tối)', color: '#FF6FA8', segs: [{ s: '10:00', e: '14:00' }, { s: '17:00', e: '22:00' }] },
      ];

      for (const tpl of templates) {
        await client.query(`
          INSERT INTO shift_templates (id, store_id, name, color, created_by)
          VALUES ($1, 1, $2, $3, '00000000-0000-0000-0000-000000000001')
          ON CONFLICT (store_id, name) DO NOTHING
        `, [tpl.id, tpl.name, tpl.color]);

        for (let i = 0; i < tpl.segs.length; i++) {
          const seg = tpl.segs[i]!;
          await client.query(`
            INSERT INTO shift_template_segments (template_id, start_time, end_time, sort_order)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
          `, [tpl.id, seg.s, seg.e, i]);
        }
      }

      await client.query('COMMIT');
      process.stdout.write('✅ Seed completed!\n\n');
      process.stdout.write('📋 Accounts created:\n');
      process.stdout.write(`  Admin:  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}\n`);
      process.stdout.write('  Staff:  nguyen.an@chamcong.local / Staff@1234!\n');
      process.stdout.write('  Staff:  tran.binh@chamcong.local / Staff@1234!\n');
      process.stdout.write('  Staff:  le.cuong@chamcong.local / Staff@1234!\n');
      process.stdout.write('\n⚠️  Tất cả accounts phải đổi mật khẩu lần đầu đăng nhập!\n');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

void seed().catch((err) => {
  process.stderr.write(`Seed failed: ${String(err)}\n`);
  process.exit(1);
});
