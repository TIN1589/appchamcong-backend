import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adjustmentRepository } from './adjustment.repository.js';
import * as clientModule from '../db/client.js';
import { ConflictError, ErrorCode, NotFoundError } from '../lib/errors.js';

describe('adjustmentRepository.reviewWithTransaction (§2.7 Concurrency & Single Source of Truth)', () => {
  const storeId = 1;
  const staffId = '11111111-1111-1111-1111-111111111111';
  const adminId = '22222222-2222-2222-2222-222222222222';
  const shiftId = 'aaaa-aaaa-aaaa-aaaa';
  const segmentId = 'bbbb-bbbb-bbbb-bbbb';
  const requestId = 'cccc-cccc-cccc-cccc';

  const startsAt = new Date('2026-10-08T08:00:00+07:00');
  const endsAt = new Date('2026-10-08T12:00:00+07:00');

  let mockClient: {
    query: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn(),
    };

    // Giả lập withTransaction thực thi callback với mockClient
    vi.spyOn(clientModule, 'withTransaction').mockImplementation(async (cb) => {
      return cb(mockClient as unknown as import('pg').PoolClient);
    });
  });

  it('1. Admin tự duyệt đơn của chính mình -> Bị chặn với ADJUSTMENT_CANNOT_REVIEW_SELF', async () => {
    // Đơn này do chính adminId tạo ra
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          id: requestId,
          store_id: storeId,
          user_id: adminId, // người tạo chính là admin
          shift_id: shiftId,
          segment_id: segmentId,
          status: 'pending',
          request_type: 'forgot_checkin',
        },
      ],
    });

    await expect(
      adjustmentRepository.reviewWithTransaction({
        requestId,
        reviewerAdminId: adminId,
        decision: 'approved',
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: ErrorCode.ADJUSTMENT_CANNOT_REVIEW_SELF,
      }),
    );
  });

  it('2. Đơn không ở trạng thái pending (đã duyệt hoặc đang bị tranh chấp) -> 409 ConflictError', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          id: requestId,
          store_id: storeId,
          user_id: staffId,
          shift_id: shiftId,
          segment_id: segmentId,
          status: 'approved', // đã được duyệt rồi
          request_type: 'forgot_checkin',
        },
      ],
    });

    await expect(
      adjustmentRepository.reviewWithTransaction({
        requestId,
        reviewerAdminId: adminId,
        decision: 'approved',
      }),
    ).rejects.toThrowError(ConflictError);
  });

  it('3. Đơn không tồn tại -> 404 NotFoundError', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [],
    });

    await expect(
      adjustmentRepository.reviewWithTransaction({
        requestId: 'non-existing-id',
        reviewerAdminId: adminId,
        decision: 'approved',
      }),
    ).rejects.toThrowError(NotFoundError);
  });

  it('4. Duyệt forgot_checkin khi CHƯA có attendance -> Tạo mới attendance với source = adjustment', async () => {
    const proposedCheckin = new Date('2026-10-08T08:00:00+07:00');

    // 1. Khóa đơn
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          id: requestId,
          store_id: storeId,
          user_id: staffId,
          shift_id: shiftId,
          segment_id: segmentId,
          status: 'pending',
          request_type: 'forgot_checkin',
          proposed_checkin_at: proposedCheckin,
          reason: 'Quên điện thoại',
        },
      ],
    });

    // 2. Cập nhật đơn
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: requestId, status: 'approved' }],
    });

    // 3. Lấy grace_period_minutes của store
    mockClient.query.mockResolvedValueOnce({
      rows: [{ grace_period_minutes: 5 }],
    });

    // 4. Lấy chi tiết segment
    mockClient.query.mockResolvedValueOnce({
      rows: [{ starts_at: startsAt, ends_at: endsAt, shift_type: 'REGULAR' }],
    });

    // 5. Kiểm tra attendance hiện có (chưa có -> rows rỗng)
    mockClient.query.mockResolvedValueOnce({
      rows: [],
    });

    // 6. INSERT vào attendances
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'new-attendance-id' }],
    });

    // 7. Lấy lại chi tiết đơn
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          id: requestId,
          status: 'approved',
          user_name: 'Nhân viên A',
          reviewer_name: 'Quản lý B',
        },
      ],
    });

    const res = await adjustmentRepository.reviewWithTransaction({
      requestId,
      reviewerAdminId: adminId,
      decision: 'approved',
    });

    expect(res.status).toBe('approved');

    // Kiểm tra câu lệnh INSERT attendance
    const insertCall = mockClient.query.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO attendances'),
    );
    expect(insertCall).toBeDefined();
    // Kiểm tra câu lệnh SQL chèn source 'adjustment'
    expect(insertCall?.[0]).toContain("'adjustment'");
  });

  it('5. Duyệt forgot_checkin khi ĐÃ CÓ attendance -> Cập nhật giờ, lưu original_checkin_at', async () => {
    const existingCheckin = new Date('2026-10-08T08:30:00+07:00');
    const proposedCheckin = new Date('2026-10-08T08:00:00+07:00');

    mockClient.query
      // 1. Lock đơn
      .mockResolvedValueOnce({
        rows: [
          {
            id: requestId,
            store_id: storeId,
            user_id: staffId,
            shift_id: shiftId,
            segment_id: segmentId,
            status: 'pending',
            request_type: 'forgot_checkin',
            proposed_checkin_at: proposedCheckin,
            reason: 'Quên máy',
          },
        ],
      })
      // 2. Update status đơn
      .mockResolvedValueOnce({
        rows: [{ id: requestId, status: 'approved' }],
      })
      // 3. Store config
      .mockResolvedValueOnce({
        rows: [{ grace_period_minutes: 5 }],
      })
      // 4. Segment details
      .mockResolvedValueOnce({
        rows: [{ starts_at: startsAt, ends_at: endsAt, shift_type: 'REGULAR' }],
      })
      // 5. Attendance hiện có
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'existing-att-id',
            checkin_at: existingCheckin,
            checkout_at: endsAt,
            original_checkin_at: null,
            original_checkout_at: null,
            late_minutes: 30,
            early_leave_minutes: 0,
            actual_minutes: 210,
            ot_minutes: 0,
            status: 'late',
            source: 'self',
            notes: null,
          },
        ],
      })
      // 6. UPDATE attendances
      .mockResolvedValueOnce({
        rows: [{ id: 'existing-att-id' }],
      })
      // 7. Fetch full request
      .mockResolvedValueOnce({
        rows: [{ id: requestId, status: 'approved' }],
      });

    const res = await adjustmentRepository.reviewWithTransaction({
      requestId,
      reviewerAdminId: adminId,
      decision: 'approved',
    });

    expect(res.status).toBe('approved');

    // Kiểm tra câu lệnh UPDATE attendances có original_checkin_at được giữ lại
    const updateCall = mockClient.query.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('UPDATE attendances'),
    );
    expect(updateCall).toBeDefined();
    // original_checkin_at ($3) phải là existingCheckin
    expect(updateCall?.[1]?.[2]).toEqual(existingCheckin);
    // checkin_at ($1) mới phải là proposedCheckin
    expect(updateCall?.[1]?.[0]).toEqual(proposedCheckin);
  });

  it('6. Duyệt official_late_early -> Xóa phút trễ/sớm (late = 0, early = 0, status = present)', async () => {
    mockClient.query
      // 1. Lock đơn
      .mockResolvedValueOnce({
        rows: [
          {
            id: requestId,
            store_id: storeId,
            user_id: staffId,
            shift_id: shiftId,
            segment_id: segmentId,
            status: 'pending',
            request_type: 'official_late_early',
            reason: 'Đi giao hàng cho khách',
          },
        ],
      })
      // 2. Update status đơn
      .mockResolvedValueOnce({
        rows: [{ id: requestId, status: 'approved' }],
      })
      // 3. Store config
      .mockResolvedValueOnce({
        rows: [{ grace_period_minutes: 5 }],
      })
      // 4. Segment details
      .mockResolvedValueOnce({
        rows: [{ starts_at: startsAt, ends_at: endsAt, shift_type: 'REGULAR' }],
      })
      // 5. Attendance hiện có
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'att-late-id',
            checkin_at: new Date('2026-10-08T08:45:00+07:00'),
            checkout_at: endsAt,
            late_minutes: 45,
            early_leave_minutes: 0,
            actual_minutes: 195,
            ot_minutes: 0,
            status: 'late',
            source: 'self',
            notes: null,
          },
        ],
      })
      // 6. UPDATE attendances
      .mockResolvedValueOnce({
        rows: [{ id: 'att-late-id' }],
      })
      // 7. Fetch full request
      .mockResolvedValueOnce({
        rows: [{ id: requestId, status: 'approved' }],
      });

    await adjustmentRepository.reviewWithTransaction({
      requestId,
      reviewerAdminId: adminId,
      decision: 'approved',
    });

    const updateCall = mockClient.query.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('UPDATE attendances'),
    );
    expect(updateCall).toBeDefined();
    // late_minutes ($5) = 0
    expect(updateCall?.[1]?.[4]).toBe(0);
    // early_leave_minutes ($6) = 0
    expect(updateCall?.[1]?.[5]).toBe(0);
    // status ($9) = 'present'
    expect(updateCall?.[1]?.[8]).toBe('present');
  });

  it('7. Duyệt overtime -> Cộng thêm proposed_minutes vào ot_minutes', async () => {
    mockClient.query
      // 1. Lock đơn
      .mockResolvedValueOnce({
        rows: [
          {
            id: requestId,
            store_id: storeId,
            user_id: staffId,
            shift_id: shiftId,
            segment_id: segmentId,
            status: 'pending',
            request_type: 'overtime',
            proposed_minutes: 60,
            reason: 'Tăng ca đột xuất kiểm kho',
          },
        ],
      })
      // 2. Update status đơn
      .mockResolvedValueOnce({
        rows: [{ id: requestId, status: 'approved' }],
      })
      // 3. Store config
      .mockResolvedValueOnce({
        rows: [{ grace_period_minutes: 5 }],
      })
      // 4. Segment details
      .mockResolvedValueOnce({
        rows: [{ starts_at: startsAt, ends_at: endsAt, shift_type: 'REGULAR' }],
      })
      // 5. Attendance hiện có
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'att-ot-id',
            checkin_at: startsAt,
            checkout_at: endsAt,
            late_minutes: 0,
            early_leave_minutes: 0,
            actual_minutes: 240,
            ot_minutes: 15, // đã có sẵn 15 phút OT
            status: 'present',
            source: 'self',
            notes: null,
          },
        ],
      })
      // 6. UPDATE attendances
      .mockResolvedValueOnce({
        rows: [{ id: 'att-ot-id' }],
      })
      // 7. Fetch full request
      .mockResolvedValueOnce({
        rows: [{ id: requestId, status: 'approved' }],
      });

    await adjustmentRepository.reviewWithTransaction({
      requestId,
      reviewerAdminId: adminId,
      decision: 'approved',
    });

    const updateCall = mockClient.query.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('UPDATE attendances'),
    );
    expect(updateCall).toBeDefined();
    // ot_minutes ($8) = 15 + 60 = 75
    expect(updateCall?.[1]?.[7]).toBe(75);
  });

  it('8. Từ chối đơn (rejected) -> Không cập nhật hay chèn vào bảng attendances', async () => {
    mockClient.query
      // 1. Lock đơn
      .mockResolvedValueOnce({
        rows: [
          {
            id: requestId,
            store_id: storeId,
            user_id: staffId,
            shift_id: shiftId,
            segment_id: segmentId,
            status: 'pending',
            request_type: 'forgot_checkin',
          },
        ],
      })
      // 2. Update status đơn thành rejected
      .mockResolvedValueOnce({
        rows: [{ id: requestId, status: 'rejected' }],
      })
      // 3. Fetch full request
      .mockResolvedValueOnce({
        rows: [{ id: requestId, status: 'rejected' }],
      });

    const res = await adjustmentRepository.reviewWithTransaction({
      requestId,
      reviewerAdminId: adminId,
      decision: 'rejected',
      adminNote: 'Không có minh chứng hợp lệ',
    });

    expect(res.status).toBe('rejected');

    // Đảm bảo không có câu lệnh query nào tương tác với attendances
    const attendanceQueries = mockClient.query.mock.calls.filter((call) =>
      typeof call[0] === 'string' && call[0].toLowerCase().includes('attendances'),
    );
    expect(attendanceQueries).toHaveLength(0);
  });
});
