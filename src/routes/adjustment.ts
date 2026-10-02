import { Router } from 'express';
import { adjustmentController } from '../controllers/adjustment.controller.js';
import { authenticate, requirePasswordChanged, requireRole } from '../middleware/auth.js';

export const adjustmentRouter = Router();

// Toàn bộ routes của adjustment đều yêu cầu đăng nhập và đã đổi mật khẩu ban đầu
adjustmentRouter.use(authenticate, requirePasswordChanged);

// Tạo đơn ngoại lệ (Staff & Admin)
adjustmentRouter.post('/', (req, res, next) => {
  void adjustmentController.create(req, res, next);
});

// Lấy danh sách đơn ngoại lệ
adjustmentRouter.get('/', (req, res, next) => {
  void adjustmentController.list(req, res, next);
});

// Chi tiết đơn ngoại lệ
adjustmentRouter.get('/:id', (req, res, next) => {
  void adjustmentController.getById(req, res, next);
});

// Hủy đơn ngoại lệ khi còn pending
adjustmentRouter.delete('/:id', (req, res, next) => {
  void adjustmentController.cancel(req, res, next);
});

// Duyệt hoặc từ chối đơn ngoại lệ (Admin only)
adjustmentRouter.post('/:id/review', requireRole('admin'), (req, res, next) => {
  void adjustmentController.review(req, res, next);
});
