import { describe, it, expect } from 'vitest';
import { validateDayLoad } from './shiftLoadValidator.js';

describe('validateDayLoad (§1 & §8 SRS v1.1 Delta)', () => {
  it('cho phép ngày có 1 ca duy nhất', () => {
    const existing = [
      { segments: [{ start: '07:00', end: '12:00' }] },
    ];
    const incoming = { segments: [{ start: '17:00', end: '22:00' }] };

    const result = validateDayLoad(existing, incoming);
    expect(result.ok).toBe(true);
  });

  it('từ chối ca thứ 3 trong ngày (vượt quá MAX_SHIFTS_PER_DAY = 2)', () => {
    const existing = [
      { segments: [{ start: '07:00', end: '11:00' }] },
      { segments: [{ start: '12:00', end: '16:00' }] },
    ];
    const incoming = { segments: [{ start: '17:00', end: '21:00' }] };

    const result = validateDayLoad(existing, incoming);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('OVER_DAILY_LIMIT');
  });

  it('cho phép 2 ca sáng + tối không chồng giờ', () => {
    const existing = [
      { segments: [{ start: '07:00', end: '12:00' }] },
    ];
    const incoming = { segments: [{ start: '17:00', end: '22:00' }] };

    const result = validateDayLoad(existing, incoming);
    expect(result.ok).toBe(true);
  });

  it('từ chối 2 ca chồng giờ nhau (ví dụ: 07:00-12:00 và 10:00-15:00)', () => {
    const existing = [
      { segments: [{ start: '07:00', end: '12:00' }] },
    ];
    const incoming = { segments: [{ start: '10:00', end: '15:00' }] };

    const result = validateDayLoad(existing, incoming);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('OVERLAP');
  });

  it('cho phép 2 ca tiếp giáp giờ nhau (ví dụ: 07:00-12:00 và 12:00-17:00)', () => {
    const existing = [
      { segments: [{ start: '07:00', end: '12:00' }] },
    ];
    const incoming = { segments: [{ start: '12:00', end: '17:00' }] };

    const result = validateDayLoad(existing, incoming);
    expect(result.ok).toBe(true);
  });

  it('hỗ trợ ca gãy: kiểm tra từng đoạn segment', () => {
    // Ca gãy đoạn 1: 10:00 - 14:00, đoạn 2: 17:00 - 22:00
    const existing = [
      {
        segments: [
          { start: '10:00', end: '14:00' },
          { start: '17:00', end: '22:00' },
        ],
      },
    ];

    // Ca sáng 07:00 - 10:00 không chồng
    const validIncoming = { segments: [{ start: '07:00', end: '10:00' }] };
    expect(validateDayLoad(existing, validIncoming).ok).toBe(true);

    // Ca trưa 12:00 - 16:00 chồng đoạn 1 (10-14)
    const overlapSeg1 = { segments: [{ start: '12:00', end: '16:00' }] };
    expect(validateDayLoad(existing, overlapSeg1).ok).toBe(false);
    expect(validateDayLoad(existing, overlapSeg1).reason).toBe('OVERLAP');

    // Ca tối 19:00 - 23:00 chồng đoạn 2 (17-22)
    const overlapSeg2 = { segments: [{ start: '19:00', end: '23:00' }] };
    expect(validateDayLoad(existing, overlapSeg2).ok).toBe(false);
    expect(validateDayLoad(existing, overlapSeg2).reason).toBe('OVERLAP');
  });
});
