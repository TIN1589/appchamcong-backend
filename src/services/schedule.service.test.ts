import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scheduleService } from './schedule.service.js';
import { scheduleRepository } from '../repositories/schedule.repository.js';
import { shiftsRepository } from '../repositories/shifts.repository.js';

vi.mock('../repositories/schedule.repository.js', () => ({
  scheduleRepository: {
    getWeekSchedule: vi.fn(),
  },
}));

vi.mock('../repositories/shifts.repository.js', () => ({
  shiftsRepository: {
    listTemplates: vi.fn().mockResolvedValue([]),
  },
}));

describe('scheduleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shiftsRepository.listTemplates).mockResolvedValue([]);
  });

  describe('Biên tuần (Week boundary)', () => {
    it('chuẩn hóa đúng tuần Thứ Hai - Chủ Nhật khi truyền ngày Thứ Hai đầu tuần', async () => {
      vi.mocked(scheduleRepository.getWeekSchedule).mockResolvedValueOnce([]);

      const result = await scheduleService.getWeekSchedule(1, 'user-1', {
        start: '2026-10-05', // Thứ Hai
        scope: 'me',
      });

      expect(result.week.startDate).toBe('2026-10-05');
      expect(result.week.endDate).toBe('2026-10-11');
      expect(result.week.days).toEqual([
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
        '2026-10-09',
        '2026-10-10',
        '2026-10-11',
      ]);
      expect(scheduleRepository.getWeekSchedule).toHaveBeenCalledWith(
        1,
        '2026-10-05',
        '2026-10-11',
        'user-1',
      );
    });

    it('chuẩn hóa về cùng tuần khi truyền ngày Thứ Tư giữa tuần', async () => {
      vi.mocked(scheduleRepository.getWeekSchedule).mockResolvedValueOnce([]);

      const result = await scheduleService.getWeekSchedule(1, 'user-1', {
        start: '2026-10-07', // Thứ Tư
        scope: 'me',
      });

      expect(result.week.startDate).toBe('2026-10-05');
      expect(result.week.endDate).toBe('2026-10-11');
      expect(scheduleRepository.getWeekSchedule).toHaveBeenCalledWith(
        1,
        '2026-10-05',
        '2026-10-11',
        'user-1',
      );
    });

    it('chuẩn hóa về cùng tuần khi truyền ngày Chủ Nhật cuối tuần', async () => {
      vi.mocked(scheduleRepository.getWeekSchedule).mockResolvedValueOnce([]);

      const result = await scheduleService.getWeekSchedule(1, 'user-1', {
        start: '2026-10-11', // Chủ Nhật
        scope: 'me',
      });

      expect(result.week.startDate).toBe('2026-10-05');
      expect(result.week.endDate).toBe('2026-10-11');
    });

    it('Chủ Nhật tuần trước thuộc tuần riêng biệt (2026-09-28 đến 2026-10-04)', async () => {
      vi.mocked(scheduleRepository.getWeekSchedule).mockResolvedValueOnce([]);

      const result = await scheduleService.getWeekSchedule(1, 'user-1', {
        start: '2026-10-04', // Chủ Nhật tuần trước
        scope: 'me',
      });

      expect(result.week.startDate).toBe('2026-09-28');
      expect(result.week.endDate).toBe('2026-10-04');
    });

    it('Thứ Hai tuần kế tiếp thuộc tuần kế tiếp (2026-10-12 đến 2026-10-18)', async () => {
      vi.mocked(scheduleRepository.getWeekSchedule).mockResolvedValueOnce([]);

      const result = await scheduleService.getWeekSchedule(1, 'user-1', {
        start: '2026-10-12', // Thứ Hai tuần sau
        scope: 'me',
      });

      expect(result.week.startDate).toBe('2026-10-12');
      expect(result.week.endDate).toBe('2026-10-18');
    });
  });

  describe('Ca gãy hiển thị đủ segment', () => {
    it('trả về đầy đủ các segment của ca gãy theo đúng thứ tự sort_order', async () => {
      const mockSplitShift = {
        id: 'shift-split-1',
        store_id: 1,
        template_id: 'tpl-split',
        assigned_to: 'user-1',
        status: 'assigned' as const,
        source: 'manual' as const,
        type: 'SPLIT' as const,
        work_date: '2026-10-06',
        notes: 'Ca gãy trưa - tối',
        created_by: 'admin-1',
        created_at: new Date(),
        updated_at: new Date(),
        assigned_user: {
          id: 'user-1',
          full_name: 'Nguyễn Văn An',
          email: 'an@chamcong.local',
        },
        template: {
          id: 'tpl-split',
          name: 'Ca gãy',
          color: '#FF6FA8',
        },
        segments: [
          {
            id: 'seg-1',
            shift_id: 'shift-split-1',
            starts_at: '2026-10-06T03:00:00.000Z', // 10:00 VN
            ends_at: '2026-10-06T07:00:00.000Z',   // 14:00 VN
            sort_order: 0,
          },
          {
            id: 'seg-2',
            shift_id: 'shift-split-1',
            starts_at: '2026-10-06T10:00:00.000Z', // 17:00 VN
            ends_at: '2026-10-06T15:00:00.000Z',   // 22:00 VN
            sort_order: 1,
          },
        ],
      };

      vi.mocked(scheduleRepository.getWeekSchedule).mockResolvedValueOnce([mockSplitShift]);

      const result = await scheduleService.getWeekSchedule(1, 'user-1', {
        start: '2026-10-05',
        scope: 'me',
      });

      expect(result.shifts).toHaveLength(1);
      const shift = result.shifts[0]!;
      expect(shift.segments).toHaveLength(2);
      expect(shift.segments[0]!.sort_order).toBe(0);
      expect(shift.segments[1]!.sort_order).toBe(1);
      expect(shift.template?.name).toBe('Ca gãy');
    });
  });

  describe('Scope phân quyền lịch (me vs store)', () => {
    it('scope=me chỉ lấy ca được gán cho user hiện tại', async () => {
      vi.mocked(scheduleRepository.getWeekSchedule).mockResolvedValueOnce([]);

      const result = await scheduleService.getWeekSchedule(1, 'user-123', {
        scope: 'me',
      });

      expect(result.scope).toBe('me');
      expect(scheduleRepository.getWeekSchedule).toHaveBeenCalledWith(
        1,
        expect.any(String),
        expect.any(String),
        'user-123',
      );
    });

    it('scope=store lấy ca của toàn cửa hàng (assignedTo = undefined)', async () => {
      vi.mocked(scheduleRepository.getWeekSchedule).mockResolvedValueOnce([]);

      const result = await scheduleService.getWeekSchedule(1, 'user-123', {
        scope: 'store',
      });

      expect(result.scope).toBe('store');
      expect(scheduleRepository.getWeekSchedule).toHaveBeenCalledWith(
        1,
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });
  });
});
