import { Router } from 'express';
import { telegramController } from '../controllers/telegram.controller.js';
import { authenticate, requirePasswordChanged, requireRole } from '../middleware/auth.js';

export const telegramRouter = Router();

// Webhook từ Telegram API (không cần authenticate của user)
telegramRouter.post('/webhook', (req, res, next) => {
  void telegramController.handleWebhook(req, res, next);
});

// Các endpoint nghiệp vụ cho người dùng (yêu cầu đăng nhập)
telegramRouter.post('/link-token', authenticate, requirePasswordChanged, (req, res, next) => {
  void telegramController.createLinkToken(req, res, next);
});

telegramRouter.get('/status', authenticate, requirePasswordChanged, (req, res, next) => {
  void telegramController.getStatus(req, res, next);
});

telegramRouter.post('/unlink', authenticate, requirePasswordChanged, (req, res, next) => {
  void telegramController.unlink(req, res, next);
});

// Quản lý kiểm tra gửi tin
telegramRouter.post('/test-notify', authenticate, requirePasswordChanged, requireRole('admin'), (req, res, next) => {
  void telegramController.testNotify(req, res, next);
});
