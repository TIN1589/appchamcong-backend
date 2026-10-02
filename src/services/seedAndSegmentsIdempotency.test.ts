import { describe, it, expect } from 'vitest';
import { query } from '../db/client.js';
import { seed } from '../db/seed.js';
import { rosterGenerationService } from './rosterGeneration.service.js';

describe('Seed & Shift Segments Idempotency (§1.2 & §1.3)', () => {
  it('chạy seed 2 lần liên tiếp -> số segments không đổi và không có bản ghi trùng lặp', async () => {
    // Chạy seed lần 1
    await seed();

    const tplSegCount1 = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM shift_template_segments',
    );
    const seedShiftSegs1 = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM shift_segments WHERE shift_id IN ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002')`,
    );

    // Chạy seed lần 2
    await seed();

    const tplSegCount2 = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM shift_template_segments',
    );
    const seedShiftSegs2 = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM shift_segments WHERE shift_id IN ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002')`,
    );

    expect(Number(tplSegCount2.rows[0]?.count)).toBe(Number(tplSegCount1.rows[0]?.count));
    expect(Number(seedShiftSegs2.rows[0]?.count)).toBe(Number(seedShiftSegs1.rows[0]?.count));
    expect(Number(seedShiftSegs2.rows[0]?.count)).toBe(2);

    // Kiểm tra HAVING COUNT(*) > 1 trên shift_segments
    const dupShiftSegs = await query(
      `SELECT shift_id, starts_at, ends_at, COUNT(*)
       FROM shift_segments
       GROUP BY shift_id, starts_at, ends_at
       HAVING COUNT(*) > 1`,
    );
    expect(dupShiftSegs.rows.length).toBe(0);

    // Kiểm tra HAVING COUNT(*) > 1 trên shift_template_segments
    const dupTplSegs = await query(
      `SELECT template_id, start_time, end_time, COUNT(*)
       FROM shift_template_segments
       GROUP BY template_id, start_time, end_time
       HAVING COUNT(*) > 1`,
    );
    expect(dupTplSegs.rows.length).toBe(0);
  }, 30000);

  it('định nghĩa template: Ca sáng/chiều/tối = 1 segment, Ca gãy = đúng 2 segments (10:00–14:00, 17:00–22:00)', async () => {
    const tpls = await query<{ id: string; name: string; shift_type: string; seg_count: string }>(
      `SELECT t.id, t.name, t.shift_type, COUNT(s.id) as seg_count
       FROM shift_templates t
       JOIN shift_template_segments s ON t.id = s.template_id
       GROUP BY t.id, t.name, t.shift_type
       ORDER BY t.name`,
    );

    for (const t of tpls.rows) {
      const segCount = Number(t.seg_count);
      if (t.name.includes('Ca gãy')) {
        expect(t.shift_type).toBe('SPLIT');
        expect(segCount).toBe(2);

        const segs = await query<{ start_time: string; end_time: string }>(
          `SELECT start_time::text, end_time::text FROM shift_template_segments WHERE template_id = $1 ORDER BY start_time`,
          [t.id],
        );
        expect(segs.rows[0]?.start_time).toBe('10:00:00');
        expect(segs.rows[0]?.end_time).toBe('14:00:00');
        expect(segs.rows[1]?.start_time).toBe('17:00:00');
        expect(segs.rows[1]?.end_time).toBe('22:00:00');
      } else {
        expect(t.shift_type).toBe('REGULAR');
        expect(segCount).toBe(1);
      }
    }
  });

  it('sinh lịch tuần generateWeek 2 lần liên tiếp -> số segments không đổi', async () => {
    const TEST_STORE_ID = 1;
    const TEST_WEEK = '2027-01-04'; // Tuần Thứ Hai độc lập năm 2027

    await query("DELETE FROM shifts WHERE work_date >= '2027-01-04' AND work_date <= '2027-01-10'");

    // Sinh lịch lần 1
    const run1 = await rosterGenerationService.generateWeek(TEST_STORE_ID, TEST_WEEK);
    expect(run1.createdCount).toBeGreaterThan(0);

    const segCount1 = await query<{ count: string }>(
      `SELECT COUNT(ss.id) as count
       FROM shifts s
       JOIN shift_segments ss ON s.id = ss.shift_id
       WHERE s.store_id = $1 AND s.work_date >= '2027-01-04' AND s.work_date <= '2027-01-10'`,
      [TEST_STORE_ID],
    );

    // Sinh lịch lần 2
    const run2 = await rosterGenerationService.generateWeek(TEST_STORE_ID, TEST_WEEK);
    expect(run2.createdCount).toBe(0);

    const segCount2 = await query<{ count: string }>(
      `SELECT COUNT(ss.id) as count
       FROM shifts s
       JOIN shift_segments ss ON s.id = ss.shift_id
       WHERE s.store_id = $1 AND s.work_date >= '2027-01-04' AND s.work_date <= '2027-01-10'`,
      [TEST_STORE_ID],
    );

    expect(Number(segCount2.rows[0]?.count)).toBe(Number(segCount1.rows[0]?.count));

    // Dọn dẹp sau test
    await query("DELETE FROM shifts WHERE work_date >= '2027-01-04' AND work_date <= '2027-01-10'");
  }, 30000);
});
