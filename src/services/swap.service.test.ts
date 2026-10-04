import { describe, it, expect, vi, beforeEach } from 'vitest';
import { swapService } from './swap.service.js';
import { swapRepository } from '../repositories/swap.repository.js';
import { shiftsRepository } from '../repositories/shifts.repository.js';
import { auditRepository } from '../repositories/audit.repository.js';
import * as dbClient from '../db/client.js';
import { AppError, ErrorCode, ForbiddenError } from '../lib/errors.js';

vi.mock('../repositories/swap.repository.js', () => ({
  swapRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findPendingByShiftId: vi.fn(),
    list: vi.fn(),
    listPoolShifts: vi.fn(),
    cancel: vi.fn(),
    reviewSwapWithLock: vi.fn(),
    claimPoolShiftWithLock: vi.fn(),
  },
}));

vi.mock('../repositories/shifts.repository.js', () => ({
  shiftsRepository: {
    findById: vi.fn(),
    hasOverlap: vi.fn(),
  },
}));

vi.mock('../repositories/audit.repository.js', () => ({
  auditRepository: {
    log: vi.fn(),
  },
}));

vi.mock('../db/client.js', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

describe('swapService - Kiểm thử nghiệp vụ Đổi ca & Chợ ca (SRS v1.1 & Rule 30)', () => {
  const storeId = 1;
  const userA = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const userB = '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const adminId = '33333333-cccc-cccc-cccc-cccccccccccc';

  const shiftAId = 'shift-aaaa-1111';
  const shiftBId = 'shift-bbbb-2222';

  // Mốc thời gian chuẩn: Thứ Ba 2026-10-06 08:00 ICT (UTC+7)
  // Thời điểm "hiện tại" của test: 2026-10-04 07:00 ICT (cách đúng 49 tiếng)
  const baseNow = new Date('2026-10-04T00:00:00.000Z'); // 07:00 ICT
  const mockClock = () => new Date(baseNow);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Đổi ca 1-1 (createSwapRequest)', () => {
    it('Chặn đổi ca với chính mình -> ném SWAP_CANNOT_SWAP_SELF', async () => {
      await expect(
        swapService.createSwapRequest({
          storeId,
          requesterId: userA,
          receiverId: userA,
          requesterShiftId: shiftAId,
          receiverShiftId: shiftBId,
          clock: mockClock,
        }),
      ).rejects.toThrow(AppError);
    });

    it('Chặn khi ca của mình không phải do mình phụ trách -> ném ForbiddenError', async () => {
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: shiftAId,
        store_id: storeId,
        assigned_to: 'someone-else',
        work_date: '2026-10-06',
        status: 'scheduled',
        shift_type: 'REGULAR',
        source: 'manual',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: shiftBId,
        store_id: storeId,
        assigned_to: userB,
        work_date: '2026-10-06',
        status: 'scheduled',
        shift_type: 'REGULAR',
        source: 'manual',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });

      await expect(
        swapService.createSwapRequest({
          storeId,
          requesterId: userA,
          receiverId: userB,
          requesterShiftId: shiftAId,
          receiverShiftId: shiftBId,
          clock: mockClock,
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('Biên 48h: Ca cách 47h59p -> thất bại (SWAP_LT_48H)', async () => {
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: shiftAId,
        store_id: storeId,
        assigned_to: userA,
        work_date: '2026-10-06',
        status: 'scheduled',
        shift_type: 'REGULAR',
        source: 'manual',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: shiftBId,
        store_id: storeId,
        assigned_to: userB,
        work_date: '2026-10-06',
        status: 'scheduled',
        shift_type: 'REGULAR',
        source: 'manual',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });

      // 47 giờ 59 phút kể từ baseNow
      const startsAt47h59m = new Date(baseNow.getTime() + (47 * 60 + 59) * 60 * 1000);
      vi.mocked(dbClient.query).mockResolvedValueOnce({
        rows: [{ starts_at: startsAt47h59m.toISOString(), work_date: '2026-10-06' }],
        rowCount: 1,
      } as any);
      vi.mocked(dbClient.query).mockResolvedValueOnce({
        rows: [{ starts_at: new Date(baseNow.getTime() + 60 * 3600 * 1000).toISOString(), work_date: '2026-10-06' }],
        rowCount: 1,
      } as any);

      try {
        await swapService.createSwapRequest({
          storeId,
          requesterId: userA,
          receiverId: userB,
          requesterShiftId: shiftAId,
          receiverShiftId: shiftBId,
          clock: mockClock,
        });
        expect.unreachable('Should have thrown SWAP_LT_48H');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCode.SWAP_LT_48H);
      }
    });

    it('Ranh giới tuần: Ca A Chủ Nhật tuần này, Ca B Thứ Hai tuần sau -> thất bại (SWAP_NOT_SAME_WEEK)', async () => {
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: shiftAId,
        store_id: storeId,
        assigned_to: userA,
        work_date: '2026-10-11', // Chủ nhật
        status: 'scheduled',
        shift_type: 'REGULAR',
        source: 'manual',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: shiftBId,
        store_id: storeId,
        assigned_to: userB,
        work_date: '2026-10-12', // Thứ hai tuần kế
        status: 'scheduled',
        shift_type: 'REGULAR',
        source: 'manual',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });

      // Ca A: Chủ nhật 2026-10-11
      vi.mocked(dbClient.query).mockResolvedValueOnce({
        rows: [{ starts_at: '2026-10-11T01:00:00.000Z', work_date: '2026-10-11' }],
        rowCount: 1,
      } as any);
      // Ca B: Thứ hai 2026-10-12
      vi.mocked(dbClient.query).mockResolvedValueOnce({
        rows: [{ starts_at: '2026-10-12T01:00:00.000Z', work_date: '2026-10-12' }],
        rowCount: 1,
      } as any);

      try {
        await swapService.createSwapRequest({
          storeId,
          requesterId: userA,
          receiverId: userB,
          requesterShiftId: shiftAId,
          receiverShiftId: shiftBId,
          clock: mockClock,
        });
        expect.unreachable('Should have thrown SWAP_NOT_SAME_WEEK');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCode.SWAP_NOT_SAME_WEEK);
      }
    });

    it('Phát hiện trùng ca của người nhận -> thất bại (SWAP_RECEIVER_OVERLAP)', async () => {
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: shiftAId,
        store_id: storeId,
        assigned_to: userA,
        work_date: '2026-10-07',
        status: 'scheduled',
        shift_type: 'REGULAR',
        source: 'manual',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: shiftBId,
        store_id: storeId,
        assigned_to: userB,
        work_date: '2026-10-07',
        status: 'scheduled',
        shift_type: 'REGULAR',
        source: 'manual',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });

      // 2 ca cùng ngày Thứ Tư cách > 48h
      vi.mocked(dbClient.query).mockResolvedValueOnce({
        rows: [{ starts_at: '2026-10-07T01:00:00.000Z', work_date: '2026-10-07' }],
        rowCount: 1,
      } as any);
      vi.mocked(dbClient.query).mockResolvedValueOnce({
        rows: [{ starts_at: '2026-10-07T06:00:00.000Z', work_date: '2026-10-07' }],
        rowCount: 1,
      } as any);

      // Không có pending swap
      vi.mocked(swapRepository.findPendingByShiftId).mockResolvedValue(null);

      // User A nhận Ca B không trùng
      vi.mocked(shiftsRepository.hasOverlap).mockResolvedValueOnce({ hasOverlap: false });
      // Query count ca của User A = 1
      vi.mocked(dbClient.query).mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 } as any);

      // User B nhận Ca A BỊ TRÙNG
      vi.mocked(shiftsRepository.hasOverlap).mockResolvedValueOnce({
        hasOverlap: true,
        message: 'Trùng giờ với Ca chiều',
      });
      // Query count ca của User B = 1
      vi.mocked(dbClient.query).mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 } as any);

      try {
        await swapService.createSwapRequest({
          storeId,
          requesterId: userA,
          receiverId: userB,
          requesterShiftId: shiftAId,
          receiverShiftId: shiftBId,
          clock: mockClock,
        });
        expect.unreachable('Should have thrown SWAP_RECEIVER_OVERLAP');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCode.SWAP_RECEIVER_OVERLAP);
      }
    });

    it('Happy path: Cùng tuần, >= 48h, không trùng ca -> tạo thành công', async () => {
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: shiftAId,
        store_id: storeId,
        assigned_to: userA,
        work_date: '2026-10-07',
        status: 'scheduled',
        shift_type: 'REGULAR',
        source: 'manual',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: shiftBId,
        store_id: storeId,
        assigned_to: userB,
        work_date: '2026-10-08',
        status: 'scheduled',
        shift_type: 'REGULAR',
        source: 'manual',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });

      // 2 ca cách > 48h trong cùng tuần
      vi.mocked(dbClient.query).mockResolvedValueOnce({
        rows: [{ starts_at: '2026-10-07T01:00:00.000Z', work_date: '2026-10-07' }],
        rowCount: 1,
      } as any);
      vi.mocked(dbClient.query).mockResolvedValueOnce({
        rows: [{ starts_at: '2026-10-08T01:00:00.000Z', work_date: '2026-10-08' }],
        rowCount: 1,
      } as any);

      vi.mocked(swapRepository.findPendingByShiftId).mockResolvedValue(null);

      // Overlap A và B đều false
      vi.mocked(shiftsRepository.hasOverlap).mockResolvedValueOnce({ hasOverlap: false });
      vi.mocked(dbClient.query).mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 } as any);

      vi.mocked(shiftsRepository.hasOverlap).mockResolvedValueOnce({ hasOverlap: false });
      vi.mocked(dbClient.query).mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 } as any);

      vi.mocked(swapRepository.create).mockResolvedValueOnce({
        id: 'new-swap-id',
        store_id: storeId,
        requester_id: userA,
        requester_shift: shiftAId,
        receiver_id: userB,
        receiver_shift: shiftBId,
        status: 'pending',
        type: 'swap',
        reason: 'Có việc gia đình',
        admin_note: null,
        reviewed_by: null,
        reviewed_at: null,
        expires_at: null,
        claimed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await swapService.createSwapRequest({
        storeId,
        requesterId: userA,
        receiverId: userB,
        requesterShiftId: shiftAId,
        receiverShiftId: shiftBId,
        reason: 'Có việc gia đình',
        clock: mockClock,
      });

      expect(result.id).toBe('new-swap-id');
      expect(result.status).toBe('pending');
      expect(auditRepository.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SWAP_REQUEST_CREATED' }),
      );
    });
  });

  describe('2. Shift Pool (Chợ ca)', () => {
    it('Đẩy ca lên chợ khi ca >= 48h -> thành công', async () => {
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: shiftAId,
        store_id: storeId,
        assigned_to: userA,
        work_date: '2026-10-08',
        status: 'scheduled',
        shift_type: 'REGULAR',
        source: 'manual',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });

      vi.mocked(dbClient.query).mockResolvedValueOnce({
        rows: [{ starts_at: '2026-10-08T01:00:00.000Z', work_date: '2026-10-08' }],
        rowCount: 1,
      } as any);

      vi.mocked(swapRepository.findPendingByShiftId).mockResolvedValueOnce(null);

      vi.mocked(swapRepository.create).mockResolvedValueOnce({
        id: 'pool-swap-id',
        store_id: storeId,
        requester_id: userA,
        requester_shift: shiftAId,
        receiver_id: null,
        receiver_shift: null,
        status: 'pending',
        type: 'pool',
        reason: 'Bận việc',
        admin_note: null,
        reviewed_by: null,
        reviewed_at: null,
        expires_at: new Date('2026-10-06T01:00:00.000Z'),
        claimed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await swapService.publishToPool({
        storeId,
        requesterId: userA,
        shiftId: shiftAId,
        clock: mockClock,
      });

      expect(res.type).toBe('pool');
      expect(auditRepository.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SHIFT_POOLED' }),
      );
    });

    it('Nhận ca từ Chợ ca (Claim): Chủ ca không được tự nhận -> ném SWAP_CANNOT_SWAP_SELF', async () => {
      vi.mocked(swapRepository.findById).mockResolvedValueOnce({
        id: 'pool-id',
        store_id: storeId,
        requester_id: userA,
        requester_shift: shiftAId,
        receiver_id: null,
        receiver_shift: null,
        status: 'pending',
        type: 'pool',
        reason: null,
        admin_note: null,
        reviewed_by: null,
        reviewed_at: null,
        expires_at: null,
        claimed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        requester_name: 'Nguyễn Văn An',
        requester_shift_date: '2026-10-08',
      });

      await expect(
        swapService.claimPoolShift({
          storeId,
          claimerId: userA,
          swapRequestId: 'pool-id',
          clock: mockClock,
        }),
      ).rejects.toThrow(AppError);
    });

    it('Nhận ca từ Chợ ca (Claim): Thành công với khoá FOR UPDATE', async () => {
      vi.mocked(swapRepository.findById).mockResolvedValueOnce({
        id: 'pool-id',
        store_id: storeId,
        requester_id: userA,
        requester_shift: shiftAId,
        receiver_id: null,
        receiver_shift: null,
        status: 'pending',
        type: 'pool',
        reason: null,
        admin_note: null,
        reviewed_by: null,
        reviewed_at: null,
        expires_at: null,
        claimed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        requester_name: 'Nguyễn Văn An',
        requester_shift_date: '2026-10-08',
      });

      vi.mocked(dbClient.query).mockResolvedValueOnce({
        rows: [{ starts_at: '2026-10-08T01:00:00.000Z', work_date: '2026-10-08' }],
        rowCount: 1,
      } as any);

      // Không trùng ca, mới có 0 ca
      vi.mocked(shiftsRepository.hasOverlap).mockResolvedValueOnce({ hasOverlap: false });
      vi.mocked(dbClient.query).mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 } as any);

      vi.mocked(swapRepository.claimPoolShiftWithLock).mockResolvedValueOnce({
        id: 'pool-id',
        store_id: storeId,
        requester_id: userA,
        requester_shift: shiftAId,
        receiver_id: userB,
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

      const res = await swapService.claimPoolShift({
        storeId,
        claimerId: userB,
        swapRequestId: 'pool-id',
        clock: mockClock,
      });

      expect(res.status).toBe('approved');
      expect(res.receiver_id).toBe(userB);
      expect(auditRepository.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SHIFT_POOL_CLAIMED' }),
      );
    });
  });

  describe('3. Admin Xét Duyệt Đơn (Review)', () => {
    it('Admin từ chối đơn -> cập nhật status = rejected', async () => {
      vi.mocked(swapRepository.findById).mockResolvedValueOnce({
        id: 'swap-review-id',
        store_id: storeId,
        requester_id: userA,
        requester_shift: shiftAId,
        receiver_id: userB,
        receiver_shift: shiftBId,
        status: 'pending',
        type: 'swap',
        reason: null,
        admin_note: null,
        reviewed_by: null,
        reviewed_at: null,
        expires_at: null,
        claimed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        requester_name: 'An',
        requester_shift_date: '2026-10-08',
      });

      vi.mocked(swapRepository.reviewSwapWithLock).mockResolvedValueOnce({
        id: 'swap-review-id',
        store_id: storeId,
        requester_id: userA,
        requester_shift: shiftAId,
        receiver_id: userB,
        receiver_shift: shiftBId,
        status: 'rejected',
        type: 'swap',
        reason: null,
        admin_note: 'Không phù hợp',
        reviewed_by: adminId,
        reviewed_at: new Date(),
        expires_at: null,
        claimed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await swapService.reviewSwapRequest({
        storeId,
        adminId,
        swapRequestId: 'swap-review-id',
        action: 'reject',
        adminNote: 'Không phù hợp',
        clock: mockClock,
      });

      expect(res.status).toBe('rejected');
      expect(auditRepository.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SWAP_REQUEST_REJECTED' }),
      );
    });
  });
});
