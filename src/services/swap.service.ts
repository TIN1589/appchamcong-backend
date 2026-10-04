import { swapRepository, type SwapDetails, type SwapRequestRecord } from '../repositories/swap.repository.js';
import { shiftsRepository } from '../repositories/shifts.repository.js';
import { usersRepository } from '../repositories/users.repository.js';
import { auditRepository } from '../repositories/audit.repository.js';
import { telegramService } from './telegram.service.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ErrorCode,
} from '../lib/errors.js';
import { diffHours, getWeekRange, formatTimeVN } from '../lib/timezone.js';
import { type Clock, systemClock } from '../lib/clock.js';
import { query } from '../db/client.js';

export interface CreateSwapRequestInput {
  storeId: number;
  requesterId: string;
  requesterShiftId: string;
  receiverId: string;
  receiverShiftId: string;
  reason?: string | undefined;
  clock?: Clock | undefined;
}

export interface PublishPoolShiftInput {
  storeId: number;
  requesterId: string;
  shiftId: string;
  reason?: string | undefined;
  clock?: Clock | undefined;
}

export interface ClaimPoolShiftInput {
  storeId: number;
  claimerId: string;
  swapRequestId: string;
  clock?: Clock | undefined;
}

export interface ReviewSwapInput {
  storeId: number;
  adminId: string;
  swapRequestId: string;
  action: 'approve' | 'reject';
  adminNote?: string | undefined;
  clock?: Clock | undefined;
}

async function getShiftStartsAt(shiftId: string): Promise<{ startsAt: Date; workDate: string } | null> {
  const res = await query<{ starts_at: string; work_date: string }>(
    `SELECT ss.starts_at, to_char(s.work_date, 'YYYY-MM-DD') AS work_date
     FROM shifts s
     JOIN shift_segments ss ON ss.shift_id = s.id
     WHERE s.id = $1
     ORDER BY ss.sort_order ASC LIMIT 1`,
    [shiftId],
  );
  if (!res.rows[0]) return null;
  return {
    startsAt: new Date(res.rows[0].starts_at),
    workDate: res.rows[0].work_date,
  };
}

