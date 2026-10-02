export interface TimeInterval {
  startsAt: Date | string | number;
  endsAt: Date | string | number;
}

/**
 * Tính tổng số giờ công thực tế trong ngày từ danh sách các đoạn ca làm việc (segments).
 * Hợp nhất các khoảng thời gian bị chồng lấn (Interval Union) để KHÔNG bao giờ cộng chồng giờ.
 * Ví dụ: Ca sáng (07:00–12:00, 5h) + Ca gãy (10:00–14:00 & 17:00–22:00, 9h)
 * Đoạn 10:00–12:00 bị trùng sẽ chỉ tính 1 lần -> Tổng ra 12 giờ (thay vì 14 giờ).
 */
export function calculateDailyWorkHours(intervals: TimeInterval[]): number {
  if (intervals.length === 0) return 0;

  const normalized = intervals
    .map((int) => ({
      start:
        typeof int.startsAt === 'object' && int.startsAt instanceof Date
          ? int.startsAt.getTime()
          : new Date(int.startsAt).getTime(),
      end:
        typeof int.endsAt === 'object' && int.endsAt instanceof Date
          ? int.endsAt.getTime()
          : new Date(int.endsAt).getTime(),
    }))
    .filter((int) => !isNaN(int.start) && !isNaN(int.end) && int.start < int.end)
    .sort((a, b) => a.start - b.start);

  if (normalized.length === 0) return 0;

  const merged: Array<{ start: number; end: number }> = [];
  let current = { ...normalized[0]! };

  for (let i = 1; i < normalized.length; i++) {
    const next = normalized[i]!;
    if (next.start <= current.end) {
      // Chồng lấn hoặc liền kề -> gộp lại
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  const totalMs = merged.reduce((sum, int) => sum + (int.end - int.start), 0);
  return totalMs / (1000 * 60 * 60);
}
