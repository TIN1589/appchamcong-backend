/**
 * Users routes
 * GET  /api/users           — Admin: list all; Staff: forbidden
 * POST /api/users           — Admin only: tạo nhân viên
 * GET  /api/users/:id       — Admin: any; Staff: chỉ của mình
 * PATCH /api/users/:id      — Admin: any; Staff: chỉ của mình (limited fields)
 * POST /api/users/:id/face  — Admin hoặc chính user
 */
import { Router } from 'express';
import { usersController } from '../controllers/users.controller.js';
import {
  authenticate,
  requireRole,
  requirePasswordChanged,
  requireOwnershipOrAdmin,
} from '../middleware/auth.js';

export const usersRouter = Router();

// Tất cả users routes đều cần authenticate và đổi pass
usersRouter.use(authenticate, requirePasswordChanged);

usersRouter.get(
  '/',
  requireRole('admin'),
  (req, res, next) => { void usersController.list(req, res, next); },
);

usersRouter.post(
  '/',
  requireRole('admin'),
  (req, res, next) => { void usersController.create(req, res, next); },
);

usersRouter.get(
  '/:id',
  requireOwnershipOrAdmin((req) => req.params['id']!),
  (req, res, next) => { void usersController.getById(req, res, next); },
);

usersRouter.patch(
  '/:id',
  requireOwnershipOrAdmin((req) => req.params['id']!),
  (req, res, next) => { void usersController.update(req, res, next); },
);

// Face enrollment — Admin hoặc chính user
usersRouter.post(
  '/:id/face',
  requireOwnershipOrAdmin((req) => req.params['id']!),
  (req, res, next) => { void usersController.enrollFace(req, res, next); },
);
