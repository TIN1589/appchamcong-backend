import { describe, it, expect } from 'vitest';
import { calcMetrics } from './metrics.service.js';

describe('calcMetrics (§2.5 Core Attendance Rules)', () => {
  const startsAt = new Date('2026-10-05T07:00:00+07:00');
  const endsAt = new Date('2026-10-05T12:00:00+07:00');

  it('1. Check-in đúng giờ chính xác (07:00) -> late_minutes = 0, status = present', () => {
    const res = calcMetrics({
      shiftType: 'REGULAR',
      startsAt,
      endsAt,
      checkinAt: new Date('2026-10-05T07:00:00+07:00'),
    });
    expect(res.lateMinutes).toBe(0);
    expect(res.status).toBe('present');
  });

  it('2. Check-in sớm hơn giờ ca (06:55) -> late_minutes = 0, status = present', () => {
    const res = calcMetrics({
      shiftType: 'REGULAR',
      startsAt,
      endsAt,
      checkinAt: new Date('2026-10-05T06:55:00+07:00'),
    });
    expect(res.lateMinutes).toBe(0);
    expect(res.status).toBe('present');
  });

  it('3. Check-in trong thời gian ân hạn 5 phút (07:05) -> late_minutes = 0', () => {
    const res = calcMetrics({
      shiftType: 'REGULAR',
      startsAt,
      endsAt,
      checkinAt: new Date('2026-10-05T07:05:00+07:00'),
      gracePeriodMinutes: 5,
    });
    expect(res.lateMinutes).toBe(0);
    expect(res.status).toBe('present');
  });

  it('4. Check-in quá ân hạn 5 phút (07:06, trễ 6 phút) -> tính đủ late_minutes = 6, status = late', () => {
    const res = calcMetrics({
      shiftType: 'REGULAR',
      startsAt,
      endsAt,
      checkinAt: new Date('2026-10-05T07:06:00+07:00'),
      gracePeriodMinutes: 5,
    });
    expect(res.lateMinutes).toBe(6);
    expect(res.status).toBe('late');
  });

  it('5. Check-out đúng giờ (12:00) -> early_leave_minutes = 0, actual_minutes = 300', () => {
    const res = calcMetrics({
      shiftType: 'REGULAR',
      startsAt,
      endsAt,
      checkinAt: startsAt,
      checkoutAt: endsAt,
    });
    expect(res.earlyLeaveMinutes).toBe(0);
    expect(res.actualMinutes).toBe(300);
    expect(res.status).toBe('present');
  });

  it('6. Check-out trong ân hạn về sớm 5 phút (11:55) -> early_leave_minutes = 0', () => {
    const res = calcMetrics({
      shiftType: 'REGULAR',
      startsAt,
      endsAt,
      checkinAt: startsAt,
      checkoutAt: new Date('2026-10-05T11:55:00+07:00'),
      gracePeriodMinutes: 5,
    });
    expect(res.earlyLeaveMinutes).toBe(0);
    expect(res.status).toBe('present');
  });

  it('7. Check-out về sớm quá 5 phút (11:54, sớm 6 phút) -> tính đủ early_leave_minutes = 6, status = early_leave', () => {
    const res = calcMetrics({
      shiftType: 'REGULAR',
      startsAt,
      endsAt,
      checkinAt: startsAt,
      checkoutAt: new Date('2026-10-05T11:54:00+07:00'),
      gracePeriodMinutes: 5,
    });
    expect(res.earlyLeaveMinutes).toBe(6);
    expect(res.status).toBe('early_leave');
  });

  it('8. Trễ 10 phút VÀ về sớm 15 phút cùng ngày -> ghi nhận cả late_minutes = 10 và early_leave_minutes = 15', () => {
    const res = calcMetrics({
      shiftType: 'REGULAR',
      startsAt,
      endsAt,
      checkinAt: new Date('2026-10-05T07:10:00+07:00'),
      checkoutAt: new Date('2026-10-05T11:45:00+07:00'),
      gracePeriodMinutes: 5,
    });
    expect(res.lateMinutes).toBe(10);
    expect(res.earlyLeaveMinutes).toBe(15);
    expect(res.actualMinutes).toBe(275);
    expect(res.status).toBe('late');
  });

  it('9. Ca linh hoạt (FLEXIBLE) -> luôn có late_minutes = 0, early_leave_minutes = 0, chỉ tính actual_minutes', () => {
    const res = calcMetrics({
      shiftType: 'FLEXIBLE',
      startsAt,
      endsAt,
      checkinAt: new Date('2026-10-05T09:30:00+07:00'),
      checkoutAt: new Date('2026-10-05T13:45:00+07:00'),
    });
    expect(res.lateMinutes).toBe(0);
    expect(res.earlyLeaveMinutes).toBe(0);
    expect(res.actualMinutes).toBe(255);
    expect(res.status).toBe('present');
  });

  it('10. Làm vượt giờ (checkout sau ends_at) không tự tính OT nếu chưa có đơn duyệt (approvedOtMinutes = 0)', () => {
    const res = calcMetrics({
      shiftType: 'REGULAR',
      startsAt,
      endsAt,
      checkinAt: startsAt,
      checkoutAt: new Date('2026-10-05T13:00:00+07:00'), // lố 60 phút
      approvedOtMinutes: 0,
    });
    expect(res.otMinutes).toBe(0);
    expect(res.actualMinutes).toBe(360);
  });

  it('11. Khi có đơn overtime được duyệt (approvedOtMinutes = 45) -> ot_minutes = 45', () => {
    const res = calcMetrics({
      shiftType: 'REGULAR',
      startsAt,
      endsAt,
      checkinAt: startsAt,
      checkoutAt: new Date('2026-10-05T13:00:00+07:00'),
      approvedOtMinutes: 45,
    });
    expect(res.otMinutes).toBe(45);
  });
});
