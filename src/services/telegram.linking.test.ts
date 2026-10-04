import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramLinkingService } from './telegram.linking.js';
import { usersRepository } from '../repositories/users.repository.js';
import { telegramService } from './telegram.service.js';

describe('TelegramLinkingService (Unit Tests)', () => {
  let linkingService: TelegramLinkingService;

  beforeEach(() => {
    vi.restoreAllMocks();
    linkingService = new TelegramLinkingService();
  });

  describe('1. Quản lý Token Liên kết', () => {
    it('Sinh token liên kết ngẫu nhiên với độ dài 24 ký tự hex', () => {
      const token1 = linkingService.createLinkToken('user-1', 1);
      const token2 = linkingService.createLinkToken('user-2', 1);

      expect(token1).toHaveLength(24);
      expect(token2).toHaveLength(24);
      expect(token1).not.toBe(token2);
    });

    it('Từ chối khi xác thực token không tồn tại', async () => {
      const result = await linkingService.verifyAndLink('invalid_token_xyz', 'chat_123');
      expect(result.success).toBe(false);
      expect(result.message).toContain('không hợp lệ');
    });

    it('Xác thực token hợp lệ: Cập nhật telegram_chat_id và thu hồi token', async () => {
      const token = linkingService.createLinkToken('user-100', 1);

      vi.spyOn(usersRepository, 'updateTelegramChatId').mockResolvedValue(true);
      vi.spyOn(usersRepository, 'findById').mockResolvedValue({
        id: 'user-100',
        store_id: 1,
        email: 'nhanvien@quan.com',
        full_name: 'Nguyễn Văn Test',
        role: 'staff',
      } as any);

      const result = await linkingService.verifyAndLink(token, 'tele_chat_888');

      expect(result.success).toBe(true);
      expect(result.user?.full_name).toBe('Nguyễn Văn Test');
      expect(usersRepository.updateTelegramChatId).toHaveBeenCalledWith('user-100', 1, 'tele_chat_888');

      // Token đã bị xóa, không thể tái sử dụng
      const retryResult = await linkingService.verifyAndLink(token, 'tele_chat_888');
      expect(retryResult.success).toBe(false);
    });
  });

  describe('2. Xử lý các lệnh cập nhật từ Bot Telegram (processTelegramUpdate)', () => {
    it('Lệnh /start <token>: Tự động liên kết và gửi tin nhắn chúc mừng', async () => {
      const token = linkingService.createLinkToken('user-100', 1);

      vi.spyOn(usersRepository, 'updateTelegramChatId').mockResolvedValue(true);
      vi.spyOn(usersRepository, 'findById').mockResolvedValue({
        id: 'user-100',
        store_id: 1,
        email: 'staff@test.com',
        full_name: 'Trần Thị Mai',
        role: 'staff',
      } as any);

      const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue(true);

      await linkingService.processTelegramUpdate({
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: '999888', type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: `/start ${token}`,
        },
      });

      expect(sendSpy).toHaveBeenCalledWith(
        '999888',
        expect.stringContaining('LIÊN KẾT TÀI KHOẢN THÀNH CÔNG'),
      );
      expect(sendSpy).toHaveBeenCalledWith(
        '999888',
        expect.stringContaining('Trần Thị Mai'),
      );
    });

    it('Lệnh /status: Trả về thông tin nhân viên đã liên kết', async () => {
      vi.spyOn(usersRepository, 'findByTelegramChatId').mockResolvedValue({
        id: 'user-100',
        store_id: 1,
        email: 'staff@test.com',
        full_name: 'Trần Thị Mai',
        role: 'staff',
      } as any);

      const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue(true);

      await linkingService.processTelegramUpdate({
        update_id: 2,
        message: {
          message_id: 11,
          chat: { id: '999888', type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: '/status',
        },
      });

      expect(sendSpy).toHaveBeenCalledWith(
        '999888',
        expect.stringContaining('THÔNG TIN TÀI KHOẢN LIÊN KẾT'),
      );
      expect(sendSpy).toHaveBeenCalledWith(
        '999888',
        expect.stringContaining('Trần Thị Mai'),
      );
    });

    it('Lệnh /unlink: Hủy liên kết Telegram thành công', async () => {
      vi.spyOn(usersRepository, 'findByTelegramChatId').mockResolvedValue({
        id: 'user-100',
        store_id: 1,
        email: 'staff@test.com',
        full_name: 'Trần Thị Mai',
        role: 'staff',
      } as any);

      const updateSpy = vi.spyOn(usersRepository, 'updateTelegramChatId').mockResolvedValue(true);
      const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue(true);

      await linkingService.processTelegramUpdate({
        update_id: 3,
        message: {
          message_id: 12,
          chat: { id: '999888', type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: '/unlink',
        },
      });

      expect(updateSpy).toHaveBeenCalledWith('user-100', 1, null);
      expect(sendSpy).toHaveBeenCalledWith(
        '999888',
        expect.stringContaining('Đã hủy liên kết Telegram'),
      );
    });

    it('Lệnh /help: Gửi danh sách cú pháp trợ giúp', async () => {
      const sendSpy = vi.spyOn(telegramService, 'sendMessage').mockResolvedValue(true);

      await linkingService.processTelegramUpdate({
        update_id: 4,
        message: {
          message_id: 13,
          chat: { id: '999888', type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: '/help',
        },
      });

      expect(sendSpy).toHaveBeenCalledWith(
        '999888',
        expect.stringContaining('HƯỚNG DẪN SỬ DỤNG BOT THÔNG BÁO'),
      );
    });
  });
});
