/**
 * Race condition test cho swapRepository.claimPoolShiftWithLock
 *
 * Yêu cầu: Docker Postgres đang chạy với migration đã áp dụng.
 * Chạy: DATABASE_URL=postgres://... npm run test:race
 *
 * Mục đích: Chứng minh SELECT ... FOR UPDATE trong claimPoolShiftWithLock
 * chặn được concurrent claim cùng một ca từ Shift Pool - chỉ 1 người thành công.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { query } from '../db/client.js';
import { swapRepository } from './swap.repository.js';

const isExplicitRaceRun =
  process.env['RUN_RACE_TESTS'] === 'true' ||
  process.argv.some((arg) => arg.includes('race'));

const HAS_DB =
  isExplicitRaceRun &&
  (!!process.env['DATABASE_URL'] || !!process.env['POSTGRES_HOST']);

const describeIfDb = HAS_DB ? describe : describe.skip;

const STORE_ID = 1;
const OWNER_ID  = '88888888-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLAIMER_A = '88888888-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CLAIMER_B = '88888888-cccc-cccc-cccc-cccccccccccc';
const WORK_DATE = '2099-12-30';

let testShiftId: string;
let testSwapRequestId: string;

describeIfDb('swapRepository.claimPoolShiftWithLock - race condition với Postgres thật', () => {
  beforeAll(async () => {
    await query('SELECT 1');
    // Dọn dẹp dữ liệu thử nghiệm cũ nếu còn
    await query(
      `DELETE FROM swap_requests WHERE requester_id = $1 OR receiver_id IN ($2, $3)`,
      [OWNER_ID, CLAIMER_A, CLAIMER_B],
    );
    await query(
      `DELETE FROM shift_segments WHERE shift_id IN (
         SELECT id FROM shifts WHERE created_by = $1 OR assigned_to IN ($1, $2, $3)
       )`,
      [OWNER_ID, CLAIMER_A, CLAIMER_B],
    );
    await query(
      `DELETE FROM shifts WHERE created_by = $1 OR assigned_to IN ($1, $2, $3)`,
      [OWNER_ID, CLAIMER_A, CLAIMER_B],
    );
    await query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [OWNER_ID, CLAIMER_A, CLAIMER_B]);

    await query(
      `INSERT INTO users (id, store_id, full_name, email, password_hash, role)
       VALUES ($1, $2, 'Owner Race',   'owner_race@test.local',   'x', 'staff'),
              ($3, $2, 'Claimer A',    'claimera_race@test.local', 'x', 'staff'),
              ($4, $2, 'Claimer B',    'claimerb_race@test.local', 'x', 'staff')
       ON CONFLICT (id) DO NOTHING`,
      [OWNER_ID, STORE_ID, CLAIMER_A, CLAIMER_B],
    );
  });

  beforeEach(async () => {
    // 1. Tạo ca của Owner
    const sRes = await query<{ id: string }>(
      `INSERT INTO shifts (store_id, status, work_date, source, shift_type, created_by, assigned_to)
       VALUES ($1, 'scheduled', $2, 'manual', 'REGULAR', $3, $3) RETURNING id`,
      [STORE_ID, WORK_DATE, OWNER_ID],
    );
    testShiftId = sRes.rows[0]!.id;

    await query(
      `INSERT INTO shift_segments (shift_id, starts_at, ends_at, sort_order)
       VALUES ($1, '2099-12-30 01:00:00+00', '2099-12-30 10:00:00+00', 0)`,
      [testShiftId],
    );

    // 2. Tạo đơn swap pool
    const rRes = await query<{ id: string }>(
      `INSERT INTO swap_requests (
         store_id, requester_id, requester_shift, status, type, expires_at
       )
       VALUES ($1, $2, $3, 'pending', 'pool', '2099-12-28 01:00:00+00')
       RETURNING id`,
      [STORE_ID, OWNER_ID, testShiftId],
    );
    testSwapRequestId = rRes.rows[0]!.id;
  });

  afterAll(async () => {
    await query(
      `DELETE FROM swap_requests WHERE requester_id = $1 OR receiver_id IN ($2, $3)`,
      [OWNER_ID, CLAIMER_A, CLAIMER_B],
    );
    await query(
      `DELETE FROM shift_segments WHERE shift_id IN (
         SELECT id FROM shifts WHERE created_by = $1 OR assigned_to IN ($1, $2, $3)
       )`,
      [OWNER_ID, CLAIMER_A, CLAIMER_B],
    );
    await query(
      `DELETE FROM shifts WHERE created_by = $1 OR assigned_to IN ($1, $2, $3)`,
      [OWNER_ID, CLAIMER_A, CLAIMER_B],
    );
    await query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [OWNER_ID, CLAIMER_A, CLAIMER_B]);
  });

  it('2 nhân viên đồng thời nhận 1 ca từ Shift Pool -> chỉ 1 người thành công, 1 người nhận null', async () => {
    const [r1, r2] = await Promise.allSettled([
      swapRepository.claimPoolShiftWithLock(testSwapRequestId, STORE_ID, CLAIMER_A),
      swapRepository.claimPoolShiftWithLock(testSwapRequestId, STORE_ID, CLAIMER_B),
    ]);

    const successes = [r1, r2].filter((r) => r.status === 'fulfilled' && r.value !== null);
    const failures  = [r1, r2].filter((r) => r.status === 'fulfilled' && r.value === null);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // Kiểm tra DB thật: ca đã được gán cho người thắng và đơn đã approved
    const checkShift = await query<{ assigned_to: string }>(
      `SELECT assigned_to FROM shifts WHERE id = $1`,
      [testShiftId],
    );
    expect([CLAIMER_A, CLAIMER_B]).toContain(checkShift.rows[0]?.assigned_to);

    const checkReq = await query<{ status: string; receiver_id: string }>(
      `SELECT status, receiver_id FROM swap_requests WHERE id = $1`,
      [testSwapRequestId],
    );
    expect(checkReq.rows[0]?.status).toBe('approved');
    expect(checkReq.rows[0]?.receiver_id).toBe(checkShift.rows[0]?.assigned_to);
  });
});
