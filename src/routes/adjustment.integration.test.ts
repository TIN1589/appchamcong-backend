import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { adjustmentRouter } from './adjustment.js';
import { errorHandler } from '../lib/errors.js';
import { adjustmentService } from '../services/adjustment.service.js';
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

vi.mock('../services/adjustment.service.js', () => ({
  adjustmentService: {
    createRequest: vi.fn(),
    listRequests: vi.fn(),
    getById: vi.fn(),
    cancelRequest: vi.fn(),
    reviewRequest: vi.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/adjustments', adjustmentRouter);
app.use(errorHandler);

function mockAdmin(userId = 'admin-uuid') {
  vi.mocked(jwt.verify).mockReturnValue({
    sub: userId,
    storeId: 1,
    role: 'admin',
    mustChangePassword: false,
    type: 'access',
  } as unknown as ReturnType<typeof jwt.verify>);
}

function mockStaff(userId = 'staff-uuid') {
  vi.mocked(jwt.verify).mockReturnValue({
    sub: userId,
    storeId: 1,
    role: 'staff',
    mustChangePassword: false,
    type: 'access',
  } as unknown as ReturnType<typeof jwt.verify>);
}

describe('Adjustment Routes Integration', () => {
  const shiftId = '11111111-1111-1111-1111-111111111111';
  const segmentId = '22222222-2222-2222-2222-222222222222';
  const requestId = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/adjustments', () => {
    it('Chưa đăng nhập -> 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/api/adjustments')
        .send({
          shift_id: shiftId,
          segment_id: segmentId,
          request_type: 'forgot_checkin',
          reason: 'Quên chấm công',
        });

      expect(res.status).toBe(401);
    });

    it('Payload không hợp lệ (thiếu lý do) -> 400 VALIDATION_ERROR', async () => {
      mockStaff();
      const res = await request(app)
        .post('/api/adjustments')
        .set('Authorization', 'Bearer dummy-token')
        .send({
          shift_id: shiftId,
          segment_id: segmentId,
          request_type: 'forgot_checkin',
          reason: '', // rỗng
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('Tạo đơn hợp lệ -> 201 Created', async () => {
      mockStaff('staff-1');
      vi.mocked(adjustmentService.createRequest).mockResolvedValue({
        id: requestId,
        store_id: 1,
        user_id: 'staff-1',
        shift_id: shiftId,
        segment_id: segmentId,
        attendance_id: null,
        request_type: 'forgot_checkin',
        reason: 'Điện thoại hết pin',
        proposed_checkin_at: new Date('2026-10-08T08:00:00Z'),
        proposed_checkout_at: null,
        proposed_minutes: null,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        admin_note: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .post('/api/adjustments')
        .set('Authorization', 'Bearer dummy-token')
        .send({
          shift_id: shiftId,
          segment_id: segmentId,
          request_type: 'forgot_checkin',
          reason: 'Điện thoại hết pin',
          proposed_checkin_at: '2026-10-08T08:00:00Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(requestId);
    });
  });

  describe('GET /api/adjustments', () => {
    it('Lấy danh sách đơn -> 200 OK', async () => {
      mockStaff();
      vi.mocked(adjustmentService.listRequests).mockResolvedValue([]);

      const res = await request(app)
        .get('/api/adjustments')
        .set('Authorization', 'Bearer dummy-token');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/adjustments/:id', () => {
    it('Xem chi tiết đơn -> 200 OK', async () => {
      mockStaff();
      vi.mocked(adjustmentService.getById).mockResolvedValue({
        id: requestId,
        store_id: 1,
        user_id: 'staff-uuid',
        user_name: 'Nguyễn Văn A',
        user_email: 'staff@example.com',
        shift_id: shiftId,
        segment_id: segmentId,
        attendance_id: null,
        request_type: 'forgot_checkin',
        reason: 'Quên điện thoại',
        proposed_checkin_at: new Date('2026-10-08T08:00:00Z'),
        proposed_checkout_at: null,
        proposed_minutes: null,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        admin_note: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .get(`/api/adjustments/${requestId}`)
        .set('Authorization', 'Bearer dummy-token');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(requestId);
    });
  });

  describe('DELETE /api/adjustments/:id', () => {
    it('Hủy đơn pending -> 200 OK', async () => {
      mockStaff();
      vi.mocked(adjustmentService.cancelRequest).mockResolvedValue();

      const res = await request(app)
        .delete(`/api/adjustments/${requestId}`)
        .set('Authorization', 'Bearer dummy-token');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Đã hủy đơn ngoại lệ');
    });
  });

  describe('POST /api/adjustments/:id/review', () => {
    it('Staff cố tình gọi review -> 403 FORBIDDEN', async () => {
      mockStaff();
      const res = await request(app)
        .post(`/api/adjustments/${requestId}/review`)
        .set('Authorization', 'Bearer dummy-token')
        .send({ decision: 'approved' });

      expect(res.status).toBe(403);
    });

    it('Admin duyệt đơn thành công -> 200 OK', async () => {
      mockAdmin();
      vi.mocked(adjustmentService.reviewRequest).mockResolvedValue({
        id: requestId,
        store_id: 1,
        user_id: 'staff-uuid',
        user_name: 'Nguyễn Văn A',
        user_email: 'staff@example.com',
        shift_id: shiftId,
        segment_id: segmentId,
        attendance_id: null,
        request_type: 'forgot_checkin',
        reason: 'Quên điện thoại',
        proposed_checkin_at: new Date('2026-10-08T08:00:00Z'),
        proposed_checkout_at: null,
        proposed_minutes: null,
        status: 'approved',
        reviewed_by: 'admin-uuid',
        reviewed_at: new Date(),
        admin_note: 'Đã xác minh qua camera an ninh',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .post(`/api/adjustments/${requestId}/review`)
        .set('Authorization', 'Bearer dummy-token')
        .send({
          decision: 'approved',
          admin_note: 'Đã xác minh qua camera an ninh',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('approved');
      expect(res.body.message).toContain('Đã duyệt đơn ngoại lệ');
    });
  });
});
