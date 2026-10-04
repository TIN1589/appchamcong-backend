import { query, withTransaction } from '../db/client.js';

export type SwapType = 'swap' | 'pool';
export type SwapStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface SwapRequestRecord {
  id: string;
  store_id: number;
  requester_id: string;
  requester_shift: string;
  receiver_id: string | null;
  receiver_shift: string | null;
  status: SwapStatus;
  type: SwapType;
  reason: string | null;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  expires_at: Date | null;
  claimed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SwapDetails extends SwapRequestRecord {
  requester_name: string;
  receiver_name?: string | null;
  requester_shift_date: string;
  requester_shift_name?: string | null;
  requester_shift_starts_at?: Date | null;
  requester_shift_ends_at?: Date | null;
  receiver_shift_date?: string | null;
  receiver_shift_name?: string | null;
  receiver_shift_starts_at?: Date | null;
  receiver_shift_ends_at?: Date | null;
}

export interface CreateSwapInput {
  storeId: number;
  requesterId: string;
  requesterShiftId: string;
  type: SwapType;
  receiverId?: string | null | undefined;
  receiverShiftId?: string | null | undefined;
  reason?: string | null | undefined;
  expiresAt?: Date | null | undefined;
}

export const swapRepository = {
  async create(data: CreateSwapInput): Promise<SwapRequestRecord> {
    const res = await query<SwapRequestRecord>(
      `INSERT INTO swap_requests (
         store_id, requester_id, requester_shift, receiver_id, receiver_shift,
         type, reason, expires_at, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING *`,
      [
        data.storeId,
        data.requesterId,
        data.requesterShiftId,
        data.receiverId ?? null,
        data.receiverShiftId ?? null,
        data.type,
        data.reason ?? null,
        data.expiresAt ?? null,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Create swap request failed');
    return row;
  },

  async findById(id: string, storeId: number): Promise<SwapDetails | null> {
    const res = await query<SwapDetails>(
      `SELECT
         sr.*,
         u1.full_name AS requester_name,
         u2.full_name AS receiver_name,
         to_char(s1.work_date, 'YYYY-MM-DD') AS requester_shift_date,
         t1.name AS requester_shift_name,
         s1_start.starts_at AS requester_shift_starts_at,
         s1_end.ends_at AS requester_shift_ends_at,
         to_char(s2.work_date, 'YYYY-MM-DD') AS receiver_shift_date,
         t2.name AS receiver_shift_name,
         s2_start.starts_at AS receiver_shift_starts_at,
         s2_end.ends_at AS receiver_shift_ends_at
       FROM swap_requests sr
       JOIN users u1 ON sr.requester_id = u1.id
       LEFT JOIN users u2 ON sr.receiver_id = u2.id
       JOIN shifts s1 ON sr.requester_shift = s1.id
       LEFT JOIN shift_templates t1 ON s1.template_id = t1.id
       LEFT JOIN LATERAL (
         SELECT starts_at FROM shift_segments WHERE shift_id = s1.id ORDER BY sort_order ASC LIMIT 1
       ) s1_start ON true
       LEFT JOIN LATERAL (
         SELECT ends_at FROM shift_segments WHERE shift_id = s1.id ORDER BY sort_order DESC LIMIT 1
       ) s1_end ON true
       LEFT JOIN shifts s2 ON sr.receiver_shift = s2.id
       LEFT JOIN shift_templates t2 ON s2.template_id = t2.id
       LEFT JOIN LATERAL (
         SELECT starts_at FROM shift_segments WHERE shift_id = s2.id ORDER BY sort_order ASC LIMIT 1
       ) s2_start ON true
       LEFT JOIN LATERAL (
         SELECT ends_at FROM shift_segments WHERE shift_id = s2.id ORDER BY sort_order DESC LIMIT 1
       ) s2_end ON true
       WHERE sr.id = $1 AND sr.store_id = $2`,
      [id, storeId],
    );
    return res.rows[0] ?? null;
  },

  async findPendingByShiftId(shiftId: string, storeId: number): Promise<SwapRequestRecord | null> {
    const res = await query<SwapRequestRecord>(
      `SELECT * FROM swap_requests
       WHERE store_id = $1
         AND status = 'pending'
         AND (requester_shift = $2 OR receiver_shift = $2)
       LIMIT 1`,
      [storeId, shiftId],
    );
    return res.rows[0] ?? null;
  },

  async list(
    storeId: number,
    filters?: {
      userId?: string | undefined;
      status?: SwapStatus | undefined;
      type?: SwapType | undefined;
    },
  ): Promise<SwapDetails[]> {
    const conditions: string[] = ['sr.store_id = $1'];
    const params: unknown[] = [storeId];
    let pIdx = 2;

    if (filters?.userId) {
      conditions.push(`(sr.requester_id = $${pIdx} OR sr.receiver_id = $${pIdx})`);
      params.push(filters.userId);
      pIdx++;
    }

    if (filters?.status) {
      conditions.push(`sr.status = $${pIdx}`);
      params.push(filters.status);
      pIdx++;
    }

    if (filters?.type) {
      conditions.push(`sr.type = $${pIdx}`);
      params.push(filters.type);
      pIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const res = await query<SwapDetails>(
      `SELECT
         sr.*,
         u1.full_name AS requester_name,
         u2.full_name AS receiver_name,
         to_char(s1.work_date, 'YYYY-MM-DD') AS requester_shift_date,
         t1.name AS requester_shift_name,
         s1_start.starts_at AS requester_shift_starts_at,
         s1_end.ends_at AS requester_shift_ends_at,
         to_char(s2.work_date, 'YYYY-MM-DD') AS receiver_shift_date,
         t2.name AS receiver_shift_name,
         s2_start.starts_at AS receiver_shift_starts_at,
         s2_end.ends_at AS receiver_shift_ends_at
       FROM swap_requests sr
       JOIN users u1 ON sr.requester_id = u1.id
       LEFT JOIN users u2 ON sr.receiver_id = u2.id
       JOIN shifts s1 ON sr.requester_shift = s1.id
       LEFT JOIN shift_templates t1 ON s1.template_id = t1.id
       LEFT JOIN LATERAL (
         SELECT starts_at FROM shift_segments WHERE shift_id = s1.id ORDER BY sort_order ASC LIMIT 1
       ) s1_start ON true
       LEFT JOIN LATERAL (
         SELECT ends_at FROM shift_segments WHERE shift_id = s1.id ORDER BY sort_order DESC LIMIT 1
       ) s1_end ON true
       LEFT JOIN shifts s2 ON sr.receiver_shift = s2.id
       LEFT JOIN shift_templates t2 ON s2.template_id = t2.id
       LEFT JOIN LATERAL (
         SELECT starts_at FROM shift_segments WHERE shift_id = s2.id ORDER BY sort_order ASC LIMIT 1
       ) s2_start ON true
       LEFT JOIN LATERAL (
         SELECT ends_at FROM shift_segments WHERE shift_id = s2.id ORDER BY sort_order DESC LIMIT 1
       ) s2_end ON true
       WHERE ${whereClause}
       ORDER BY sr.created_at DESC`,
      params,
    );

    return res.rows;
  },

  async listPoolShifts(storeId: number): Promise<SwapDetails[]> {
    const res = await query<SwapDetails>(
      `SELECT
         sr.*,
         u1.full_name AS requester_name,
         NULL AS receiver_name,
         to_char(s1.work_date, 'YYYY-MM-DD') AS requester_shift_date,
         t1.name AS requester_shift_name,
         s1_start.starts_at AS requester_shift_starts_at,
         s1_end.ends_at AS requester_shift_ends_at,
         NULL AS receiver_shift_date,
         NULL AS receiver_shift_name,
         NULL AS receiver_shift_starts_at,
         NULL AS receiver_shift_ends_at
       FROM swap_requests sr
       JOIN users u1 ON sr.requester_id = u1.id
       JOIN shifts s1 ON sr.requester_shift = s1.id
       LEFT JOIN shift_templates t1 ON s1.template_id = t1.id
       LEFT JOIN LATERAL (
         SELECT starts_at FROM shift_segments WHERE shift_id = s1.id ORDER BY sort_order ASC LIMIT 1
       ) s1_start ON true
       LEFT JOIN LATERAL (
         SELECT ends_at FROM shift_segments WHERE shift_id = s1.id ORDER BY sort_order DESC LIMIT 1
       ) s1_end ON true
       WHERE sr.store_id = $1
         AND sr.type = 'pool'
         AND sr.status = 'pending'
         AND sr.receiver_id IS NULL
         AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
       ORDER BY s1_start.starts_at ASC`,
      [storeId],
    );
    return res.rows;
  },

  async cancel(id: string, storeId: number, userId: string): Promise<boolean> {
    const res = await query(
      `UPDATE swap_requests
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND store_id = $2 AND requester_id = $3 AND status = 'pending'`,
      [id, storeId, userId],
    );
    return (res.rowCount ?? 0) > 0;
  },

  async reviewSwapWithLock(
    id: string,
    storeId: number,
    adminId: string,
    action: 'approve' | 'reject',
    adminNote?: string,
  ): Promise<SwapRequestRecord | null> {
    return withTransaction(async (client) => {
      // 1. Lock đơn swap
      const reqRes = await client.query<SwapRequestRecord>(
        `SELECT * FROM swap_requests WHERE id = $1 AND store_id = $2 FOR UPDATE`,
        [id, storeId],
      );
      const req = reqRes.rows[0];
      if (!req || req.status !== 'pending') return null;

      if (action === 'reject') {
        const updateRes = await client.query<SwapRequestRecord>(
          `UPDATE swap_requests
           SET status = 'rejected', admin_note = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
           WHERE id = $3 RETURNING *`,
          [adminNote ?? null, adminId, id],
        );
        return updateRes.rows[0] ?? null;
      }

      // Approve swap 1-1: Lock cả 2 ca
      if (!req.receiver_id || !req.receiver_shift) {
        throw new Error('Đơn đổi ca 1-1 thiếu thông tin người nhận hoặc ca nhận');
      }

      const s1Res = await client.query(
        `SELECT id, assigned_to FROM shifts WHERE id = $1 AND store_id = $2 FOR UPDATE`,
        [req.requester_shift, storeId],
      );
      const s2Res = await client.query(
        `SELECT id, assigned_to FROM shifts WHERE id = $1 AND store_id = $2 FOR UPDATE`,
        [req.receiver_shift, storeId],
      );

      if (!s1Res.rows[0] || !s2Res.rows[0]) {
        throw new Error('Một trong hai ca không tồn tại');
      }

      // Hoán đổi assigned_to
      await client.query(
        `UPDATE shifts
         SET assigned_to = $1, source = 'swap', updated_at = NOW()
         WHERE id = $2`,
        [req.receiver_id, req.requester_shift],
      );

      await client.query(
        `UPDATE shifts
         SET assigned_to = $1, source = 'swap', updated_at = NOW()
         WHERE id = $2`,
        [req.requester_id, req.receiver_shift],
      );

      // Cập nhật swap request
      const finalRes = await client.query<SwapRequestRecord>(
        `UPDATE swap_requests
         SET status = 'approved', admin_note = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [adminNote ?? null, adminId, id],
      );
      return finalRes.rows[0] ?? null;
    });
  },

  async claimPoolShiftWithLock(
    id: string,
    storeId: number,
    claimerId: string,
  ): Promise<SwapRequestRecord | null> {
    return withTransaction(async (client) => {
      // Lock đơn pool
      const reqRes = await client.query<SwapRequestRecord>(
        `SELECT * FROM swap_requests WHERE id = $1 AND store_id = $2 FOR UPDATE`,
        [id, storeId],
      );
      const req = reqRes.rows[0];
      if (!req || req.status !== 'pending' || req.type !== 'pool' || req.receiver_id !== null) {
        return null;
      }

      // Lock ca requester
      const shiftRes = await client.query(
        `SELECT id FROM shifts WHERE id = $1 AND store_id = $2 FOR UPDATE`,
        [req.requester_shift, storeId],
      );
      if (!shiftRes.rows[0]) return null;

      // Chuyển ca sang cho người claim
      await client.query(
        `UPDATE shifts
         SET assigned_to = $1, source = 'swap', updated_at = NOW()
         WHERE id = $2`,
        [claimerId, req.requester_shift],
      );

      // Đánh dấu đơn là approved và đã claim
      const updateRes = await client.query<SwapRequestRecord>(
        `UPDATE swap_requests
         SET receiver_id = $1, status = 'approved', claimed_at = NOW(), reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [claimerId, id],
      );
      return updateRes.rows[0] ?? null;
    });
  },
};
