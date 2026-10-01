import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller.js';
import { authenticate, requirePasswordChanged } from '../middleware/auth.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { code: 'RATE_LIMITED', message: 'Quá nhiều lần đăng nhập thất bại. Thử lại sau 15 phút.' },
});

authRouter.post('/login', loginLimiter, (req, res, next) => { void authController.login(req, res, next); });
authRouter.post('/refresh', (req, res, next) => { void authController.refresh(req, res, next); });

authRouter.post(
  '/logout',
  authenticate,
  (req, res, next) => { void authController.logout(req, res, next); },
);

authRouter.post(
  '/change-password',
  authenticate,
  (req, res, next) => { void authController.changePassword(req, res, next); },
);

authRouter.get(
  '/me',
  authenticate,
  requirePasswordChanged,
  (req, res, next) => { void authController.me(req, res, next); },
);
