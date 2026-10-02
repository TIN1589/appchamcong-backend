import pg from 'pg';
import bcrypt from 'bcrypt';
import { env } from '../config/env.js';

const isSupabase =
  (env.DATABASE_URL && env.DATABASE_URL.includes('supabase')) ||
  (env.POSTGRES_HOST && env.POSTGRES_HOST.includes('supabase')) ||
  env.POSTGRES_SSL;

const DB_CONFIG: pg.ClientConfig = env.DATABASE_URL
  ? {
      connectionString: env.DATABASE_URL,
      ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
    }
  : {
      host: env.POSTGRES_HOST,
      port: env.POSTGRES_PORT,
      database: env.POSTGRES_DB,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
    };

const ADMIN_EMAIL = env.SEED_ADMIN_EMAIL ?? 'admin@chamcong.local';
const ADMIN_PASSWORD = env.SEED_ADMIN_PASSWORD ?? 'Admin@1234!';
const BCRYPT_ROUNDS = 12;

export async function seed(): Promise<void> {
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
        { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Ca sáng', color: '#6C4CF1', type: 'REGULAR', segs: [{ s: '07:00', e: '12:00' }] },
        { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Ca chiều', color: '#4F6BFF', type: 'REGULAR', segs: [{ s: '12:00', e: '17:00' }] },
        { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Ca tối', color: '#2CA7FF', type: 'REGULAR', segs: [{ s: '17:00', e: '22:00' }] },
        { id: 'aaaaaaaa-0000-0000-0000-000000000004', name: 'Ca gãy (trưa-tối)', color: '#FF6FA8', type: 'SPLIT', segs: [{ s: '10:00', e: '14:00' }, { s: '17:00', e: '22:00' }] },
      ];

      for (const tpl of templates) {
        await client.query(`
          INSERT INTO shift_templates (id, store_id, name, color, shift_type, created_by)
          VALUES ($1, 1, $2, $3, $4, '00000000-0000-0000-0000-000000000001')
          ON CONFLICT (store_id, name) DO UPDATE SET shift_type = EXCLUDED.shift_type, color = EXCLUDED.color
        `, [tpl.id, tpl.name, tpl.color, tpl.type]);

        for (let i = 0; i < tpl.segs.length; i++) {
          const seg = tpl.segs[i]!;
          await client.query(`
            INSERT INTO shift_template_segments (template_id, start_time, end_time, sort_order)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (template_id, start_time, end_time) DO NOTHING
          `, [tpl.id, seg.s, seg.e, i]);
        }
      }

      // Seed staff_default_shifts
      const defaultShifts = [
        // Nguyễn Văn An: Thứ 2 -> Thứ 6 ca sáng (weekday 1..5)
        { user_id: '00000000-0000-0000-0000-000000000002', weekday: 1, template_id: 'aaaaaaaa-0000-0000-0000-000000000001' },
        { user_id: '00000000-0000-0000-0000-000000000002', weekday: 2, template_id: 'aaaaaaaa-0000-0000-0000-000000000001' },
        { user_id: '00000000-0000-0000-0000-000000000002', weekday: 3, template_id: 'aaaaaaaa-0000-0000-0000-000000000001' },
        { user_id: '00000000-0000-0000-0000-000000000002', weekday: 4, template_id: 'aaaaaaaa-0000-0000-0000-000000000001' },
        { user_id: '00000000-0000-0000-0000-000000000002', weekday: 5, template_id: 'aaaaaaaa-0000-0000-0000-000000000001' },
        // Trần Thị Bình: Thứ 2 -> Thứ 6 ca chiều
        { user_id: '00000000-0000-0000-0000-000000000003', weekday: 1, template_id: 'aaaaaaaa-0000-0000-0000-000000000002' },
        { user_id: '00000000-0000-0000-0000-000000000003', weekday: 2, template_id: 'aaaaaaaa-0000-0000-0000-000000000002' },
        { user_id: '00000000-0000-0000-0000-000000000003', weekday: 3, template_id: 'aaaaaaaa-0000-0000-0000-000000000002' },
        { user_id: '00000000-0000-0000-0000-000000000003', weekday: 4, template_id: 'aaaaaaaa-0000-0000-0000-000000000002' },
        { user_id: '00000000-0000-0000-0000-000000000003', weekday: 5, template_id: 'aaaaaaaa-0000-0000-0000-000000000002' },
        // Lê Văn Cường: Thứ 2, 4, 6 ca tối
        { user_id: '00000000-0000-0000-0000-000000000004', weekday: 1, template_id: 'aaaaaaaa-0000-0000-0000-000000000003' },
        { user_id: '00000000-0000-0000-0000-000000000004', weekday: 3, template_id: 'aaaaaaaa-0000-0000-0000-000000000003' },
        { user_id: '00000000-0000-0000-0000-000000000004', weekday: 5, template_id: 'aaaaaaaa-0000-0000-0000-000000000003' },
      ];

      for (const ds of defaultShifts) {
        await client.query(`
          INSERT INTO staff_default_shifts (store_id, user_id, weekday, shift_template_id)
          VALUES (1, $1, $2, $3)
          ON CONFLICT (user_id, weekday, shift_template_id) DO NOTHING
        `, [ds.user_id, ds.weekday, ds.template_id]);
      }

      // Seed mẫu ca leave_approved và swapped_out trong tuần hiện tại để kiểm chứng UI Lịch Chung & Lịch Của Tôi
      const nowVN = new Date(Date.now() + 7 * 3600 * 1000);
      const dayOfWeek = nowVN.getUTCDay();
      const diffToMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const mondayMs = nowVN.getTime() - diffToMon * 86400000;
      const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const tueDate = fmt(mondayMs + 86400000);
      const wedDate = fmt(mondayMs + 2 * 86400000);

      // Đơn nghỉ phép cho Lê Văn Cường vào Thứ Ba
      await client.query(`
        INSERT INTO leaves (id, store_id, user_id, start_date, end_date, days_count, reason, status)
        VALUES (
          'cccccccc-0000-0000-0000-000000000001', 1,
          '00000000-0000-0000-0000-000000000004',
          $1, $1, 1, 'Bận việc gia đình', 'approved'
        ) ON CONFLICT DO NOTHING
      `, [tueDate]);

      // Ca có trạng thái leave_approved của Cường
      await client.query(`
        INSERT INTO shifts (id, store_id, template_id, assigned_to, status, source, shift_type, work_date, created_by)
        VALUES (
          'dddddddd-0000-0000-0000-000000000001', 1,
          'aaaaaaaa-0000-0000-0000-000000000003',
          '00000000-0000-0000-0000-000000000004',
          'leave_approved', 'default', 'REGULAR', $1,
          '00000000-0000-0000-0000-000000000001'
        ) ON CONFLICT (assigned_to, work_date, template_id) WHERE assigned_to IS NOT NULL AND template_id IS NOT NULL
        DO NOTHING
      `, [tueDate]);

      await client.query(`
        INSERT INTO shift_segments (shift_id, starts_at, ends_at, sort_order)
        VALUES ('dddddddd-0000-0000-0000-000000000001', $1, $2, 0)
        ON CONFLICT (shift_id, starts_at, ends_at) DO NOTHING
      `, [`${tueDate}T10:00:00Z`, `${tueDate}T15:00:00Z`]);

      // Ca có trạng thái swapped_out của Bình vào Thứ Tư
      await client.query(`
        INSERT INTO shifts (id, store_id, template_id, assigned_to, status, source, shift_type, work_date, created_by)
        VALUES (
          'dddddddd-0000-0000-0000-000000000002', 1,
          'aaaaaaaa-0000-0000-0000-000000000002',
          '00000000-0000-0000-0000-000000000003',
          'swapped_out', 'manual', 'REGULAR', $1,
          '00000000-0000-0000-0000-000000000001'
        ) ON CONFLICT (assigned_to, work_date, template_id) WHERE assigned_to IS NOT NULL AND template_id IS NOT NULL
        DO NOTHING
      `, [wedDate]);

      await client.query(`
        INSERT INTO shift_segments (shift_id, starts_at, ends_at, sort_order)
        VALUES ('dddddddd-0000-0000-0000-000000000002', $1, $2, 0)
        ON CONFLICT (shift_id, starts_at, ends_at) DO NOTHING
      `, [`${wedDate}T05:00:00Z`, `${wedDate}T10:00:00Z`]);

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
