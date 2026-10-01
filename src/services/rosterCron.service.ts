import { rosterGenerationService } from './rosterGeneration.service.js';
import { logger } from '../lib/logger.js';

let cronInterval: ReturnType<typeof setInterval> | null = null;
let lastTriggerKey = '';

/**
 * Cron runner tự động sinh lịch tuần kế tiếp vào Thứ Sáu 18:00 ICT (SRS v1.1 Delta §1)
 */
export function startRosterCron(): void {
  if (cronInterval) return;

  cronInterval = setInterval(async () => {
    try {
      const now = new Date();
      // Chuyển đổi sang giờ ICT (UTC+7)
      const vnMs = now.getTime() + 7 * 60 * 60 * 1000;
      const vnDate = new Date(vnMs);

      const dayOfWeek = vnDate.getUTCDay(); // 5 = Friday
      const hour = vnDate.getUTCHours(); // 18
      const minute = vnDate.getUTCMinutes(); // 0

      const key = `${vnDate.toISOString().slice(0, 10)}_${hour}_${minute}`;

      // Đúng Thứ Sáu 18:00 ICT (chỉ chạy 1 lần trong phút đó)
      if (dayOfWeek === 5 && hour === 18 && minute === 0 && lastTriggerKey !== key) {
        lastTriggerKey = key;
        logger.info('[Roster Cron] Thứ Sáu 18:00 ICT — Bắt đầu tự động tạo lịch tuần kế tiếp...');
        await rosterGenerationService.generateWeek(1);
      }
    } catch (err) {
      logger.error({ err }, '[Roster Cron] Lỗi khi thực thi cron tạo lịch');
    }
  }, 30_000);

  logger.info('[Roster Cron] Đã khởi động cron tự động sinh lịch (Thứ Sáu 18:00 ICT)');
}

export function stopRosterCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    logger.info('[Roster Cron] Đã dừng cron');
  }
}
