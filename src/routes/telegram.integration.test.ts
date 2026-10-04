import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { telegramRouter } from './telegram.js';
import { errorHandler } from '../lib/errors.js';
import { telegramService } from '../services/telegram.service.js';
import { telegramLinkingService } from '../services/telegram.linking.js';
import { usersRepository } from '../repositories/users.repository.js';
import jwt from 'jsonwebtoken';

vi.mock('jsonwebtoken', async () => {
  const actual = await vi.importActual<typeof import('jsonwebtoken')>('jsonwebtoken');
  return {
    ...actual,
    default: {
      ...actual,
      verify: vi.fn(),
    },
  };
});

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/telegram', telegramRouter);
app.use(errorHandler);

function mockUser(role: 'admin' | 'staff', userId = 'user-uuid-123') {
  vi.mocked(jwt.verify).mockReturnValue({
    sub: userId,
    storeId: 1,
    role,
    mustChangePassword: false,
    type: 'access',
  } as unknown as ReturnType<typeof jwt.verify>);
}

describe('Telegram Routes Integration Tests (Supertest)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Endpoint /api/telegram/link-token', () => {
    it('Chặn truy cập 401 Unauthorized khi không có JWT token', async () => {
      const res = await request(app).post('/api/telegram/link-token');
      expect(res.status).toBe(401);
    });

    it('Sinh token thành công HTTP 200 cho nhân viên đã đăng nhập', async () => {
      mockUser('staff');
      vi.spyOn(telegramLinkingService, 'createLinkToken').mockReturnValue('mock_token_abc_123');

      const res = await request(app)
        .post('/api/telegram/link-token')
        .set('Authorization', 'Bearer valid_jwt_token');

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBe('mock_token_abc_123');
      expect(res.body.data.expiresInSeconds).toBe(900);
    });
  });

  describe('2. Endpoint /api/telegram/status', () => {
    it('Trả về thông tin trạng thái liên kết Telegram của nhân viên', async () => {
      mockUser('staff', 'user-staff-1');
      vi.spyOn(usersRepository, 'findById').mockResolvedValue({
        id: 'user-staff-1',
        store_id: 1,
        telegram_chat_id: '987654321',
      } as any);

      const res = await request(app)
        .get('/api/telegram/status')
        .set('Authorization', 'Bearer valid_jwt_token');

      expect(res.status).toBe(200);
      expect(res.body.data.isLinked).toBe(true);
      expect(res.body.data.telegramChatId).toContain('4321');
    });
  });

  describe('3. Endpoint /api/telegram/unlink', () => {
    it('Hủy liên kết Telegram thành công', async () => {
      mockUser('staff', 'user-staff-1');
      vi.spyOn(telegramLinkingService, 'unlinkUser').mockResolvedValue(true);

      const res = await request(app)
        .post('/api/telegram/unlink')
        .set('Authorization', 'Bearer valid_jwt_token');

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(telegramLinkingService.unlinkUser).toHaveBeenCalledWith('user-staff-1', 1);
    });
  });

  describe('4. Endpoint /api/telegram/webhook', () => {
    it('Nhận update từ Telegram và trả HTTP 200 ok: true', async () => {
      const processSpy = vi.spyOn(telegramLinkingService, 'processTelegramUpdate').mockResolvedValue();

      const res = await request(app)
        .post('/api/telegram/webhook')
        .send({
          update_id: 1001,
          message: {
            message_id: 5,
            chat: { id: 123456, type: 'private' },
            text: '/start',
            date: 1600000000,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(processSpy).toHaveBeenCalled();
    });
  });

  describe('5. Endpoint /api/telegram/test-notify', () => {
    it('Chặn nhân viên (role staff) gọi endpoint test notify với HTTP 403 Forbidden', async () => {
      mockUser('staff');

      const res = await request(app)
        .post('/api/telegram/test-notify')
        .set('Authorization', 'Bearer valid_jwt_token')
        .send({ chatId: '123456', message: 'Hello' });

      expect(res.status).toBe(403);
    });

    it('Cho phép Quản lý (role admin) gửi tin nhắn kiểm tra hệ thống', async () => {
      mockUser('admin');
      vi.spyOn(telegramService, 'sendMessage').mockResolvedValue(true);

      const res = await request(app)
        .post('/api/telegram/test-notify')
        .set('Authorization', 'Bearer valid_jwt_token')
        .send({ chatId: '123456', message: 'Kiểm tra thông báo bot' });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        '123456',
        expect.stringContaining('Kiểm tra thông báo bot'),
      );
    });
  });
});
