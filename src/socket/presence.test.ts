import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { presenceManager } from './presence.js';
import type { Server } from 'socket.io';

describe('PresenceManager (§3.3 SRS v1.1 - Online/Offline & 15s Grace Period)', () => {
  let mockIo: Server;
  const storeId = 1;
  const userId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    vi.useFakeTimers();
    presenceManager.reset();

    mockIo = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    } as unknown as Server;
  });

  afterEach(() => {
    presenceManager.reset();
    vi.useRealTimers();
  });

  it('1. Khi user kết nối lần đầu (từ 0 lên 1 socket) -> phát sự kiện online: true vào room store', () => {
    presenceManager.handleUserConnect(mockIo, storeId, userId, 'socket-1');

    expect(presenceManager.isUserOnline(userId)).toBe(true);
    expect(mockIo.to).toHaveBeenCalledWith(`store:${storeId}`);
    expect(mockIo.emit).toHaveBeenCalledWith('presence:update', {
      userId,
      online: true,
    });
  });

  it('2. User mở tab thứ 2 (thêm socket-2) -> không phát lại sự kiện online lặp', () => {
    presenceManager.handleUserConnect(mockIo, storeId, userId, 'socket-1');
    vi.clearAllMocks();

    presenceManager.handleUserConnect(mockIo, storeId, userId, 'socket-2');

    // Không phát lại vì đã online sẵn
    expect(mockIo.emit).not.toHaveBeenCalled();
    expect(presenceManager.isUserOnline(userId)).toBe(true);
  });

  it('3. User đóng 1 trong 2 tab -> vẫn giữ trạng thái online, chưa phát offline', () => {
    presenceManager.handleUserConnect(mockIo, storeId, userId, 'socket-1');
    presenceManager.handleUserConnect(mockIo, storeId, userId, 'socket-2');
    vi.clearAllMocks();

    presenceManager.handleUserDisconnect(mockIo, storeId, userId, 'socket-1');

    expect(presenceManager.isUserOnline(userId)).toBe(true);
    expect(mockIo.emit).not.toHaveBeenCalled();
  });

  it('4. User đóng hết tab (ngắt socket cuối cùng) -> chỉ phát offline sau 15 giây grace period', () => {
    presenceManager.handleUserConnect(mockIo, storeId, userId, 'socket-1');
    vi.clearAllMocks();

    presenceManager.handleUserDisconnect(mockIo, storeId, userId, 'socket-1');

    // Ngay lúc disconnect: CHƯA phát offline
    expect(mockIo.emit).not.toHaveBeenCalled();

    // Tiến tới 14.9 giây: VẪN CHƯA phát offline
    vi.advanceTimersByTime(14_900);
    expect(mockIo.emit).not.toHaveBeenCalled();

    // Tiến thêm 200ms (vượt mốc 15s): ĐÃ phát offline
    vi.advanceTimersByTime(200);
    expect(mockIo.to).toHaveBeenCalledWith(`store:${storeId}`);
    expect(mockIo.emit).toHaveBeenCalledWith('presence:update', {
      userId,
      online: false,
    });
  });

  it('5. User reconnect trong vòng 15s grace period -> huỷ timer và giữ trạng thái online liên tục', () => {
    presenceManager.handleUserConnect(mockIo, storeId, userId, 'socket-1');
    vi.clearAllMocks();

    // Disconnect
    presenceManager.handleUserDisconnect(mockIo, storeId, userId, 'socket-1');

    // Sau 10 giây user refresh trang hoặc reconnect bằng socket-2
    vi.advanceTimersByTime(10_000);
    presenceManager.handleUserConnect(mockIo, storeId, userId, 'socket-2');

    // Tiến thêm 10 giây nữa (tổng 20s kể từ lúc disconnect socket-1)
    vi.advanceTimersByTime(10_000);

    // Không bao giờ phát offline
    expect(mockIo.emit).not.toHaveBeenCalledWith('presence:update', {
      userId,
      online: false,
    });
    expect(presenceManager.isUserOnline(userId)).toBe(true);
  });
});
