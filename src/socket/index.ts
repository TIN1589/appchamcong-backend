import { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { presenceManager } from './presence.js';
import { chatService } from '../services/chat.service.js';

export interface SocketUser {
  userId: string;
  storeId: number;
  role: 'admin' | 'staff';
  fullName?: string;
}

declare module 'socket.io' {
  interface SocketData {
    user: SocketUser;
  }
}

let ioInstance: Server | null = null;

export function getIO(): Server {
  if (!ioInstance) {
    throw new Error('Socket.io chưa được khởi tạo');
  }
  return ioInstance;
}

export function initSocketServer(httpServer: HttpServer): Server {
  presenceManager.reset();

  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  ioInstance = io;

  // Middleware xác thực JWT lúc handshake
  io.use((socket: Socket, next) => {
    try {
      const authHeader = socket.handshake.headers.authorization;
      const rawAuth = socket.handshake.auth as Record<string, unknown> | undefined;
      const token =
        (typeof rawAuth?.['token'] === 'string' ? rawAuth['token'] : null) ??
        (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

      if (!token) {
        next(new Error('UNAUTHORIZED'));
        return;
      }

      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
        sub: string;
        storeId?: number;
        role: 'admin' | 'staff';
        fullName?: string;
        type?: string;
      };

      if (decoded.type && decoded.type !== 'access') {
        next(new Error('INVALID_TOKEN_TYPE'));
        return;
      }

      socket.data.user = {
        userId: decoded.sub,
        storeId: decoded.storeId ?? 1,
        role: decoded.role,
        fullName: decoded.fullName,
      };

      next();
    } catch (err) {
      logger.warn({ err }, 'Socket handshake authentication failed');
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const socketData = socket.data as { user?: SocketUser };
    const user = socketData.user;
    if (!user) return;
    const userId: string = user.userId;
    const storeId: number = user.storeId;

    // 1. Tự động tham gia 2 room chính: toàn cửa hàng và cá nhân
    void socket.join(`store:${storeId}`);
    void socket.join(`user:${userId}`);

    // 2. Ghi nhận Presence
    presenceManager.handleUserConnect(io, storeId, userId, socket.id);

    // 3. Client yêu cầu danh sách các user đang Online
    socket.on('presence:get_online', (callback?: (onlineUserIds: string[]) => void) => {
      const list = presenceManager.getOnlineUserIds();
      if (typeof callback === 'function') {
        callback(list);
      } else {
        socket.emit('presence:online_list', list);
      }
    });

    // 4. Chat: Tham gia phòng hội thoại cụ thể
    socket.on('chat:join', async (data: { conversationId: string }, callback?: (res: { ok: boolean; error?: string }) => void) => {
      try {
        const { conversationId } = data;
        await socket.join(`conversation:${conversationId}`);
        if (typeof callback === 'function') callback({ ok: true });
      } catch {
        if (typeof callback === 'function') callback({ ok: false, error: 'JOIN_FAILED' });
      }
    });

    // 5. Chat: Rời phòng hội thoại
    socket.on('chat:leave', (data: { conversationId: string }) => {
      void socket.leave(`conversation:${data.conversationId}`);
    });

    // 6. Chat: Gửi tin nhắn
    socket.on('chat:message', async (data: { conversationId: string; content: string }, callback?: (res: { ok: boolean; data?: unknown; error?: string }) => void) => {
      try {
        const { conversationId, content } = data;
        const msg = await chatService.sendMessage(conversationId, userId, content);

        // Phát cho mọi người trong phòng hội thoại này
        io.to(`conversation:${conversationId}`).emit('chat:message:new', msg);

        // Báo cho toàn quán cập nhật danh sách hội thoại gần nhất
        io.to(`store:${storeId}`).emit('chat:conversation:updated', {
          conversationId,
          lastMessage: msg,
        });

        if (typeof callback === 'function') callback({ ok: true, data: msg });
      } catch (err: unknown) {
        if (typeof callback === 'function') {
          callback({ ok: false, error: err instanceof Error ? err.message : 'SEND_FAILED' });
        }
      }
    });

    // 7. Chat: Đang nhập văn bản (Typing indicator)
    socket.on('chat:typing', (data: { conversationId: string; isTyping: boolean }) => {
      socket.to(`conversation:${data.conversationId}`).emit('chat:typing', {
        conversationId: data.conversationId,
        userId,
        isTyping: data.isTyping,
      });
    });

    // 8. Ngắt kết nối
    socket.on('disconnect', () => {
      presenceManager.handleUserDisconnect(io, storeId, userId, socket.id);
    });
  });

  return io;
}
