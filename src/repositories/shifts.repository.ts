import { query, withTransaction } from '../db/client.js';
import { formatTimeVN } from '../lib/timezone.js';
import type {
  Shift,
  ShiftSegment,
  ShiftTemplate,
  ShiftTemplateSegment,
  ShiftStatus,
  ShiftType,
  PaginatedResult,
  PaginationParams,
} from '../types/db.js';

export interface OverlapCheckResult {
  hasOverlap: boolean;
  message?: string;
  conflictingShift?: {
    shiftId: string;
    shiftName: string;
    timeRange: string;
    userName: string;
    workDate: string;
  };
}

export interface ShiftWithSegments extends Shift {
  segments: ShiftSegment[];
}

export interface TemplateWithSegments extends ShiftTemplate {
  type?: ShiftType;
  segments: ShiftTemplateSegment[];
}

export const shiftsRepository = {
  async listTemplates(storeId: number): Promise<TemplateWithSegments[]> {
    const templatesResult = await query<ShiftTemplate>(
      'SELECT * FROM shift_templates WHERE store_id = $1 ORDER BY name',
      [storeId],
    );
    const templates = templatesResult.rows;
    if (templates.length === 0) return [];

    const templateIds = templates.map((t) => t.id);
    const segsResult = await query<ShiftTemplateSegment>(
      `SELECT * FROM shift_template_segments
       WHERE template_id = ANY($1::uuid[])
       ORDER BY template_id, sort_order`,
      [templateIds],
    );

    const segsByTemplate = new Map<string, ShiftTemplateSegment[]>();
    for (const seg of segsResult.rows) {
      const arr = segsByTemplate.get(seg.template_id) ?? [];
      arr.push(seg);
      segsByTemplate.set(seg.template_id, arr);
    }

    return templates.map((t) => ({
      ...t,
      type: t.shift_type,
      segments: segsByTemplate.get(t.id) ?? [],
    }));
  },

  async createTemplate(
    storeId: number,
    createdBy: string,
    data: {
      name: string;
      color: string;
      shiftType?: ShiftType;
      segments: Array<{ startTime: string; endTime: string; sortOrder?: number }>;
    },
  ): Promise<TemplateWithSegments> {
    const shiftType = data.shiftType ?? (data.name.toLowerCase().includes('gãy') || data.name.toLowerCase().includes('gay') ? 'SPLIT' : 'REGULAR');
    return withTransaction(async (client) => {
      const tResult = await client.query<ShiftTemplate>(
        `INSERT INTO shift_templates (store_id, name, color, shift_type, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [storeId, data.name, data.color, shiftType, createdBy],
      );
      const template = tResult.rows[0];
      if (!template) throw new Error('Insert template failed');

      const segments: ShiftTemplateSegment[] = [];
      for (let i = 0; i < data.segments.length; i++) {
        const seg = data.segments[i];
        if (!seg) continue;
        const sResult = await client.query<ShiftTemplateSegment>(
          `INSERT INTO shift_template_segments (template_id, start_time, end_time, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (template_id, start_time, end_time) DO NOTHING
           RETURNING *`,
          [template.id, seg.startTime, seg.endTime, seg.sortOrder ?? i],
        );
        const inserted = sResult.rows[0];
        if (inserted) segments.push(inserted);
      }

      return { ...template, type: template.shift_type, segments };
    });
  },

  async findById(shiftId: string, storeId: number): Promise<ShiftWithSegments | null> {
    const shiftResult = await query<Shift>(
      'SELECT * FROM shifts WHERE id = $1 AND store_id = $2',
      [shiftId, storeId],
    );
    const shift = shiftResult.rows[0];
    if (!shift) return null;

    const segsResult = await query<ShiftSegment>(
      'SELECT * FROM shift_segments WHERE shift_id = $1 ORDER BY sort_order',
      [shiftId],
    );

    return { ...shift, segments: segsResult.rows };
  },

  async listByDateRange(
    storeId: number,
    startDate: string,
    endDate: string,
    pagination: PaginationParams,
    filters?: {
      assignedTo?: string;
      status?: ShiftStatus;
    },
  ): Promise<PaginatedResult<ShiftWithSegments>> {
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;

    const conditions: string[] = [
      's.store_id = $1',
      's.work_date >= $2',
      's.work_date <= $3',
    ];
    const params: unknown[] = [storeId, startDate, endDate];
    let idx = 4;

    if (filters?.assignedTo !== undefined) {
      conditions.push(`s.assigned_to = $${idx++}`);
      params.push(filters.assignedTo);
    }
    if (filters?.status !== undefined) {
      conditions.push(`s.status = $${idx++}`);
      params.push(filters.status);
    }

    const where = conditions.join(' AND ');

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM shifts s WHERE ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    const shiftsResult = await query<Shift>(
      `SELECT s.* FROM shifts s WHERE ${where}
       ORDER BY s.work_date ASC, s.id ASC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset],
    );

    if (shiftsResult.rows.length === 0) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }

    const shiftIds = shiftsResult.rows.map((s) => s.id);
    const segsResult = await query<ShiftSegment>(
      'SELECT * FROM shift_segments WHERE shift_id = ANY($1::uuid[]) ORDER BY shift_id, sort_order',
      [shiftIds],
    );

    const segsByShift = new Map<string, ShiftSegment[]>();
    for (const seg of segsResult.rows) {
      const arr = segsByShift.get(seg.shift_id) ?? [];
      arr.push(seg);
      segsByShift.set(seg.shift_id, arr);
    }

    const data: ShiftWithSegments[] = shiftsResult.rows.map((s) => ({
      ...s,
      segments: segsByShift.get(s.id) ?? [],
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async create(
    storeId: number,
    createdBy: string,
    data: {
      templateId?: string;
      assignedTo?: string;
      workDate: string;
      notes?: string;
      source?: 'default' | 'manual' | 'swap';
      status?: ShiftStatus;
      shiftType?: ShiftType;
      segments: Array<{
        startsAt: Date;
        endsAt: Date;
        sortOrder?: number;
      }>;
    },
  ): Promise<ShiftWithSegments> {
    return withTransaction(async (client) => {
      let shiftType = data.shiftType;
      if (!shiftType && data.templateId) {
        const tplRes = await client.query<{ shift_type: ShiftType }>(
          'SELECT shift_type FROM shift_templates WHERE id = $1',
          [data.templateId],
        );
        shiftType = tplRes.rows[0]?.shift_type ?? 'REGULAR';
      }
      shiftType = shiftType ?? 'REGULAR';

      const shiftResult = await client.query<Shift>(
        `INSERT INTO shifts (store_id, template_id, assigned_to, status, work_date, notes, source, shift_type, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          storeId,
          data.templateId ?? null,
          data.assignedTo ?? null,
          data.status ?? (data.assignedTo ? 'scheduled' : 'open'),
          data.workDate,
          data.notes ?? null,
          data.source ?? 'manual',
          shiftType,
          createdBy,
        ],
      );
      const shift = shiftResult.rows[0];
      if (!shift) throw new Error('Insert shift failed');

      const segments: ShiftSegment[] = [];
      for (let i = 0; i < data.segments.length; i++) {
        const seg = data.segments[i];
        if (!seg) continue;
        const sResult = await client.query<ShiftSegment>(
          `INSERT INTO shift_segments (shift_id, starts_at, ends_at, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (shift_id, starts_at, ends_at) DO NOTHING
           RETURNING *`,
          [shift.id, seg.startsAt.toISOString(), seg.endsAt.toISOString(), seg.sortOrder ?? i],
        );
        const inserted = sResult.rows[0];
        if (inserted) segments.push(inserted);
      }

      return { ...shift, segments };
    });
  },

  async assignToUser(
    shiftId: string,
    storeId: number,
    userId: string,
  ): Promise<Shift | null> {
    return withTransaction(async (client) => {
      const lockResult = await client.query<Shift>(
        `SELECT * FROM shifts WHERE id = $1 AND store_id = $2 FOR UPDATE`,
        [shiftId, storeId],
      );
      const shift = lockResult.rows[0];
      if (!shift || shift.status !== 'open') return null;

      const updateResult = await client.query<Shift>(
        `UPDATE shifts SET assigned_to = $1, status = 'scheduled', updated_at = NOW()
         WHERE id = $2 AND store_id = $3 RETURNING *`,
        [userId, shiftId, storeId],
      );
      return updateResult.rows[0] ?? null;
    });
  },

  async delete(shiftId: string, storeId: number): Promise<boolean> {
    const result = await query(
      `DELETE FROM shifts
       WHERE id = $1 AND store_id = $2 AND status = 'open'`,
      [shiftId, storeId],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async hasOverlap(
    empId: string,
    date: string,
    shiftIdOrSegments: string | Array<{ startsAt: Date; endsAt: Date }>,
    storeId?: number,
    excludeShiftId?: string,
  ): Promise<OverlapCheckResult> {
    let newSegments: Array<{ startsAt: Date; endsAt: Date }> = [];
    let effectiveExcludeShiftId = excludeShiftId;

    if (typeof shiftIdOrSegments === 'string') {
      effectiveExcludeShiftId = effectiveExcludeShiftId ?? shiftIdOrSegments;
      const segRes = await query<{ starts_at: string; ends_at: string }>(
        `SELECT starts_at, ends_at FROM shift_segments WHERE shift_id = $1 ORDER BY sort_order ASC`,
        [shiftIdOrSegments],
      );
      if (segRes.rows.length > 0) {
        newSegments = segRes.rows.map((r) => ({
          startsAt: new Date(r.starts_at),
          endsAt: new Date(r.ends_at),
        }));
      } else {
        const tplSegRes = await query<{ start_time: string; end_time: string }>(
          `SELECT sts.start_time, sts.end_time
           FROM shifts s
           JOIN shift_template_segments sts ON s.template_id = sts.template_id
           WHERE s.id = $1
           ORDER BY sts.sort_order ASC`,
          [shiftIdOrSegments],
        );
        newSegments = tplSegRes.rows.map((r) => {
          const [y, m, d] = date.split('-').map(Number);
          const [sh, smin] = r.start_time.split(':').map(Number);
          const [eh, emin] = r.end_time.split(':').map(Number);
          const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
          return {
            startsAt: new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1, sh ?? 0, smin ?? 0) - VN_OFFSET_MS),
            endsAt: new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1, eh ?? 0, emin ?? 0) - VN_OFFSET_MS),
          };
        });
      }
    } else {
      newSegments = shiftIdOrSegments;
    }

    if (newSegments.length === 0) {
      return { hasOverlap: false };
    }

    // Lấy mọi segment của các ca nhân viên đã có trong ngày date
    const existingShiftsRes = await query<{
      shift_id: string;
      work_date: string;
      notes: string | null;
      shift_name: string;
      full_name: string;
      starts_at: string;
      ends_at: string;
    }>(
      `SELECT 
         s.id AS shift_id,
         to_char(s.work_date, 'YYYY-MM-DD') AS work_date,
         s.notes,
         COALESCE(t.name, s.notes, 'Ca làm việc') AS shift_name,
         u.full_name,
         ss.starts_at,
         ss.ends_at
       FROM shifts s
       JOIN users u ON s.assigned_to = u.id
       LEFT JOIN shift_templates t ON s.template_id = t.id
       JOIN shift_segments ss ON ss.shift_id = s.id
       WHERE s.assigned_to = $1
         AND s.work_date = $2
         AND s.status IN ('assigned', 'scheduled', 'completed')
         AND ($3::uuid IS NULL OR s.id != $3::uuid)
       ORDER BY s.id, ss.sort_order ASC`,
      [empId, date, effectiveExcludeShiftId ?? null],
    );

    if (existingShiftsRes.rows.length === 0) {
      return { hasOverlap: false };
    }

    const shiftsMap = new Map<
      string,
      {
        id: string;
        workDate: string;
        shiftName: string;
        fullName: string;
        segments: Array<{ starts_at: string; ends_at: string }>;
      }
    >();

    for (const row of existingShiftsRes.rows) {
      let item = shiftsMap.get(row.shift_id);
      if (!item) {
        item = {
          id: row.shift_id,
          workDate: row.work_date,
          shiftName: row.shift_name,
          fullName: row.full_name,
          segments: [],
        };
        shiftsMap.set(row.shift_id, item);
      }
      item.segments.push({ starts_at: row.starts_at, ends_at: row.ends_at });
    }

    for (const existingShift of shiftsMap.values()) {
      for (const a of existingShift.segments) {
        const aStart = new Date(a.starts_at).getTime();
        const aEnd = new Date(a.ends_at).getTime();

        for (const b of newSegments) {
          const bStart = b.startsAt.getTime();
          const bEnd = b.endsAt.getTime();

          // Trùng khi aStart < bEnd && bStart < aEnd (liền kề không trùng)
          if (aStart < bEnd && bStart < aEnd) {
            const timeRange = existingShift.segments
              .map((seg) => `${formatTimeVN(new Date(seg.starts_at))}–${formatTimeVN(new Date(seg.ends_at))}`)
              .join(', ');
            const message = `${existingShift.fullName} đã có ${existingShift.shiftName} (${timeRange}) cùng ngày`;

            return {
              hasOverlap: true,
              message,
              conflictingShift: {
                shiftId: existingShift.id,
                shiftName: existingShift.shiftName,
                timeRange,
                userName: existingShift.fullName,
                workDate: date,
              },
            };
          }
        }
      }
    }

    return { hasOverlap: false };
  },
};
