import { Router } from 'express';
import { chatController } from '../controllers/chat.controller.js';
import { authenticate, requirePasswordChanged } from '../middleware/auth.js';

export const chatRouter = Router();

chatRouter.use(authenticate, requirePasswordChanged);

// Danh sách cuộc trò chuyện của user
chatRouter.get('/conversations', (req, res, next) => {
  void chatController.listConversations(req, res, next);
});

// Lấy/tạo nhóm chat chung toàn quán
chatRouter.get('/group', (req, res, next) => {
  void chatController.getStoreGroup(req, res, next);
});

// Lấy/tạo hội thoại 1-1 với nhân viên khác
chatRouter.post('/direct', (req, res, next) => {
  void chatController.getOrCreateDirect(req, res, next);
});

// Lấy lịch sử tin nhắn
chatRouter.get('/conversations/:id/messages', (req, res, next) => {
  void chatController.listMessages(req, res, next);
});

// Gửi tin nhắn mới qua REST API
chatRouter.post('/conversations/:id/messages', (req, res, next) => {
  void chatController.sendMessage(req, res, next);
});

// Đánh dấu đã đọc
chatRouter.post('/conversations/:id/read', (req, res, next) => {
  void chatController.markRead(req, res, next);
});
