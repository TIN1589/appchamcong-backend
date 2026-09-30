/**
 * Shifts routes
 * GET  /api/shifts/templates         — Admin + Staff (xem templates)
 * POST /api/shifts/templates         — Admin only
 * GET  /api/shifts                   — Admin: all; Staff: của mình
 * POST /api/shifts                   — Admin only: tạo ca tùy chỉnh
 * POST /api/shifts/from-template     — Admin only
 * GET  /api/shifts/:id               — Admin + Staff
 * POST /api/shifts/:id/assign        — Admin only
 * DELETE /api/shifts/:id             — Admin only
 */
import { Router } from 'express';
import { shiftsController } from '../controllers/shifts.controller.js';
import {
  authenticate,
  requireRole,
  requirePasswordChanged,
} from '../middleware/auth.js';

export const shiftsRouter = Router();

// Tất cả shifts routes cần authenticate và đổi pass
shiftsRouter.use(authenticate, requirePasswordChanged);

// Templates
shiftsRouter.get('/templates', (req, res, next) => {
  void shiftsController.listTemplates(req, res, next);
});
shiftsRouter.post('/templates', requireRole('admin'), (req, res, next) => {
  void shiftsController.createTemplate(req, res, next);
});

// Create from template — trước /:id để không bị match nhầm
shiftsRouter.post('/from-template', requireRole('admin'), (req, res, next) => {
  void shiftsController.createFromTemplate(req, res, next);
});

// CRUD shifts
shiftsRouter.get('/', (req, res, next) => { void shiftsController.list(req, res, next); });
shiftsRouter.post('/', requireRole('admin'), (req, res, next) => { void shiftsController.create(req, res, next); });
shiftsRouter.get('/:id', (req, res, next) => { void shiftsController.getById(req, res, next); });
shiftsRouter.post('/:id/assign', requireRole('admin'), (req, res, next) => { void shiftsController.assign(req, res, next); });
shiftsRouter.delete('/:id', requireRole('admin'), (req, res, next) => { void shiftsController.delete(req, res, next); });
