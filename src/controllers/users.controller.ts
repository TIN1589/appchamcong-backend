import { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { usersService } from '../services/users.service.js';

const createUserSchema = z.object({
  email: z.string().email(),
  initialPassword: z.string().min(8),
  role: z.enum(['admin', 'staff']).default('staff'),
  fullName: z.string().min(1).max(100),
  phone: z.string().regex(/^[0-9+\-\s]{7,20}$/).optional(),
  hourlyRate: z.number().int().min(0).optional(),
  leaveBalance: z.number().int().min(0).max(365).optional(),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  phone: z.string().regex(/^[0-9+\-\s]{7,20}$/).nullable().optional(),
  hourlyRate: z.number().int().min(0).optional(),
  leaveBalance: z.number().int().min(0).max(365).optional(),
  isActive: z.boolean().optional(),
});

const faceDescriptorSchema = z.object({
  descriptor: z.array(z.number()).length(128),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const usersController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, limit } = paginationSchema.parse(req.query);
      const roleRaw = req.query['role'] as 'admin' | 'staff' | undefined;
      const filters = roleRaw !== undefined
        ? { role: roleRaw, isActive: true as const }
        : { isActive: true as const };
      const result = await usersService.list(
        req.user!.storeId,
        { page, limit },
        filters,
      );
      res.json(result);
    } catch (err) { next(err); }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params['id']!;
      const user = await usersService.getById(userId, req.user!.storeId);
      res.json(user);
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = createUserSchema.parse(req.body);
      const user = await usersService.create(req.user!.storeId, {
        email: body.email,
        initialPassword: body.initialPassword,
        role: body.role,
        fullName: body.fullName,
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.hourlyRate !== undefined ? { hourlyRate: body.hourlyRate } : {}),
        ...(body.leaveBalance !== undefined ? { leaveBalance: body.leaveBalance } : {}),
      });
      res.status(201).json(user);
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params['id']!;
      const body = updateUserSchema.parse(req.body);
      const user = await usersService.update(userId, req.user!.storeId, {
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.hourlyRate !== undefined ? { hourlyRate: body.hourlyRate } : {}),
        ...(body.leaveBalance !== undefined ? { leaveBalance: body.leaveBalance } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      });
      res.json(user);
    } catch (err) { next(err); }
  },

  async enrollFace(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params['id']!;
      const { descriptor } = faceDescriptorSchema.parse(req.body);
      await usersService.enrollFace(userId, req.user!.storeId, descriptor);
      res.json({ message: 'Đăng ký khuôn mặt thành công' });
    } catch (err) { next(err); }
  },
};
