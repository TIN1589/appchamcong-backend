import { shiftsRepository } from '../repositories/shifts.repository.js';
import { NotFoundError, AppError, ErrorCode, ConflictError } from '../lib/errors.js';

import type { ShiftWithSegments, TemplateWithSegments } from '../repositories/shifts.repository.js';
import type { PaginatedResult, PaginationParams, ShiftStatus } from '../types/db.js';

function buildSegmentTime(workDate: string, timeStr: string): Date {
  const [y, m, d] = workDate.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);

  if (!y || !m || !d || h === undefined || min === undefined) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Định dạng ngày/giờ không hợp lệ', 400);
  }

  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const localMs = Date.UTC(y, m - 1, d, h, min, 0, 0);
  return new Date(localMs - VN_OFFSET_MS);
}

export const shiftsService = {
  async listTemplates(storeId: number): Promise<TemplateWithSegments[]> {
    return shiftsRepository.listTemplates(storeId);
  },

  async createTemplate(
    storeId: number,
    createdBy: string,
    data: {
      name: string;
      color?: string;
      segments: Array<{ startTime: string; endTime: string }>;
    },
  ): Promise<TemplateWithSegments> {
    if (data.segments.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Template phải có ít nhất 1 segment', 400);
    }

    const timeRegex = /^\d{2}:\d{2}$/;
    for (const seg of data.segments) {
      if (!timeRegex.test(seg.startTime) || !timeRegex.test(seg.endTime)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Format giờ phải là HH:mm', 400);
      }
      if (seg.startTime >= seg.endTime) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Giờ bắt đầu phải trước giờ kết thúc', 400);
      }
    }

    for (const seg of data.segments) {
      if (seg.startTime >= seg.endTime) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Không hỗ trợ ca qua đêm', 400);
      }
    }

    return shiftsRepository.createTemplate(storeId, createdBy, {
      name: data.name,
      color: data.color ?? '#6C4CF1',
      segments: data.segments.map((s, i) => ({
        startTime: s.startTime,
        endTime: s.endTime,
        sortOrder: i,
      })),
    });
  },

  async createFromTemplate(
    storeId: number,
    createdBy: string,
    data: {
      templateId: string;
      workDate: string;
      assignedTo?: string;
      notes?: string;
    },
  ): Promise<ShiftWithSegments> {
    const templates = await shiftsRepository.listTemplates(storeId);
    const template = templates.find((t) => t.id === data.templateId);
    if (!template) throw new NotFoundError('Shift template');

    const segments = template.segments.map((seg, i) => ({
      startsAt: buildSegmentTime(data.workDate, seg.start_time),
      endsAt: buildSegmentTime(data.workDate, seg.end_time),
      sortOrder: i,
    }));

    return shiftsRepository.create(storeId, createdBy, {
      templateId: data.templateId,
      ...(data.assignedTo !== undefined ? { assignedTo: data.assignedTo } : {}),
      workDate: data.workDate,
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      segments,
    });
  },

  async create(
    storeId: number,
    createdBy: string,
    data: {
      workDate: string;
      assignedTo?: string;
      notes?: string;
      segments: Array<{ startTime: string; endTime: string }>;
    },
  ): Promise<ShiftWithSegments> {
    if (data.segments.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Phải có ít nhất 1 segment', 400);
    }

    const timeRegex = /^\d{2}:\d{2}$/;
    for (const seg of data.segments) {
      if (!timeRegex.test(seg.startTime) || !timeRegex.test(seg.endTime)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Format giờ phải là HH:mm', 400);
      }
      if (seg.startTime >= seg.endTime) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Giờ bắt đầu phải trước giờ kết thúc', 400);
      }
    }

    const segments = data.segments.map((seg, i) => ({
      startsAt: buildSegmentTime(data.workDate, seg.startTime),
      endsAt: buildSegmentTime(data.workDate, seg.endTime),
      sortOrder: i,
    }));

    return shiftsRepository.create(storeId, createdBy, {
      workDate: data.workDate,
      ...(data.assignedTo !== undefined ? { assignedTo: data.assignedTo } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      segments,
    });
  },

  async getById(shiftId: string, storeId: number): Promise<ShiftWithSegments> {
    const shift = await shiftsRepository.findById(shiftId, storeId);
    if (!shift) throw new NotFoundError('Ca làm việc');
    return shift;
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
    return shiftsRepository.listByDateRange(storeId, startDate, endDate, pagination, filters);
  },

  async assign(
    shiftId: string,
    storeId: number,
    userId: string,
  ): Promise<ShiftWithSegments> {
    const shift = await shiftsRepository.assignToUser(shiftId, storeId, userId);
    if (!shift) {
      throw new ConflictError(
        ErrorCode.SHIFT_NOT_OPEN,
        'Ca này không còn trống hoặc không tồn tại',
      );
    }
    const full = await shiftsRepository.findById(shift.id, storeId);
    if (!full) throw new NotFoundError('Ca làm việc');
    return full;
  },

  async delete(shiftId: string, storeId: number): Promise<void> {
    const deleted = await shiftsRepository.delete(shiftId, storeId);
    if (!deleted) {
      throw new AppError(
        ErrorCode.SHIFT_NOT_OPEN,
        'Chỉ xóa được ca ở trạng thái trống',
        409,
      );
    }
  },
};
