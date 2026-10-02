import { describe, it, expect } from 'vitest';
import { calculateDailyWorkHours } from './workHours.js';

describe('calculateDailyWorkHours (Chống cộng dồn giờ công bị trùng lặp - §5)', () => {
  it('ngày có Ca sáng (5h) + Ca gãy (9h) KHÔNG được ra 14 giờ mà ra đúng 12 giờ', () => {
    // Giả sử ngày 2026-10-02:
    // Ca sáng: 07:00 - 12:00
    // Ca gãy đoạn 1: 10:00 - 14:00
    // Ca gãy đoạn 2: 17:00 - 22:00
    const segments = [
      {
        startsAt: '2026-10-02T07:00:00+07:00',
        endsAt: '2026-10-02T12:00:00+07:00',
      },
      {
        startsAt: '2026-10-02T10:00:00+07:00',
        endsAt: '2026-10-02T14:00:00+07:00',
      },
      {
        startsAt: '2026-10-02T17:00:00+07:00',
        endsAt: '2026-10-02T22:00:00+07:00',
      },
    ];

    const totalHours = calculateDailyWorkHours(segments);

    // Không được cộng dồn ngây thơ 5 + 4 + 5 = 14 giờ
    expect(totalHours).not.toBe(14);
    // Đoạn [07:00, 14:00] (7h) + [17:00, 22:00] (5h) = 12 giờ
    expect(totalHours).toBe(12);
  });

  it('ngày có 2 ca liền kề (Chiều 12-17h, Tối 17-22h) tính đúng 10 giờ', () => {
    const segments = [
      {
        startsAt: '2026-10-02T12:00:00+07:00',
        endsAt: '2026-10-02T17:00:00+07:00',
      },
      {
        startsAt: '2026-10-02T17:00:00+07:00',
        endsAt: '2026-10-02T22:00:00+07:00',
      },
    ];

    const totalHours = calculateDailyWorkHours(segments);
    expect(totalHours).toBe(10);
  });

  it('ngày chỉ có 1 ca gãy 2 đoạn tính đúng 9 giờ', () => {
    const segments = [
      {
        startsAt: '2026-10-02T10:00:00+07:00',
        endsAt: '2026-10-02T14:00:00+07:00',
      },
      {
        startsAt: '2026-10-02T17:00:00+07:00',
        endsAt: '2026-10-02T22:00:00+07:00',
      },
    ];

    const totalHours = calculateDailyWorkHours(segments);
    expect(totalHours).toBe(9);
  });
});
