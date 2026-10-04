import { Router } from 'express';
import { swapController } from '../controllers/swap.controller.js';
import { authenticate, requirePasswordChanged, requireRole } from '../middleware/auth.js';

export const swapRouter = Router();
export const shiftPoolRouter = Router();

// Toàn bộ routes yêu cầu đăng nhập và đã đổi mật khẩu
swapRouter.use(authenticate, requirePasswordChanged);
shiftPoolRouter.use(authenticate, requirePasswordChanged);

// ── SWAP REQUESTS ROUTES (/api/swaps) ──
// Tạo yêu cầu đổi ca 1-1
swapRouter.post('/', (req, res, next) => {
  void swapController.createSwap(req, res, next);
});

// Lấy danh sách yêu cầu đổi ca
swapRouter.get('/', (req, res, next) => {
  void swapController.listSwaps(req, res, next);
});

// Xem chi tiết yêu cầu đổi ca
swapRouter.get('/:id', (req, res, next) => {
  void swapController.getSwapById(req, res, next);
});

// Admin duyệt / từ chối đơn đổi ca
swapRouter.patch('/:id/review', requireRole('admin'), (req, res, next) => {
  void swapController.reviewSwap(req, res, next);
});

// Hủy yêu cầu đổi ca khi còn pending
swapRouter.delete('/:id', (req, res, next) => {
  void swapController.cancelSwap(req, res, next);
});

// ── SHIFT POOL ROUTES (/api/shift-pool) ──
// Lấy danh sách ca trong Shift Pool
shiftPoolRouter.get('/', (req, res, next) => {
  void swapController.listPoolShifts(req, res, next);
});

// Nhân viên đẩy ca lên Chợ ca
shiftPoolRouter.post('/publish', (req, res, next) => {
  void swapController.publishToPool(req, res, next);
});

// Nhân viên nhận ca từ Chợ ca
shiftPoolRouter.post('/:id/claim', (req, res, next) => {
  void swapController.claimPoolShift(req, res, next);
});
