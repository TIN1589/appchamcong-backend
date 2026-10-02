export interface CalcMetricsInput {
  shiftType: 'REGULAR' | 'SPLIT' | 'FLEXIBLE';
  startsAt: Date;
  endsAt: Date;
  checkinAt?: Date | null;
  checkoutAt?: Date | null;
  gracePeriodMinutes?: number;
  approvedOtMinutes?: number;
}

export interface AttendanceMetrics {
  lateMinutes: number;
  earlyLeaveMinutes: number;
  actualMinutes: number;
  otMinutes: number;
  status: 'present' | 'late' | 'early_leave' | 'absent' | 'pending';
}

/**
 * Hàm thuần tuý tính toán các chỉ số chấm công (late, early, actual, ot, status).
 * Nguồn sự thật duy nhất (Single Source of Truth) dùng chung cho Check-in, Check-out và Duyệt đơn ngoại lệ.
 */
export function calcMetrics(input: CalcMetricsInput): AttendanceMetrics {
  const {
    shiftType,
    startsAt,
    endsAt,
    checkinAt,
    checkoutAt,
    gracePeriodMinutes = 5,
    approvedOtMinutes = 0,
  } = input;

  const otMinutes = Math.max(0, approvedOtMinutes);

  // Ca linh hoạt (FLEXIBLE): Không có giờ cố định -> không tính trễ/sớm
  if (shiftType === 'FLEXIBLE') {
    let actualMinutes = 0;
    if (checkinAt && checkoutAt) {
      actualMinutes = Math.max(0, Math.floor((checkoutAt.getTime() - checkinAt.getTime()) / 60000));
    }
    return {
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      actualMinutes,
      otMinutes,
      status: checkinAt ? 'present' : 'pending',
    };
  }

  // 1. Tính số phút đi trễ (late_minutes)
  let lateMinutes = 0;
  if (checkinAt) {
    const diffMs = checkinAt.getTime() - startsAt.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    // Nếu trong thời gian ân hạn (diffMin <= gracePeriodMinutes), coi như đúng giờ (0 phút)
    // Nếu vượt quá ân hạn, tính đủ toàn bộ số phút từ startsAt
    if (diffMin > gracePeriodMinutes) {
      lateMinutes = Math.max(0, diffMin);
    }
  }

  // 2. Tính số phút về sớm (early_leave_minutes)
  let earlyLeaveMinutes = 0;
  if (checkoutAt) {
    const diffMs = endsAt.getTime() - checkoutAt.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    // Nếu trong thời gian ân hạn (diffMin <= gracePeriodMinutes), coi như đủ giờ (0 phút)
    // Nếu về sớm vượt quá ân hạn, tính đủ toàn bộ số phút từ endsAt
    if (diffMin > gracePeriodMinutes) {
      earlyLeaveMinutes = Math.max(0, diffMin);
    }
  }

  // 3. Tính số phút làm thực tế (actual_minutes)
  let actualMinutes = 0;
  if (checkinAt && checkoutAt) {
    actualMinutes = Math.max(0, Math.floor((checkoutAt.getTime() - checkinAt.getTime()) / 60000));
  }

  // 4. Xác định status
  let status: AttendanceMetrics['status'] = 'pending';
  if (checkinAt) {
    if (lateMinutes > 0) {
      status = 'late';
    } else if (earlyLeaveMinutes > 0) {
      status = 'early_leave';
    } else {
      status = 'present';
    }
  }

  return {
    lateMinutes,
    earlyLeaveMinutes,
    actualMinutes,
    otMinutes,
    status,
  };
}
