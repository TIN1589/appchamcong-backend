import { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { scheduleService } from '../services/schedule.service.js';
import { rosterGenerationService } from '../services/rosterGeneration.service.js';

const weekScheduleQuerySchema = z.object({
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD')
    .optional(),
  scope: z.enum(['me', 'store']).default('me'),
});

const generateScheduleQuerySchema = z.object({
  week: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD')
    .optional(),
});

export const scheduleController = {
  async getWeekSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = weekScheduleQuerySchema.parse(req.query);
      const result = await scheduleService.getWeekSchedule(
        req.user!.storeId,
        req.user!.id,
        {
          start: query.start,
          scope: query.scope,
        },
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async generateWeek(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = generateScheduleQuerySchema.parse(req.query);
      const result = await rosterGenerationService.generateWeek(
        req.user!.storeId,
        query.week,
      );
      res.status(200).json({
        success: true,
        message: `Đã sinh lịch tuần ${result.weekStart} thành công`,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },
};

