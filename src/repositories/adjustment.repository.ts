import pg from 'pg';
import { query, withTransaction } from '../db/client.js';
import {
  AppError,
  ConflictError,
  ErrorCode,
  NotFoundError,
} from '../lib/errors.js';
import { calcMetrics } from '../services/metrics.service.js';

export type AdjustmentType =
  | 'forgot_checkin'
  | 'forgot_checkout'
  | 'forgot_both'
  | 'official_late_early'
  | 'overtime';

export type AdjustmentStatus = 'pending' | 'approved' | 'rejected';

export interface AdjustmentRequestRecord {
  id: string;
  store_id: number;
  user_id: string;
  shift_id: string | null;
  segment_id: string | null;
  attendance_id: string | null;
  request_type: AdjustmentType;
  reason: string;
  proposed_checkin_at: Date | null;
  proposed_checkout_at: Date | null;
  proposed_minutes: number | null;
  status: AdjustmentStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  admin_note: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AdjustmentRequestWithDetails extends AdjustmentRequestRecord {
  user_name: string;
  user_email: string;
  reviewer_name?: string | null;
  shift_name?: string | null;
  starts_at?: Date | null;
  ends_at?: Date | null;
  work_date?: string | null;
}

export interface AdjustmentFilter {
  storeId: number;
  userId?: string | undefined;
  status?: AdjustmentStatus | undefined;
  requestType?: AdjustmentType | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
}

export interface CreateAdjustmentInput {
  storeId: number;
  userId: string;
  shiftId: string;
  segmentId: string;
  attendanceId?: string | undefined;
  requestType: AdjustmentType;
  reason: string;
  proposedCheckinAt?: Date | undefined;
  proposedCheckoutAt?: Date | undefined;
  proposedMinutes?: number | undefined;
}

export const adjustmentRepository = {
  async create(data: CreateAdjustmentInput): Promise<AdjustmentRequestRecord> {
    const res = await query<AdjustmentRequestRecord>(
      `INSERT INTO adjustment_requests (
         store_id, user_id, shift_id, segment_id, attendance_id,
         request_type, reason, proposed_checkin_at, proposed_checkout_at,
         proposed_minutes, status, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, 'pending', NOW(), NOW()
       ) RETURNING *`,
      [
        data.storeId,
        data.userId,
        data.shiftId,
        data.segmentId,
        data.attendanceId ?? null,
        data.requestType,
        data.reason,
        data.proposedCheckinAt ?? null,
        data.proposedCheckoutAt ?? null,
        data.proposedMinutes ?? null,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Không thể tạo đơn ngoại lệ');
    return row;
  },

  async findPendingBySegmentAndType(
    userId: string,
    segmentId: string,
    requestType: AdjustmentType,
  ): Promise<AdjustmentRequestRecord | null> {
    const res = await query<AdjustmentRequestRecord>(
      `SELECT * FROM adjustment_requests
       WHERE user_id = $1 AND segment_id = $2 AND request_type = $3 AND status = 'pending'
       LIMIT 1`,
      [userId, segmentId, requestType],
    );
    return res.rows[0] ?? null;
  },

  async findById(id: string): Promise<AdjustmentRequestWithDetails | null> {
    const res = await query<AdjustmentRequestWithDetails>(
      `SELECT 
         ar.*,
         u.full_name AS user_name,
         u.email AS user_email,
         rev.full_name AS reviewer_name,
         COALESCE(t.name, s.notes, 'Ca làm việc') AS shift_name,
         ss.starts_at,
         ss.ends_at,
         to_char(s.work_date, 'YYYY-MM-DD') AS work_date
       FROM adjustment_requests ar
       JOIN users u ON ar.user_id = u.id
       LEFT JOIN users rev ON ar.reviewed_by = rev.id
       LEFT JOIN shifts s ON ar.shift_id = s.id
       LEFT JOIN shift_segments ss ON ar.segment_id = ss.id
       LEFT JOIN shift_templates t ON s.template_id = t.id
       WHERE ar.id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  },

  async list(filter: AdjustmentFilter): Promise<AdjustmentRequestWithDetails[]> {
    let sql = `
      SELECT 
        ar.*,
        u.full_name AS user_name,
        u.email AS user_email,
        rev.full_name AS reviewer_name,
        COALESCE(t.name, s.notes, 'Ca làm việc') AS shift_name,
        ss.starts_at,
        ss.ends_at,
        to_char(s.work_date, 'YYYY-MM-DD') AS work_date
      FROM adjustment_requests ar
      JOIN users u ON ar.user_id = u.id
      LEFT JOIN users rev ON ar.reviewed_by = rev.id
      LEFT JOIN shifts s ON ar.shift_id = s.id
      LEFT JOIN shift_segments ss ON ar.segment_id = ss.id
      LEFT JOIN shift_templates t ON s.template_id = t.id
      WHERE ar.store_id = $1
    `;
    const params: unknown[] = [filter.storeId];

    if (filter.userId) {
      params.push(filter.userId);
      sql += ` AND ar.user_id = $${params.length}`;
    }
    if (filter.status) {
      params.push(filter.status);
      sql += ` AND ar.status = $${params.length}`;
    }
    if (filter.requestType) {
      params.push(filter.requestType);
      sql += ` AND ar.request_type = $${params.length}`;
    }
    if (filter.fromDate) {
      params.push(filter.fromDate);
      sql += ` AND ar.created_at >= $${params.length}::timestamptz`;
    }
    if (filter.toDate) {
      params.push(filter.toDate);
      sql += ` AND ar.created_at <= $${params.length}::timestamptz`;
    }

    sql += ` ORDER BY ar.created_at DESC`;

    const res = await query<AdjustmentRequestWithDetails>(sql, params);
    return res.rows;
  },

  async deletePending(id: string, userId: string): Promise<boolean> {
    const res = await query(
      `DELETE FROM adjustment_requests WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [id, userId],
    );
    return (res.rowCount ?? 0) > 0;
  },

  /**
   * Duyệt đơn ngoại lệ sử dụng transaction DB và SELECT ... FOR UPDATE
   * để chống race condition khi 2 admin cùng click duyệt hoặc gọi đồng thời.
   */
  async reviewWithTransaction(params: {
    requestId: string;
    reviewerAdminId: string;
    decision: 'approved' | 'rejected';
    adminNote?: string | undefined;
  }): Promise<AdjustmentRequestWithDetails> {
    const { requestId, reviewerAdminId, decision, adminNote } = params;

    return withTransaction(async (client: pg.PoolClient) => {
      // 1. SELECT ... FOR UPDATE trên đơn để khóa hàng
      const lockRes = await client.query<AdjustmentRequestRecord>(
        `SELECT * FROM adjustment_requests WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      const request = lockRes.rows[0];
      if (!request) {
        throw new NotFoundError('Đơn ngoại lệ');
      }

      if (request.status !== 'pending') {
        throw new ConflictError(ErrorCode.CONFLICT, 'Đơn này đã được xử lý trước đó');
      }

      // 2. Chặn Admin tự duyệt đơn của chính mình [A-SelfReview]
      if (request.user_id === reviewerAdminId) {
        throw new AppError(
          ErrorCode.ADJUSTMENT_CANNOT_REVIEW_SELF,
          'Người quản lý không được tự duyệt đơn ngoại lệ của chính mình',
          403,
        );
      }

      // 3. Cập nhật trạng thái đơn (UPDATE ... WHERE status = 'pending')
      const updateReqRes = await client.query<AdjustmentRequestRecord>(
        `UPDATE adjustment_requests
         SET status = $1, reviewed_by = $2, reviewed_at = NOW(), admin_note = $3, updated_at = NOW()
         WHERE id = $4 AND status = 'pending'
         RETURNING *`,
        [decision, reviewerAdminId, adminNote ?? null, requestId],
      );
      const updatedReq = updateReqRes.rows[0];
      if (!updatedReq) {
        throw new ConflictError(ErrorCode.CONFLICT, 'Đơn đã bị thay đổi trạng thái');
      }

      // 4. Nếu approved: cập nhật hoặc tạo mới bản ghi attendances
      if (decision === 'approved' && request.segment_id && request.shift_id) {
        await applyAdjustmentToAttendance(client, request);
      }

      // 5. Trả về thông tin chi tiết đầy đủ
      const fullRes = await client.query<AdjustmentRequestWithDetails>(
        `SELECT 
           ar.*,
           u.full_name AS user_name,
           u.email AS user_email,
           rev.full_name AS reviewer_name,
           COALESCE(t.name, s.notes, 'Ca làm việc') AS shift_name,
           ss.starts_at,
           ss.ends_at,
           to_char(s.work_date, 'YYYY-MM-DD') AS work_date
         FROM adjustment_requests ar
         JOIN users u ON ar.user_id = u.id
         LEFT JOIN users rev ON ar.reviewed_by = rev.id
         LEFT JOIN shifts s ON ar.shift_id = s.id
         LEFT JOIN shift_segments ss ON ar.segment_id = ss.id
         LEFT JOIN shift_templates t ON s.template_id = t.id
         WHERE ar.id = $1`,
        [requestId],
      );

      const result = fullRes.rows[0];
      if (!result) throw new Error('Không thể tải thông tin đơn sau duyệt');
      return result;
    });
  },
};

/**
 * Áp dụng điều chỉnh vào bảng attendances đồng bộ theo Single Source of Truth calcMetrics().
 */
async function applyAdjustmentToAttendance(
  client: pg.PoolClient,
  request: AdjustmentRequestRecord,
): Promise<void> {
  const { store_id, user_id, shift_id, segment_id, request_type } = request;
  if (!shift_id || !segment_id) return;

  // Lấy cấu hình store (grace_period_minutes)
  const storeRes = await client.query<{ grace_period_minutes: number }>(
    `SELECT grace_period_minutes FROM stores WHERE id = $1`,
    [store_id],
  );
  const gracePeriodMinutes = storeRes.rows[0]?.grace_period_minutes ?? 5;

  // Lấy chi tiết segment và ca
  const segRes = await client.query<{
    starts_at: Date;
    ends_at: Date;
    shift_type: 'REGULAR' | 'SPLIT' | 'FLEXIBLE';
  }>(
    `SELECT ss.starts_at, ss.ends_at, COALESCE(s.shift_type, 'REGULAR') AS shift_type
     FROM shift_segments ss
     JOIN shifts s ON ss.shift_id = s.id
     WHERE ss.id = $1`,
    [segment_id],
  );
  const segment = segRes.rows[0];
  if (!segment) {
    throw new NotFoundError('Phân đoạn ca làm việc');
  }

  // Khóa bản ghi attendances nếu đã tồn tại
  const attRes = await client.query<{
    id: string;
    checkin_at: Date | null;
    checkout_at: Date | null;
    original_checkin_at: Date | null;
    original_checkout_at: Date | null;
    late_minutes: number;
    early_leave_minutes: number;
    actual_minutes: number | null;
    ot_minutes: number;
    status: string;
    source: string;
    notes: string | null;
  }>(
    `SELECT * FROM attendances WHERE segment_id = $1 AND user_id = $2 FOR UPDATE`,
    [segment_id, user_id],
  );
  const existingAtt = attRes.rows[0];

  if (!existingAtt) {
    // Trường hợp chưa có bản ghi attendance -> Tạo mới với source = 'adjustment'
    let checkinAt: Date | null = null;
    let checkoutAt: Date | null = null;
    let otMinutes = 0;

    switch (request_type) {
      case 'forgot_checkin':
        checkinAt = request.proposed_checkin_at ?? segment.starts_at;
        break;
      case 'forgot_checkout':
        checkinAt = segment.starts_at;
        checkoutAt = request.proposed_checkout_at ?? segment.ends_at;
        break;
      case 'forgot_both':
        checkinAt = request.proposed_checkin_at ?? segment.starts_at;
        checkoutAt = request.proposed_checkout_at ?? segment.ends_at;
        break;
      case 'official_late_early':
        checkinAt = segment.starts_at;
        checkoutAt = segment.ends_at;
        break;
      case 'overtime':
        checkinAt = segment.starts_at;
        checkoutAt = segment.ends_at;
        otMinutes = request.proposed_minutes ?? 0;
        break;
    }

    const metrics = calcMetrics({
      shiftType: segment.shift_type,
      startsAt: segment.starts_at,
      endsAt: segment.ends_at,
      checkinAt,
      checkoutAt,
      gracePeriodMinutes,
      approvedOtMinutes: otMinutes,
    });

    if (request_type === 'official_late_early') {
      metrics.lateMinutes = 0;
      metrics.earlyLeaveMinutes = 0;
      metrics.status = 'present';
    }

    await client.query(
      `INSERT INTO attendances (
         store_id, shift_id, segment_id, user_id, status,
         checkin_at, checkout_at, actual_minutes, ot_minutes,
         late_minutes, early_leave_minutes, source, notes, flagged
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, 'adjustment', $12, FALSE
       )`,
      [
        store_id,
        shift_id,
        segment_id,
        user_id,
        metrics.status,
        checkinAt,
        checkoutAt,
        metrics.actualMinutes,
        metrics.otMinutes,
        metrics.lateMinutes,
        metrics.earlyLeaveMinutes,
        `Tạo từ đơn ngoại lệ: ${request.reason}`,
      ],
    );
  } else {
    // Trường hợp đã có bản ghi attendance -> Cập nhật và lưu giá trị gốc vào original_*
    let newCheckinAt = existingAtt.checkin_at;
    let newCheckoutAt = existingAtt.checkout_at;
    let originalCheckinAt = existingAtt.original_checkin_at;
    let originalCheckoutAt = existingAtt.original_checkout_at;
    let otMinutes = existingAtt.ot_minutes;

    switch (request_type) {
      case 'forgot_checkin':
        if (!originalCheckinAt && existingAtt.checkin_at) {
          originalCheckinAt = existingAtt.checkin_at;
        }
        newCheckinAt = request.proposed_checkin_at ?? existingAtt.checkin_at;
        break;

      case 'forgot_checkout':
        if (!originalCheckoutAt && existingAtt.checkout_at) {
          originalCheckoutAt = existingAtt.checkout_at;
        }
        newCheckoutAt = request.proposed_checkout_at ?? existingAtt.checkout_at;
        break;

      case 'forgot_both':
        if (!originalCheckinAt && existingAtt.checkin_at) {
          originalCheckinAt = existingAtt.checkin_at;
        }
        if (!originalCheckoutAt && existingAtt.checkout_at) {
          originalCheckoutAt = existingAtt.checkout_at;
        }
        newCheckinAt = request.proposed_checkin_at ?? existingAtt.checkin_at;
        newCheckoutAt = request.proposed_checkout_at ?? existingAtt.checkout_at;
        break;

      case 'official_late_early':
        // Đi trễ/về sớm công vụ -> xóa late/early
        break;

      case 'overtime':
        otMinutes = (existingAtt.ot_minutes ?? 0) + (request.proposed_minutes ?? 0);
        break;
    }

    const metrics = calcMetrics({
      shiftType: segment.shift_type,
      startsAt: segment.starts_at,
      endsAt: segment.ends_at,
      checkinAt: newCheckinAt,
      checkoutAt: newCheckoutAt,
      gracePeriodMinutes,
      approvedOtMinutes: otMinutes,
    });

    if (request_type === 'official_late_early') {
      metrics.lateMinutes = 0;
      metrics.earlyLeaveMinutes = 0;
      metrics.status = 'present';
    }

    await client.query(
      `UPDATE attendances
       SET
         checkin_at = $1,
         checkout_at = $2,
         original_checkin_at = $3,
         original_checkout_at = $4,
         late_minutes = $5,
         early_leave_minutes = $6,
         actual_minutes = $7,
         ot_minutes = $8,
         status = $9,
         source = 'adjustment',
         notes = CASE 
           WHEN notes IS NULL OR notes = '' THEN $10
           ELSE notes || '; ' || $10
         END,
         updated_at = NOW()
       WHERE id = $11`,
      [
        newCheckinAt,
        newCheckoutAt,
        originalCheckinAt,
        originalCheckoutAt,
        metrics.lateMinutes,
        metrics.earlyLeaveMinutes,
        metrics.actualMinutes,
        metrics.otMinutes,
        metrics.status,
        `Duyệt đơn: ${request.reason}`,
        existingAtt.id,
      ],
    );
  }
}
