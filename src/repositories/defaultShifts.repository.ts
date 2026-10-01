import { query } from '../db/client.js';
import type { StaffDefaultShift } from '../types/db.js';

export interface DefaultShiftWithDetails extends StaffDefaultShift {
  user_name: string;
  user_email: string;
  template_name: string;
  template_color: string;
  segments: Array<{
    start_time: string;
    end_time: string;
    sort_order: number;
  }>;
}

export const defaultShiftsRepository = {
  async list(storeId: number, userId?: string): Promise<DefaultShiftWithDetails[]> {
    const conditions = ['d.store_id = $1'];
    const params: unknown[] = [storeId];

    if (userId) {
      conditions.push('d.user_id = $2');
      params.push(userId);
    }

    const sql = `
      SELECT 
        d.id,
        d.store_id,
        d.user_id,
        d.weekday,
        d.shift_template_id,
        d.created_at,
        d.updated_at,
        u.full_name AS user_name,
        u.email AS user_email,
        t.name AS template_name,
        t.color AS template_color
      FROM staff_default_shifts d
      JOIN users u ON d.user_id = u.id
      JOIN shift_templates t ON d.shift_template_id = t.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.weekday ASC, u.full_name ASC
    `;

    const result = await query<Omit<DefaultShiftWithDetails, 'segments'>>(sql, params);
    if (result.rows.length === 0) return [];

    const templateIds = [...new Set(result.rows.map((r) => r.shift_template_id))];
    const segsResult = await query<{
      template_id: string;
      start_time: string;
      end_time: string;
      sort_order: number;
    }>(
      `SELECT template_id, start_time, end_time, sort_order
       FROM shift_template_segments
       WHERE template_id = ANY($1::uuid[])
       ORDER BY sort_order ASC`,
      [templateIds],
    );

    const segsByTpl = new Map<string, Array<{ start_time: string; end_time: string; sort_order: number }>>();
    for (const seg of segsResult.rows) {
      const arr = segsByTpl.get(seg.template_id) ?? [];
      arr.push({
        start_time: seg.start_time,
        end_time: seg.end_time,
        sort_order: seg.sort_order,
      });
      segsByTpl.set(seg.template_id, arr);
    }

    return result.rows.map((row) => ({
      ...row,
      segments: segsByTpl.get(row.shift_template_id) ?? [],
    }));
  },

  async getByUserAndWeekday(
    storeId: number,
    userId: string,
    weekday: number,
  ): Promise<DefaultShiftWithDetails[]> {
    const all = await this.list(storeId, userId);
    return all.filter((s) => s.weekday === weekday);
  },

  async create(
    storeId: number,
    userId: string,
    weekday: number,
    shiftTemplateId: string,
  ): Promise<StaffDefaultShift> {
    const result = await query<StaffDefaultShift>(
      `INSERT INTO staff_default_shifts (store_id, user_id, weekday, shift_template_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [storeId, userId, weekday, shiftTemplateId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Create staff default shift failed');
    return row;
  },

  async delete(id: number, storeId: number): Promise<boolean> {
    const result = await query(
      `DELETE FROM staff_default_shifts WHERE id = $1 AND store_id = $2`,
      [id, storeId],
    );
    return (result.rowCount ?? 0) > 0;
  },
};
