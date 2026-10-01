import { defaultShiftsRepository, type DefaultShiftWithDetails } from '../repositories/defaultShifts.repository.js';
import { shiftsRepository } from '../repositories/shifts.repository.js';
import { validateDayLoad } from '../lib/shiftLoadValidator.js';
import { AppError, ErrorCode, NotFoundError } from '../lib/errors.js';
import { query } from '../db/client.js';
import type { StaffDefaultShift } from '../types/db.js';

export const defaultShiftsService = {
  async list(storeId: number, userId?: string): Promise<DefaultShiftWithDetails[]> {
    return defaultShiftsRepository.list(storeId, userId);
  },

  async create(
    storeId: number,
    userId: string,
    weekday: number,
    shiftTemplateId: string,
  ): Promise<StaffDefaultShift> {
    if (weekday < 1 || weekday > 7) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Weekday phải từ 1 (Thứ Hai) đến 7 (Chủ Nhật)', 400);
    }

    // Kiểm tra nhân viên thuộc quán và đang active
    const userCheck = await query<{ id: string }>(
      'SELECT id FROM users WHERE id = $1 AND store_id = $2 AND is_active = TRUE',
      [userId, storeId],
    );
    if (userCheck.rows.length === 0) {
      throw new NotFoundError('Nhân viên không tồn tại hoặc đã ngừng hoạt động');
    }

    // Kiểm tra template tồn tại
    const templates = await shiftsRepository.listTemplates(storeId);
    const targetTemplate = templates.find((t) => t.id === shiftTemplateId);
    if (!targetTemplate) {
      throw new NotFoundError('Mẫu ca làm việc');
    }

    // Lấy các ca mặc định đã gán của nhân viên trong thứ này
    const existing = await defaultShiftsRepository.getByUserAndWeekday(storeId, userId, weekday);

    const scheduledThatDay = existing.map((s) => ({
      id: String(s.id),
      segments: s.segments.map((seg) => ({
        start: seg.start_time,
        end: seg.end_time,
      })),
    }));

    const incoming = {
      segments: targetTemplate.segments.map((seg) => ({
        start: seg.start_time,
        end: seg.end_time,
      })),
    };

    const validation = validateDayLoad(scheduledThatDay, incoming);
    if (!validation.ok) {
      if (validation.reason === 'OVER_DAILY_LIMIT') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Vượt quá giới hạn tối đa 2 ca trong ngày', 400);
      }
      if (validation.reason === 'OVERLAP') {
        throw new AppError(ErrorCode.SHIFT_ALREADY_ASSIGNED, 'Ca làm việc mặc định bị trùng giờ với ca khác trong ngày', 409);
      }
    }

    try {
      return await defaultShiftsRepository.create(storeId, userId, weekday, shiftTemplateId);
    } catch (err: unknown) {
      const dbErr = err as { code?: string };
      if (dbErr.code === '23505') {
        throw new AppError(ErrorCode.CONFLICT, 'Nhân viên đã được gán mẫu ca này vào thứ tương ứng', 409);
      }
      throw err;
    }
  },

  async delete(id: number, storeId: number): Promise<void> {
    const deleted = await defaultShiftsRepository.delete(id, storeId);
    if (!deleted) {
      throw new NotFoundError('Ca mặc định không tồn tại');
    }
  },
};
