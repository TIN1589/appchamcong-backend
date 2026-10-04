import crypto from 'crypto';
import { usersRepository } from '../repositories/users.repository.js';
import { telegramService } from './telegram.service.js';
import type { User } from '../types/db.js';

export interface TelegramLinkTokenEntry {
  userId: string;
  storeId: number;
  createdAt: number;
  expiresAt: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number | string;
      type: string;
    };
    date: number;
    text?: string;
  };
}

export class TelegramLinkingService {
  // Bộ nhớ tạm lưu mã token liên kết với TTL 15 phút (900_000 ms)
  private readonly tokens = new Map<string, TelegramLinkTokenEntry>();
  private readonly TOKEN_TTL_MS = 15 * 60 * 1000;

  /**
   * Sinh mã liên kết cho nhân viên
   */
  public createLinkToken(userId: string, storeId: number): string {
    this.cleanupExpiredTokens();

    const token = crypto.randomBytes(12).toString('hex');
    const now = Date.now();

    this.tokens.set(token, {
      userId,
      storeId,
      createdAt: now,
      expiresAt: now + this.TOKEN_TTL_MS,
    });

    return token;
  }

  /**
   * Xác thực token và gán chatId vào tài khoản người dùng
   */
  public async verifyAndLink(
    token: string,
    chatId: string,
  ): Promise<{ success: boolean; user?: User; message: string }> {
    const entry = this.tokens.get(token);
    if (!entry) {
      return {
        success: false,
        message: 'Mã liên kết không hợp lệ hoặc đã hết hạn (chỉ có hiệu lực trong 15 phút). Vui lòng lấy mã mới trên web.',
      };
    }

    if (Date.now() > entry.expiresAt) {
      this.tokens.delete(token);
      return {
        success: false,
        message: 'Mã liên kết đã hết hạn. Vui lòng tạo mã mới từ ứng dụng.',
      };
    }

    // Cập nhật telegram_chat_id cho user
    const updated = await usersRepository.updateTelegramChatId(entry.userId, entry.storeId, chatId);
    if (!updated) {
      return {
        success: false,
        message: 'Không tìm thấy thông tin tài khoản nhân viên hoặc tài khoản đã bị vô hiệu hóa.',
      };
    }

    const user = await usersRepository.findById(entry.userId, entry.storeId);
    this.tokens.delete(token);

    if (user) {
      return {
        success: true,
        user,
        message: 'Liên kết tài khoản thành công!',
      };
    }

    return {
      success: true,
      message: 'Liên kết tài khoản thành công!',
    };
  }

  /**
   * Hủy liên kết Telegram của nhân viên
   */
  public async unlinkUser(userId: string, storeId: number): Promise<boolean> {
    return usersRepository.updateTelegramChatId(userId, storeId, null);
  }

  /**
   * Xử lý webhook update đến từ Telegram
   */
  public async processTelegramUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message || !message.text) return;

    const text = message.text.trim();
    const chatId = String(message.chat.id);

    // 1. Lệnh /start kèm token: /start <token>
    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const token = parts[1];

      if (token) {
        const result = await this.verifyAndLink(token, chatId);
        if (result.success && result.user) {
          const welcomeMsg = [
            '🎉 <b>LIÊN KẾT TÀI KHOẢN THÀNH CÔNG!</b>',
            '',
            `Xin chào <b>${result.user.full_name}</b> (${result.user.email})!`,
            'Từ bây giờ, bạn sẽ nhận được:',
            '• ⏰ Thông báo nhắc ca làm việc trước 1 giờ',
            '• 🔄 Cập nhật duyệt đơn đổi ca & Chợ ca',
            '• 📋 Các thông báo quan trọng từ quản lý',
            '',
            '<i>Bạn có thể gõ /status để kiểm tra trạng thái hoặc /unlink để ngắt kết nối bất cứ lúc nào.</i>',
          ].join('\n');

          await telegramService.sendMessage(chatId, welcomeMsg);
        } else {
          await telegramService.sendMessage(
            chatId,
            `❌ <b>LIÊN KẾT THẤT BẠI</b>\n\n${result.message}`,
          );
        }
        return;
      }

      // /start không có token: Kiểm tra user đã liên kết chưa
      const existingUser = await usersRepository.findByTelegramChatId(chatId);
      if (existingUser) {
        await telegramService.sendMessage(
          chatId,
          `👋 Xin chào <b>${existingUser.full_name}</b>!\nBạn đã liên kết với tài khoản <b>${existingUser.email}</b>.\nGõ /status để xem thông tin hoặc /help để xem hướng dẫn.`,
        );
      } else {
        await telegramService.sendMessage(
          chatId,
          '👋 <b>Xin chào bạn đến với Bot Thông Báo appChamCong!</b>\n\n' +
            'Để nhận thông báo ca làm việc, vui lòng đăng nhập vào ứng dụng trên web/điện thoại, vào mục <b>Cá nhân / Cài đặt</b> và chọn <b>Liên kết Telegram</b>.\n\n' +
            'Sau đó nhấn vào liên kết được cung cấp để hoàn tất kết nối.',
        );
      }
      return;
    }

    // 2. Lệnh /status
    if (text === '/status') {
      const user = await usersRepository.findByTelegramChatId(chatId);
      if (!user) {
        await telegramService.sendMessage(
          chatId,
          '⚠️ Tài khoản Telegram này chưa được liên kết với bất kỳ nhân viên nào trong hệ thống appChamCong.\n\nVui lòng đăng nhập trên ứng dụng và bấm "Liên kết Telegram".',
        );
        return;
      }

      await telegramService.sendMessage(
        chatId,
        [
          '👤 <b>THÔNG TIN TÀI KHOẢN LIÊN KẾT</b>',
          '',
          `• Họ tên: <b>${user.full_name}</b>`,
          `• Email: <code>${user.email}</code>`,
          `• Vai trò: <b>${user.role === 'admin' ? 'Quản lý' : 'Nhân viên'}</b>`,
          `• Telegram Chat ID: <code>${chatId}</code>`,
          '',
          '✅ Trạng thái nhận thông báo: <b>Đang hoạt động</b>',
        ].join('\n'),
      );
      return;
    }

    // 3. Lệnh /unlink
    if (text === '/unlink') {
      const user = await usersRepository.findByTelegramChatId(chatId);
      if (!user) {
        await telegramService.sendMessage(chatId, '⚠️ Bạn chưa liên kết tài khoản nào.');
        return;
      }

      await usersRepository.updateTelegramChatId(user.id, user.store_id, null);
      await telegramService.sendMessage(
        chatId,
        `✅ Đã hủy liên kết Telegram với tài khoản <b>${user.email}</b> thành công. Bạn sẽ không còn nhận thông báo tự động từ bot.`,
      );
      return;
    }

    // 4. Lệnh /help
    if (text === '/help') {
      await telegramService.sendMessage(
        chatId,
        [
          '📖 <b>HƯỚNG DẪN SỬ DỤNG BOT THÔNG BÁO</b>',
          '',
          '• /status : Kiểm tra trạng thái tài khoản đang liên kết',
          '• /unlink : Hủy liên kết Telegram với hệ thống',
          '• /help : Hiển thị bảng trợ giúp này',
          '',
          '<i>Bot này hoạt động 24/7 để tự động gửi thông báo lịch ca, đổi ca và chấm công cho bạn.</i>',
        ].join('\n'),
      );
    }
  }

  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens.entries()) {
      if (now > entry.expiresAt) {
        this.tokens.delete(token);
      }
    }
  }
}

export const telegramLinkingService = new TelegramLinkingService();
