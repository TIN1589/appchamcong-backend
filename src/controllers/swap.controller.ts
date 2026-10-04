import { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { swapService } from '../services/swap.service.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';

const createSwapSchema = z.object({
  requester_shift_id: z.string().uuid('requester_shift_id phải là UUID'),
  receiver_id: z.string().uuid('receiver_id phải là UUID'),
  receiver_shift_id: z.string().uuid('receiver_shift_id phải là UUID'),
  reason: z.string().max(500, 'Lý do tối đa 500 ký tự').optional(),
});

const publishPoolSchema = z.object({
  shift_id: z.string().uuid('shift_id phải là UUID'),
  reason: z.string().max(500, 'Lý do tối đa 500 ký tự').optional(),
});

const reviewSwapSchema = z.object({
  action: z.enum(['approve', 'reject']),
  admin_note: z.string().max(500, 'Ghi chú tối đa 500 ký tự').optional(),
});

const listSwapsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  type: z.enum(['swap', 'pool']).optional(),
  user_id: z.string().uuid().optional(),
});

export const swapController = {
  /**
   * POST /api/swaps - Tạo yêu cầu đổi ca 1-1
   */
  async createSwap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const body = createSwapSchema.parse(req.body);

      const result = await swapService.createSwapRequest({
        storeId: req.user.storeId,
        requesterId: req.user.id,
        requesterShiftId: body.requester_shift_id,
        receiverId: body.receiver_id,
        receiverShiftId: body.receiver_shift_id,
        reason: body.reason,
      });

      res.status(201).json({
        data: result,
        message: 'Yêu cầu đổi ca đã được gửi thành công và đang chờ xét duyệt',
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/shift-pool/publish - Đẩy ca lên Shift Pool (Chợ ca)
   */
  async publishToPool(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const body = publishPoolSchema.parse(req.body);

      const result = await swapService.publishToPool({
        storeId: req.user.storeId,
        requesterId: req.user.id,
        shiftId: body.shift_id,
        reason: body.reason,
      });

      res.status(201).json({
        data: result,
        message: 'Ca làm việc đã được đưa lên Chợ ca thành công',
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/shift-pool/:id/claim - Nhận ca từ Shift Pool (Chợ ca)
   */
  async claimPoolShift(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const { id } = req.params;
      if (!id) throw new Error('Missing swapRequestId');

      const result = await swapService.claimPoolShift({
        storeId: req.user.storeId,
        claimerId: req.user.id,
        swapRequestId: id,
      });

      res.status(200).json({
        data: result,
        message: 'Bạn đã nhận ca thành công từ Chợ ca',
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/shift-pool - Danh sách ca trong Shift Pool
   */
  async listPoolShifts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const items = await swapService.listPoolShifts(req.user.storeId);
      res.status(200).json({ data: items });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/swaps - Danh sách yêu cầu đổi ca
   */
  async listSwaps(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const query = listSwapsQuerySchema.parse(req.query);

      // Staff chỉ xem được đơn liên quan đến mình
      let effectiveUserId = query.user_id;
      if (req.user.role === 'staff') {
        effectiveUserId = req.user.id;
      }

      const items = await swapService.list(req.user.storeId, {
        userId: effectiveUserId,
        status: query.status,
        type: query.type,
      });

      res.status(200).json({ data: items });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/swaps/:id - Chi tiết một yêu cầu đổi ca
   */
  async getSwapById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const { id } = req.params;
      if (!id) throw new Error('Missing swap id');

      const item = await swapService.getById(id, req.user.storeId);

      // Phân quyền: Staff chỉ xem được đơn mà mình là requester hoặc receiver
      if (
        req.user.role === 'staff' &&
        item.requester_id !== req.user.id &&
        item.receiver_id !== req.user.id
      ) {
        throw new ForbiddenError('Bạn không có quyền xem đơn đổi ca này');
      }

      res.status(200).json({ data: item });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/swaps/:id/review - Duyệt / Từ chối đơn đổi ca (Admin)
   */
  async reviewSwap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      if (req.user.role !== 'admin') {
        throw new ForbiddenError('Chỉ Quản lý mới có quyền duyệt đơn đổi ca');
      }

      const { id } = req.params;
      if (!id) throw new Error('Missing swap id');
      const body = reviewSwapSchema.parse(req.body);

      const result = await swapService.reviewSwapRequest({
        storeId: req.user.storeId,
        adminId: req.user.id,
        swapRequestId: id,
        action: body.action,
        adminNote: body.admin_note,
      });

      res.status(200).json({
        data: result,
        message: body.action === 'approve' ? 'Đã duyệt đổi ca thành công' : 'Đã từ chối đơn đổi ca',
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/swaps/:id - Huỷ đơn đổi ca
   */
  async cancelSwap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const { id } = req.params;
      if (!id) throw new Error('Missing swap id');

      await swapService.cancelSwapRequest(id, req.user.storeId, req.user.id);

      res.status(200).json({
        message: 'Đã huỷ đơn đổi ca thành công',
      });
    } catch (err) {
      next(err);
    }
  },
};
