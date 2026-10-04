/**
 * Race condition test cho shiftsRepository.assignToUser
 *
 * Yeu cau: Docker Postgres dang chay voi migration da ap dung.
 * Chay: DATABASE_URL=postgres://... npm run test:race
 *
 * Muc dich: chung minh SELECT ... FOR UPDATE trong assignToUser
 * chan duoc concurrent gan cung mot ca - dieu KHONG the kiem tra
 * bang mock service o tang route.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { query, withTransaction } from '../db/client.js';
import { shiftsRepository } from './shifts.repository.js';

const isExplicitRaceRun =
  process.env['RUN_RACE_TESTS'] === 'true' ||
  process.argv.some((arg) => arg.includes('race'));

const HAS_DB =
  isExplicitRaceRun &&
  (!!process.env['DATABASE_URL'] || !!process.env['POSTGRES_HOST']);

const describeIfDb = HAS_DB ? describe : describe.skip;

const STORE_ID = 1;
const ADMIN_ID = '99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STAFF_A  = '99999999-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STAFF_B  = '99999999-cccc-cccc-cccc-cccccccccccc';
const WORK_DATE = '2099-12-31';

let testShiftId: string;

describeIfDb('shiftsRepository.assignToUser - race condition voi Postgres that', () => {
  beforeAll(async () => {
    await query('SELECT 1');
    // Dọn dẹp dữ liệu thử nghiệm cũ nếu còn sót lại từ lần chạy trước
    await query(
      `DELETE FROM shift_segments WHERE shift_id IN (
         SELECT id FROM shifts WHERE created_by = $1 OR assigned_to IN ($2, $3)
       )`,
      [ADMIN_ID, STAFF_A, STAFF_B],
    );
    await query(
      `DELETE FROM shifts WHERE created_by = $1 OR assigned_to IN ($2, $3)`,
      [ADMIN_ID, STAFF_A, STAFF_B],
    );
    await query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [ADMIN_ID, STAFF_A, STAFF_B]);

    await query(
      `INSERT INTO users (id, store_id, full_name, email, password_hash, role)
       VALUES ($1, $2, 'Admin Test', 'admin_race@test.local', 'x', 'admin'),
              ($3, $2, 'Staff A',   'staffa_race@test.local', 'x', 'staff'),
              ($4, $2, 'Staff B',   'staffb_race@test.local', 'x', 'staff')
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN_ID, STORE_ID, STAFF_A, STAFF_B],
    );
  });

  beforeEach(async () => {
    const res = await query<{ id: string }>(
      `INSERT INTO shifts (store_id, status, work_date, source, shift_type, created_by)
       VALUES ($1, 'open', $2, 'manual', 'REGULAR', $3) RETURNING id`,
      [STORE_ID, WORK_DATE, ADMIN_ID],
    );
    testShiftId = res.rows[0]!.id;
    await query(
      `INSERT INTO shift_segments (shift_id, starts_at, ends_at, sort_order)
       VALUES ($1, '2099-12-31 01:00:00+00', '2099-12-31 10:00:00+00', 0)`,
      [testShiftId],
    );
  });

  afterAll(async () => {
    await query(
      `DELETE FROM shift_segments WHERE shift_id IN (
         SELECT id FROM shifts WHERE created_by = $1 OR assigned_to IN ($2, $3)
       )`,
      [ADMIN_ID, STAFF_A, STAFF_B],
    );
    await query(
      `DELETE FROM shifts WHERE created_by = $1 OR assigned_to IN ($2, $3)`,
      [ADMIN_ID, STAFF_A, STAFF_B],
    );
    await query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [ADMIN_ID, STAFF_A, STAFF_B]);
  });

  it('2 request gan cung ca dong thoi - chi 1 thanh cong, DB chi co 1 ban ghi scheduled', async () => {
    const [r1, r2] = await Promise.allSettled([
      shiftsRepository.assignToUser(testShiftId, STORE_ID, STAFF_A),
      shiftsRepository.assignToUser(testShiftId, STORE_ID, STAFF_B),
    ]);

    const successes = [r1, r2].filter((r) => r.status === 'fulfilled' && r.value !== null);
    const failures  = [r1, r2].filter((r) => r.status === 'fulfilled' && r.value === null);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const dbCheck = await query<{ status: string; assigned_to: string }>(
      `SELECT status, assigned_to FROM shifts WHERE id = $1`,
      [testShiftId],
    );
    expect(dbCheck.rows[0]?.status).toBe('scheduled');
    expect([STAFF_A, STAFF_B]).toContain(dbCheck.rows[0]?.assigned_to);
  });

  it('withTransaction tu ROLLBACK khi co loi - shift van open', async () => {
    await expect(
      withTransaction(async (client) => {
        await client.query(`SELECT * FROM shifts WHERE id = $1 FOR UPDATE`, [testShiftId]);
        throw new Error('Loi gia lap giua transaction');
      }),
    ).rejects.toThrow('Loi gia lap');

    const check = await query<{ status: string }>(
      `SELECT status FROM shifts WHERE id = $1`,
      [testShiftId],
    );
    expect(check.rows[0]?.status).toBe('open');
  });
});