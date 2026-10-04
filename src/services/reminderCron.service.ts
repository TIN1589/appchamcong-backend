import { query } from '../db/client.js';
import { telegramService } from './telegram.service.js';
import { auditRepository } from '../repositories/audit.repository.js';
import { logger } from '../lib/logger.js';

const formatHHMM = (t: string): string => t.slice(0, 5);

interface ShiftReminderCandidate {
  shift_id: string;
  store_id: number;
  user_id: string;
  user_name: string;
  telegram_chat_id: string | null;
  work_date: string;
  template_name: string | null;
  start_time: string;
  end_time: string;
}

interface MissingCheckoutCandidate {
  attendance_id: string;
  user_id: string;
  user_name: string;
  work_date: string;
  shift_id: string;
  template_name: string | null;
  start_time: string;
  end_time: string;
}

export class ReminderCronService {
  private reminderInterval: ReturnType<typeof setInterval> | null = null;
  private readonly remindedShiftCache = new Set<string>();

  /**
   * Quét ca làm việc sắp diễn ra trong vòng 60 phút tới và gửi tin nhắc qua Telegram
   */
  public async scanAndSendShiftReminders(): Promise<number> {
    try {
      const now = new Date();
      // Chuyển sang giờ ICT
      const vnMs = now.getTime() + 7 * 60 * 60 * 1000;
      const vnDate = new Date(vnMs);
      const todayStr = vnDate.toISOString().slice(0, 10);

      const currentMinutes = vnDate.getUTCHours() * 60 + vnDate.getUTCMinutes();
      const lookaheadMinutes = currentMinutes + 60;

      // Tìm ca trong ngày hôm nay có trạng thái 'assigned', có người được gán
      const result = await query<ShiftReminderCandidate>(
        `SELECT 
            s.id AS shift_id,
            s.store_id,
            u.id AS user_id,
            u.full_name AS user_name,
            u.telegram_chat_id,
            s.work_date::text AS work_date,
            st.name AS template_name,
            COALESCE(MIN(seg.start_time)::text, '08:00:00') AS start_time,
            COALESCE(MAX(seg.end_time)::text, '17:00:00') AS end_time
         FROM shifts s
         JOIN users u ON s.assigned_to = u.id
         LEFT JOIN shift_templates st ON s.template_id = st.id
         LEFT JOIN shift_template_segments seg ON st.id = seg.template_id
         WHERE s.work_date = $1::date
           AND s.status = 'assigned'
           AND u.is_active = true
           AND u.telegram_chat_id IS NOT NULL
         GROUP BY s.id, s.store_id, u.id, u.full_name, u.telegram_chat_id, s.work_date, st.name`,
        [todayStr],
      );

      let sentCount = 0;

      for (const row of result.rows) {
        const cacheKey = `${row.shift_id}_${row.work_date}`;
        if (this.remindedShiftCache.has(cacheKey)) continue;

        // Tính phút bắt đầu của ca
        const [h, m] = row.start_time.split(':').map((v) => parseInt(v, 10));
        const shiftStartMinutes = (h ?? 0) * 60 + (m ?? 0);

        // Nếu ca bắt đầu trong khoảng từ bây giờ đến 60 phút tới
        if (shiftStartMinutes >= currentMinutes && shiftStartMinutes <= lookaheadMinutes) {
          const timeRange = `${formatHHMM(row.start_time)} - ${formatHHMM(row.end_time)}`;

          if (row.telegram_chat_id) {
            await telegramService.notifyShiftReminder({
              chatId: row.telegram_chat_id,
              userName: row.user_name,
              workDate: row.work_date,
              timeRange: row.template_name ? `${row.template_name} (${timeRange})` : timeRange,
            });
            sentCount++;
          }

          this.remindedShiftCache.add(cacheKey);
        }
      }

      if (sentCount > 0) {
        logger.info({ sentCount }, '[Reminder Cron] Đã gửi thông báo nhắc ca làm việc qua Telegram');
      }

      return sentCount;
    } catch (err: unknown) {
      logger.error({ err }, '[Reminder Cron] Lỗi khi quét nhắc ca làm việc');
      return 0;
    }
  }

