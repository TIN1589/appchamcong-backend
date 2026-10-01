export const MAX_SHIFTS_PER_DAY = 2;

export interface ShiftInterval {
  start: Date | string | number;
  end: Date | string | number;
}

export interface ShiftWithIntervals {
  id?: string;
  segments: ShiftInterval[];
}

export function intervalsOverlap(
  aStart: string | number,
  aEnd: string | number,
  bStart: string | number,
  bEnd: string | number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Kiểm tra giới hạn tải ca trong ngày theo SRS v1.1 Delta §1:
 * - Tối đa 2 ca scheduled mỗi người mỗi ngày.
 * - Hai ca không được chồng giờ (sáng + tối hợp lệ).
 * - Kiểm tra từng segment của ca (hỗ trợ ca gãy).
 */
export function validateDayLoad(
  scheduledThatDay: ShiftWithIntervals[],
  incoming: ShiftWithIntervals,
): { ok: boolean; reason?: 'OVER_DAILY_LIMIT' | 'OVERLAP' } {
  const all = [...scheduledThatDay, incoming];
  if (all.length > MAX_SHIFTS_PER_DAY) {
    return { ok: false, reason: 'OVER_DAILY_LIMIT' };
  }

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const shiftA = all[i]!;
      const shiftB = all[j]!;

      for (const segA of shiftA.segments) {
        for (const segB of shiftB.segments) {
          const aS =
            typeof segA.start === 'object' && segA.start instanceof Date
              ? segA.start.getTime()
              : segA.start;
          const aE =
            typeof segA.end === 'object' && segA.end instanceof Date
              ? segA.end.getTime()
              : segA.end;
          const bS =
            typeof segB.start === 'object' && segB.start instanceof Date
              ? segB.start.getTime()
              : segB.start;
          const bE =
            typeof segB.end === 'object' && segB.end instanceof Date
              ? segB.end.getTime()
              : segB.end;

          if (intervalsOverlap(aS, aE, bS, bE)) {
            return { ok: false, reason: 'OVERLAP' };
          }
        }
      }
    }
  }

  return { ok: true };
}
