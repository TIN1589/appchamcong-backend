import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReminderCronService } from './reminderCron.service.js';
import { telegramService } from './telegram.service.js';
import { auditRepository } from '../repositories/audit.repository.js';
import * as dbClient from '../db/client.js';

describe('ReminderCronService (Unit Tests)', () => {
  let reminderCron: ReminderCronService;

  beforeEach(() => {
    vi.restoreAllMocks();
    reminderCron = new ReminderCronService();
  });

  describe('1. Quét ca sắp bắt đầu (scanAndSendShiftReminders)', () => {
    it('Phát hiện ca trong vòng 60 phút tới và gửi tin nhắn nhắc ca qua Telegram', async () => {
      // Giả lập giờ hiện tại là 07:30 ICT
      const now = new Date();
      const vnMs = now.getTime() + 7 * 60 * 60 * 1000;
      const vnDate = new Date(vnMs);
      const currentH = vnDate.getUTCHours();
      const currentM = vnDate.getUTCMinutes();

      // Ca bắt đầu sau 20 phút (thỏa mãn <= 60 phút)
      const targetMinute = currentH * 60 + currentM + 20;
      const startH = Math.floor(targetMinute / 60) % 24;
      const startM = targetMinute % 60;
      const startTimeStr = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`;

      vi.spyOn(dbClient, 'query').mockResolvedValue({
        rows: [
          {
            shift_id: 'shift-1',
            store_id: 1,
            user_id: 'user-1',
            user_name: 'Phạm Văn An',
            telegram_chat_id: '11223344',
            work_date: '2026-10-04',
            template_name: 'Ca Sáng',
            start_time: startTimeStr,
            end_time: '12:00:00',
          },
        ],
        rowCount: 1,
      } as any);

      const notifySpy = vi.spyOn(telegramService, 'notifyShiftReminder').mockResolvedValue(true);

      const sentCount = await reminderCron.scanAndSendShiftReminders();

      expect(sentCount).toBe(1);
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: '11223344',
          userName: 'Phạm Văn An',
          workDate: '2026-10-04',
        }),
      );

      // Chạy lần thứ 2: Đã lưu cache trong ngày nên không gửi lặp lại
      const retryCount = await reminderCron.scanAndSendShiftReminders();
      expect(retryCount).toBe(0);
    });

    it('Bỏ qua ca ngoài khung giờ 60 phút (ví dụ ca bắt đầu sau 3 tiếng)', async () => {
      const now = new Date();
      const vnMs = now.getTime() + 7 * 60 * 60 * 1000;
      const vnDate = new Date(vnMs);
      const currentH = vnDate.getUTCHours();

      // Ca bắt đầu sau 3 tiếng (180 phút > 60 phút)
      const startH = (currentH + 3) % 24;
      const startTimeStr = `${String(startH).padStart(2, '0')}:00:00`;

      vi.spyOn(dbClient, 'query').mockResolvedValue({
        rows: [
          {
            shift_id: 'shift-far',
            store_id: 1,
            user_id: 'user-2',
            user_name: 'Trần Văn X',
            telegram_chat_id: '999999',
            work_date: '2026-10-04',
            template_name: 'Ca Tối',
            start_time: startTimeStr,
            end_time: '22:00:00',
          },
        ],
        rowCount: 1,
      } as any);

      const notifySpy = vi.spyOn(telegramService, 'notifyShiftReminder').mockResolvedValue(true);

      const sentCount = await reminderCron.scanAndSendShiftReminders();
      expect(sentCount).toBe(0);
      expect(notifySpy).not.toHaveBeenCalled();
    });
  });

  describe('2. Quét quên check-out (scanMissingCheckout)', () => {
    it('Gắn cờ missing_checkout, ghi audit log và gửi cảnh báo Quản lý khi quá 2 tiếng', async () => {
      vi.spyOn(dbClient, 'query').mockResolvedValue({
        rows: [
          {
            attendance_id: 'att-101',
            user_id: 'user-9',
            user_name: 'Lê Hoàng Nam',
            work_date: '2026-10-04',
            shift_id: 'shift-9',
            template_name: 'Ca Chiều',
            start_time: '12:00:00',
            end_time: '17:00:00',
          },
        ],
        rowCount: 1,
      } as any);

      const auditSpy = vi.spyOn(auditRepository, 'log').mockResolvedValue();
      const notifySpy = vi.spyOn(telegramService, 'notifyMissingCheckout').mockResolvedValue();

      const count = await reminderCron.scanMissingCheckout();

      expect(count).toBe(1);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-9',
          action: 'MISSING_CHECKOUT',
        }),
      );
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attendanceId: 'att-101',
          userName: 'Lê Hoàng Nam',
        }),
      );
    });
  });
});
