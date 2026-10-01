import { Router } from 'express';
import { shiftsController } from '../controllers/shifts.controller.js';
import {
  authenticate,
  requireRole,
  requirePasswordChanged,
} from '../middleware/auth.js';

export const shiftsRouter = Router();

shiftsRouter.use(authenticate, requirePasswordChanged);

shiftsRouter.get('/templates', (req, res, next) => {
  void shiftsController.listTemplates(req, res, next);
});
shiftsRouter.post('/templates', requireRole('admin'), (req, res, next) => {
  void shiftsController.createTemplate(req, res, next);
});

shiftsRouter.post('/from-template', requireRole('admin'), (req, res, next) => {
  void shiftsController.createFromTemplate(req, res, next);
});

shiftsRouter.get('/', (req, res, next) => { void shiftsController.list(req, res, next); });
shiftsRouter.post('/', requireRole('admin'), (req, res, next) => { void shiftsController.create(req, res, next); });
shiftsRouter.get('/:id', (req, res, next) => { void shiftsController.getById(req, res, next); });
shiftsRouter.post('/:id/assign', requireRole('admin'), (req, res, next) => { void shiftsController.assign(req, res, next); });
shiftsRouter.delete('/:id', requireRole('admin'), (req, res, next) => { void shiftsController.delete(req, res, next); });
