import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rosterGenerationService } from './rosterGeneration.service.js';
import { query } from '../db/client.js';

describe('rosterGenerationService (§1 & §8 SRS v1.1 Delta)', () => {
  const TEST_STORE_ID = 1;
  const TEST_WEEK_1 = '2026-11-02'; // Thứ Hai
  const TEST_WEEK_2 = '2026-11-09'; // Thứ Hai

  beforeAll(async () => {
    // Dọn dẹp dữ liệu test cũ nếu có
    await query("DELETE FROM shifts WHERE work_date >= '2026-11-01' AND work_date <= '2026-11-30'");
    await query("DELETE FROM leaves WHERE start_date >= '2026-11-01' AND start_date <= '2026-11-30'");
  });

  afterAll(async () => {
    await query("DELETE FROM shifts WHERE work_date >= '2026-11-01' AND work_date <= '2026-11-30'");
    await query("DELETE FROM leaves WHERE start_date >= '2026-11-01' AND start_date <= '2026-11-30'");
  });

  it('chạy generateWeek hai lần liên tiếp không tạo dòng trùng (idempotent)', async () => {
    // Lần 1: Tạo lịch tuần từ staff_default_shifts
    const run1 = await rosterGenerationService.generateWeek(TEST_STORE_ID, TEST_WEEK_1);
    expect(run1.createdCount).toBeGreaterThan(0);

    // Đếm số ca thực tế trong tuần 1
    const countRes1 = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM shifts WHERE store_id = $1 AND work_date >= '2026-11-02' AND work_date <= '2026-11-08'",
      [TEST_STORE_ID],
    );
    const totalShifts1 = parseInt(countRes1.rows[0]?.count ?? '0', 10);
    expect(totalShifts1).toBe(run1.createdCount);

    // Lần 2: Chạy lại ngay lập tức
    const run2 = await rosterGenerationService.generateWeek(TEST_STORE_ID, TEST_WEEK_1);
    expect(run2.createdCount).toBe(0);
    expect(run2.skippedCount).toBe(run1.createdCount);

    // Số ca trong DB vẫn giữ nguyên, không có dòng trùng
    const countRes2 = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM shifts WHERE store_id = $1 AND work_date >= '2026-11-02' AND work_date <= '2026-11-08'",
      [TEST_STORE_ID],
    );
    const totalShifts2 = parseInt(countRes2.rows[0]?.count ?? '0', 10);
    expect(totalShifts2).toBe(totalShifts1);
  });

  it('không bao giờ ghi đè dòng có source manual/swap', async () => {
    // Tạo trước 1 ca manual cho Nguyễn Văn An vào Thứ Hai tuần 2
    const anUserId = '00000000-0000-0000-0000-000000000002';
    const tplSg = 'aaaaaaaa-0000-0000-0000-000000000001';

    await query(
      `INSERT INTO shifts
         (store_id, template_id, assigned_to, work_date, source, status, notes, created_by)
       VALUES ($1, $2, $3, $4, 'manual', 'scheduled', 'Ca do Admin xếp tay đặc biệt', '00000000-0000-0000-0000-000000000001')`,
      [TEST_STORE_ID, tplSg, anUserId, TEST_WEEK_2],
    );

    // Chạy generateWeek cho tuần 2
    const run = await rosterGenerationService.generateWeek(TEST_STORE_ID, TEST_WEEK_2);
    expect(run.createdCount).toBeGreaterThan(0);

    // Kiểm tra dòng ca manual của An vẫn giữ nguyên source='manual' và notes
    const shiftRes = await query<{ source: string; notes: string; status: string }>(
      `SELECT source, notes, status FROM shifts
       WHERE store_id = $1 AND assigned_to = $2 AND work_date = $3 AND template_id = $4`,
      [TEST_STORE_ID, anUserId, TEST_WEEK_2, tplSg],
    );
    expect(shiftRes.rows[0]?.source).toBe('manual');
    expect(shiftRes.rows[0]?.notes).toBe('Ca do Admin xếp tay đặc biệt');
    expect(shiftRes.rows[0]?.status).toBe('scheduled');
  });

  it('người có nghỉ phép đã duyệt được sinh với status = leave_approved', async () => {
    const WEEK_3 = '2026-11-16'; // Thứ Hai
    const cuongUserId = '00000000-0000-0000-0000-000000000004';

    // Tạo đơn nghỉ phép đã duyệt cho Cường vào Thứ Hai 2026-11-16
    await query(
      `INSERT INTO leaves (id, store_id, user_id, start_date, end_date, days_count, reason, status)
       VALUES ('cccccccc-1111-0000-0000-000000000001', 1, $1, $2, $2, 1, 'Nghỉ phép test', 'approved')`,
      [cuongUserId, WEEK_3],
    );

    // Chạy generateWeek
    const run = await rosterGenerationService.generateWeek(TEST_STORE_ID, WEEK_3);
    expect(run.onLeaveCount).toBeGreaterThan(0);

    // Kiểm tra ca tối của Cường vào ngày này có status = 'leave_approved'
    const shiftRes = await query<{ status: string }>(
      `SELECT status FROM shifts
       WHERE store_id = $1 AND assigned_to = $2 AND work_date = $3`,
      [TEST_STORE_ID, cuongUserId, WEEK_3],
    );
    expect(shiftRes.rows[0]?.status).toBe('leave_approved');

    // Dọn dẹp
    await query("DELETE FROM shifts WHERE work_date >= '2026-11-16' AND work_date <= '2026-11-22'");
    await query("DELETE FROM leaves WHERE start_date >= '2026-11-16' AND start_date <= '2026-11-22'");
  });
});
