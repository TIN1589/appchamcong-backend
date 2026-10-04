import { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { chatService } from '../services/chat.service.js';
import { UnauthorizedError } from '../lib/errors.js';
import { getIO } from '../socket/index.js';

const directChatSchema = z.object({
  target_user_id: z.string().uuid('target_user_id phải là UUID hợp lệ'),
});

const sendMessageSchema = z.object({
  content: z.string().min(1, 'Nội dung tin nhắn không được rỗng').max(2000, 'Tối đa 2000 ký tự'),
});

export const chatController = {
  async listConversations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const convs = await chatService.listUserConversations(req.user.storeId, req.user.id);
      res.status(200).json({ data: convs });
    } catch (err) {
      next(err);
    }
  },

  async getStoreGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const group = await chatService.getOrCreateStoreGroup(req.user.storeId);
      res.status(200).json({ data: group });
    } catch (err) {
      next(err);
    }
  },

  async getOrCreateDirect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const body = directChatSchema.parse(req.body);

      const conv = await chatService.getOrCreateDirect(req.user.storeId, req.user.id, body.target_user_id);
      res.status(200).json({ data: conv });
    } catch (err) {
      next(err);
    }
  },

  async listMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const { id } = req.params;
      if (!id) throw new Error('Missing conversation id');

      const limit = req.query['limit'] ? Number(req.query['limit']) : 50;
      const beforeVal = req.query['before'];
      const beforeDate = typeof beforeVal === 'string' ? new Date(beforeVal) : undefined;

      const messages = await chatService.listMessages(id, req.user.id, limit, beforeDate);
      res.status(200).json({ data: messages });
    } catch (err) {
      next(err);
    }
  },

  async sendMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const { id } = req.params;
      if (!id) throw new Error('Missing conversation id');

      const body = sendMessageSchema.parse(req.body);
      const msg = await chatService.sendMessage(id, req.user.id, body.content);

      // Phát realtime qua Socket.io nếu server đang chạy
      try {
        const io = getIO();
        io.to(`conversation:${id}`).emit('chat:message:new', msg);
        io.to(`store:${req.user.storeId}`).emit('chat:conversation:updated', {
          conversationId: id,
          lastMessage: msg,
        });
      } catch {
        // Bỏ qua nếu socket chưa init (trong môi trường test route)
      }

      res.status(201).json({ data: msg });
    } catch (err) {
      next(err);
    }
  },

  async markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const { id } = req.params;
      if (!id) throw new Error('Missing conversation id');

      await chatService.markRead(id, req.user.id);
      res.status(200).json({ message: 'Đã đánh dấu đã đọc' });
    } catch (err) {
      next(err);
    }
  },
};
