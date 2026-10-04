import type { Server } from 'socket.io';
import { logger } from '../lib/logger.js';

const GRACE_PERIOD_MS = 15_000; // 15 giây theo SRS v1.1

// Memory state: userId -> Set<socketId>
const userSockets = new Map<string, Set<string>>();
// Memory state: userId -> timeoutId
const disconnectTimeouts = new Map<string, NodeJS.Timeout>();

export const presenceManager = {
  /**
   * Gọi khi một socket kết nối thành công
   */
  handleUserConnect(io: Server, storeId: number, userId: string, socketId: string): void {
    // 1. Nếu có timer đang đếm ngược báo offline, huỷ ngay (reconnect trong grace period)
    const existingTimer = disconnectTimeouts.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      disconnectTimeouts.delete(userId);
    }

    // 2. Thêm socket vào tập hợp
    let sockets = userSockets.get(userId);
    const wasOffline = !sockets || sockets.size === 0;

    if (!sockets) {
      sockets = new Set();
      userSockets.set(userId, sockets);
    }
    sockets.add(socketId);

    // 3. Nếu chuyển trạng thái từ offline sang online, thông báo cho toàn quán
    if (wasOffline) {
      logger.info({ userId, storeId }, 'User online');
      io.to(`store:${storeId}`).emit('presence:update', {
        userId,
        online: true,
      });
    }
  },

  /**
   * Gọi khi một socket ngắt kết nối
   */
  handleUserDisconnect(io: Server, storeId: number, userId: string, socketId: string): void {
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        userSockets.delete(userId);

        // Đặt hẹn giờ 15 giây trước khi công bố offline (SRS v1.1)
        const timer = setTimeout(() => {
          disconnectTimeouts.delete(userId);
          const currentSockets = userSockets.get(userId);
          if (!currentSockets || currentSockets.size === 0) {
            logger.info({ userId, storeId }, 'User offline (sau 15s grace period)');
            io.to(`store:${storeId}`).emit('presence:update', {
              userId,
              online: false,
            });
          }
        }, GRACE_PERIOD_MS);

        disconnectTimeouts.set(userId, timer);
      }
    }
  },

  /**
   * Kiểm tra một user có đang online không
   */
  isUserOnline(userId: string): boolean {
    const sockets = userSockets.get(userId);
    return !!sockets && sockets.size > 0;
  },

  /**
   * Lấy danh sách toàn bộ userIds đang online
   */
  getOnlineUserIds(): string[] {
    const onlineUsers: string[] = [];
    for (const [userId, sockets] of userSockets.entries()) {
      if (sockets.size > 0) {
        onlineUsers.push(userId);
      }
    }
    return onlineUsers;
  },

  /**
   * Dọn dẹp trạng thái khi server khởi động
   */
  reset(): void {
    for (const timer of disconnectTimeouts.values()) {
      clearTimeout(timer);
    }
    disconnectTimeouts.clear();
    userSockets.clear();
  },
};
