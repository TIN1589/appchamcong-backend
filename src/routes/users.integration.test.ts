import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { usersRouter } from './users.js';
import { errorHandler } from '../lib/errors.js';
import { usersService } from '../services/users.service.js';
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

vi.mock('../services/users.service.js', () => ({
  usersService: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    enrollFace: vi.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/users', usersRouter);
app.use(errorHandler);

function mockAdmin(userId = 'admin-uuid-1') {
  vi.mocked(jwt.verify).mockReturnValue({
    sub: userId,
    storeId: 1,
    role: 'admin',
    mustChangePassword: false,
    type: 'access',
  } as unknown as ReturnType<typeof jwt.verify>);
}

function mockStaff(userId = 'staff-uuid-1') {
  vi.mocked(jwt.verify).mockReturnValue({
    sub: userId,
    storeId: 1,
    role: 'staff',
    mustChangePassword: false,
    type: 'access',
  } as unknown as ReturnType<typeof jwt.verify>);
}

describe('Users API RBAC & Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PATCH /api/users/:id - RBAC Guard', () => {
    it('[RBAC] Staff không được phép tự sửa hourlyRate của chính mình', async () => {
      mockStaff('staff-uuid-1');
      const res = await request(app)
        .patch('/api/users/staff-uuid-1')
        .set('Authorization', 'Bearer valid-token')
        .send({ hourlyRate: 500000 });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('[RBAC] Staff không được phép tự sửa leaveBalance của chính mình', async () => {
      mockStaff('staff-uuid-1');
      const res = await request(app)
        .patch('/api/users/staff-uuid-1')
        .set('Authorization', 'Bearer valid-token')
        .send({ leaveBalance: 30 });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('[RBAC] Staff không được phép tự sửa isActive của chính mình', async () => {
      mockStaff('staff-uuid-1');
      const res = await request(app)
        .patch('/api/users/staff-uuid-1')
        .set('Authorization', 'Bearer valid-token')
        .send({ isActive: false });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('[RBAC] Staff không được sửa thông tin người khác', async () => {
      mockStaff('staff-uuid-1');
      const res = await request(app)
        .patch('/api/users/staff-uuid-2')
        .set('Authorization', 'Bearer valid-token')
        .send({ fullName: 'Tên Mới' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('[RBAC] Staff được phép tự sửa fullName và phone của chính mình', async () => {
      mockStaff('staff-uuid-1');
      vi.mocked(usersService.update).mockResolvedValueOnce({
        id: 'staff-uuid-1',
        store_id: 1,
        email: 'staff@example.com',
        role: 'staff',
        full_name: 'Nguyễn Văn Đã Đổi Tên',
        phone: '0901234567',
        hourly_rate: 25000,
        ot_rate_multiplier: '1.5',
        leave_balance: 12,
        is_active: true,
        must_change_password: false,
        telegram_chat_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .patch('/api/users/staff-uuid-1')
        .set('Authorization', 'Bearer valid-token')
        .send({ fullName: 'Nguyễn Văn Đã Đổi Tên', phone: '0901234567' });

      expect(res.status).toBe(200);
      expect(usersService.update).toHaveBeenCalledWith('staff-uuid-1', 1, {
        fullName: 'Nguyễn Văn Đã Đổi Tên',
        phone: '0901234567',
      });
    });

    it('[RBAC] Admin được phép sửa hourlyRate, leaveBalance và isActive của nhân viên', async () => {
      mockAdmin('admin-uuid-1');
      vi.mocked(usersService.update).mockResolvedValueOnce({
        id: 'staff-uuid-1',
        store_id: 1,
        email: 'staff@example.com',
        role: 'staff',
        full_name: 'Nguyễn Văn A',
        phone: '0901234567',
        hourly_rate: 35000,
        ot_rate_multiplier: '1.5',
        leave_balance: 15,
        is_active: true,
        must_change_password: false,
        telegram_chat_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .patch('/api/users/staff-uuid-1')
        .set('Authorization', 'Bearer valid-token')
        .send({ hourlyRate: 35000, leaveBalance: 15, isActive: true });

      expect(res.status).toBe(200);
      expect(usersService.update).toHaveBeenCalledWith('staff-uuid-1', 1, {
        hourlyRate: 35000,
        leaveBalance: 15,
        isActive: true,
      });
    });
  });

  describe('GET /api/users - Role Check', () => {
    it('[RBAC] Staff không được gọi danh sách toàn bộ users', async () => {
      mockStaff('staff-uuid-1');
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('[RBAC] Admin được gọi danh sách users', async () => {
      mockAdmin('admin-uuid-1');
      vi.mocked(usersService.list).mockResolvedValueOnce({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });

      const res = await request(app)
        .get('/api/users')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(usersService.list).toHaveBeenCalled();
    });
  });
});
