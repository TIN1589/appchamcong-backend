const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function getTodayVietnam(): string {
  const nowUtc = Date.now();
  const nowVN = new Date(nowUtc + VN_OFFSET_MS);
  return nowVN.toISOString().slice(0, 10);
}

export function toVietnamDate(utcDate: Date): string {
  const vnMs = utcDate.getTime() + VN_OFFSET_MS;
  const vnDate = new Date(vnMs);
  return vnDate.toISOString().slice(0, 10);
}

export function getWeekRange(referenceDate?: Date): {
  startDate: string;
  endDate: string;
} {
  const now = referenceDate ?? new Date();
  const vnMs = now.getTime() + VN_OFFSET_MS;
  const vnDate = new Date(vnMs);

  const dayOfWeek = vnDate.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const mondayMs = vnMs - daysFromMonday * 24 * 60 * 60 * 1000;
  const sundayMs = mondayMs + 6 * 24 * 60 * 60 * 1000;

  const monday = new Date(mondayMs);
  const sunday = new Date(sundayMs);

  const fmt = (d: Date): string => d.toISOString().slice(0, 10);

  return {
    startDate: fmt(monday),
    endDate: fmt(sunday),
  };
}

export function isInCurrentWeekVN(date: Date): boolean {
  const { startDate, endDate } = getWeekRange();
  const dateStr = toVietnamDate(date);
  return dateStr >= startDate && dateStr <= endDate;
}

export function parseVNDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${dateStr}`);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - VN_OFFSET_MS);
}

export function diffHours(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60);
}

export function diffMinutes(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60));
}

export function getDaysOfWeek(startDate: string): string[] {
  const [y, m, d] = startDate.split('-').map(Number);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(y!, m! - 1, d! + i));
    days.push(dt.toISOString().slice(0, 10));
  }
  return days;
}

export function getTomorrowVietnam(referenceDate?: Date): string {
  const d = referenceDate ?? new Date();
  const nextDay = new Date(d.getTime() + 24 * 3600 * 1000);
  return toVietnamDate(nextDay);
}

export function isTomorrowVietnam(workDate: string, referenceDate?: Date): boolean {
  return workDate === getTomorrowVietnam(referenceDate);
}

export function addDaysVietnam(startDate: string, daysToAdd: number): string {
  const [y, m, d] = startDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + daysToAdd));
  return dt.toISOString().slice(0, 10);
}

