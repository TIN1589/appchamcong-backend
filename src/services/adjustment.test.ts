import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdjustmentService } from './adjustment.service.js';
import { adjustmentRepository } from '../repositories/adjustment.repository.js';
import { attendanceRepository } from '../repositories/attendance.repository.js';
import { AppError, ErrorCode } from '../lib/errors.js';

vi.mock('../repositories/adjustment.repository.js', () => ({
  adjustmentRepository: {
    create: vi.fn(),
    findPendingBySegmentAndType: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    deletePending: vi.fn(),
    reviewWithTransaction: vi.fn(),
  },
}));

vi.mock('../repositories/attendance.repository.js', () => ({
  attendanceRepository: {
    findSegmentDetails: vi.fn(),
    findBySegmentAndUser: vi.fn(),
  },
}));

describe('AdjustmentService (§2.7 Business Logic)', () => {
  let service: AdjustmentService;

  const mockNow = new Date('2026-10-10T10:00:00+07:00');
  const mockClock = () => new Date(mockNow);

  const storeId = 1;
  const staffId = '11111111-1111-1111-1111-111111111111';
  const otherStaffId = '22222222-2222-2222-2222-222222222222';
  const adminId = '33333333-3333-3333-3333-333333333333';

  const shiftId = 'aaaa-aaaa-aaaa-aaaa';
  const segmentId = 'bbbb-bbbb-bbbb-bbbb';

  // Ca làm việc 2 ngày trước (nằm trong cửa sổ 7 ngày)
  const startsAt = new Date('2026-10-08T08:00:00+07:00');
  const endsAt = new Date('2026-10-08T12:00:00+07:00');

  const mockSegment = {
    shift_id: shiftId,
    segment_id: segmentId,
    user_id: staffId,
    store_id: storeId,
    shift_type: 'REGULAR' as const,
    shift_status: 'scheduled',
    starts_at: startsAt,
    ends_at: endsAt,
    work_date: '2026-10-08',
    shift_name: 'Ca sáng',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AdjustmentService(mockClock);

    vi.mocked(attendanceRepository.findSegmentDetails).mockResolvedValue(mockSegment);
    vi.mocked(attendanceRepository.findBySegmentAndUser).mockResolvedValue(null);
    vi.mocked(adjustmentRepository.findPendingBySegmentAndType).mockResolvedValue(null);
  });

  describe('Tạo đơn ngoại lệ (createRequest)', () => {
    it('1. Staff tạo đơn forgot_checkin hợp lệ -> Thành công', async () => {
      const proposedCheckin = new Date('2026-10-08T08:05:00+07:00');
      vi.mocked(adjustmentRepository.create).mockResolvedValue({
        id: 'req-1',
        store_id: storeId,
        user_id: staffId,
        shift_id: shiftId,
        segment_id: segmentId,
        attendance_id: null,
        request_type: 'forgot_checkin',
        reason: 'Quên mang điện thoại',
        proposed_checkin_at: proposedCheckin,
        proposed_checkout_at: null,
        proposed_minutes: null,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        admin_note: null,
        created_at: mockNow,
        updated_at: mockNow,
      });

      const res = await service.createRequest(
        {
          storeId,
          userId: staffId,
          shiftId,
          segmentId,
          requestType: 'forgot_checkin',
          reason: 'Quên mang điện thoại',
          proposedCheckinAt: proposedCheckin,
        },
        { id: staffId, storeId, role: 'staff' },
      );

      expect(res.id).toBe('req-1');
      expect(adjustmentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestType: 'forgot_checkin',
          userId: staffId,
          proposedCheckinAt: proposedCheckin,
        }),
      );
    });

    it('2. Staff cố tạo đơn cho người khác -> 403 FORBIDDEN', async () => {
      await expect(
        service.createRequest(
          {
            storeId,
            userId: otherStaffId,
            shiftId,
            segmentId,
            requestType: 'forgot_checkin',
            reason: 'Tạo giùm bạn',
            proposedCheckinAt: startsAt,
          },
          { id: staffId, storeId, role: 'staff' },
        ),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.FORBIDDEN,
        }),
      );
    });

    it('3. Ca làm việc quá 7 ngày trước -> 400 ADJUSTMENT_WINDOW_EXPIRED', async () => {
      // Ca 8 ngày trước so với mockNow (2026-10-10)
      const oldStartsAt = new Date('2026-10-01T08:00:00+07:00');
      vi.mocked(attendanceRepository.findSegmentDetails).mockResolvedValue({
        ...mockSegment,
        starts_at: oldStartsAt,
      });

      await expect(
        service.createRequest(
          {
            storeId,
            userId: staffId,
            shiftId,
            segmentId,
            requestType: 'forgot_checkin',
            reason: 'Đơn ca cũ tuần trước nữa',
            proposedCheckinAt: oldStartsAt,
          },
          { id: staffId, storeId, role: 'staff' },
        ),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.ADJUSTMENT_WINDOW_EXPIRED,
        }),
      );
    });

    it('4. Đã có đơn pending cùng loại cho segment -> 400 ADJUSTMENT_DUPLICATE_PENDING', async () => {
      vi.mocked(adjustmentRepository.findPendingBySegmentAndType).mockResolvedValue({
        id: 'existing-pending-req',
        store_id: storeId,
        user_id: staffId,
        shift_id: shiftId,
        segment_id: segmentId,
        attendance_id: null,
        request_type: 'forgot_checkin',
        reason: 'Đơn trước',
        proposed_checkin_at: startsAt,
        proposed_checkout_at: null,
        proposed_minutes: null,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        admin_note: null,
        created_at: mockNow,
        updated_at: mockNow,
      });

      await expect(
        service.createRequest(
          {
            storeId,
            userId: staffId,
            shiftId,
            segmentId,
            requestType: 'forgot_checkin',
            reason: 'Nộp lại đơn khác',
            proposedCheckinAt: startsAt,
          },
          { id: staffId, storeId, role: 'staff' },
        ),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.ADJUSTMENT_DUPLICATE_PENDING,
        }),
      );
    });

    it('5. forgot_both nhưng proposedCheckinAt >= proposedCheckoutAt -> Lỗi validation', async () => {
      await expect(
        service.createRequest(
          {
            storeId,
            userId: staffId,
            shiftId,
            segmentId,
            requestType: 'forgot_both',
            reason: 'Quên cả hai',
            proposedCheckinAt: new Date('2026-10-08T12:00:00+07:00'),
            proposedCheckoutAt: new Date('2026-10-08T08:00:00+07:00'),
          },
          { id: staffId, storeId, role: 'staff' },
        ),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.VALIDATION_ERROR,
        }),
      );
    });

    it('6. overtime nhưng proposedMinutes <= 0 hoặc thiếu -> Lỗi validation', async () => {
      await expect(
        service.createRequest(
          {
            storeId,
            userId: staffId,
            shiftId,
            segmentId,
            requestType: 'overtime',
            reason: 'Làm thêm ca',
            proposedMinutes: 0,
          },
          { id: staffId, storeId, role: 'staff' },
        ),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.VALIDATION_ERROR,
        }),
      );
    });

    it('7. Phân đoạn ca không tồn tại hoặc không thuộc nhân viên -> 404 NOT_FOUND', async () => {
      vi.mocked(attendanceRepository.findSegmentDetails).mockResolvedValue(null);

      await expect(
        service.createRequest(
          {
            storeId,
            userId: staffId,
            shiftId,
            segmentId: 'non-existing-segment',
            requestType: 'official_late_early',
            reason: 'Đi trễ vì việc công',
          },
          { id: staffId, storeId, role: 'staff' },
        ),
      ).rejects.toThrowError(AppError);
    });
  });

  describe('Xem chi tiết và danh sách đơn', () => {
    it('8. Staff chỉ xem được đơn của mình; cố xem đơn của người khác -> 403 FORBIDDEN', async () => {
      vi.mocked(adjustmentRepository.findById).mockResolvedValue({
        id: 'req-other',
        store_id: storeId,
        user_id: otherStaffId,
        user_name: 'Nhân viên khác',
        user_email: 'other@example.com',
        shift_id: shiftId,
        segment_id: segmentId,
        attendance_id: null,
        request_type: 'forgot_checkin',
        reason: '...',
        proposed_checkin_at: startsAt,
        proposed_checkout_at: null,
        proposed_minutes: null,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        admin_note: null,
        created_at: mockNow,
        updated_at: mockNow,
      });

      await expect(
        service.getById('req-other', { id: staffId, storeId, role: 'staff' }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.FORBIDDEN,
        }),
      );
    });

    it('9. Staff list danh sách đơn -> Tự động bị gán filter.userId = staffId', async () => {
      vi.mocked(adjustmentRepository.list).mockResolvedValue([]);

      await service.listRequests(
        { storeId, userId: otherStaffId },
        { id: staffId, storeId, role: 'staff' },
      );

      expect(adjustmentRepository.list).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: staffId, // bị ghi đè thành staffId của currentUser
        }),
      );
    });

    it('10. Admin list danh sách đơn -> Được phép xem theo filter chỉ định', async () => {
      vi.mocked(adjustmentRepository.list).mockResolvedValue([]);

      await service.listRequests(
        { storeId, userId: otherStaffId },
        { id: adminId, storeId, role: 'admin' },
      );

      expect(adjustmentRepository.list).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: otherStaffId,
        }),
      );
    });
  });

  describe('Hủy đơn (cancelRequest)', () => {
    it('11. Staff hủy đơn pending của chính mình -> Thành công', async () => {
      vi.mocked(adjustmentRepository.findById).mockResolvedValue({
        id: 'req-1',
        store_id: storeId,
        user_id: staffId,
        user_name: 'Tôi',
        user_email: 'me@example.com',
        shift_id: shiftId,
        segment_id: segmentId,
        attendance_id: null,
        request_type: 'forgot_checkin',
        reason: '...',
        proposed_checkin_at: startsAt,
        proposed_checkout_at: null,
        proposed_minutes: null,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        admin_note: null,
        created_at: mockNow,
        updated_at: mockNow,
      });
      vi.mocked(adjustmentRepository.deletePending).mockResolvedValue(true);

      await expect(
        service.cancelRequest('req-1', { id: staffId, storeId, role: 'staff' }),
      ).resolves.not.toThrow();

      expect(adjustmentRepository.deletePending).toHaveBeenCalledWith('req-1', staffId);
    });

    it('12. Không thể hủy đơn đã được duyệt hoặc từ chối -> Lỗi validation', async () => {
      vi.mocked(adjustmentRepository.findById).mockResolvedValue({
        id: 'req-approved',
        store_id: storeId,
        user_id: staffId,
        user_name: 'Tôi',
        user_email: 'me@example.com',
        shift_id: shiftId,
        segment_id: segmentId,
        attendance_id: null,
        request_type: 'forgot_checkin',
        reason: '...',
        proposed_checkin_at: startsAt,
        proposed_checkout_at: null,
        proposed_minutes: null,
        status: 'approved',
        reviewed_by: adminId,
        reviewed_at: mockNow,
        admin_note: 'OK',
        created_at: mockNow,
        updated_at: mockNow,
      });

      await expect(
        service.cancelRequest('req-approved', { id: staffId, storeId, role: 'staff' }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.VALIDATION_ERROR,
        }),
      );
    });
  });

  describe('Duyệt đơn (reviewRequest)', () => {
    it('13. Staff cố thực hiện duyệt đơn -> 403 FORBIDDEN', async () => {
      await expect(
        service.reviewRequest({
          requestId: 'req-1',
          reviewer: { id: staffId, storeId, role: 'staff' },
          decision: 'approved',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.FORBIDDEN,
        }),
      );
    });

    it('14. Admin duyệt đơn của nhân viên -> Gọi reviewWithTransaction', async () => {
      vi.mocked(adjustmentRepository.reviewWithTransaction).mockResolvedValue({
        id: 'req-1',
        store_id: storeId,
        user_id: staffId,
        user_name: 'Nhân viên A',
        user_email: 'staff@example.com',
        shift_id: shiftId,
        segment_id: segmentId,
        attendance_id: null,
        request_type: 'forgot_checkin',
        reason: 'Quên điện thoại',
        proposed_checkin_at: startsAt,
        proposed_checkout_at: null,
        proposed_minutes: null,
        status: 'approved',
        reviewed_by: adminId,
        reviewed_at: mockNow,
        admin_note: 'Đã duyệt',
        created_at: mockNow,
        updated_at: mockNow,
      });

      const res = await service.reviewRequest({
        requestId: 'req-1',
        reviewer: { id: adminId, storeId, role: 'admin' },
        decision: 'approved',
        adminNote: 'Đã duyệt',
      });

      expect(res.status).toBe('approved');
      expect(adjustmentRepository.reviewWithTransaction).toHaveBeenCalledWith({
        requestId: 'req-1',
        reviewerAdminId: adminId,
        decision: 'approved',
        adminNote: 'Đã duyệt',
      });
    });
  });
});
