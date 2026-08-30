import {
  isValidDateStr,
  isValidTimeHM,
  validateNoteForm,
  validateOverrideForm,
  validateScheduleForm,
  validateWalkInForm,
} from '../validation';

/**
 * Client-side mirror tests — the staff console rejects invalid forms BEFORE
 * submit, mirroring the api's zod schemas (which re-check server-side).
 */

// -- primitives ---------------------------------------------------------------

describe('isValidDateStr (api validateDateStr mirror)', () => {
  test('accepts real calendar dates', () => {
    expect(isValidDateStr('2026-08-30')).toBe(true);
    expect(isValidDateStr('2024-02-29')).toBe(true); // leap year
    expect(isValidDateStr('2026-12-31')).toBe(true);
  });

  test('rejects rollover and malformed dates', () => {
    expect(isValidDateStr('2026-02-30')).toBe(false); // rolls over → mismatch
    expect(isValidDateStr('2025-02-29')).toBe(false); // not a leap year
    expect(isValidDateStr('2026-8-30')).toBe(false); // zero-padded only
    expect(isValidDateStr('30-08-2026')).toBe(false);
    expect(isValidDateStr('')).toBe(false);
    expect(isValidDateStr('2026-08-30T00:00:00.000Z')).toBe(false);
  });
});

describe('isValidTimeHM (api TIME_RE mirror)', () => {
  test('accepts 00:00–23:59', () => {
    expect(isValidTimeHM('00:00')).toBe(true);
    expect(isValidTimeHM('09:30')).toBe(true);
    expect(isValidTimeHM('23:59')).toBe(true);
  });

  test('rejects out-of-range and malformed times', () => {
    expect(isValidTimeHM('24:00')).toBe(false);
    expect(isValidTimeHM('9:00')).toBe(false); // zero-padded only
    expect(isValidTimeHM('09:60')).toBe(false);
    expect(isValidTimeHM('0900')).toBe(false);
    expect(isValidTimeHM('')).toBe(false);
  });
});

// -- schedule form ---------------------------------------------------------------

const VALID_SCHEDULE = {
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '13:00',
  clinicName: 'Sunrise Clinic',
  clinicAddress: 'MG Road',
  pinCode: '560001',
  landmark: 'Near metro',
  mapLink: 'https://maps.example.com',
  avgMinutesPerPatient: '10',
};

describe('validateScheduleForm (scheduleSchema mirror)', () => {
  test('a valid form produces no errors', () => {
    expect(validateScheduleForm(VALID_SCHEDULE)).toEqual({});
  });

  test('start must be before end (api refine)', () => {
    const errors = validateScheduleForm({ ...VALID_SCHEDULE, endTime: '09:00' });
    expect(errors.endTime).toBe('End time must be after start time');
    const equal = validateScheduleForm({ ...VALID_SCHEDULE, endTime: '09:00', startTime: '09:00' });
    expect(equal.endTime).toBe('End time must be after start time');
  });

  test('dayOfWeek must be picked (0–6)', () => {
    expect(validateScheduleForm({ ...VALID_SCHEDULE, dayOfWeek: null }).dayOfWeek).toBeDefined();
    expect(validateScheduleForm({ ...VALID_SCHEDULE, dayOfWeek: 7 }).dayOfWeek).toBeDefined();
  });

  test('clinicName and clinicAddress are required', () => {
    expect(validateScheduleForm({ ...VALID_SCHEDULE, clinicName: '  ' }).clinicName).toBeDefined();
    expect(
      validateScheduleForm({ ...VALID_SCHEDULE, clinicAddress: '' }).clinicAddress,
    ).toBeDefined();
  });

  test('avgMinutesPerPatient must be an integer 1–120', () => {
    expect(
      validateScheduleForm({ ...VALID_SCHEDULE, avgMinutesPerPatient: '0' }).avgMinutesPerPatient,
    ).toBeDefined();
    expect(
      validateScheduleForm({ ...VALID_SCHEDULE, avgMinutesPerPatient: '121' }).avgMinutesPerPatient,
    ).toBeDefined();
    expect(
      validateScheduleForm({ ...VALID_SCHEDULE, avgMinutesPerPatient: '10.5' })
        .avgMinutesPerPatient,
    ).toBeDefined();
    expect(
      validateScheduleForm({ ...VALID_SCHEDULE, avgMinutesPerPatient: '' }).avgMinutesPerPatient,
    ).toBeDefined();
    expect(
      validateScheduleForm({ ...VALID_SCHEDULE, avgMinutesPerPatient: '120' }).avgMinutesPerPatient,
    ).toBeUndefined();
  });

  test('field length caps mirror the api (pin 12 / landmark 200 / map 500)', () => {
    expect(
      validateScheduleForm({ ...VALID_SCHEDULE, pinCode: '1'.repeat(13) }).pinCode,
    ).toBeDefined();
    expect(
      validateScheduleForm({ ...VALID_SCHEDULE, landmark: 'x'.repeat(201) }).landmark,
    ).toBeDefined();
    expect(
      validateScheduleForm({ ...VALID_SCHEDULE, mapLink: 'x'.repeat(501) }).mapLink,
    ).toBeDefined();
  });
});

// -- override form (TYPE-CONDITIONAL) --------------------------------------------

