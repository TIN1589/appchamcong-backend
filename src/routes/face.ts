import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { attendanceController } from '../controllers/attendance.controller.js';
import { authenticate, requirePasswordChanged, requireRole } from '../middleware/auth.js';

export const faceRouter = Router();

const enrollRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'RATE_LIMITED',
    message: 'Thao tác đăng ký khuôn mặt quá thường xuyên. Vui lòng thử lại sau.',
  },
});

faceRouter.use(authenticate, requirePasswordChanged);

faceRouter.post('/enroll', enrollRateLimiter, (req, res, next) => {
  void attendanceController.enrollFace(req, res, next);
});
faceRouter.get('/status', (req, res, next) => {
  void attendanceController.getFaceStatus(req, res, next);
});
faceRouter.get('/me', (req, res, next) => {
  void attendanceController.getFaceStatus(req, res, next);
});

// Admin endpoints quản lý mẫu khuôn mặt
faceRouter.post('/:userId/reset', requireRole('admin'), (req, res, next) => {
  void attendanceController.resetFace(req, res, next);
});
faceRouter.delete('/:userId', requireRole('admin'), (req, res, next) => {
  void attendanceController.deleteFace(req, res, next);
});
