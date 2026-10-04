import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { attendanceController } from '../controllers/attendance.controller.js';
import { authenticate, requirePasswordChanged } from '../middleware/auth.js';

export const attendanceRouter = Router();

const attendanceRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 10, // tối đa 10 request/phút
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'RATE_LIMITED',
    message: 'Thao tác chấm công quá nhanh. Vui lòng thử lại sau giây lát.',
  },
});

attendanceRouter.use(authenticate, requirePasswordChanged);

attendanceRouter.post('/checkin', attendanceRateLimiter, (req, res, next) => {
  void attendanceController.checkin(req, res, next);
});
attendanceRouter.post('/checkout', attendanceRateLimiter, (req, res, next) => {
  void attendanceController.checkout(req, res, next);
});
attendanceRouter.get('/', (req, res, next) => {
  void attendanceController.list(req, res, next);
});
