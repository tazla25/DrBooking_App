import { addDaysISO, dayOfWeekISO, firstDateForDay, istTodayISO, nextDates } from '../time';

/**
 * IST time-law tests. "Today" cases pin the system clock: IST is UTC+05:30,
 * so 18:30 UTC is midnight IST — the exact boundary the v1 WhatsApp bot got
 * wrong. Date arithmetic anchors UTC noon (IST has no DST).
 */
describe('time — istTodayISO', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('23:59 IST is still the same IST day (18:29 UTC)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-30T18:29:30.000Z'));
    expect(istTodayISO()).toBe('2026-08-30');
  });

  test('00:01 IST is already the NEXT IST day (18:31 UTC)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-30T18:31:00.000Z'));
    expect(istTodayISO()).toBe('2026-08-31');
  });

  test('independent of a non-IST device timezone (UTC noon)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
    expect(istTodayISO()).toBe('2026-08-30');
  });
});

describe('time — dayOfWeekISO', () => {
  test('2026-08-30 is Sunday (0) and 2026-08-31 is Monday (1)', () => {
    expect(dayOfWeekISO('2026-08-30')).toBe(0);
    expect(dayOfWeekISO('2026-08-31')).toBe(1);
  });

  test('2027-01-01 is Friday (5)', () => {
    expect(dayOfWeekISO('2027-01-01')).toBe(5);
  });
});

describe('time — addDaysISO', () => {
  test.each([
    ['2026-08-30', 1, '2026-08-31'],
    ['2026-08-31', 1, '2026-09-01'], // month rollover
    ['2026-12-31', 1, '2027-01-01'], // year rollover
    ['2026-03-01', -1, '2026-02-28'], // 2026 is not a leap year
    ['2028-02-28', 1, '2028-02-29'], // 2028 IS a leap year
    ['2026-08-30', 0, '2026-08-30'],
  ] as const)('addDaysISO(%s, %i) → %s', (date, days, expected) => {
    expect(addDaysISO(date, days)).toBe(expected);
  });
});

describe('time — nextDates (the 7-day strip)', () => {
  test('produces 7 consecutive dates starting today', () => {
    const dates = nextDates('2026-08-28', 7);
    expect(dates).toEqual([
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
  });

  test('every weekday appears exactly once in 7 days', () => {
    const weekdays = nextDates('2026-08-28', 7).map(dayOfWeekISO);
    expect(new Set(weekdays).size).toBe(7);
  });
});

describe('time — firstDateForDay', () => {
  test('finds the next Monday from a Sunday', () => {
    expect(firstDateForDay('2026-08-30', 1)).toBe('2026-08-31');
  });

  test('today matches today (schedule operates today)', () => {
    expect(firstDateForDay('2026-08-30', 0)).toBe('2026-08-30');
  });

  test('wraps to next week when the day already passed', () => {
    // Saturday (6) from Monday 2026-08-31 → 2026-09-05
    expect(firstDateForDay('2026-08-31', 6)).toBe('2026-09-05');
  });
});
