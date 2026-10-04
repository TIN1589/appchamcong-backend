import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { swapRouter, shiftPoolRouter } from './swap.js';
import { errorHandler } from '../lib/errors.js';
import { swapService } from '../services/swap.service.js';
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

vi.mock('../services/swap.service.js', () => ({
  swapService: {
    createSwapRequest: vi.fn(),
    publishToPool: vi.fn(),
    claimPoolShift: vi.fn(),
    reviewSwapRequest: vi.fn(),
    cancelSwapRequest: vi.fn(),
    list: vi.fn(),
    listPoolShifts: vi.fn(),
    getById: vi.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/swaps', swapRouter);
app.use('/api/shift-pool', shiftPoolRouter);
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

describe('Swap & Shift Pool Routes Integration Tests (Supertest - Route Layer)', () => {
  const dummyUUID1 = '11111111-1111-1111-1111-111111111111';
  const dummyUUID2 = '22222222-2222-2222-2222-222222222222';
  const dummyUUID3 = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/swaps (Tạo yêu cầu đổi ca 1-1)', () => {
    it('Chưa đăng nhập -> trả về 401', async () => {
      const res = await request(app).post('/api/swaps').send({});
      expect(res.status).toBe(401);
    });

    it('Body thiếu trường hoặc sai UUID -> trả về 400 Validation Error', async () => {
      mockStaff();
      const res = await request(app)
        .post('/api/swaps')
        .set('Authorization', 'Bearer dummy-token')
        .send({
          requester_shift_id: 'invalid-id',
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('Đủ thông tin hợp lệ -> gọi swapService và trả 201', async () => {
      mockStaff(dummyUUID1);
      vi.mocked(swapService.createSwapRequest).mockResolvedValueOnce({
        id: dummyUUID3,
        store_id: 1,
        requester_id: dummyUUID1,
        requester_shift: dummyUUID2,
        receiver_id: dummyUUID3,
        receiver_shift: dummyUUID1,
        status: 'pending',
        type: 'swap',
        reason: 'Có việc bận',
        admin_note: null,
        reviewed_by: null,
        reviewed_at: null,
        expires_at: null,
        claimed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .post('/api/swaps')
        .set('Authorization', 'Bearer dummy-token')
        .send({
          requester_shift_id: dummyUUID2,
          receiver_id: dummyUUID3,
          receiver_shift_id: dummyUUID1,
          reason: 'Có việc bận',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(dummyUUID3);
      expect(swapService.createSwapRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: 1,
          requesterId: dummyUUID1,
          requesterShiftId: dummyUUID2,
        }),
      );
    });
  });

  describe('Shift Pool Routes (/api/shift-pool)', () => {
    it('POST /publish: Nhân viên đẩy ca lên Chợ ca -> trả 201', async () => {
      mockStaff(dummyUUID1);
      vi.mocked(swapService.publishToPool).mockResolvedValueOnce({
        id: dummyUUID3,
        store_id: 1,
        requester_id: dummyUUID1,
        requester_shift: dummyUUID2,
        receiver_id: null,
        receiver_shift: null,
        status: 'pending',
        type: 'pool',
        reason: 'Nhượng ca',
        admin_note: null,
        reviewed_by: null,
        reviewed_at: null,
        expires_at: new Date(),
        claimed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .post('/api/shift-pool/publish')
        .set('Authorization', 'Bearer dummy-token')
        .send({
          shift_id: dummyUUID2,
          reason: 'Nhượng ca',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('pool');
    });

    it('POST /:id/claim: Nhân viên nhận ca từ Chợ ca -> trả 200', async () => {
      mockStaff(dummyUUID2);
      vi.mocked(swapService.claimPoolShift).mockResolvedValueOnce({
        id: dummyUUID3,
        store_id: 1,
        requester_id: dummyUUID1,
        requester_shift: dummyUUID1,
        receiver_id: dummyUUID2,
        receiver_shift: null,
        status: 'approved',
        type: 'pool',
        reason: null,
        admin_note: null,
        reviewed_by: null,
        reviewed_at: new Date(),
        expires_at: null,
        claimed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .post(`/api/shift-pool/${dummyUUID3}/claim`)
        .set('Authorization', 'Bearer dummy-token');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('approved');
      expect(swapService.claimPoolShift).toHaveBeenCalledWith({
        storeId: 1,
        claimerId: dummyUUID2,
        swapRequestId: dummyUUID3,
      });
    });

    it('GET /api/shift-pool: Lấy danh sách ca đang mở trên chợ -> trả 200', async () => {
      mockStaff();
      vi.mocked(swapService.listPoolShifts).mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/shift-pool')
        .set('Authorization', 'Bearer dummy-token');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('PATCH /api/swaps/:id/review (Phân quyền RBAC & Xét duyệt)', () => {
    it('Nhân viên (role staff) gọi endpoint review -> trả 403 Forbidden', async () => {
      mockStaff();
      const res = await request(app)
        .patch(`/api/swaps/${dummyUUID1}/review`)
        .set('Authorization', 'Bearer dummy-token')
        .send({ action: 'approve' });

      expect(res.status).toBe(403);
    });

    it('Admin duyệt đơn đổi ca (approve) -> trả 200', async () => {
      mockAdmin('admin-id');
      vi.mocked(swapService.reviewSwapRequest).mockResolvedValueOnce({
        id: dummyUUID1,
        store_id: 1,
        requester_id: dummyUUID2,
        requester_shift: dummyUUID2,
        receiver_id: dummyUUID3,
        receiver_shift: dummyUUID3,
        status: 'approved',
        type: 'swap',
        reason: null,
        admin_note: 'Đồng ý',
        reviewed_by: 'admin-id',
        reviewed_at: new Date(),
        expires_at: null,
        claimed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .patch(`/api/swaps/${dummyUUID1}/review`)
        .set('Authorization', 'Bearer dummy-token')
        .send({ action: 'approve', admin_note: 'Đồng ý' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('approved');
    });

    it('Admin từ chối đơn đổi ca (reject) -> trả 200', async () => {
      mockAdmin('admin-id');
      vi.mocked(swapService.reviewSwapRequest).mockResolvedValueOnce({
        id: dummyUUID1,
        store_id: 1,
        requester_id: dummyUUID2,
        requester_shift: dummyUUID2,
        receiver_id: dummyUUID3,
        receiver_shift: dummyUUID3,
        status: 'rejected',
        type: 'swap',
        reason: null,
        admin_note: 'Không hợp lý',
        reviewed_by: 'admin-id',
        reviewed_at: new Date(),
        expires_at: null,
        claimed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .patch(`/api/swaps/${dummyUUID1}/review`)
        .set('Authorization', 'Bearer dummy-token')
        .send({ action: 'reject', admin_note: 'Không hợp lý' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('rejected');
    });
  });

  describe('DELETE /api/swaps/:id (Hủy yêu cầu đổi ca)', () => {
    it('Nhân viên hủy đơn của mình -> trả 200', async () => {
      mockStaff(dummyUUID1);
      vi.mocked(swapService.cancelSwapRequest).mockResolvedValueOnce();

      const res = await request(app)
        .delete(`/api/swaps/${dummyUUID2}`)
        .set('Authorization', 'Bearer dummy-token');

      expect(res.status).toBe(200);
      expect(swapService.cancelSwapRequest).toHaveBeenCalledWith(dummyUUID2, 1, dummyUUID1);
    });
  });
});
