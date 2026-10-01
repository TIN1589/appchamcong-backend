import { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { shiftsService } from '../services/shifts.service.js';
import { defaultShiftsService } from '../services/defaultShifts.service.js';
import { getWeekRange } from '../lib/timezone.js';

const segmentSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:mm'),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#6C4CF1'),
  segments: z.array(segmentSchema).min(1).max(4),
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
  async listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const templates = await shiftsService.listTemplates(req.user!.storeId);
      res.json(templates);
    } catch (err) { next(err); }
  },

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

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = dateRangeSchema.parse(req.query);
      const currentWeek = getWeekRange();

      const startDate = query.startDate ?? currentWeek.startDate;
      const endDate = query.endDate ?? currentWeek.endDate;

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

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shift = await shiftsService.getById(req.params['id']!, req.user!.storeId);
      res.json(shift);
    } catch (err) { next(err); }
  },

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

  async assign(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = assignSchema.parse(req.body);
      const shift = await shiftsService.assign(req.params['id']!, req.user!.storeId, userId);
      res.json(shift);
    } catch (err) { next(err); }
  },

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await shiftsService.delete(req.params['id']!, req.user!.storeId);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async listDefaultShifts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.query['userId'] as string | undefined;
      const list = await defaultShiftsService.list(req.user!.storeId, userId);
      res.json(list);
    } catch (err) { next(err); }
  },

  async createDefaultShift(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        userId: z.string().uuid(),
        weekday: z.number().int().min(1).max(7),
        shiftTemplateId: z.string().uuid(),
      });
      const body = schema.parse(req.body);
      const created = await defaultShiftsService.create(
        req.user!.storeId,
        body.userId,
        body.weekday,
        body.shiftTemplateId,
      );
      res.status(201).json(created);
    } catch (err) { next(err); }
  },

  async deleteDefaultShift(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params['id']!, 10);
      await defaultShiftsService.delete(id, req.user!.storeId);
      res.status(204).send();
    } catch (err) { next(err); }
  },
};
