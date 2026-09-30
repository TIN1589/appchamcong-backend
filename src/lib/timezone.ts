/**
 * Timezone utilities [A5]
 * Mọi conversion Asia/Ho_Chi_Minh ↔ UTC tập trung ở đây
 * DB lưu timestamptz (UTC), business layer convert sang VN
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;  // UTC+7

/**
 * Lấy ngày hiện tại theo Asia/Ho_Chi_Minh
 * Trả về 'YYYY-MM-DD' string
 */
export function getTodayVietnam(): string {
  const nowUtc = Date.now();
  const nowVN = new Date(nowUtc + VN_OFFSET_MS);
  return nowVN.toISOString().slice(0, 10);
}

/**
 * Convert Date (UTC) sang YYYY-MM-DD theo Asia/Ho_Chi_Minh
 */
export function toVietnamDate(utcDate: Date): string {
  const vnMs = utcDate.getTime() + VN_OFFSET_MS;
  const vnDate = new Date(vnMs);
  return vnDate.toISOString().slice(0, 10);
}

/**
 * Lấy đầu tuần (Thứ Hai) và cuối tuần (Chủ Nhật) theo VN timezone [A5]
 * "Tuần hiện tại" = Thứ Hai đến Chủ Nhật
 */
export function getWeekRange(referenceDate?: Date): {
  startDate: string;
  endDate: string;
} {
  const now = referenceDate ?? new Date();
  const vnMs = now.getTime() + VN_OFFSET_MS;
  const vnDate = new Date(vnMs);

  // getDay(): 0=Chủ Nhật, 1=Thứ Hai, ..., 6=Thứ Bảy
  const dayOfWeek = vnDate.getUTCDay();
  // Số ngày từ Thứ Hai (nếu Chủ Nhật = 7 - 0 = 7 → trừ 6)
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const mondayMs = vnMs - daysFromMonday * 24 * 60 * 60 * 1000;
  const sundayMs = mondayMs + 6 * 24 * 60 * 60 * 1000;

  const monday = new Date(mondayMs);
  const sunday = new Date(sundayMs);

  // Format YYYY-MM-DD
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);

  return {
    startDate: fmt(monday),
    endDate: fmt(sunday),
  };
}

/**
 * Kiểm tra Date có trong tuần hiện tại theo VN timezone không [A5]
 */
export function isInCurrentWeekVN(date: Date): boolean {
  const { startDate, endDate } = getWeekRange();
  const dateStr = toVietnamDate(date);
  return dateStr >= startDate && dateStr <= endDate;
}

/**
 * Parse 'YYYY-MM-DD' thành Date đầu ngày theo UTC (midnight VN → 17:00 UTC ngày hôm trước)
 */
export function parseVNDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${dateStr}`);
  // Midnight VN = 00:00 UTC+7 = 17:00 UTC ngày hôm trước
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - VN_OFFSET_MS);
}

/**
 * Tính số giờ giữa 2 Date
 */
export function diffHours(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60);
}

/**
 * Tính số phút giữa 2 Date
 */
export function diffMinutes(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60));
}
