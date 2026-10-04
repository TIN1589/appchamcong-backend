import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { telegramService } from '../services/telegram.service.js';
import { telegramLinkingService, type TelegramUpdate } from '../services/telegram.linking.js';
import { usersRepository } from '../repositories/users.repository.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const telegramController = {
  /**
   * Tạo token liên kết Telegram cho người dùng hiện tại
   */
  async createLinkToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user;
      if (!user) throw new AppError('UNAUTHORIZED', 'Chưa xác thực', 401);

      const token = telegramLinkingService.createLinkToken(user.id, user.storeId);

      // Trích xuất bot username nếu có trong token (hoặc để client ghép)
      res.json({
        data: {
          token,
          expiresInSeconds: 900,
          telegramConfigured: telegramService.isConfigured(),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Kiểm tra trạng thái liên kết Telegram của người dùng hiện tại
   */
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user;
      if (!user) throw new AppError('UNAUTHORIZED', 'Chưa xác thực', 401);

      const dbUser = await usersRepository.findById(user.id, user.storeId);
      if (!dbUser) throw new AppError('USER_NOT_FOUND', 'Không tìm thấy người dùng', 404);

      res.json({
        data: {
          isLinked: Boolean(dbUser.telegram_chat_id),
          telegramChatId: dbUser.telegram_chat_id ? '******' + dbUser.telegram_chat_id.slice(-4) : null,
          telegramConfigured: telegramService.isConfigured(),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Hủy liên kết Telegram của người dùng hiện tại
   */
  async unlink(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user;
      if (!user) throw new AppError('UNAUTHORIZED', 'Chưa xác thực', 401);

      await telegramLinkingService.unlinkUser(user.id, user.storeId);

      res.json({
        data: {
          success: true,
          message: 'Đã hủy liên kết Telegram thành công',
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Webhook endpoint nhận tin nhắn từ Telegram Bot API
   */
  async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Xác thực bí mật webhook nếu có cấu hình
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
        if (incomingSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
          logger.warn('[Telegram Webhook] Từ chối webhook do secret token không khớp');
          res.status(401).json({ error: 'Unauthorized webhook' });
          return;
        }
      }

      // Xử lý không đồng bộ (fire-and-forget) để đáp ứng HTTP 200 nhanh chóng cho Telegram
      const update = req.body as TelegramUpdate;
      void telegramLinkingService.processTelegramUpdate(update).catch((err: unknown) => {
        logger.error({ err }, '[Telegram Webhook] Lỗi khi xử lý update từ Telegram');
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Admin test: Gửi thông báo thử nghiệm
   */
  async testNotify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        chatId: z.string().optional(),
        message: z.string().min(1, 'Nội dung tin nhắn không được rỗng'),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ', 400);
      }

      const { chatId, message } = parsed.data;
      const targetChatId = chatId ?? env.TELEGRAM_ADMIN_CHAT_ID;

      if (!targetChatId) {
        throw new AppError('VALIDATION_ERROR', 'Cần cung cấp chatId hoặc cấu hình TELEGRAM_ADMIN_CHAT_ID', 400);
      }

      const success = await telegramService.sendMessage(
        targetChatId,
        `🔔 <b>TIN NHẮN KIỂM TRA TỪ HỆ THỐNG APPCHAMCONG</b>\n\n${message}`,
      );

      res.json({
        data: {
          success,
          targetChatId,
          configured: telegramService.isConfigured(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
