import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { attendanceRouter } from './attendance.js';
import { faceRouter } from './face.js';
import { errorHandler } from '../lib/errors.js';
import { attendanceService } from '../services/attendance.service.js';
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

vi.mock('../services/attendance.service.js', () => ({
  attendanceService: {
    checkin: vi.fn(),
    checkout: vi.fn(),
    listAttendances: vi.fn(),
    enrollFace: vi.fn(),
    getFaceStatus: vi.fn(),
    resetFace: vi.fn(),
    deleteFace: vi.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/attendances', attendanceRouter);
app.use('/api/face', faceRouter);
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

describe('Attendance & Face Routes Integration', () => {
  const validVector = Array(128).fill(0.1);
  const shiftId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/attendances/checkin', () => {
    it('Chưa đăng nhập -> 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/api/attendances/checkin')
        .send({
          shift_id: shiftId,
          coords: { lat: 10.7769, lng: 106.7009 },
          face_descriptor: validVector,
        });

      expect(res.status).toBe(401);
    });

    it('Sai Zod validation: descriptor độ dài 100 thay vì 128 -> 400 VALIDATION_ERROR', async () => {
      mockStaff();
      const res = await request(app)
        .post('/api/attendances/checkin')
        .set('Authorization', 'Bearer valid-token')
        .send({
          shift_id: shiftId,
          coords: { lat: 10.7769, lng: 106.7009 },
          face_descriptor: Array(100).fill(0.1),
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('Check-in thành công -> 201 Created', async () => {
      mockStaff('staff-uuid');
      vi.mocked(attendanceService.checkin).mockResolvedValueOnce({
        id: 'att-id',
        shift_id: shiftId,
        segment_id: 'seg-id',
        checkin_at: new Date(),
        status: 'present',
        late_minutes: 0,
        distance_m: 14,
        verified: true,
        flagged: false,
        message: 'Đã xác thực và chấm công vào thành công',
      });

      const res = await request(app)
        .post('/api/attendances/checkin')
        .set('Authorization', 'Bearer valid-token')
        .send({
          shift_id: shiftId,
          coords: { lat: 10.7769, lng: 106.7009, accuracy: 15 },
          face_descriptor: validVector,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.verified).toBe(true);
      expect(res.body.data.distance_m).toBe(14);
      expect(res.body.data.face_distance).toBeUndefined();
    });
  });

  describe('POST /api/attendances/checkout', () => {
    it('Check-out thành công -> 200 OK', async () => {
      mockStaff('staff-uuid');
      vi.mocked(attendanceService.checkout).mockResolvedValueOnce({
        id: 'att-id',
        shift_id: shiftId,
        segment_id: 'seg-id',
        checkout_at: new Date(),
        actual_minutes: 300,
        early_leave_minutes: 0,
        ot_minutes: 0,
        status: 'present',
        distance_m: 10,
        verified: true,
        flagged: false,
        message: 'Đã xác thực và chấm công ra thành công',
      });

      const res = await request(app)
        .post('/api/attendances/checkout')
        .set('Authorization', 'Bearer valid-token')
        .send({
          shift_id: shiftId,
          coords: { lat: 10.7769, lng: 106.7009 },
          face_descriptor: validVector,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.actual_minutes).toBe(300);
    });
  });

  describe('GET /api/attendances (RBAC)', () => {
    it('Staff xem danh sách -> service chỉ nhận userId của chính staff đó', async () => {
      mockStaff('staff-uuid-1');
      vi.mocked(attendanceService.listAttendances).mockResolvedValueOnce([]);

      const otherUserId = '22222222-2222-2222-2222-222222222222';
      const res = await request(app)
        .get(`/api/attendances?user_id=${otherUserId}`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(attendanceService.listAttendances).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'staff-uuid-1', // Cưỡng chế về chính mình
        }),
      );
    });

    it('Admin xem danh sách -> cho phép truyền user_id bất kỳ', async () => {
      mockAdmin();
      vi.mocked(attendanceService.listAttendances).mockResolvedValueOnce([]);

      const otherUserId = '22222222-2222-2222-2222-222222222222';
      const res = await request(app)
        .get(`/api/attendances?user_id=${otherUserId}`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(attendanceService.listAttendances).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: otherUserId,
        }),
      );
    });
  });

  describe('POST /api/face/enroll', () => {
    it('Từ chối khi consent = false -> 400 VALIDATION_ERROR', async () => {
      mockStaff();
      const res = await request(app)
        .post('/api/face/enroll')
        .set('Authorization', 'Bearer valid-token')
        .send({
          descriptor: validVector,
          consent: false,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('Enroll thành công khi consent = true -> 201 Created', async () => {
      mockStaff('staff-uuid');
      vi.mocked(attendanceService.enrollFace).mockResolvedValueOnce({
        success: true,
        message: 'Đăng ký mẫu khuôn mặt thành công',
        consent_at: new Date(),
      });

      const res = await request(app)
        .post('/api/face/enroll')
        .set('Authorization', 'Bearer valid-token')
        .send({
          descriptor: validVector,
          consent: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Admin Face Management Endpoints', () => {
    it('Staff gọi POST /api/face/:userId/reset -> 403 Forbidden', async () => {
      mockStaff();
      const targetUserId = '22222222-2222-2222-2222-222222222222';
      const res = await request(app)
        .post(`/api/face/${targetUserId}/reset`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('Admin gọi POST /api/face/:userId/reset -> 200 OK', async () => {
      mockAdmin();
      const targetUserId = '22222222-2222-2222-2222-222222222222';
      vi.mocked(attendanceService.resetFace).mockResolvedValueOnce({
        success: true,
        message: 'Đã đặt lại mẫu khuôn mặt thành công',
      });

      const res = await request(app)
        .post(`/api/face/${targetUserId}/reset`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Staff gọi DELETE /api/face/:userId -> 403 Forbidden', async () => {
      mockStaff();
      const targetUserId = '22222222-2222-2222-2222-222222222222';
      const res = await request(app)
        .delete(`/api/face/${targetUserId}`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('Admin gọi DELETE /api/face/:userId -> 200 OK', async () => {
      mockAdmin();
      const targetUserId = '22222222-2222-2222-2222-222222222222';
      vi.mocked(attendanceService.deleteFace).mockResolvedValueOnce({
        success: true,
        message: 'Đã xoá vĩnh viễn mẫu khuôn mặt khỏi hệ thống',
      });

      const res = await request(app)
        .delete(`/api/face/${targetUserId}`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
