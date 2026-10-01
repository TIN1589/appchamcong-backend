import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { authRouter } from './auth.js';
import { shiftsRouter } from './shifts.js';
import { authService } from '../services/auth.service.js';
import cookieParser from 'cookie-parser';
import { errorHandler } from '../lib/errors.js';
import jwt from 'jsonwebtoken';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRouter);
app.use('/api/shifts', shiftsRouter);
app.use(errorHandler);

vi.mock('jsonwebtoken', async () => {
  const actual = await vi.importActual('jsonwebtoken');
  return {
    ...actual,
    default: {
      ...actual,
      verify: vi.fn(),
    }
  };
});

describe('Auth & RBAC Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should block unauthenticated requests to protected routes', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/đăng nhập/);
  });

  it('should block requests to /api/auth/me if password not changed', async () => {
    vi.mocked(jwt.verify).mockReturnValue({
      sub: '123',
      storeId: 1,
      role: 'staff',
      mustChangePassword: true,
      type: 'access',
    } as any);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer dummy-token');

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Vui lòng đổi mật khẩu/);
  });

  it('should allow requests to /api/auth/change-password even if password not changed', async () => {
    vi.mocked(jwt.verify).mockReturnValue({
      sub: '123',
      storeId: 1,
      role: 'staff',
      mustChangePassword: true,
      type: 'access',
    } as any);
    vi.spyOn(authService, 'changePassword').mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer dummy-token')
      .send({ currentPassword: 'old', newPassword: 'ValidPassword123!', confirmPassword: 'ValidPassword123!' });

    expect(res.status).toBe(200);
  });

  it('should deny staff from accessing admin routes (e.g. POST /api/shifts)', async () => {
    vi.mocked(jwt.verify).mockReturnValue({
      sub: '123',
      storeId: 1,
      role: 'staff',
      mustChangePassword: false,
      type: 'access',
    } as any);

    const res = await request(app)
      .post('/api/shifts')
      .set('Authorization', 'Bearer dummy-token')
      .send({ work_date: '2024-01-01', segments: [] });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Bạn không có quyền/);
  });
});
