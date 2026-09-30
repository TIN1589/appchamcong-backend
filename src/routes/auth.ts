/**
 * Auth routes
 * POST /api/auth/login          — public
 * POST /api/auth/refresh        — public (dùng refresh token cookie)
 * POST /api/auth/logout         — authenticate (cần access token)
 * POST /api/auth/change-password — authenticate (bắt buộc nếu mustChangePassword)
 * GET  /api/auth/me             — authenticate + requirePasswordChanged
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller.js';
import { authenticate, requirePasswordChanged } from '../middleware/auth.js';

export const authRouter = Router();

// Login rate limit — chặt hơn
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { code: 'RATE_LIMITED', message: 'Quá nhiều lần đăng nhập thất bại. Thử lại sau 15 phút.' },
});

// Public
authRouter.post('/login', loginLimiter, (req, res, next) => { void authController.login(req, res, next); });
authRouter.post('/refresh', (req, res, next) => { void authController.refresh(req, res, next); });

// Cần authenticate
authRouter.post(
  '/logout',
  authenticate,
  (req, res, next) => { void authController.logout(req, res, next); },
);

// change-password: authenticate nhưng KHÔNG requirePasswordChanged
// (vì đây chính là endpoint để fulfill mustChangePassword)
authRouter.post(
  '/change-password',
  authenticate,
  (req, res, next) => { void authController.changePassword(req, res, next); },
);

// me: cần đổi password rồi mới xem được
authRouter.get(
  '/me',
  authenticate,
  requirePasswordChanged,
  (req, res, next) => { void authController.me(req, res, next); },
);
