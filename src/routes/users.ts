import { Router } from 'express';
import { usersController } from '../controllers/users.controller.js';
import {
  authenticate,
  requireRole,
  requirePasswordChanged,
  requireOwnershipOrAdmin,
} from '../middleware/auth.js';

export const usersRouter = Router();

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

usersRouter.post(
  '/:id/face',
  requireOwnershipOrAdmin((req) => req.params['id']!),
  (req, res, next) => { void usersController.enrollFace(req, res, next); },
);
