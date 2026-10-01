import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { scheduleRouter } from './schedule.js';
import { errorHandler } from '../lib/errors.js';
import { scheduleService } from '../services/schedule.service.js';
import { rosterGenerationService } from '../services/rosterGeneration.service.js';
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

vi.mock('../services/schedule.service.js', () => ({
  scheduleService: {
    getWeekSchedule: vi.fn(),
  },
}));

vi.mock('../services/rosterGeneration.service.js', () => ({
  rosterGenerationService: {
    generateWeek: vi.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/schedule', scheduleRouter);
app.use('/schedule', scheduleRouter);
app.use('/api/schedules', scheduleRouter);
app.use('/schedules', scheduleRouter);
app.use(errorHandler);

function mockUser(role: 'admin' | 'staff' = 'staff', userId = 'staff-uuid-1', mustChangePassword = false) {
  vi.mocked(jwt.verify).mockReturnValue({
    sub: userId,
    storeId: 1,
    role,
    mustChangePassword,
    type: 'access',
  } as unknown as ReturnType<typeof jwt.verify>);
}

describe('Schedule API — GET /schedule/week & /api/schedule/week', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('RBAC & Auth Guard', () => {
    it('trả về 401 UNAUTHORIZED khi không có token', async () => {
      const res = await request(app).get('/api/schedule/week');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('trả về 403 MUST_CHANGE_PASSWORD nếu user chưa đổi mật khẩu lần đầu', async () => {
      mockUser('staff', 'staff-uuid-1', true);

      const res = await request(app)
        .get('/api/schedule/week')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MUST_CHANGE_PASSWORD');
    });

    it('Staff được phép gọi GET /schedule/week (Staff chỉ đọc thành công)', async () => {
      mockUser('staff', 'staff-uuid-1');
      vi.mocked(scheduleService.getWeekSchedule).mockResolvedValueOnce({
        week: {
          startDate: '2026-10-05',
          endDate: '2026-10-11',
          days: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'],
        },
        scope: 'me',
        shifts: [],
      });

      const res = await request(app)
        .get('/api/schedule/week')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('me');
      expect(scheduleService.getWeekSchedule).toHaveBeenCalledWith(1, 'staff-uuid-1', {
        start: undefined,
        scope: 'me',
      });
    });

    it('Staff xem được lịch toàn quán với scope=store', async () => {
      mockUser('staff', 'staff-uuid-1');
      vi.mocked(scheduleService.getWeekSchedule).mockResolvedValueOnce({
        week: {
          startDate: '2026-10-05',
          endDate: '2026-10-11',
          days: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'],
        },
        scope: 'store',
        shifts: [],
      });

      const res = await request(app)
        .get('/api/schedule/week?scope=store')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('store');
      expect(scheduleService.getWeekSchedule).toHaveBeenCalledWith(1, 'staff-uuid-1', {
        start: undefined,
        scope: 'store',
      });
    });

    it('Hoạt động với đường dẫn trực tiếp /schedule/week', async () => {
      mockUser('staff', 'staff-uuid-1');
      vi.mocked(scheduleService.getWeekSchedule).mockResolvedValueOnce({
        week: {
          startDate: '2026-10-05',
          endDate: '2026-10-11',
          days: ['2026-10-05'],
        },
        scope: 'me',
        shifts: [],
      });

      const res = await request(app)
        .get('/schedule/week')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(200);
    });

    it('Admin cũng gọi được lịch tuần', async () => {
      mockUser('admin', 'admin-uuid-1');
      vi.mocked(scheduleService.getWeekSchedule).mockResolvedValueOnce({
        week: {
          startDate: '2026-10-05',
          endDate: '2026-10-11',
          days: ['2026-10-05'],
        },
        scope: 'store',
        shifts: [],
      });

      const res = await request(app)
        .get('/api/schedule/week?scope=store')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(200);
    });
  });

  describe('Validation Query Parameters', () => {
    it('báo lỗi 400 VALIDATION_ERROR khi start không đúng định dạng YYYY-MM-DD', async () => {
      mockUser('staff');

      const resInvalid = await request(app)
        .get('/api/schedule/week?start=not-a-date')
        .set('Authorization', 'Bearer token');

      expect(resInvalid.status).toBe(400);
      expect(resInvalid.body.code).toBe('VALIDATION_ERROR');
    });

    it('báo lỗi 400 VALIDATION_ERROR khi scope không hợp lệ', async () => {
      mockUser('staff');

      const res = await request(app)
        .get('/api/schedule/week?scope=invalid_scope')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Admin manual generate — POST /schedules/generate (§1 SRS v1.1 Delta)', () => {
    it('trả về 401 khi không có token', async () => {
      const res = await request(app).post('/schedules/generate');
      expect(res.status).toBe(401);
    });

    it('trả về 403 khi staff gọi (chỉ admin có quyền sinh ca)', async () => {
      mockUser('staff');
      const res = await request(app)
        .post('/schedules/generate')
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(403);
    });

    it('admin gọi thành công và gọi rosterGenerationService.generateWeek', async () => {
      mockUser('admin', 'admin-uuid-1');
      vi.mocked(rosterGenerationService.generateWeek).mockResolvedValueOnce({
        storeId: 1,
        weekStart: '2026-10-12',
        days: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'],
        createdCount: 10,
        skippedCount: 0,
        onLeaveCount: 1,
      });

      const res = await request(app)
        .post('/schedules/generate?week=2026-10-12')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.createdCount).toBe(10);
      expect(rosterGenerationService.generateWeek).toHaveBeenCalledWith(1, '2026-10-12');
    });

    it('báo lỗi 400 khi week query param sai định dạng', async () => {
      mockUser('admin');
      const res = await request(app)
        .post('/schedules/generate?week=invalid-date')
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
