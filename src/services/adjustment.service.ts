import { type Clock, systemClock } from '../lib/clock.js';
import {
  BadRequestError,
  ErrorCode,
  ForbiddenError,
  NotFoundError,
} from '../lib/errors.js';
import {
  adjustmentRepository,
  AdjustmentFilter,
  AdjustmentRequestRecord,
  AdjustmentRequestWithDetails,
  AdjustmentType,
} from '../repositories/adjustment.repository.js';
import { attendanceRepository } from '../repositories/attendance.repository.js';

export interface CreateAdjustmentServiceInput {
  storeId: number;
  userId: string;
  shiftId: string;
  segmentId: string;
  requestType: AdjustmentType;
  reason: string;
  proposedCheckinAt?: Date | undefined;
  proposedCheckoutAt?: Date | undefined;
  proposedMinutes?: number | undefined;
}

export interface CurrentUserPayload {
  id: string;
  storeId: number;
  role: 'admin' | 'staff';
}

export class AdjustmentService {
  private clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.clock = clock;
  }

  setClock(clock: Clock): void {
    this.clock = clock;
  }

  getClock(): Clock {
    return this.clock;
  }

  /**
   * Tạo đơn ngoại lệ (Staff & Admin)
   */
  async createRequest(
    input: CreateAdjustmentServiceInput,
    currentUser: CurrentUserPayload,
  ): Promise<AdjustmentRequestRecord> {
    const {
      storeId,
      userId,
      shiftId,
      segmentId,
      requestType,
      reason,
      proposedCheckinAt,
      proposedCheckoutAt,
      proposedMinutes,
    } = input;

    // 1. Staff chỉ được tạo đơn cho chính mình
    if (currentUser.role !== 'admin' && currentUser.id !== userId) {
      throw new ForbiddenError('Không được phép tạo đơn cho nhân viên khác');
    }

    // 2. Xác thực phân đoạn ca làm việc tồn tại và thuộc về user
    const segment = await attendanceRepository.findSegmentDetails(shiftId, segmentId, userId);
    if (!segment) {
      throw new NotFoundError('Phân đoạn ca làm việc của nhân viên');
    }

    // 3. Quy tắc 7 ngày gần nhất: Không được gửi đơn cho ca quá 7 ngày trước
    const now = this.clock();
    const diffMs = now.getTime() - segment.starts_at.getTime();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    if (diffMs > SEVEN_DAYS_MS) {
      throw new BadRequestError(
        ErrorCode.ADJUSTMENT_WINDOW_EXPIRED,
        'Chỉ được gửi đơn ngoại lệ cho ca làm việc trong vòng 7 ngày gần nhất',
      );
    }

    // 4. Kiểm tra trùng đơn pending (Tối đa 1 đơn pending cho mỗi segment, type)
    const existingPending = await adjustmentRepository.findPendingBySegmentAndType(
      userId,
      segmentId,
      requestType,
    );
    if (existingPending) {
      throw new BadRequestError(
        ErrorCode.ADJUSTMENT_DUPLICATE_PENDING,
        'Đã có đơn ngoại lệ loại này đang chờ duyệt cho ca làm việc này',
      );
    }

    // 5. Kiểm tra dữ liệu đề xuất tương ứng với từng loại đơn
    if (requestType === 'forgot_checkin' && !proposedCheckinAt) {
      throw new BadRequestError(
        ErrorCode.VALIDATION_ERROR,
        'Đơn quên check-in bắt buộc phải có thời gian check-in đề xuất',
      );
    }

    if (requestType === 'forgot_checkout' && !proposedCheckoutAt) {
      throw new BadRequestError(
        ErrorCode.VALIDATION_ERROR,
        'Đơn quên check-out bắt buộc phải có thời gian check-out đề xuất',
      );
    }

    if (requestType === 'forgot_both') {
      if (!proposedCheckinAt || !proposedCheckoutAt) {
        throw new BadRequestError(
          ErrorCode.VALIDATION_ERROR,
          'Đơn quên cả check-in và check-out bắt buộc phải có đủ 2 mốc thời gian đề xuất',
        );
      }
      if (proposedCheckinAt.getTime() >= proposedCheckoutAt.getTime()) {
        throw new BadRequestError(
          ErrorCode.VALIDATION_ERROR,
          'Thời gian check-in đề xuất phải trước thời gian check-out',
        );
      }
    }

    if (requestType === 'overtime') {
      if (proposedMinutes === undefined || proposedMinutes <= 0) {
        throw new BadRequestError(
          ErrorCode.VALIDATION_ERROR,
          'Số phút làm thêm đề xuất phải lớn hơn 0',
        );
      }
    }

    // 6. Tìm bản ghi chấm công (nếu đã có) để gắn liên kết
    const attendance = await attendanceRepository.findBySegmentAndUser(segmentId, userId);

    return adjustmentRepository.create({
      storeId,
      userId,
      shiftId,
      segmentId,
      attendanceId: attendance?.id,
      requestType,
      reason,
      proposedCheckinAt,
      proposedCheckoutAt,
      proposedMinutes,
    });
  }

  /**
   * Xem chi tiết đơn ngoại lệ
   */
  async getById(id: string, currentUser: CurrentUserPayload): Promise<AdjustmentRequestWithDetails> {
    const request = await adjustmentRepository.findById(id);
    if (!request) {
      throw new NotFoundError('Đơn ngoại lệ');
    }

    // Staff chỉ xem được đơn của mình
    if (currentUser.role !== 'admin' && request.user_id !== currentUser.id) {
      throw new ForbiddenError('Không có quyền truy cập đơn của nhân viên khác');
    }

    return request;
  }

  /**
   * Lấy danh sách đơn ngoại lệ
   */
  async listRequests(
    filter: AdjustmentFilter,
    currentUser: CurrentUserPayload,
  ): Promise<AdjustmentRequestWithDetails[]> {
    // Nếu là staff: Bắt buộc chỉ lấy của chính mình
    if (currentUser.role !== 'admin') {
      filter.userId = currentUser.id;
    }

    return adjustmentRepository.list(filter);
  }

  /**
   * Nhân viên hủy đơn đang chờ duyệt của chính mình
   */
  async cancelRequest(id: string, currentUser: CurrentUserPayload): Promise<void> {
    const request = await adjustmentRepository.findById(id);
    if (!request) {
      throw new NotFoundError('Đơn ngoại lệ');
    }

    if (currentUser.role !== 'admin' && request.user_id !== currentUser.id) {
      throw new ForbiddenError('Không được phép hủy đơn của người khác');
    }

    if (request.status !== 'pending') {
      throw new BadRequestError(ErrorCode.VALIDATION_ERROR, 'Chỉ có thể hủy đơn khi đang chờ duyệt');
    }

    await adjustmentRepository.deletePending(id, request.user_id);
  }

  /**
   * Admin duyệt hoặc từ chối đơn ngoại lệ
   */
  async reviewRequest(params: {
    requestId: string;
    reviewer: CurrentUserPayload;
    decision: 'approved' | 'rejected';
    adminNote?: string | undefined;
  }): Promise<AdjustmentRequestWithDetails> {
    const { requestId, reviewer, decision, adminNote } = params;

    if (reviewer.role !== 'admin') {
      throw new ForbiddenError('Chỉ Admin mới có quyền duyệt đơn ngoại lệ');
    }

    return adjustmentRepository.reviewWithTransaction({
      requestId,
      reviewerAdminId: reviewer.id,
      decision,
      adminNote,
    });
  }
}

export const adjustmentService = new AdjustmentService();