async function countUserShiftsInDate(userId: string, workDate: string, excludeShiftId?: string): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM shifts
     WHERE assigned_to = $1 AND work_date = $2
       AND status IN ('assigned', 'scheduled', 'completed')
       AND ($3::uuid IS NULL OR id != $3::uuid)`,
    [userId, workDate, excludeShiftId ?? null],
  );
  return Number(res.rows[0]?.count ?? 0);
}

export const swapService = {
  /**
   * Tạo yêu cầu đổi ca 1-1 giữa 2 nhân viên
   */
  async createSwapRequest(input: CreateSwapRequestInput): Promise<SwapRequestRecord> {
    const now = (input.clock ?? systemClock)();

    if (input.requesterId === input.receiverId) {
      throw new BadRequestError(ErrorCode.SWAP_CANNOT_SWAP_SELF, 'Không thể đổi ca với chính mình');
    }

    // 1. Kiểm tra 2 ca có tồn tại và đúng chủ sở hữu
    const [s1, s2] = await Promise.all([
      shiftsRepository.findById(input.requesterShiftId, input.storeId),
      shiftsRepository.findById(input.receiverShiftId, input.storeId),
    ]);

    if (!s1 || !s2) throw new NotFoundError('Ca làm việc đổi ca');

    if (s1.assigned_to !== input.requesterId) {
      throw new ForbiddenError('Bạn chỉ có thể đổi ca do chính bạn phụ trách');
    }
    if (s2.assigned_to !== input.receiverId) {
      throw new BadRequestError(ErrorCode.SWAP_NOT_OWNER, 'Ca nhận không thuộc quyền phụ trách của nhân viên chỉ định');
    }

    // 2. Kiểm tra giờ bắt đầu của 2 ca
    const [time1, time2] = await Promise.all([
      getShiftStartsAt(input.requesterShiftId),
      getShiftStartsAt(input.receiverShiftId),
    ]);
    if (!time1 || !time2) throw new NotFoundError('Chi tiết thời gian ca');

    // Quy tắc >= 48h
    if (diffHours(now, time1.startsAt) < 48) {
      throw new BadRequestError(ErrorCode.SWAP_LT_48H, 'Ca của bạn bắt đầu trong vòng dưới 48 giờ, không thể tạo đơn đổi');
    }
    if (diffHours(now, time2.startsAt) < 48) {
      throw new BadRequestError(ErrorCode.SWAP_LT_48H, 'Ca của đồng nghiệp bắt đầu trong vòng dưới 48 giờ, không thể tạo đơn đổi');
    }

    // Quy tắc Cùng tuần
    const week1 = getWeekRange(time1.startsAt);
    const week2 = getWeekRange(time2.startsAt);
    if (week1.startDate !== week2.startDate) {
      throw new BadRequestError(ErrorCode.SWAP_NOT_SAME_WEEK, 'Chỉ được đổi ca thuộc cùng một tuần làm việc (Thứ Hai đến Chủ Nhật)');
    }

    // 3. Kiểm tra xem 2 ca có đang trong đơn pending nào khác không
    const [pend1, pend2] = await Promise.all([
      swapRepository.findPendingByShiftId(input.requesterShiftId, input.storeId),
      swapRepository.findPendingByShiftId(input.receiverShiftId, input.storeId),
    ]);
    if (pend1 || pend2) {
      throw new ConflictError(ErrorCode.SWAP_ALREADY_PENDING, 'Một trong hai ca đang có yêu cầu đổi ca chờ xử lý');
    }

    // 4. Kiểm tra User A nhận Ca B có bị trùng ca hay vượt 2 ca/ngày không
    const [overlapA, countA] = await Promise.all([
      shiftsRepository.hasOverlap(input.requesterId, time2.workDate, input.receiverShiftId, input.storeId, input.requesterShiftId),
      countUserShiftsInDate(input.requesterId, time2.workDate, input.requesterShiftId),
    ]);
    if (overlapA.hasOverlap) {
      throw new ConflictError(ErrorCode.SWAP_RECEIVER_OVERLAP, `Bạn sẽ bị trùng ca khi nhận ca này: ${overlapA.message}`);
    }
    if (countA >= 2) {
      throw new ConflictError(ErrorCode.SWAP_RECEIVER_MAX_SHIFTS, 'Bạn đã có tối đa 2 ca trong ngày của ca nhận');
    }

    // 5. Kiểm tra User B nhận Ca A có bị trùng ca hay vượt 2 ca/ngày không
    const [overlapB, countB] = await Promise.all([
      shiftsRepository.hasOverlap(input.receiverId, time1.workDate, input.requesterShiftId, input.storeId, input.receiverShiftId),
      countUserShiftsInDate(input.receiverId, time1.workDate, input.receiverShiftId),
    ]);
    if (overlapB.hasOverlap) {
      throw new ConflictError(ErrorCode.SWAP_RECEIVER_OVERLAP, `Đồng nghiệp sẽ bị trùng ca khi nhận ca của bạn: ${overlapB.message}`);
    }
    if (countB >= 2) {
      throw new ConflictError(ErrorCode.SWAP_RECEIVER_MAX_SHIFTS, 'Đồng nghiệp đã có tối đa 2 ca trong ngày của ca nhận');
    }

    // 6. Tạo đơn
    const record = await swapRepository.create({
      storeId: input.storeId,
      requesterId: input.requesterId,
      requesterShiftId: input.requesterShiftId,
      type: 'swap',
      receiverId: input.receiverId,
      receiverShiftId: input.receiverShiftId,
      reason: input.reason,
    });

    await auditRepository.log({
      userId: input.requesterId,
      action: 'SWAP_REQUEST_CREATED',
      detail: { requestId: record.id, requesterShiftId: input.requesterShiftId, receiverShiftId: input.receiverShiftId },
    });

    // Thông báo Telegram non-blocking
    void Promise.all([
      usersRepository.findById(input.requesterId, input.storeId),
      usersRepository.findById(input.receiverId, input.storeId),
    ]).then(([reqUser, recUser]) => {
      if (reqUser && recUser) {
        void telegramService.notifySwapRequested({
          receiverChatId: recUser.telegram_chat_id,
          requesterName: reqUser.full_name,
          receiverName: recUser.full_name,
          targetShiftInfo: `${time2.workDate} (bắt đầu ${formatTimeVN(time2.startsAt)})`,
          myShiftInfo: `${time1.workDate} (bắt đầu ${formatTimeVN(time1.startsAt)})`,
          reason: input.reason,
        });
      }
    }).catch(() => { return; });

    return record;
  },

  /**
   * Đẩy ca lên Shift Pool (Chợ ca)
   */
  async publishToPool(input: PublishPoolShiftInput): Promise<SwapRequestRecord> {
    const now = (input.clock ?? systemClock)();

    const shift = await shiftsRepository.findById(input.shiftId, input.storeId);
    if (!shift) throw new NotFoundError('Ca làm việc');

    if (shift.assigned_to !== input.requesterId) {
      throw new ForbiddenError('Bạn chỉ có thể nhượng ca do bạn phụ trách');
    }

    const time = await getShiftStartsAt(input.shiftId);
    if (!time) throw new NotFoundError('Thời gian ca');

    if (diffHours(now, time.startsAt) < 48) {
      throw new BadRequestError(ErrorCode.SWAP_LT_48H, 'Ca bắt đầu trong vòng dưới 48 giờ, không thể đẩy lên Chợ ca');
    }

    const pending = await swapRepository.findPendingByShiftId(input.shiftId, input.storeId);
    if (pending) {
      throw new ConflictError(ErrorCode.SWAP_ALREADY_PENDING, 'Ca này đang có yêu cầu đổi hoặc nhượng ca chờ xử lý');
    }

    // Hạn nhận ca: tối đa trước ca 48h
    const expiresAt = new Date(time.startsAt.getTime() - 48 * 3600 * 1000);

    const record = await swapRepository.create({
      storeId: input.storeId,
      requesterId: input.requesterId,
      requesterShiftId: input.shiftId,
      type: 'pool',
      reason: input.reason,
      expiresAt,
    });

    await auditRepository.log({
      userId: input.requesterId,
      action: 'SHIFT_POOLED',
      detail: { requestId: record.id, shiftId: input.shiftId, expiresAt },
    });

    // Thông báo Telegram khi có ca mới lên Chợ ca
    void usersRepository.findById(input.requesterId, input.storeId).then((reqUser) => {
      if (reqUser) {
        void telegramService.notifyShiftPoolCreated({
          requesterName: reqUser.full_name,
          workDate: time.workDate,
          timeRange: `bắt đầu ${formatTimeVN(time.startsAt)}`,
          reason: input.reason,
        });
      }
    }).catch(() => { return; });

    return record;
  },

  /**
   * Nhận ca từ Shift Pool (Chợ ca)
   */
  async claimPoolShift(input: ClaimPoolShiftInput): Promise<SwapRequestRecord> {
    const now = (input.clock ?? systemClock)();

    const swapReq = await swapRepository.findById(input.swapRequestId, input.storeId);
    if (!swapReq || swapReq.type !== 'pool' || swapReq.status !== 'pending' || swapReq.receiver_id !== null) {
      throw new ConflictError(ErrorCode.POOL_SHIFT_NOT_AVAILABLE, 'Ca trong Chợ ca không còn khả dụng hoặc đã có người nhận');
    }

    if (swapReq.requester_id === input.claimerId) {
      throw new BadRequestError(ErrorCode.SWAP_CANNOT_SWAP_SELF, 'Bạn không thể nhận lại chính ca bạn đã đẩy lên Chợ');
    }

    const time = await getShiftStartsAt(swapReq.requester_shift);
    if (!time) throw new NotFoundError('Thời gian ca');

    if (diffHours(now, time.startsAt) < 48) {
      throw new BadRequestError(ErrorCode.SWAP_LT_48H, 'Hạn nhận ca đã hết (yêu cầu trước giờ ca tối thiểu 48 giờ)');
    }

    // Kiểm tra người claim có bị trùng ca hoặc vượt 2 ca trong ngày đó không
    const [overlap, count] = await Promise.all([
      shiftsRepository.hasOverlap(input.claimerId, time.workDate, swapReq.requester_shift, input.storeId),
      countUserShiftsInDate(input.claimerId, time.workDate),
    ]);
    if (overlap.hasOverlap) {
      throw new ConflictError(ErrorCode.SWAP_RECEIVER_OVERLAP, `Bạn đã có ca trùng thời gian trong ngày này: ${overlap.message}`);
    }
    if (count >= 2) {
      throw new ConflictError(ErrorCode.SWAP_RECEIVER_MAX_SHIFTS, 'Bạn đã có tối đa 2 ca trong ngày của ca này');
    }

    // Thực hiện claim có khoá FOR UPDATE chống race condition
    const updated = await swapRepository.claimPoolShiftWithLock(input.swapRequestId, input.storeId, input.claimerId);
    if (!updated) {
      throw new ConflictError(ErrorCode.POOL_SHIFT_NOT_AVAILABLE, 'Ca vừa được người khác nhận trước');
    }

    await auditRepository.log({
      userId: input.claimerId,
      action: 'SHIFT_POOL_CLAIMED',
      detail: { requestId: input.swapRequestId, shiftId: swapReq.requester_shift },
    });

    // Thông báo Telegram khi ca được nhận thành công
    void Promise.all([
      usersRepository.findById(swapReq.requester_id, input.storeId),
      usersRepository.findById(input.claimerId, input.storeId),
    ]).then(([reqUser, claimUser]) => {
      if (reqUser && claimUser) {
        void telegramService.notifyShiftPoolClaimed({
          requesterChatId: reqUser.telegram_chat_id,
          requesterName: reqUser.full_name,
          claimerName: claimUser.full_name,
          workDate: time.workDate,
          timeRange: `bắt đầu ${formatTimeVN(time.startsAt)}`,
        });
      }
    }).catch(() => { return; });

    return updated;
  },

  /**
   * Admin duyệt hoặc từ chối đơn đổi ca 1-1
   */
  async reviewSwapRequest(input: ReviewSwapInput): Promise<SwapRequestRecord> {
    const now = (input.clock ?? systemClock)();

    const swapReq = await swapRepository.findById(input.swapRequestId, input.storeId);
    if (!swapReq) throw new NotFoundError('Đơn đổi ca');
    if (swapReq.status !== 'pending') {
      throw new ConflictError(ErrorCode.SWAP_INVALID_STATUS, 'Đơn đổi ca không ở trạng thái chờ duyệt');
    }

    if (input.action === 'reject') {
      const rejected = await swapRepository.reviewSwapWithLock(
        input.swapRequestId,
        input.storeId,
        input.adminId,
        'reject',
        input.adminNote,
      );
      if (!rejected) throw new NotFoundError('Đơn đổi ca');

      await auditRepository.log({
        userId: input.adminId,
        action: 'SWAP_REQUEST_REJECTED',
        detail: { requestId: input.swapRequestId, reason: input.adminNote },
      });

      // Bắn thông báo kết quả từ chối qua Telegram
      void Promise.all([
        usersRepository.findById(swapReq.requester_id, input.storeId),
        swapReq.receiver_id ? usersRepository.findById(swapReq.receiver_id, input.storeId) : Promise.resolve(null),
        usersRepository.findById(input.adminId, input.storeId),
      ]).then(([reqUser, recUser, adminUser]) => {
        const adminName = adminUser?.full_name ?? 'Quản lý';
        if (reqUser) {
          void telegramService.notifySwapReviewed({
            recipientChatId: reqUser.telegram_chat_id,
            recipientName: reqUser.full_name,
            status: 'rejected',
            adminName,
            note: input.adminNote,
          });
        }
        if (recUser) {
          void telegramService.notifySwapReviewed({
            recipientChatId: recUser.telegram_chat_id,
            recipientName: recUser.full_name,
            status: 'rejected',
            adminName,
            note: input.adminNote,
          });
        }
      }).catch(() => { return; });

      return rejected;
    }

    // Khi duyệt (Approve): Re-validate toàn bộ quy tắc lúc approve theo rule 10-backend.md
    if (!swapReq.receiver_id || !swapReq.receiver_shift) {
      throw new BadRequestError(ErrorCode.VALIDATION_ERROR, 'Đơn đổi ca thiếu thông tin ca đối ứng');
    }

    const [time1, time2] = await Promise.all([
      getShiftStartsAt(swapReq.requester_shift),
      getShiftStartsAt(swapReq.receiver_shift),
    ]);
    if (!time1 || !time2) throw new NotFoundError('Thời gian ca đổi');

    if (diffHours(now, time1.startsAt) < 48 || diffHours(now, time2.startsAt) < 48) {
      throw new BadRequestError(ErrorCode.SWAP_LT_48H, 'Một trong hai ca đã vào khung dưới 48 giờ tại thời điểm duyệt');
    }

    // Kiểm tra lại trùng ca
    const [overlapA, overlapB] = await Promise.all([
      shiftsRepository.hasOverlap(swapReq.requester_id, time2.workDate, swapReq.receiver_shift, input.storeId, swapReq.requester_shift),
      shiftsRepository.hasOverlap(swapReq.receiver_id, time1.workDate, swapReq.requester_shift, input.storeId, swapReq.receiver_shift),
    ]);
    if (overlapA.hasOverlap || overlapB.hasOverlap) {
      throw new ConflictError(ErrorCode.SWAP_RECEIVER_OVERLAP, 'Phát hiện trùng ca phát sinh tại thời điểm duyệt');
    }

    const approved = await swapRepository.reviewSwapWithLock(
      input.swapRequestId,
      input.storeId,
      input.adminId,
      'approve',
      input.adminNote,
    );
    if (!approved) throw new NotFoundError('Đơn đổi ca');

    await auditRepository.log({
      userId: input.adminId,
      action: 'SWAP_REQUEST_APPROVED',
      detail: { requestId: input.swapRequestId, requesterShift: swapReq.requester_shift, receiverShift: swapReq.receiver_shift },
    });

    // Bắn thông báo kết quả chấp thuận qua Telegram
    void Promise.all([
      usersRepository.findById(swapReq.requester_id, input.storeId),
      swapReq.receiver_id ? usersRepository.findById(swapReq.receiver_id, input.storeId) : Promise.resolve(null),
      usersRepository.findById(input.adminId, input.storeId),
    ]).then(([reqUser, recUser, adminUser]) => {
      const adminName = adminUser?.full_name ?? 'Quản lý';
      if (reqUser) {
        void telegramService.notifySwapReviewed({
          recipientChatId: reqUser.telegram_chat_id,
          recipientName: reqUser.full_name,
          status: 'approved',
          adminName,
          note: input.adminNote,
        });
      }
      if (recUser) {
        void telegramService.notifySwapReviewed({
          recipientChatId: recUser.telegram_chat_id,
          recipientName: recUser.full_name,
          status: 'approved',
          adminName,
          note: input.adminNote,
        });
      }
    }).catch(() => { return; });

    return approved;
  },

  /**
   * Huỷ đơn đổi ca
   */
  async cancelSwapRequest(swapRequestId: string, storeId: number, userId: string): Promise<void> {
    const cancelled = await swapRepository.cancel(swapRequestId, storeId, userId);
    if (!cancelled) {
      throw new BadRequestError(ErrorCode.SWAP_INVALID_STATUS, 'Không thể huỷ đơn (đơn đã được duyệt hoặc không phải của bạn)');
    }

    await auditRepository.log({
      userId,
      action: 'SWAP_REQUEST_CANCELLED',
      detail: { requestId: swapRequestId },
    });
  },

  async list(
    storeId: number,
    filters?: {
      userId?: string | undefined;
      status?: SwapDetails['status'] | undefined;
      type?: SwapDetails['type'] | undefined;
    },
  ): Promise<SwapDetails[]> {
    return swapRepository.list(storeId, filters);
  },

  async listPoolShifts(storeId: number): Promise<SwapDetails[]> {
    return swapRepository.listPoolShifts(storeId);
  },

  async getById(id: string, storeId: number): Promise<SwapDetails> {
    const item = await swapRepository.findById(id, storeId);
    if (!item) throw new NotFoundError('Đơn đổi ca');
    return item;
  },
};
