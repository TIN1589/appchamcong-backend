import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceService } from './attendance.service.js';
import { attendanceRepository } from '../repositories/attendance.repository.js';
import { AppError, ErrorCode } from '../lib/errors.js';

vi.mock('../repositories/attendance.repository.js', () => ({
  attendanceRepository: {
    getStoreConfig: vi.fn(),
    getFaceTemplate: vi.fn(),
    saveFaceTemplate: vi.fn(),
    deleteFaceTemplate: vi.fn(),
    findSegmentDetails: vi.fn(),
    findBySegmentAndUser: vi.fn(),
    findById: vi.fn(),
    createCheckin: vi.fn(),
    updateCheckout: vi.fn(),
    listAttendances: vi.fn(),
  },
}));

describe('attendanceService (§2.5 Business Logic & Anti-fraud)', () => {
  const storeCoords = { lat: 10.7769, lng: 106.7009 };
  const mockStoreConfig = {
    id: 1,
    lat: storeCoords.lat,
    lng: storeCoords.lng,
    radius_m: 50,
    max_gps_accuracy_m: 100,
    grace_period_minutes: 5,
    checkin_window_before_minutes: 30,
    wifi_ip_allowlist: ['192.168.1.100', '127.0.0.1'],
  };

  const storedVector = Array(128).fill(0.1) as number[];
  const matchVector = Array(128).fill(0.1) as number[];
  const mismatchVector = Array(128).fill(0.9) as number[];

  const shiftId = '11111111-1111-1111-1111-111111111111';
  const segmentId = '22222222-2222-2222-2222-222222222222';
  const userId = '33333333-3333-3333-3333-333333333333';

  const startsAt = new Date('2026-10-05T07:00:00+07:00');
  const endsAt = new Date('2026-10-05T12:00:00+07:00');

  const mockSegment = {
    shift_id: shiftId,
    segment_id: segmentId,
    user_id: userId,
    store_id: 1,
    shift_type: 'REGULAR' as const,
    shift_status: 'scheduled',
    starts_at: startsAt,
    ends_at: endsAt,
    work_date: '2026-10-05',
    shift_name: 'Ca sáng',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(attendanceRepository.getStoreConfig).mockResolvedValue(mockStoreConfig);
    vi.mocked(attendanceRepository.getFaceTemplate).mockResolvedValue({
      id: 'template-id',
      store_id: 1,
      user_id: userId,
      descriptor: storedVector,
      consent_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });
    vi.mocked(attendanceRepository.findSegmentDetails).mockResolvedValue(mockSegment);
    vi.mocked(attendanceRepository.findBySegmentAndUser).mockResolvedValue(null);
  });

  describe('Check-in Validation & Anti-fraud', () => {
    it('1. Từ chối check-in khi chưa enroll khuôn mặt -> ATTENDANCE_NO_DESCRIPTOR', async () => {
      vi.mocked(attendanceRepository.getFaceTemplate).mockResolvedValueOnce(null);

      await expect(
        attendanceService.checkin({
          userId,
          storeId: 1,
          shiftId,
          coords: { ...storeCoords, accuracy: 10 },
          faceDescriptor: matchVector,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.ATTENDANCE_NO_DESCRIPTOR,
        }),
      );
    });

    it('2. Từ chối check-in khi khuôn mặt không khớp (Euclidean > 0.6) -> ATTENDANCE_FACE_MISMATCH', async () => {
      await expect(
        attendanceService.checkin({
          userId,
          storeId: 1,
          shiftId,
          coords: { ...storeCoords, accuracy: 10 },
          faceDescriptor: mismatchVector,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.ATTENDANCE_FACE_MISMATCH,
        }),
      );
    });

    it('3. Từ chối khi GPS accuracy > 100m (105m) -> ATTENDANCE_GPS_INACCURATE', async () => {
      await expect(
        attendanceService.checkin({
          userId,
          storeId: 1,
          shiftId,
          coords: { ...storeCoords, accuracy: 105 },
          faceDescriptor: matchVector,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.ATTENDANCE_GPS_INACCURATE,
        }),
      );
    });

    it('4. Từ chối khi khoảng cách GPS > 50m (cách 1km) -> ATTENDANCE_GPS_TOO_FAR', async () => {
      await expect(
        attendanceService.checkin({
          userId,
          storeId: 1,
          shiftId,
          coords: { lat: 10.8000, lng: 106.7200, accuracy: 10 },
          faceDescriptor: matchVector,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.ATTENDANCE_GPS_TOO_FAR,
        }),
      );
    });

    it('5. Từ chối khi check-in sớm hơn 30 phút trước ca (06:20 vs 07:00) -> ATTENDANCE_TOO_EARLY', async () => {
      const earlyClock = () => new Date('2026-10-05T06:20:00+07:00');

      await expect(
        attendanceService.checkin({
          userId,
          storeId: 1,
          shiftId,
          coords: { ...storeCoords, accuracy: 10 },
          faceDescriptor: matchVector,
          clock: earlyClock,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.ATTENDANCE_TOO_EARLY,
        }),
      );
    });

    it('6. Từ chối khi check-in sau khi ca đã kết thúc (12:05 vs 12:00) -> ATTENDANCE_WINDOW_CLOSED', async () => {
      const closedClock = () => new Date('2026-10-05T12:05:00+07:00');

      await expect(
        attendanceService.checkin({
          userId,
          storeId: 1,
          shiftId,
          coords: { ...storeCoords, accuracy: 10 },
          faceDescriptor: matchVector,
          clock: closedClock,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.ATTENDANCE_WINDOW_CLOSED,
        }),
      );
    });

    it('7. Từ chối khi ca không được phân công cho user -> SHIFT_NOT_FOUND', async () => {
      vi.mocked(attendanceRepository.findSegmentDetails).mockResolvedValueOnce(null);

      await expect(
        attendanceService.checkin({
          userId,
          storeId: 1,
          shiftId: 'random-shift',
          coords: { ...storeCoords, accuracy: 10 },
          faceDescriptor: matchVector,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.SHIFT_NOT_FOUND,
        }),
      );
    });

    it('8. Chặn double-submit: Đã check-in rồi gọi lại -> ATTENDANCE_ALREADY_CHECKED_IN', async () => {
      const validClock = () => new Date('2026-10-05T06:55:00+07:00');
      vi.mocked(attendanceRepository.findBySegmentAndUser).mockResolvedValueOnce({
        id: 'existing-id',
        checkin_at: new Date('2026-10-05T06:55:00+07:00'),
      } as unknown as Awaited<ReturnType<typeof attendanceRepository.findBySegmentAndUser>>);

      await expect(
        attendanceService.checkin({
          userId,
          storeId: 1,
          shiftId,
          coords: { ...storeCoords, accuracy: 10 },
          faceDescriptor: matchVector,
          clock: validClock,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.ATTENDANCE_ALREADY_CHECKED_IN,
        }),
      );
    });

    it('9. WiFi Allowlist: IP ngoài danh sách WiFi quán -> thành công nhưng flagged = true', async () => {
      const validClock = () => new Date('2026-10-05T06:55:00+07:00');
      vi.mocked(attendanceRepository.createCheckin).mockResolvedValueOnce({
        id: 'new-attendance-id',
        shift_id: shiftId,
        segment_id: segmentId,
        user_id: userId,
        status: 'present',
        checkin_at: validClock(),
        late_minutes: 0,
        checkin_distance_m: 12,
        flagged: true,
      } as unknown as Awaited<ReturnType<typeof attendanceRepository.createCheckin>>);

      const res = await attendanceService.checkin({
        userId,
        storeId: 1,
        shiftId,
        coords: { ...storeCoords, accuracy: 10 },
        faceDescriptor: matchVector,
        ip: '10.0.0.99', // ngoài allowlist ['192.168.1.100', '127.0.0.1']
        clock: validClock,
      });

      expect(res.verified).toBe(true);
      expect(res.flagged).toBe(true);
      expect(vi.mocked(attendanceRepository.createCheckin)).toHaveBeenCalledWith(
        expect.objectContaining({
          flagged: true,
        }),
      );
    });

    it('10. Response bảo mật: KHÔNG để lộ face_distance hoặc phần trăm match', async () => {
      const validClock = () => new Date('2026-10-05T06:55:00+07:00');
      vi.mocked(attendanceRepository.createCheckin).mockResolvedValueOnce({
        id: 'new-attendance-id',
        shift_id: shiftId,
        segment_id: segmentId,
        user_id: userId,
        status: 'present',
        checkin_at: validClock(),
        late_minutes: 0,
        checkin_distance_m: 5,
        flagged: false,
      } as unknown as Awaited<ReturnType<typeof attendanceRepository.createCheckin>>);

      const res = (await attendanceService.checkin({
        userId,
        storeId: 1,
        shiftId,
        coords: { ...storeCoords, accuracy: 10 },
        faceDescriptor: matchVector,
        ip: '192.168.1.100',
        clock: validClock,
      })) as Record<string, unknown>;

      expect(res['verified']).toBe(true);
      expect(res['distance_m']).toBeDefined();
      expect(res['face_distance']).toBeUndefined();
      expect(res['match_percentage']).toBeUndefined();
    });
  });

  describe('Check-out Validation & Metrics', () => {
    it('11. Check-out khi chưa check-in -> ATTENDANCE_NOT_CHECKED_IN', async () => {
      vi.mocked(attendanceRepository.findBySegmentAndUser).mockResolvedValueOnce(null);

      await expect(
        attendanceService.checkout({
          userId,
          storeId: 1,
          shiftId,
          coords: { ...storeCoords, accuracy: 10 },
          faceDescriptor: matchVector,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.ATTENDANCE_NOT_CHECKED_IN,
        }),
      );
    });

    it('12. Check-out lần 2 khi đã check-out rồi -> ATTENDANCE_ALREADY_CHECKED_OUT', async () => {
      vi.mocked(attendanceRepository.findBySegmentAndUser).mockResolvedValueOnce({
        id: 'att-id',
        checkin_at: startsAt,
        checkout_at: endsAt,
      } as unknown as Awaited<ReturnType<typeof attendanceRepository.findBySegmentAndUser>>);

      await expect(
        attendanceService.checkout({
          userId,
          storeId: 1,
          shiftId,
          coords: { ...storeCoords, accuracy: 10 },
          faceDescriptor: matchVector,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.ATTENDANCE_ALREADY_CHECKED_OUT,
        }),
      );
    });

    it('13. Check-out hợp lệ và tính đúng actual_minutes', async () => {
      const checkoutClock = () => new Date('2026-10-05T12:00:00+07:00');
      vi.mocked(attendanceRepository.findBySegmentAndUser).mockResolvedValueOnce({
        id: 'att-id',
        checkin_at: startsAt,
        checkout_at: null,
        ot_minutes: 0,
      } as unknown as Awaited<ReturnType<typeof attendanceRepository.findBySegmentAndUser>>);

      vi.mocked(attendanceRepository.updateCheckout).mockResolvedValueOnce({
        id: 'att-id',
        shift_id: shiftId,
        segment_id: segmentId,
        checkout_at: checkoutClock(),
        actual_minutes: 300,
        early_leave_minutes: 0,
        ot_minutes: 0,
        status: 'present',
        checkout_distance_m: 8,
        flagged: false,
      } as unknown as Awaited<ReturnType<typeof attendanceRepository.updateCheckout>>);

      const res = await attendanceService.checkout({
        userId,
        storeId: 1,
        shiftId,
        coords: { ...storeCoords, accuracy: 10 },
        faceDescriptor: matchVector,
        clock: checkoutClock,
      });

      expect(res.verified).toBe(true);
      expect(res.actual_minutes).toBe(300);
      expect(res.early_leave_minutes).toBe(0);
    });
  });

  describe('Face Enrollment Lifecycle', () => {
    it('14. Bắt buộc consent: consent = false -> VALIDATION_ERROR', async () => {
      await expect(
        attendanceService.enrollFace(userId, 1, matchVector, false),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.VALIDATION_ERROR,
        }),
      );
    });

    it('15. Chặn enroll lần 2: Đã có mẫu rồi -> FACE_ALREADY_ENROLLED', async () => {
      vi.mocked(attendanceRepository.getFaceTemplate).mockResolvedValueOnce({
        id: 'old-template',
      } as unknown as Awaited<ReturnType<typeof attendanceRepository.getFaceTemplate>>);

      await expect(
        attendanceService.enrollFace(userId, 1, matchVector, true),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.FACE_ALREADY_ENROLLED,
        }),
      );
    });

    it('16. Enroll lần đầu thành công', async () => {
      vi.mocked(attendanceRepository.getFaceTemplate).mockResolvedValueOnce(null);
      vi.mocked(attendanceRepository.saveFaceTemplate).mockResolvedValueOnce({
        id: 'template-id',
        consent_at: new Date(),
      } as unknown as Awaited<ReturnType<typeof attendanceRepository.saveFaceTemplate>>);

      const res = await attendanceService.enrollFace(userId, 1, matchVector, true);
      expect(res.success).toBe(true);
      expect(res.message).toContain('thành công');
    });

    it('17. Admin resetFace cho phép nhân viên enroll lại', async () => {
      vi.mocked(attendanceRepository.deleteFaceTemplate).mockResolvedValueOnce(true);

      const res = await attendanceService.resetFace(userId);
      expect(res.success).toBe(true);
      expect(vi.mocked(attendanceRepository.deleteFaceTemplate)).toHaveBeenCalledWith(userId);
    });

    it('18. Admin deleteFace khi nhân viên nghỉ việc', async () => {
      vi.mocked(attendanceRepository.deleteFaceTemplate).mockResolvedValueOnce(true);

      const res = await attendanceService.deleteFace(userId);
      expect(res.success).toBe(true);
      expect(vi.mocked(attendanceRepository.deleteFaceTemplate)).toHaveBeenCalledWith(userId);
    });
  });

  describe('Ca gãy & Chấm công độc lập', () => {
    it('19. Ca gãy: Segment 1 và Segment 2 có thể check-in riêng biệt', async () => {
      const seg2Id = 'seg-2-uuid';
      const seg2StartsAt = new Date('2026-10-05T17:00:00+07:00');
      const seg2EndsAt = new Date('2026-10-05T22:00:00+07:00');

      vi.mocked(attendanceRepository.findSegmentDetails).mockResolvedValueOnce({
        ...mockSegment,
        segment_id: seg2Id,
        starts_at: seg2StartsAt,
        ends_at: seg2EndsAt,
      });

      const validClock = () => new Date('2026-10-05T16:55:00+07:00');
      vi.mocked(attendanceRepository.createCheckin).mockResolvedValueOnce({
        id: 'att-seg2-id',
        shift_id: shiftId,
        segment_id: seg2Id,
        user_id: userId,
        status: 'present',
        checkin_at: validClock(),
        late_minutes: 0,
        checkin_distance_m: 10,
        flagged: false,
      } as unknown as Awaited<ReturnType<typeof attendanceRepository.createCheckin>>);

      const res = await attendanceService.checkin({
        userId,
        storeId: 1,
        shiftId,
        segmentId: seg2Id,
        coords: { ...storeCoords, accuracy: 10 },
        faceDescriptor: matchVector,
        clock: validClock,
      });

      expect(res.segment_id).toBe(seg2Id);
      expect(res.status).toBe('present');
    });
  });
});
