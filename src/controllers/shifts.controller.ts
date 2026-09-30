/**
 * Shifts controller
 */
import { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { shiftsService } from '../services/shifts.service.js';
import { getWeekRange } from '../lib/timezone.js';

const segmentSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:mm'),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#6C4CF1'),
  segments: z.array(segmentSchema).min(1).max(4),  // max 4 segments/ca
});

const createShiftSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD'),
  assignedTo: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
  segments: z.array(segmentSchema).min(1).max(4),
});

const createShiftFromTemplateSchema = z.object({
  templateId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD'),
  assignedTo: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
});

const assignSchema = z.object({
  userId: z.string().uuid(),
});

const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assignedTo: z.string().uuid().optional(),
  status: z.enum(['open', 'assigned', 'completed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const shiftsController = {
  /** GET /api/shifts/templates */
  async listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const templates = await shiftsService.listTemplates(req.user!.storeId);
      res.json(templates);
    } catch (err) { next(err); }
  },

  /** POST /api/shifts/templates — Admin only */
  async createTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = createTemplateSchema.parse(req.body);
      const template = await shiftsService.createTemplate(
        req.user!.storeId,
        req.user!.id,
        body,
      );
      res.status(201).json(template);
    } catch (err) { next(err); }
  },

  /** GET /api/shifts — list theo date range, default tuần hiện tại */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = dateRangeSchema.parse(req.query);
      const currentWeek = getWeekRange();

      const startDate = query.startDate ?? currentWeek.startDate;
      const endDate = query.endDate ?? currentWeek.endDate;

      // Staff chỉ thấy ca của mình
      const assignedTo =
        req.user!.role === 'staff' ? req.user!.id : query.assignedTo;

      const result = await shiftsService.listByDateRange(
        req.user!.storeId,
        startDate,
        endDate,
        { page: query.page, limit: query.limit },
        {
          ...(assignedTo !== undefined ? { assignedTo } : {}),
          ...(query.status !== undefined ? { status: query.status } : {}),
        },
      );
      res.json(result);
    } catch (err) { next(err); }
  },

  /** GET /api/shifts/:id */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shift = await shiftsService.getById(req.params['id']!, req.user!.storeId);
      res.json(shift);
    } catch (err) { next(err); }
  },

  /** POST /api/shifts — tạo ca tùy chỉnh, Admin only */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = createShiftSchema.parse(req.body);
      const shift = await shiftsService.create(req.user!.storeId, req.user!.id, {
        workDate: body.workDate,
        ...(body.assignedTo !== undefined ? { assignedTo: body.assignedTo } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        segments: body.segments,
      });
      res.status(201).json(shift);
    } catch (err) { next(err); }
  },

  /** POST /api/shifts/from-template — tạo ca từ template, Admin only */
  async createFromTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = createShiftFromTemplateSchema.parse(req.body);
      const shift = await shiftsService.createFromTemplate(
        req.user!.storeId,
        req.user!.id,
        {
          templateId: body.templateId,
          workDate: body.workDate,
          ...(body.assignedTo !== undefined ? { assignedTo: body.assignedTo } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        },
      );
      res.status(201).json(shift);
    } catch (err) { next(err); }
  },

  /** POST /api/shifts/:id/assign — Admin gán ca */
  async assign(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = assignSchema.parse(req.body);
      const shift = await shiftsService.assign(req.params['id']!, req.user!.storeId, userId);
      res.json(shift);
    } catch (err) { next(err); }
  },

  /** DELETE /api/shifts/:id — Admin xóa ca trống */
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await shiftsService.delete(req.params['id']!, req.user!.storeId);
      res.status(204).send();
    } catch (err) { next(err); }
  },
};
