import { query } from '../db/client.js';
import { BadRequestError, ErrorCode, NotFoundError } from '../lib/errors.js';

export interface StoreAttendanceConfig {
  id: number;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  max_gps_accuracy_m: number;
  grace_period_minutes: number;
  checkin_window_before_minutes: number;
  wifi_ip_allowlist: string[];
}

export interface AttendanceRecord {
  id: string;
  store_id: number;
  shift_id: string;
  segment_id: string;
  user_id: string;
  status: 'present' | 'late' | 'early_leave' | 'absent' | 'pending';
  checkin_at: Date | null;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkin_accuracy: number | null;
  checkin_face_ok: boolean | null;
  checkin_face_distance: number | null;
  checkin_distance_m: number | null;
  checkout_at: Date | null;
  checkout_lat: number | null;
  checkout_lng: number | null;
  checkout_accuracy: number | null;
  checkout_face_ok: boolean | null;
  checkout_face_distance: number | null;
  checkout_distance_m: number | null;
  actual_minutes: number | null;
  ot_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  deduction_vnd: string;
  notes: string | null;
  gps_accuracy_m: number | null;
  ip: string | null;
  user_agent: string | null;
  source: 'self' | 'adjustment';
  flagged: boolean;
  original_checkin_at: Date | null;
  original_checkout_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface FaceTemplateRecord {
  id: string;
  store_id: number;
  user_id: string;
  descriptor: number[];
  consent_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ShiftSegmentDetails {
  shift_id: string;
  segment_id: string;
  user_id: string;
  store_id: number;
  shift_type: 'REGULAR' | 'SPLIT' | 'FLEXIBLE';
  shift_status: string;
  starts_at: Date;
  ends_at: Date;
  work_date: string;
  shift_name: string;
}

export interface AttendanceFilter {
  storeId: number;
  userId?: string | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
  status?: string | undefined;
  flagged?: boolean | undefined;
}

export const attendanceRepository = {
  async getStoreConfig(storeId: number): Promise<StoreAttendanceConfig> {
    const res = await query<StoreAttendanceConfig>(
      `SELECT 
         id, lat, lng, radius_m, 
         max_gps_accuracy_m, grace_period_minutes, 
         checkin_window_before_minutes, wifi_ip_allowlist
       FROM stores 
       WHERE id = $1`,
      [storeId],
    );
    const cfg = res.rows[0];
    if (!cfg) {
      throw new NotFoundError('Cửa hàng');
    }
    return cfg;
  },

  async getFaceTemplate(userId: string): Promise<FaceTemplateRecord | null> {
    const res = await query<{
      id: string;
      store_id: number;
      user_id: string;
      descriptor: unknown;
      consent_at: Date;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, store_id, user_id, descriptor, consent_at, created_at, updated_at
       FROM face_templates
       WHERE user_id = $1`,
      [userId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      ...row,
      descriptor: Array.isArray(row.descriptor) ? (row.descriptor as number[]) : [],
    };
  },

  async saveFaceTemplate(
    storeId: number,
    userId: string,
    descriptor: number[],
  ): Promise<FaceTemplateRecord> {
    const res = await query<FaceTemplateRecord>(
      `INSERT INTO face_templates (store_id, user_id, descriptor, consent_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (user_id) 
       DO UPDATE SET descriptor = EXCLUDED.descriptor, consent_at = NOW(), updated_at = NOW()
       RETURNING *`,
      [storeId, userId, JSON.stringify(descriptor)],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Không thể lưu mẫu khuôn mặt');
    return row;
  },

  async deleteFaceTemplate(userId: string): Promise<boolean> {
    const res = await query('DELETE FROM face_templates WHERE user_id = $1', [userId]);
    return (res.rowCount ?? 0) > 0;
  },

  async findSegmentDetails(
    shiftId: string,
    segmentId?: string,
    userId?: string,
  ): Promise<ShiftSegmentDetails | null> {
    let sql = `
      SELECT 
        s.id AS shift_id,
        ss.id AS segment_id,
        s.assigned_to AS user_id,
        s.store_id,
        COALESCE(s.shift_type, 'REGULAR') AS shift_type,
        s.status AS shift_status,
        ss.starts_at,
        ss.ends_at,
        to_char(s.work_date, 'YYYY-MM-DD') AS work_date,
        COALESCE(t.name, s.notes, 'Ca làm việc') AS shift_name
      FROM shifts s
      JOIN shift_segments ss ON ss.shift_id = s.id
      LEFT JOIN shift_templates t ON s.template_id = t.id
      WHERE s.id = $1
    `;
    const params: unknown[] = [shiftId];

    if (segmentId) {
      params.push(segmentId);
      sql += ` AND ss.id = $${params.length}`;
    }
    if (userId) {
      params.push(userId);
      sql += ` AND s.assigned_to = $${params.length}`;
    }

    sql += ' ORDER BY ss.sort_order ASC LIMIT 1';

    const res = await query<ShiftSegmentDetails>(sql, params);
    return res.rows[0] ?? null;
  },

  async findBySegmentAndUser(segmentId: string, userId: string): Promise<AttendanceRecord | null> {
    const res = await query<AttendanceRecord>(
      `SELECT * FROM attendances WHERE segment_id = $1 AND user_id = $2`,
      [segmentId, userId],
    );
    return res.rows[0] ?? null;
  },

  async findById(id: string): Promise<AttendanceRecord | null> {
    const res = await query<AttendanceRecord>(`SELECT * FROM attendances WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  },

  async createCheckin(data: {
    store_id: number;
    shift_id: string;
    segment_id: string;
    user_id: string;
    status: 'present' | 'late' | 'early_leave' | 'absent' | 'pending';
    checkin_at: Date;
    checkin_lat: number;
    checkin_lng: number;
    checkin_accuracy?: number | undefined;
    checkin_face_ok: boolean;
    checkin_face_distance: number;
    checkin_distance_m: number;
    late_minutes: number;
    gps_accuracy_m?: number | undefined;
    ip?: string | undefined;
    user_agent?: string | undefined;
    source: 'self' | 'adjustment';
    flagged: boolean;
  }): Promise<AttendanceRecord> {
    try {
      const res = await query<AttendanceRecord>(
        `INSERT INTO attendances (
           store_id, shift_id, segment_id, user_id, status,
           checkin_at, checkin_lat, checkin_lng, checkin_accuracy,
           checkin_face_ok, checkin_face_distance, checkin_distance_m,
           late_minutes, gps_accuracy_m, ip, user_agent, source, flagged
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9,
           $10, $11, $12,
           $13, $14, $15, $16, $17, $18
         ) RETURNING *`,
        [
          data.store_id,
          data.shift_id,
          data.segment_id,
          data.user_id,
          data.status,
          data.checkin_at,
          data.checkin_lat,
          data.checkin_lng,
          data.checkin_accuracy ?? null,
          data.checkin_face_ok,
          data.checkin_face_distance,
          data.checkin_distance_m,
          data.late_minutes,
          data.gps_accuracy_m ?? null,
          data.ip ?? null,
          data.user_agent ?? null,
          data.source,
          data.flagged,
        ],
      );
      const row = res.rows[0];
      if (!row) throw new Error('Không thể tạo bản ghi chấm công');
      return row;
    } catch (err: unknown) {
      // Postgres error code 23505: unique_violation trên (segment_id, user_id)
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
        throw new BadRequestError(
          ErrorCode.ATTENDANCE_ALREADY_CHECKED_IN,
          'Nhân viên đã check-in cho ca/segment này rồi',
        );
      }
      throw err;
    }
  },

  async updateCheckout(data: {
    id: string;
    checkout_at: Date;
    checkout_lat: number;
    checkout_lng: number;
    checkout_accuracy?: number | undefined;
    checkout_face_ok: boolean;
    checkout_face_distance: number;
    checkout_distance_m: number;
    early_leave_minutes: number;
    actual_minutes: number;
    ot_minutes: number;
    status: 'present' | 'late' | 'early_leave' | 'absent' | 'pending';
    flagged?: boolean | undefined;
  }): Promise<AttendanceRecord | null> {
    const res = await query<AttendanceRecord>(
      `UPDATE attendances
       SET
         checkout_at = $1,
         checkout_lat = $2,
         checkout_lng = $3,
         checkout_accuracy = $4,
         checkout_face_ok = $5,
         checkout_face_distance = $6,
         checkout_distance_m = $7,
         early_leave_minutes = $8,
         actual_minutes = $9,
         ot_minutes = $10,
         status = $11,
         flagged = CASE WHEN $12 = TRUE THEN TRUE ELSE flagged END,
         updated_at = NOW()
       WHERE id = $13 AND checkout_at IS NULL
       RETURNING *`,
      [
        data.checkout_at,
        data.checkout_lat,
        data.checkout_lng,
        data.checkout_accuracy ?? null,
        data.checkout_face_ok,
        data.checkout_face_distance,
        data.checkout_distance_m,
        data.early_leave_minutes,
        data.actual_minutes,
        data.ot_minutes,
        data.status,
        data.flagged ?? false,
        data.id,
      ],
    );
    return res.rows[0] ?? null;
  },

  async listAttendances(filter: AttendanceFilter): Promise<Array<AttendanceRecord & { full_name: string; shift_name: string; starts_at: Date; ends_at: Date }>> {
    let sql = `
      SELECT 
        a.*,
        u.full_name,
        COALESCE(t.name, s.notes, 'Ca làm việc') AS shift_name,
        ss.starts_at,
        ss.ends_at
      FROM attendances a
      JOIN users u ON a.user_id = u.id
      JOIN shifts s ON a.shift_id = s.id
      JOIN shift_segments ss ON a.segment_id = ss.id
      LEFT JOIN shift_templates t ON s.template_id = t.id
      WHERE a.store_id = $1
    `;
    const params: unknown[] = [filter.storeId];

    if (filter.userId) {
      params.push(filter.userId);
      sql += ` AND a.user_id = $${params.length}`;
    }
    if (filter.fromDate) {
      params.push(filter.fromDate);
      sql += ` AND a.checkin_at >= $${params.length}::timestamptz`;
    }
    if (filter.toDate) {
      params.push(filter.toDate);
      sql += ` AND a.checkin_at <= $${params.length}::timestamptz`;
    }
    if (filter.status) {
      params.push(filter.status);
      sql += ` AND a.status = $${params.length}`;
    }
    if (filter.flagged !== undefined) {
      params.push(filter.flagged);
      sql += ` AND a.flagged = $${params.length}`;
    }

    sql += ` ORDER BY a.checkin_at DESC`;

    const res = await query<AttendanceRecord & { full_name: string; shift_name: string; starts_at: Date; ends_at: Date }>(sql, params);
    return res.rows;
  },
};
