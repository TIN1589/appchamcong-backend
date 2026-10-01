import { Router } from 'express';
import { scheduleController } from '../controllers/schedule.controller.js';
import { authenticate, requirePasswordChanged, requireRole } from '../middleware/auth.js';

export const scheduleRouter = Router();

scheduleRouter.use(authenticate, requirePasswordChanged);

scheduleRouter.get('/week', (req, res, next) => {
  void scheduleController.getWeekSchedule(req, res, next);
});

scheduleRouter.post('/generate', requireRole('admin'), (req, res, next) => {
  void scheduleController.generateWeek(req, res, next);
});

