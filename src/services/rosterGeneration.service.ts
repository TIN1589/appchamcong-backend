import { withTransaction, query } from '../db/client.js';
import { getDaysOfWeek, getWeekRange, parseVNDate, addDaysVietnam } from '../lib/timezone.js';
import { logger } from '../lib/logger.js';

export interface GenerateWeekResult {
  storeId: number;
  weekStart: string;
  days: string[];
  createdCount: number;
  skippedCount: number;
  onLeaveCount: number;
}

function buildSegmentTime(workDate: string, timeStr: string): Date {
  const parts = workDate.split('-').map(Number);
  const y = parts[0] ?? 2026;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const [h, min] = timeStr.split(':').map(Number);
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const localMs = Date.UTC(y, m - 1, d, h ?? 0, min ?? 0, 0, 0);
  return new Date(localMs - VN_OFFSET_MS);
}

export const rosterGenerationService = {
  /**
   * Sinh lịch tuần từ cấu hình ca mặc định (staff_default_shifts)
   * Đảm bảo tính Idempotent: chạy nhiều lần không trùng, không ghi đè ca manual/swap.
   * Nhân viên có đơn nghỉ phép approved trong ngày sẽ được đánh dấu status = 'leave_approved'.
   */
  async generateWeek(storeId: number, weekStartStr?: string): Promise<GenerateWeekResult> {
    let weekStart = weekStartStr;
    if (!weekStart) {
      const curMonday = getWeekRange().startDate;
      weekStart = addDaysVietnam(curMonday, 7);
    } else {
      weekStart = getWeekRange(parseVNDate(weekStart)).startDate;
    }

    const days = getDaysOfWeek(weekStart);

    return withTransaction(async (client) => {
      // 1. Lấy danh sách ca mặc định của nhân viên đang active
      const defaultsRes = await client.query<{
        id: number;
        store_id: number;
        user_id: string;
        weekday: number;
        shift_template_id: string;
      }>(
        `SELECT d.id, d.store_id, d.user_id, d.weekday, d.shift_template_id
         FROM staff_default_shifts d
         JOIN users u ON u.id = d.user_id
         WHERE d.store_id = $1 AND u.is_active = TRUE`,
        [storeId],
      );
      const defaults = defaultsRes.rows;

      // 2. Lấy danh sách ngày nghỉ phép đã duyệt trong tuần
      const leavesRes = await client.query<{
        user_id: string;
        start_date: string;
        end_date: string;
      }>(
        `SELECT user_id, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
         FROM leaves
         WHERE store_id = $1
           AND status = 'approved'
           AND start_date <= $2
           AND end_date >= $3`,
        [storeId, days[6], days[0]],
      );

      const onLeave = new Set<string>();
      for (const leave of leavesRes.rows) {
        for (const day of days) {
          if (day >= leave.start_date && day <= leave.end_date) {
            onLeave.add(`${leave.user_id}:${day}`);
          }
        }
      }

      // 3. Cache các segments và loại ca của templates
      const templateIds = [...new Set(defaults.map((d) => d.shift_template_id))];
      const templateMeta = new Map<
        string,
        {
          shift_type: 'REGULAR' | 'SPLIT' | 'FLEXIBLE';
          segs: Array<{ start_time: string; end_time: string; sort_order: number }>;
        }
      >();
      if (templateIds.length > 0) {
        const tplRes = await client.query<{ id: string; shift_type: 'REGULAR' | 'SPLIT' | 'FLEXIBLE' }>(
          `SELECT id, COALESCE(shift_type, 'REGULAR') AS shift_type
           FROM shift_templates
           WHERE id = ANY($1::uuid[])`,
          [templateIds],
        );
        for (const t of tplRes.rows) {
          templateMeta.set(t.id, { shift_type: t.shift_type, segs: [] });
        }

        const segsRes = await client.query<{
          template_id: string;
          start_time: string;
          end_time: string;
          sort_order: number;
        }>(
          `SELECT template_id, start_time, end_time, sort_order
           FROM shift_template_segments
           WHERE template_id = ANY($1::uuid[])
           ORDER BY sort_order ASC`,
          [templateIds],
        );
        for (const s of segsRes.rows) {
          const meta = templateMeta.get(s.template_id);
          if (meta) {
            meta.segs.push({ start_time: s.start_time, end_time: s.end_time, sort_order: s.sort_order });
          }
        }
      }

      let createdCount = 0;
      let skippedCount = 0;
      let onLeaveCount = 0;

      const adminRes = await client.query<{ id: string }>(
        "SELECT id FROM users WHERE store_id = $1 AND role = 'admin' LIMIT 1",
        [storeId],
      );
      const systemAdminId = adminRes.rows[0]?.id ?? '00000000-0000-0000-0000-000000000001';

      for (const d of defaults) {
        const workDate = days[d.weekday - 1]!;
        const isOnLeave = onLeave.has(`${d.user_id}:${workDate}`);
        const status = isOnLeave ? 'leave_approved' : 'scheduled';
        const meta = templateMeta.get(d.shift_template_id);
        const shiftType = meta?.shift_type ?? 'REGULAR';

        // ON CONFLICT DO NOTHING đảm bảo idempotent không ghi đè manual/swap
        const insertShiftRes = await client.query<{ id: string }>(
          `INSERT INTO shifts
             (store_id, template_id, assigned_to, work_date, source, status, shift_type, created_by)
           VALUES ($1, $2, $3, $4, 'default', $5, $6, $7)
           ON CONFLICT (assigned_to, work_date, template_id) WHERE assigned_to IS NOT NULL AND template_id IS NOT NULL
           DO NOTHING
           RETURNING id`,
          [d.store_id, d.shift_template_id, d.user_id, workDate, status, shiftType, systemAdminId],
        );

        const insertedShift = insertShiftRes.rows[0];
        if (insertedShift) {
          createdCount++;
          if (isOnLeave) onLeaveCount++;

          const segs = meta?.segs ?? [];
          for (let i = 0; i < segs.length; i++) {
            const seg = segs[i]!;
            const startsAt = buildSegmentTime(workDate, seg.start_time);
            const endsAt = buildSegmentTime(workDate, seg.end_time);

            await client.query(
              `INSERT INTO shift_segments (shift_id, starts_at, ends_at, sort_order)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (shift_id, starts_at, ends_at) DO NOTHING`,
              [insertedShift.id, startsAt.toISOString(), endsAt.toISOString(), seg.sort_order ?? i],
            );
          }
        } else {
          skippedCount++;
        }
      }

      logger.info(
        { storeId, weekStart, createdCount, skippedCount, onLeaveCount },
        'generateWeek completed',
      );

      return {
        storeId,
        weekStart,
        days,
        createdCount,
        skippedCount,
        onLeaveCount,
      };
    });
  },

  /**
   * Kiểm tra và sinh bù lịch tuần kế tiếp khi server khởi động
   */
  async checkAndCatchUpNextWeek(storeId: number = 1): Promise<boolean> {
    const curMonday = getWeekRange().startDate;
    const nextWeekMonday = addDaysVietnam(curMonday, 7);
    const nextWeekSunday = addDaysVietnam(nextWeekMonday, 6);

    const checkRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM shifts
       WHERE store_id = $1
         AND source = 'default'
         AND work_date >= $2 AND work_date <= $3`,
      [storeId, nextWeekMonday, nextWeekSunday],
    );

    const count = parseInt(checkRes.rows[0]?.count ?? '0', 10);
    if (count === 0) {
      logger.info(
        { storeId, nextWeekMonday },
        '[Roster Catch-Up] Tuần kế tiếp chưa có ca mặc định, tiến hành sinh lịch...',
      );
      await this.generateWeek(storeId, nextWeekMonday);
      return true;
    }

    logger.info(
      { storeId, nextWeekMonday, count },
      '[Roster Catch-Up] Tuần kế tiếp đã có ca mặc định, bỏ qua sinh bù.',
    );
    return false;
  },
};