describe('validateOverrideForm (overrideCreateSchema mirror)', () => {
  test('CLOSED with no times is valid', () => {
    expect(
      validateOverrideForm({
        date: '2026-09-02',
        type: 'CLOSED',
        newStartTime: '',
        newEndTime: '',
        reason: '',
      }),
    ).toEqual({});
  });

  test('CLOSED carrying times is rejected LOCALLY before submit', () => {
    const errors = validateOverrideForm({
      date: '2026-09-02',
      type: 'CLOSED',
      newStartTime: '09:00',
      newEndTime: '13:00',
      reason: '',
    });
    expect(errors.newStartTime).toBe('A CLOSED override cannot carry times');
  });

  test('MODIFIED_HOURS requires BOTH times', () => {
    const missingEnd = validateOverrideForm({
      date: '2026-09-02',
      type: 'MODIFIED_HOURS',
      newStartTime: '09:00',
      newEndTime: '',
      reason: '',
    });
    expect(missingEnd.newEndTime).toBeDefined();

    const missingBoth = validateOverrideForm({
      date: '2026-09-02',
      type: 'MODIFIED_HOURS',
      newStartTime: '',
      newEndTime: '',
      reason: '',
    });
    expect(missingBoth.newStartTime).toBeDefined();
    expect(missingBoth.newEndTime).toBeDefined();
  });

  test('MODIFIED_HOURS and SPECIAL require start < end', () => {
    for (const type of ['MODIFIED_HOURS', 'SPECIAL'] as const) {
      const errors = validateOverrideForm({
        date: '2026-09-02',
        type,
        newStartTime: '14:00',
        newEndTime: '13:00',
        reason: '',
      });
      expect(errors.newEndTime).toBe('End time must be after start time');
    }
  });

  test('SPECIAL with valid times is valid', () => {
    expect(
      validateOverrideForm({
        date: '2026-09-02',
        type: 'SPECIAL',
        newStartTime: '10:00',
        newEndTime: '12:00',
        reason: 'Camp day',
      }),
    ).toEqual({});
  });

  test('invalid date and missing type are rejected', () => {
    expect(
      validateOverrideForm({
        date: '2026-02-30',
        type: 'CLOSED',
        newStartTime: '',
        newEndTime: '',
        reason: '',
      }).date,
    ).toBeDefined();
    expect(
      validateOverrideForm({
        date: '2026-09-02',
        type: null,
        newStartTime: '',
        newEndTime: '',
        reason: '',
      }).type,
    ).toBeDefined();
  });

  test('reason cap is 300 chars', () => {
    expect(
      validateOverrideForm({
        date: '2026-09-02',
        type: 'CLOSED',
        newStartTime: '',
        newEndTime: '',
        reason: 'x'.repeat(301),
      }).reason,
    ).toBeDefined();
  });
});

// -- walk-in form -----------------------------------------------------------------

describe('validateWalkInForm (walkInSchema mirror)', () => {
  const VALID = {
    patientName: 'Ravi Kumar',
    patientPhone: '98765 43210',
    fee: '',
    notes: '',
  };

  test('valid minimal form passes (blank fee → doctor fee applies)', () => {
    expect(validateWalkInForm(VALID)).toEqual({});
  });

  test('patientName must be 2–100 chars', () => {
    expect(validateWalkInForm({ ...VALID, patientName: 'R' }).patientName).toBeDefined();
    expect(
      validateWalkInForm({ ...VALID, patientName: 'x'.repeat(101) }).patientName,
    ).toBeDefined();
  });

  test('phone must normalize (+91 / +880 forms accepted)', () => {
    expect(validateWalkInForm({ ...VALID, patientPhone: '12345' }).patientPhone).toBeDefined();
    expect(
      validateWalkInForm({ ...VALID, patientPhone: '+919876543210' }).patientPhone,
    ).toBeUndefined();
    expect(
      validateWalkInForm({ ...VALID, patientPhone: '+8801712345678' }).patientPhone,
    ).toBeUndefined();
    expect(
      validateWalkInForm({ ...VALID, patientPhone: '09876543210' }).patientPhone,
    ).toBeUndefined();
  });

  test('fee is optional but must be a whole number ≥ 0 when present', () => {
    expect(validateWalkInForm({ ...VALID, fee: '300' }).fee).toBeUndefined();
    expect(validateWalkInForm({ ...VALID, fee: '0' }).fee).toBeUndefined();
    expect(validateWalkInForm({ ...VALID, fee: '299.50' }).fee).toBeDefined();
    expect(validateWalkInForm({ ...VALID, fee: '-5' }).fee).toBeDefined();
    expect(validateWalkInForm({ ...VALID, fee: '1000001' }).fee).toBeDefined();
  });

  test('notes cap is 2000 chars', () => {
    expect(validateWalkInForm({ ...VALID, notes: 'x'.repeat(2001) }).notes).toBeDefined();
  });
});

// -- note form ---------------------------------------------------------------------

describe('validateNoteForm (noteCreateSchema mirror)', () => {
  test('accepts 1..2000 chars after trim', () => {
    expect(validateNoteForm('  Allergic to penicillin  ')).toBeNull();
    expect(validateNoteForm('x'.repeat(2000))).toBeNull();
  });

  test('rejects empty and over-long notes', () => {
    expect(validateNoteForm('   ')).toBe('Write the note first');
    expect(validateNoteForm('')).toBe('Write the note first');
    expect(validateNoteForm('x'.repeat(2001))).toBe('Note is too long (max 2000 characters)');
  });
});
