/**
 * Unit tests: timezone utilities [A5]
 * Yêu cầu: "Tuần hiện tại" = Thứ Hai đến Chủ Nhật theo Asia/Ho_Chi_Minh
 */
import { describe, it, expect } from 'vitest';
import { getWeekRange, toVietnamDate, isInCurrentWeekVN, diffHours, diffMinutes } from '../lib/timezone.js';

describe('getWeekRange', () => {
  it('returns Monday as start and Sunday as end for a Wednesday', () => {
    // Wednesday 2026-10-01 (Thu 4) UTC — VN = 2026-10-01 (Thu 4, not Tue)
    // Use explicit Thursday VN: 2026-10-01 is Thursday UTC+7
    // Monday of that week = 2026-09-28, Sunday = 2026-10-04
    const thu = new Date('2026-10-01T10:00:00.000Z'); // Thursday 17:00 VN
    const { startDate, endDate } = getWeekRange(thu);
    expect(startDate).toBe('2026-09-28');  // Monday VN
    expect(endDate).toBe('2026-10-04');    // Sunday VN
  });

  it('handles Sunday correctly (Sunday is end of week, not start)', () => {
    // 2026-10-04 is Sunday UTC+7
    const sun = new Date('2026-10-04T10:00:00.000Z');
    const { startDate, endDate } = getWeekRange(sun);
    expect(startDate).toBe('2026-09-28');
    expect(endDate).toBe('2026-10-04');
  });

  it('handles Monday correctly (Monday is start of week)', () => {
    const mon = new Date('2026-09-28T02:00:00.000Z'); // Monday 09:00 VN
    const { startDate, endDate } = getWeekRange(mon);
    expect(startDate).toBe('2026-09-28');
    expect(endDate).toBe('2026-10-04');
  });

  it('Week boundary: Sunday midnight VN (Sun 17:00 UTC prev day)', () => {
    // Sunday 00:00 VN = Saturday 17:00 UTC
    const sunMidnightVN = new Date('2026-10-03T17:00:00.000Z'); // Sunday 00:00 VN
    const { startDate, endDate } = getWeekRange(sunMidnightVN);
    expect(startDate).toBe('2026-09-28');
    expect(endDate).toBe('2026-10-04');
  });
});

describe('toVietnamDate', () => {
  it('converts UTC to Vietnam date correctly', () => {
    // 2026-09-30 17:00 UTC = 2026-10-01 00:00 VN
    const date = new Date('2026-09-30T17:00:00.000Z');
    expect(toVietnamDate(date)).toBe('2026-10-01');
  });

  it('midnight UTC is still same day in VN (UTC+7 = 07:00 VN)', () => {
    const date = new Date('2026-10-01T00:00:00.000Z');
    expect(toVietnamDate(date)).toBe('2026-10-01');
  });

  it('16:59 UTC is still previous day in VN', () => {
    // 16:59 UTC = 23:59 VN (same date)
    const date = new Date('2026-09-30T16:59:00.000Z');
    expect(toVietnamDate(date)).toBe('2026-09-30');
  });
});

describe('isInCurrentWeekVN', () => {
  it('returns true for dates in current week', () => {
    // This test is relative to actual current time, use getWeekRange to anchor
    const { startDate } = getWeekRange();
    const [y, m, d] = startDate.split('-').map(Number);
    if (!y || !m || !d) return;
    // Monday 12:00 VN = Monday 05:00 UTC
    const monday = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
    expect(isInCurrentWeekVN(monday)).toBe(true);
  });
});

describe('diffHours', () => {
  it('calculates hours correctly', () => {
    const from = new Date('2026-10-01T07:00:00.000Z');
    const to = new Date('2026-10-01T12:00:00.000Z');
    expect(diffHours(from, to)).toBe(5);
  });

  it('calculates partial hours', () => {
    const from = new Date('2026-10-01T07:00:00.000Z');
    const to = new Date('2026-10-01T09:30:00.000Z');
    expect(diffHours(from, to)).toBe(2.5);
  });
});

describe('diffMinutes', () => {
  it('calculates minutes correctly', () => {
    const from = new Date('2026-10-01T07:00:00.000Z');
    const to = new Date('2026-10-01T09:30:00.000Z');
    expect(diffMinutes(from, to)).toBe(150);
  });

  it('truncates fractional minutes', () => {
    const from = new Date('2026-10-01T07:00:00.000Z');
    const to = new Date('2026-10-01T07:01:30.000Z');
    expect(diffMinutes(from, to)).toBe(1);
  });
});
