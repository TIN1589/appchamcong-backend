import { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { adjustmentService } from '../services/adjustment.service.js';
import { UnauthorizedError } from '../lib/errors.js';

const adjustmentTypeEnum = z.enum([
  'forgot_checkin',
  'forgot_checkout',
  'forgot_both',
  'official_late_early',
  'overtime',
]);

const createAdjustmentSchema = z.object({
  shift_id: z.string().uuid('shift_id phải là UUID hợp lệ'),
  segment_id: z.string().uuid('segment_id phải là UUID hợp lệ'),
  request_type: adjustmentTypeEnum,
  reason: z.string().min(3, 'Lý do xin điều chỉnh phải có ít nhất 3 ký tự'),
  proposed_checkin_at: z.string().datetime({ offset: true }).optional().transform((v) => (v ? new Date(v) : undefined)),
  proposed_checkout_at: z.string().datetime({ offset: true }).optional().transform((v) => (v ? new Date(v) : undefined)),
  proposed_minutes: z.number().int().positive('Số phút đề xuất phải là số nguyên dương').optional(),
  user_id: z.string().uuid().optional(),
});

const reviewAdjustmentSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  admin_note: z.string().max(500, 'Ghi chú tối đa 500 ký tự').optional(),
});

const listQuerySchema = z.object({
  user_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  request_type: adjustmentTypeEnum.optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from_date định dạng YYYY-MM-DD').optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to_date định dạng YYYY-MM-DD').optional(),
});

export const adjustmentController = {
  /**
   * POST /api/adjustments
   * Tạo đơn ngoại lệ
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const body = createAdjustmentSchema.parse(req.body);

      const targetUserId = req.user.role === 'admin' && body.user_id ? body.user_id : req.user.id;

      const result = await adjustmentService.createRequest(
        {
          storeId: req.user.storeId,
          userId: targetUserId,
          shiftId: body.shift_id,
          segmentId: body.segment_id,
          requestType: body.request_type,
          reason: body.reason,
          proposedCheckinAt: body.proposed_checkin_at,
          proposedCheckoutAt: body.proposed_checkout_at,
          proposedMinutes: body.proposed_minutes,
        },
        {
          id: req.user.id,
          storeId: req.user.storeId,
          role: req.user.role,
        },
      );

      res.status(201).json({
        data: result,
        message: 'Tạo đơn ngoại lệ thành công',
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/adjustments
   * Lấy danh sách đơn ngoại lệ
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const queryParams = listQuerySchema.parse(req.query);

      const results = await adjustmentService.listRequests(
        {
          storeId: req.user.storeId,
          userId: queryParams.user_id,
          status: queryParams.status,
          requestType: queryParams.request_type,
          fromDate: queryParams.from_date,
          toDate: queryParams.to_date,
        },
        {
          id: req.user.id,
          storeId: req.user.storeId,
          role: req.user.role,
        },
      );

      res.status(200).json({
        data: results,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/adjustments/:id
   * Chi tiết đơn ngoại lệ
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const id = req.params['id'] ?? '';

      const result = await adjustmentService.getById(id, {
        id: req.user.id,
        storeId: req.user.storeId,
        role: req.user.role,
      });

      res.status(200).json({
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/adjustments/:id
   * Hủy đơn ngoại lệ khi còn pending
   */
  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const id = req.params['id'] ?? '';

      await adjustmentService.cancelRequest(id, {
        id: req.user.id,
        storeId: req.user.storeId,
        role: req.user.role,
      });

      res.status(200).json({
        message: 'Đã hủy đơn ngoại lệ thành công',
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/adjustments/:id/review
   * Admin duyệt hoặc từ chối đơn
   */
  async review(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const id = req.params['id'] ?? '';
      const body = reviewAdjustmentSchema.parse(req.body);

      const result = await adjustmentService.reviewRequest({
        requestId: id,
        reviewer: {
          id: req.user.id,
          storeId: req.user.storeId,
          role: req.user.role,
        },
        decision: body.decision,
        adminNote: body.admin_note,
      });

      res.status(200).json({
        data: result,
        message:
          body.decision === 'approved'
            ? 'Đã duyệt đơn ngoại lệ và đồng bộ công thành công'
            : 'Đã từ chối đơn ngoại lệ',
      });
    } catch (err) {
      next(err);
    }
  },
};
