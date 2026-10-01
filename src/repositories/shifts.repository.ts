import { query, withTransaction } from '../db/client.js';
import type {
  Shift,
  ShiftSegment,
  ShiftTemplate,
  ShiftTemplateSegment,
  ShiftStatus,
  PaginatedResult,
  PaginationParams,
} from '../types/db.js';

export interface ShiftWithSegments extends Shift {
  segments: ShiftSegment[];
}

export interface TemplateWithSegments extends ShiftTemplate {
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
      segments: segsByTemplate.get(t.id) ?? [],
    }));
  },

  async createTemplate(
    storeId: number,
    createdBy: string,
    data: {
      name: string;
      color: string;
      segments: Array<{ startTime: string; endTime: string; sortOrder?: number }>;
    },
  ): Promise<TemplateWithSegments> {
    return withTransaction(async (client) => {
      const tResult = await client.query<ShiftTemplate>(
        `INSERT INTO shift_templates (store_id, name, color, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [storeId, data.name, data.color, createdBy],
      );
      const template = tResult.rows[0];
      if (!template) throw new Error('Insert template failed');

      const segments: ShiftTemplateSegment[] = [];
      for (let i = 0; i < data.segments.length; i++) {
        const seg = data.segments[i];
        if (!seg) continue;
        const sResult = await client.query<ShiftTemplateSegment>(
          `INSERT INTO shift_template_segments (template_id, start_time, end_time, sort_order)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [template.id, seg.startTime, seg.endTime, seg.sortOrder ?? i],
        );
        const inserted = sResult.rows[0];
        if (inserted) segments.push(inserted);
      }

      return { ...template, segments };
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
      segments: Array<{
        startsAt: Date;
        endsAt: Date;
        sortOrder?: number;
      }>;
    },
  ): Promise<ShiftWithSegments> {
    return withTransaction(async (client) => {
      const shiftResult = await client.query<Shift>(
        `INSERT INTO shifts (store_id, template_id, assigned_to, status, work_date, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          storeId,
          data.templateId ?? null,
          data.assignedTo ?? null,
          data.assignedTo ? 'assigned' : 'open',
          data.workDate,
          data.notes ?? null,
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
           VALUES ($1, $2, $3, $4) RETURNING *`,
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
        `UPDATE shifts SET assigned_to = $1, status = 'assigned', updated_at = NOW()
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
    userId: string,
    storeId: number,
    segments: Array<{ startsAt: Date; endsAt: Date }>,
    excludeShiftId?: string,
  ): Promise<boolean> {
    for (const seg of segments) {
      const result = await query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM shift_segments ss
         JOIN shifts s ON ss.shift_id = s.id
         WHERE s.assigned_to = $1
           AND s.store_id = $2
           AND s.status = 'assigned'
           AND ($3 IS NULL OR s.id != $3)
           AND ss.starts_at < $5
           AND ss.ends_at > $4`,
        [userId, storeId, excludeShiftId ?? null, seg.startsAt.toISOString(), seg.endsAt.toISOString()],
      );
      const count = parseInt(result.rows[0]?.count ?? '0', 10);
      if (count > 0) return true;
    }
    return false;
  },
};
