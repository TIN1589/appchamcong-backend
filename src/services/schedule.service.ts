import { scheduleRepository, type ScheduleShiftDTO } from '../repositories/schedule.repository.js';
import { shiftsRepository, type TemplateWithSegments } from '../repositories/shifts.repository.js';
import { getWeekRange, parseVNDate, getDaysOfWeek } from '../lib/timezone.js';

export interface WeekScheduleResult {
  week: {
    startDate: string;
    endDate: string;
    days: string[];
  };
  scope: 'me' | 'store';
  templates?: TemplateWithSegments[];
  shifts: ScheduleShiftDTO[];
}

export const scheduleService = {
  async getWeekSchedule(
    storeId: number,
    userId: string,
    options?: {
      start?: string | undefined;
      scope?: 'me' | 'store' | undefined;
    },
  ): Promise<WeekScheduleResult> {
    const scope = options?.scope === 'store' ? 'store' : 'me';

    let refDate: Date | undefined;
    if (options?.start) {
      try {
        refDate = parseVNDate(options.start);
      } catch {
        refDate = undefined;
      }
    }

    const { startDate, endDate } = getWeekRange(refDate);
    const days = getDaysOfWeek(startDate);

    const assignedTo = scope === 'me' ? userId : undefined;

    const [shifts, templates] = await Promise.all([
      scheduleRepository.getWeekSchedule(
        storeId,
        startDate,
        endDate,
        assignedTo,
      ),
      shiftsRepository.listTemplates(storeId),
    ]);

    return {
      week: {
        startDate,
        endDate,
        days,
      },
      scope,
      templates,
      shifts,
    };
  },
};
