import { query } from '../db/client.js';
import type { ShiftStatus, ShiftType } from '../types/db.js';

export interface ScheduleShiftSegmentRow {
  id: string;
  shift_id: string;
  starts_at: string | Date;
  ends_at: string | Date;
  sort_order: number;
}

export interface ScheduleShiftRow {
  id: string;
  store_id: number;
  template_id: string | null;
  assigned_to: string | null;
  status: ShiftStatus;
  work_date: string;
  notes: string | null;
  source: 'default' | 'manual' | 'swap';
  shift_type: ShiftType;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assigned_user_email: string | null;
  assigned_user_role: string | null;
  template_name: string | null;
  template_color: string | null;
  template_shift_type: ShiftType | null;
  segments?: ScheduleShiftSegmentRow[];
}

export interface ScheduleShiftDTO {
  id: string;
  store_id: number;
  template_id: string | null;
  assigned_to: string | null;
  status: ShiftStatus;
  work_date: string;
  notes: string | null;
  source: 'default' | 'manual' | 'swap';
  type: ShiftType;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  assigned_user: {
    id: string;
    full_name: string;
    email: string;
    role?: 'admin' | 'staff';
  } | null;
  template: {
    id: string;
    name: string;
    color: string;
    type?: ShiftType;
  } | null;
  segments: ScheduleShiftSegmentRow[];
}

export const scheduleRepository = {
  async getWeekSchedule(
    storeId: number,
    startDate: string,
    endDate: string,
    assignedTo?: string,
  ): Promise<ScheduleShiftDTO[]> {
    const conditions: string[] = [
      's.store_id = $1',
      's.work_date >= $2',
      's.work_date <= $3',
    ];
    const params: unknown[] = [storeId, startDate, endDate];

    if (assignedTo !== undefined) {
      conditions.push('s.assigned_to = $4');
      params.push(assignedTo);
    }

    const where = conditions.join(' AND ');

    const sql = `
      SELECT 
        s.id,
        s.store_id,
        s.template_id,
        s.assigned_to,
        s.status,
        to_char(s.work_date, 'YYYY-MM-DD') AS work_date,
        s.notes,
        s.source,
        COALESCE(s.shift_type, t.shift_type, 'REGULAR') AS shift_type,
        s.created_by,
        s.created_at,
        s.updated_at,
        u.id AS assigned_user_id,
        u.full_name AS assigned_user_name,
        u.email AS assigned_user_email,
        u.role AS assigned_user_role,
        t.name AS template_name,
        t.color AS template_color,
        COALESCE(t.shift_type, 'REGULAR') AS template_shift_type
      FROM shifts s
      LEFT JOIN users u ON s.assigned_to = u.id
      LEFT JOIN shift_templates t ON s.template_id = t.id
      WHERE ${where}
      ORDER BY 
        s.work_date ASC,
        s.template_id ASC NULLS LAST,
        CASE 
          WHEN s.status IN ('scheduled', 'assigned', 'open') THEN 1 
          ELSE 2 
        END ASC,
        COALESCE(u.full_name, '') ASC,
        s.id ASC
    `;

    const result = await query<ScheduleShiftRow>(sql, params);
    const shifts = result.rows;

    if (shifts.length === 0) {
      return [];
    }

    const shiftIds = shifts.map((s) => s.id);
    const segsResult = await query<ScheduleShiftSegmentRow>(
      `SELECT id, shift_id, starts_at, ends_at, sort_order
       FROM shift_segments
       WHERE shift_id = ANY($1::uuid[])
       ORDER BY shift_id, sort_order ASC`,
      [shiftIds],
    );

    const segsByShift = new Map<string, ScheduleShiftSegmentRow[]>();
    for (const seg of segsResult.rows) {
      const arr = segsByShift.get(seg.shift_id) ?? [];
      arr.push(seg);
      segsByShift.set(seg.shift_id, arr);
    }

    return shifts.map((s) => ({
      id: s.id,
      store_id: s.store_id,
      template_id: s.template_id,
      assigned_to: s.assigned_to,
      status: s.status,
      work_date: s.work_date,
      notes: s.notes,
      source: s.source ?? 'manual',
      type: s.shift_type ?? s.template_shift_type ?? 'REGULAR',
      created_by: s.created_by,
      created_at: s.created_at,
      updated_at: s.updated_at,
      assigned_user: s.assigned_user_id
        ? {
            id: s.assigned_user_id,
            full_name: s.assigned_user_name ?? '',
            email: s.assigned_user_email ?? '',
            role: (s.assigned_user_role as 'admin' | 'staff') ?? 'staff',
          }
        : null,
      template: s.template_id && s.template_name
        ? {
            id: s.template_id,
            name: s.template_name,
            color: s.template_color ?? '#6C4CF1',
            type: s.template_shift_type ?? 'REGULAR',
          }
        : null,
      segments: segsByShift.get(s.id) ?? [],
    }));
  },
};
