import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shiftsService } from './shifts.service.js';
import { shiftsRepository } from '../repositories/shifts.repository.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';

vi.mock('../repositories/shifts.repository.js', () => ({
  shiftsRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    assignToUser: vi.fn(),
    hasOverlap: vi.fn(),
    listTemplates: vi.fn(),
    createTemplate: vi.fn(),
    listByDateRange: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('shiftsService - Business Logic & Overlap Guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('cho phép tạo ca trống không gán người (không check overlap)', async () => {
      vi.mocked(shiftsRepository.create).mockResolvedValueOnce({
        id: 'shift-1',
        store_id: 1,
        template_id: null,
        assigned_to: null,
        status: 'open',
        source: 'manual',
        work_date: '2026-10-06',
        notes: null,
        created_by: 'admin-1',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });

      const res = await shiftsService.create(1, 'admin-1', {
        workDate: '2026-10-06',
        segments: [{ startTime: '08:00', endTime: '12:00' }],
      });

      expect(res.id).toBe('shift-1');
      expect(shiftsRepository.hasOverlap).not.toHaveBeenCalled();
      expect(shiftsRepository.create).toHaveBeenCalled();
    });

    it('ném lỗi SHIFT_ALREADY_ASSIGNED nếu tạo ca có gán người mà bị trùng giờ', async () => {
      vi.mocked(shiftsRepository.hasOverlap).mockResolvedValueOnce(true);

      await expect(
        shiftsService.create(1, 'admin-1', {
          workDate: '2026-10-06',
          assignedTo: 'user-uuid-1',
          segments: [{ startTime: '08:00', endTime: '12:00' }],
        }),
      ).rejects.toThrow(ConflictError);

      expect(shiftsRepository.hasOverlap).toHaveBeenCalledWith(
        'user-uuid-1',
        '2026-10-06',
        expect.any(Array),
        1,
      );
      expect(shiftsRepository.create).not.toHaveBeenCalled();
    });

    it('tạo ca thành công nếu có gán người và không bị trùng giờ', async () => {
      vi.mocked(shiftsRepository.hasOverlap).mockResolvedValueOnce(false);
      vi.mocked(shiftsRepository.create).mockResolvedValueOnce({
        id: 'shift-1',
        store_id: 1,
        template_id: null,
        assigned_to: 'user-uuid-1',
        status: 'assigned',
        source: 'manual',
        work_date: '2026-10-06',
        notes: null,
        created_by: 'admin-1',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [],
      });

      const res = await shiftsService.create(1, 'admin-1', {
        workDate: '2026-10-06',
        assignedTo: 'user-uuid-1',
        segments: [{ startTime: '08:00', endTime: '12:00' }],
      });

      expect(res.id).toBe('shift-1');
      expect(shiftsRepository.hasOverlap).toHaveBeenCalled();
      expect(shiftsRepository.create).toHaveBeenCalled();
    });
  });

  describe('assign', () => {
    it('ném lỗi SHIFT_ALREADY_ASSIGNED nếu ca cần gán trùng giờ với ca khác của user', async () => {
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce({
        id: 'shift-target',
        store_id: 1,
        template_id: null,
        assigned_to: null,
        status: 'open',
        source: 'manual',
        work_date: '2026-10-06',
        notes: null,
        created_by: 'admin-1',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [
          {
            id: 'seg-1',
            shift_id: 'shift-target',
            starts_at: '2026-10-06T01:00:00.000Z',
            ends_at: '2026-10-06T05:00:00.000Z',
            sort_order: 0,
          },
        ],
      });

      vi.mocked(shiftsRepository.hasOverlap).mockResolvedValueOnce(true);

      await expect(
        shiftsService.assign('shift-target', 1, 'user-uuid-1'),
      ).rejects.toThrow(ConflictError);

      expect(shiftsRepository.hasOverlap).toHaveBeenCalledWith(
        'user-uuid-1',
        '2026-10-06',
        'shift-target',
        1,
        'shift-target',
      );
      expect(shiftsRepository.assignToUser).not.toHaveBeenCalled();
    });

    it('gán ca thành công nếu không bị trùng giờ', async () => {
      const mockShift = {
        id: 'shift-target',
        store_id: 1,
        template_id: null,
        assigned_to: null,
        status: 'open' as const,
        source: 'manual' as const,
        work_date: '2026-10-06',
        notes: null,
        created_by: 'admin-1',
        created_at: new Date(),
        updated_at: new Date(),
        segments: [
          {
            id: 'seg-1',
            shift_id: 'shift-target',
            starts_at: '2026-10-06T01:00:00.000Z',
            ends_at: '2026-10-06T05:00:00.000Z',
            sort_order: 0,
          },
        ],
      };

      vi.mocked(shiftsRepository.findById)
        .mockResolvedValueOnce(mockShift)
        .mockResolvedValueOnce({ ...mockShift, assigned_to: 'user-uuid-1', status: 'assigned' });

      vi.mocked(shiftsRepository.hasOverlap).mockResolvedValueOnce(false);
      vi.mocked(shiftsRepository.assignToUser).mockResolvedValueOnce({
        ...mockShift,
        assigned_to: 'user-uuid-1',
        status: 'assigned',
      });

      const res = await shiftsService.assign('shift-target', 1, 'user-uuid-1');

      expect(res.assigned_to).toBe('user-uuid-1');
      expect(shiftsRepository.hasOverlap).toHaveBeenCalled();
      expect(shiftsRepository.assignToUser).toHaveBeenCalledWith('shift-target', 1, 'user-uuid-1');
    });

    it('ném lỗi NotFoundError nếu ca không tồn tại', async () => {
      vi.mocked(shiftsRepository.findById).mockResolvedValueOnce(null);

      await expect(
        shiftsService.assign('invalid-shift-id', 1, 'user-uuid-1'),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