  /**
   * Quét các ca quá 120 phút kết thúc mà nhân viên quên check-out (security.md §5.1)
   */
  public async scanMissingCheckout(): Promise<number> {
    try {
      // Tìm các bản ghi chấm công chưa check out, đã quá 2 tiếng kể từ giờ kết thúc ca
      const result = await query<MissingCheckoutCandidate>(
        `WITH shift_ends AS (
            SELECT 
              s.id AS shift_id,
              s.work_date,
              s.store_id,
              st.name AS template_name,
              COALESCE(MIN(seg.start_time)::text, '08:00:00') AS start_time,
              COALESCE(MAX(seg.end_time)::text, '17:00:00') AS end_time,
              (s.work_date + COALESCE(MAX(seg.end_time), '17:00:00'::time)) AT TIME ZONE 'Asia/Ho_Chi_Minh' AS end_timestamp
            FROM shifts s
            LEFT JOIN shift_templates st ON s.template_id = st.id
            LEFT JOIN shift_template_segments seg ON st.id = seg.template_id
            GROUP BY s.id, s.work_date, s.store_id, st.name
         ),
         updated_attendances AS (
            UPDATE attendances a
            SET needs_review = TRUE,
                flags = array_append(a.flags, 'missing_checkout')
            FROM shift_ends se, users u
            WHERE a.shift_id = se.shift_id
              AND a.user_id = u.id
              AND a.checkout_at IS NULL
              AND NOT ('missing_checkout' = ANY(a.flags))
              AND NOW() > se.end_timestamp + INTERVAL '2 hours'
            RETURNING 
              a.id AS attendance_id,
              a.user_id,
              u.full_name AS user_name,
              se.work_date::text AS work_date,
              se.shift_id,
              se.template_name,
              se.start_time,
              se.end_time
         )
         SELECT * FROM updated_attendances`,
      );

      for (const row of result.rows) {
        // Ghi Audit Log bắt buộc theo security.md §6
        await auditRepository.log({
          userId: row.user_id,
          action: 'MISSING_CHECKOUT',
          detail: {
            attendanceId: row.attendance_id,
            shiftId: row.shift_id,
            workDate: row.work_date,
          },
        });

        // Gửi Telegram cảnh báo cho Quản lý
        const timeRange = `${formatHHMM(row.start_time)} - ${formatHHMM(row.end_time)}`;
        await telegramService.notifyMissingCheckout({
          userName: row.user_name,
          workDate: row.work_date,
          timeRange: row.template_name ? `${row.template_name} (${timeRange})` : timeRange,
          attendanceId: row.attendance_id,
        });
      }

      if (result.rows.length > 0) {
        logger.warn(
          { count: result.rows.length },
          '[Missing Checkout Cron] Phát hiện và gắn cờ các ca quên check-out',
        );
      }

      return result.rows.length;
    } catch (err: unknown) {
      logger.error({ err }, '[Missing Checkout Cron] Lỗi khi quét missing checkout');
      return 0;
    }
  }

  /**
   * Khởi chạy định kỳ mỗi 5 phút
   */
  public startCron(): void {
    if (this.reminderInterval) return;

    this.reminderInterval = setInterval(async () => {
      await this.scanAndSendShiftReminders();
      await this.scanMissingCheckout();
    }, 5 * 60 * 1000);

    logger.info('[Reminder & Missing Checkout Cron] Đã khởi động runner (chu kỳ 5 phút)');
  }

  public stopCron(): void {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
      logger.info('[Reminder & Missing Checkout Cron] Đã dừng runner');
    }
  }
}

export const reminderCronService = new ReminderCronService();
