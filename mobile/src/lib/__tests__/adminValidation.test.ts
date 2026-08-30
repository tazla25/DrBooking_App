import { statusLabel, type AppointmentStatus } from '../../components/StatusChip';
import {
  normalizeAuditUserIdFilter,
  overrideTypeSelected,
  validateExportRange,
  validateOverrideForm,
  validateVerificationNote,
  type OverrideFormValues,
} from '../validation';
import { formatISTTimestamp } from '../format';
import { istDateOfISO, istTimeOfISO } from '../time';

/**
 * Phase 8 validation mirrors + the C1/C5 audit regressions:
 *  - C1: selecting the CLOSED override type CLEARS stale time fields (the
 *    hidden-field "CLOSED cannot carry times" error used to dead-end the form);
 *  - C5: statusLabel renders the RAW value for unknown runtime statuses;
 *  - new admin validators mirror the frozen zod rules;
 *  - C4: the IST-safe timestamp formatters.
 */

const FORM_WITH_TIMES: OverrideFormValues = {
  date: '2026-09-02',
  type: 'MODIFIED_HOURS',
  newStartTime: '10:00',
  newEndTime: '13:00',
  reason: 'Late opening',
};

describe('C1 regression — overrideTypeSelected', () => {
  test('choosing CLOSED clears stale newStartTime/newEndTime', () => {
    const next = overrideTypeSelected(FORM_WITH_TIMES, 'CLOSED');
    expect(next.type).toBe('CLOSED');
    expect(next.newStartTime).toBe('');
    expect(next.newEndTime).toBe('');
  });

  test('the cleared CLOSED form passes validateOverrideForm (no hidden-field dead end)', () => {
    const next = overrideTypeSelected(FORM_WITH_TIMES, 'CLOSED');
    expect(Object.keys(validateOverrideForm(next))).toHaveLength(0);
  });

  test('choosing a time-bearing type KEEPS the times typed so far', () => {
    const next = overrideTypeSelected(FORM_WITH_TIMES, 'SPECIAL');
    expect(next.type).toBe('SPECIAL');
    expect(next.newStartTime).toBe('10:00');
    expect(next.newEndTime).toBe('13:00');
  });

  test('switching MODIFIED_HOURS → CLOSED → MODIFIED_HOURS leaves clean empty times', () => {
    const closed = overrideTypeSelected(FORM_WITH_TIMES, 'CLOSED');
    const reopened = overrideTypeSelected(closed, 'MODIFIED_HOURS');
    expect(reopened.newStartTime).toBe('');
    expect(reopened.newEndTime).toBe('');
  });

  test('date/reason pass through untouched', () => {
    const next = overrideTypeSelected(FORM_WITH_TIMES, 'CLOSED');
    expect(next.date).toBe('2026-09-02');
    expect(next.reason).toBe('Late opening');
  });
});

describe('C5 regression — statusLabel default', () => {
  test('known statuses keep their human labels', () => {
    expect(statusLabel('NO_SHOW')).toBe('No-show');
    expect(statusLabel('CONFIRMED')).toBe('Confirmed');
  });

  test('an UNKNOWN runtime status renders the raw value, never undefined', () => {
    expect(statusLabel('RESCHEDULED' as AppointmentStatus)).toBe('RESCHEDULED');
    expect(statusLabel('' as AppointmentStatus)).toBe('');
    expect(typeof statusLabel('WEIRD' as AppointmentStatus)).toBe('string');
  });
});

describe('validateVerificationNote (mirror of verifyDoctorSchema.note)', () => {
  test('empty and in-range notes are fine', () => {
    expect(validateVerificationNote('')).toBeNull();
    expect(validateVerificationNote('ok')).toBeNull();
    expect(validateVerificationNote('x'.repeat(500))).toBeNull();
  });

  test('over 500 chars is rejected', () => {
    expect(validateVerificationNote('x'.repeat(501))).toBe('Note is too long (max 500 characters)');
  });
});

describe('validateExportRange (mirror of exportQuerySchema + route 422)', () => {
  test('valid inclusive range passes', () => {
    expect(validateExportRange('2026-08-01', '2026-08-31')).toEqual({});
  });

  test('from > to is blocked client-side (the server would 422)', () => {
    expect(validateExportRange('2026-09-02', '2026-09-01').from).toBe(
      'From must be on or before To',
    );
  });

  test('malformed dates are rejected (2026-02-30 rolls over)', () => {
    expect(validateExportRange('2026-02-30', '2026-03-01').from).toBe(
      'Use a valid date (YYYY-MM-DD)',
    );
    expect(validateExportRange('2026-08-01', 'not-a-date').to).toBe(
      'Use a valid date (YYYY-MM-DD)',
    );
  });
});

describe('normalizeAuditUserIdFilter', () => {
  test('blank input (whitespace only) → undefined (filter omitted)', () => {
    expect(normalizeAuditUserIdFilter('')).toBeUndefined();
    expect(normalizeAuditUserIdFilter('   ')).toBeUndefined();
  });

  test('non-blank input is trimmed and kept (exact actorId match)', () => {
    expect(normalizeAuditUserIdFilter('  user-1  ')).toBe('user-1');
  });
});

describe('C4 — IST-safe timestamp formatters', () => {
  test('istDateOfISO converts a UTC timestamp to the IST calendar date', () => {
    // 2026-08-30T20:00Z is already 2026-08-31 01:30 IST.
    expect(istDateOfISO('2026-08-30T20:00:00.000Z')).toBe('2026-08-31');
    // 2026-08-30T10:00Z is 2026-08-30 15:30 IST — same date.
    expect(istDateOfISO('2026-08-30T10:00:00.000Z')).toBe('2026-08-30');
  });

  test('istTimeOfISO renders IST clock time', () => {
    expect(istTimeOfISO('2026-08-30T20:00:00.000Z')).toBe('01:30');
  });

  test('unparseable timestamps degrade gracefully (no crash, no Invalid Date)', () => {
    expect(istDateOfISO('garbage')).toBe('garbage'.slice(0, 10));
    expect(istTimeOfISO('garbage')).toBeNull();
  });

  test('formatISTTimestamp composes date + time for audit rows', () => {
    expect(formatISTTimestamp('2026-08-30T20:00:00.000Z')).toBe('31 Aug 2026 · 01:30 IST');
  });
});
