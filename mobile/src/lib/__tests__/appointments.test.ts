import {
  availabilityClosedMessage,
  bookAppointment,
  cancelAppointment,
  fetchAvailability,
  fetchLiveQueue,
  fetchMyAppointments,
  resolveScheduleId,
  submitFeedback,
} from '../appointments';
import { ApiError, friendlyMessage } from '../errors';

/**
 * Patient flow wrapper tests — every call goes through the ONE api client,
 * so fetch is mocked at the boundary (envelope in, typed ApiError out).
 * Covers: booking success + every error code, availability open/closed
 * mapping, cancel error mapping, feedback duplicate handling, live-queue
 * anonymous-safe shape, and the scheduleId resolution workaround.
 */

type MockResponseInit = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

function mockFetchOnce({ status, body, headers = {} }: MockResponseInit): jest.Mock {
  const fetchMock = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' && !('content-type' in headers)
          ? 'application/json'
          : (headers[name.toLowerCase()] ?? null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function envelopeError(status: number, code: string, message: string) {
  return { status, body: { ok: false, error: { code, message } } };
}

const OPEN_AVAILABILITY = {
  open: true,
  date: '2026-08-31',
  schedule: {
    id: 'sch1',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '13:00',
    clinicName: 'Sunrise Clinic',
    clinicAddress: 'MG Road',
    pinCode: '560001',
    landmark: null,
    mapLink: null,
    avgMinutesPerPatient: 10,
  },
  nextQueue: 6,
  estWaitMin: 40,
  capacityLeft: 8,
  avgMinutesPerPatient: 10,
};

// ---------------------------------------------------------------------------
// availability
// ---------------------------------------------------------------------------

describe('fetchAvailability', () => {
  test('open day passes the full queue metrics through', async () => {
    const fetchMock = mockFetchOnce({ status: 200, body: { ok: true, data: OPEN_AVAILABILITY } });

    const data = await fetchAvailability('sch1', '2026-08-31');

    expect(data.open).toBe(true);
    if (data.open) {
      expect(data.nextQueue).toBe(6);
      expect(data.estWaitMin).toBe(40);
      expect(data.capacityLeft).toBe(8);
      expect(data.schedule.clinicName).toBe('Sunrise Clinic');
    }
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/schedules/sch1/availability?date=2026-08-31');
  });

  test('closed day maps both reasons verbatim (discriminated union)', async () => {
    mockFetchOnce({
      status: 200,
      body: { ok: true, data: { open: false, reason: 'NOT_SCHEDULED_DAY' } },
    });
    const notScheduled = await fetchAvailability('sch1', '2026-08-31');
    expect(notScheduled).toEqual({ open: false, reason: 'NOT_SCHEDULED_DAY' });

    mockFetchOnce({
      status: 200,
      body: { ok: true, data: { open: false, reason: 'SCHEDULE_CLOSED' } },
    });
    const closed = await fetchAvailability('sch1', '2026-09-07');
    expect(closed).toEqual({ open: false, reason: 'SCHEDULE_CLOSED' });
  });

  test('unknown/inactive schedule rejects with a typed 404', async () => {
    mockFetchOnce(envelopeError(404, 'NOT_FOUND', 'Schedule not found'));

    await expect(fetchAvailability('nope', '2026-08-31')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  test('past date rejects with 422 VALIDATION_ERROR', async () => {
    mockFetchOnce(envelopeError(422, 'VALIDATION_ERROR', 'Date must be today or in the future'));

    await expect(fetchAvailability('sch1', '2020-01-01')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 422,
    });
  });

  test('closed reasons map to distinct plain-English sentences', () => {
    const a = availabilityClosedMessage('NOT_SCHEDULED_DAY');
    const b = availabilityClosedMessage('SCHEDULE_CLOSED');
    expect(a).not.toBe(b);
    expect(a).toMatch(/does not consult/i);
    expect(b).toMatch(/closed/i);
  });
});

// ---------------------------------------------------------------------------
// booking
// ---------------------------------------------------------------------------

describe('bookAppointment', () => {
  const bookingPayload = {
    appointment: {
      id: 'apt1',
      scheduleId: 'sch1',
      doctorId: 'doc1',
      patientId: 'u1',
      patientName: 'Test Patient',
      patientPhone: '+919876543201',
      date: '2026-08-31',
      queueNumber: 6,
      status: 'CONFIRMED',
      source: 'ONLINE',
      fee: 300,
      notes: null,
      createdAt: '2026-08-30T10:00:00.000Z',
      updatedAt: '2026-08-30T10:00:00.000Z',
    },
    position: 6,
    estWaitMin: 50,
  };

  test('success returns appointment + position + estWaitMin (POST, session identity only)', async () => {
    const fetchMock = mockFetchOnce({ status: 201, body: { ok: true, data: bookingPayload } });

    const data = await bookAppointment('sch1', '2026-08-31');

    expect(data.position).toBe(6);
    expect(data.estWaitMin).toBe(50);
    expect(data.appointment.queueNumber).toBe(6);
    expect(data.appointment.status).toBe('CONFIRMED');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/appointments');
    expect(init.method).toBe('POST');
    // The body carries ONLY scheduleId + date — identity comes from the session.
    expect(JSON.parse(init.body as string)).toEqual({ scheduleId: 'sch1', date: '2026-08-31' });
  });

  test.each([
    [409, 'ALREADY_BOOKED', 'You already have an active booking for this schedule.'],
    [409, 'CAPACITY_FULL', 'This schedule is fully booked for that day.'],
    [409, 'SCHEDULE_CLOSED', 'The clinic is closed on that day.'],
    [422, 'VALIDATION_ERROR', 'The schedule does not operate on this day of the week'],
  ] as const)(
    'error %i %s rejects as typed ApiError and maps to friendly text',
    async (status, code, message) => {
      mockFetchOnce(envelopeError(status, code, message));

      const err = await bookAppointment('sch1', '2026-08-31').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe(code);
      expect(apiErr.status).toBe(status);
      expect(friendlyMessage(apiErr)).toBe(message);
    },
  );

  test('RATE_LIMITED carries retryAfter seconds into the friendly message', async () => {
    mockFetchOnce({
      status: 429,
      headers: { 'retry-after': '42' },
      body: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    });

    const err = await bookAppointment('sch1', '2026-08-31').catch((e: unknown) => e);

    expect((err as ApiError).meta.retryAfter).toBe(42);
    // The screen shows the seconds — lifting meta.retryAfter is required.
    expect(
      friendlyMessage({
        code: (err as ApiError).code,
        status: (err as ApiError).status,
        message: (err as ApiError).message,
        retryAfter: (err as ApiError).meta.retryAfter as number,
      }),
    ).toContain('42s');
  });
});

// ---------------------------------------------------------------------------
// my appointments
// ---------------------------------------------------------------------------

describe('fetchMyAppointments', () => {
  test('passes range + pagination as query params', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          total: 1,
          page: 2,
          pageSize: 10,
          appointments: [
            {
              id: 'apt1',
              date: '2026-08-31',
              queueNumber: 6,
              status: 'CONFIRMED',
              source: 'ONLINE',
              fee: 300,
              doctor: { id: 'doc1', fullName: 'Ananya Rao', specialization: 'Cardiologist' },
              schedule: {
                clinicName: 'Sunrise Clinic',
                clinicAddress: 'MG Road',
                startTime: '09:00',
                endTime: '13:00',
              },
              estWaitMin: 50,
            },
          ],
        },
      },
    });

    const data = await fetchMyAppointments('upcoming', 2, 10);

    expect(data.appointments).toHaveLength(1);
    expect(data.appointments[0].estWaitMin).toBe(50);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/appointments/mine?range=upcoming&page=2&pageSize=10');
  });
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

describe('cancelAppointment', () => {
  test('success returns the cancelled appointment', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: { appointment: { id: 'apt1', status: 'CANCELLED', queueNumber: 6 } },
      },
    });

    const data = await cancelAppointment('apt1');

    expect(data.appointment.status).toBe('CANCELLED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/appointments/apt1/cancel');
    expect(init.method).toBe('POST');
  });

  test('already-terminal appointment → 409 INVALID_TRANSITION (mapped message)', async () => {
    mockFetchOnce(
      envelopeError(409, 'INVALID_TRANSITION', 'Cannot transition from CALLED to CANCELLED'),
    );

    const err = await cancelAppointment('apt1').catch((e: unknown) => e);

    expect((err as ApiError).code).toBe('INVALID_TRANSITION');
    expect((err as ApiError).status).toBe(409);
    // The UI refetches the list and shows this sentence:
    expect(friendlyMessage(err as ApiError)).toBe('Cannot transition from CALLED to CANCELLED');
  });

  test("someone else's appointment → 404 (never reveals it exists)", async () => {
    mockFetchOnce(envelopeError(404, 'NOT_FOUND', 'Appointment not found'));

    await expect(cancelAppointment('someone-elses')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// live queue (public, masked)
// ---------------------------------------------------------------------------

describe('fetchLiveQueue', () => {
  test('masked public shape with my:null for anonymous callers', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          date: '2026-08-31',
          schedule: {
            clinicName: 'Sunrise Clinic',
            clinicAddress: 'MG Road',
            startTime: '09:00',
            endTime: '13:00',
            avgMinutesPerPatient: 10,
          },
          doctor: { fullName: 'Ananya Rao', specialization: 'Cardiologist' },
          current: { queueNumber: 3, patientName: 'P***r' },
          upNext: [{ queueNumber: 4, patientName: 'R***i', estWaitMin: 10 }],
          counts: { completed: 2, called: 1, waiting: 1 },
          my: null,
        },
      },
    });

    const data = await fetchLiveQueue('sch1', '2026-08-31');

    expect(data.current?.patientName).toBe('P***r'); // masked by the API
    expect(data.my).toBeNull();
    expect(data.counts).toEqual({ completed: 2, called: 1, waiting: 1 });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/queue/sch1/2026-08-31');
  });
});

// ---------------------------------------------------------------------------
// feedback
// ---------------------------------------------------------------------------

describe('submitFeedback', () => {
  test('success sends rating + trimmed comment (201)', async () => {
    const fetchMock = mockFetchOnce({
      status: 201,
      body: {
        ok: true,
        data: {
          feedback: { id: 'fb1', appointmentId: 'apt1', rating: 5, comment: 'Great visit' },
          avgRating: 4.5,
          reviewCount: 2,
        },
      },
    });

    const data = await submitFeedback('apt1', 5, '  Great visit  ');

    expect(data.feedback.rating).toBe(5);
    expect(data.avgRating).toBe(4.5);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      appointmentId: 'apt1',
      rating: 5,
      comment: 'Great visit', // trimmed before sending
    });
  });

  test('empty comment is OMITTED from the body (server treats it as absent)', async () => {
    const fetchMock = mockFetchOnce({
      status: 201,
      body: {
        ok: true,
        data: {
          feedback: { id: 'fb1', appointmentId: 'apt1', rating: 4, comment: null },
          avgRating: 4,
          reviewCount: 1,
        },
      },
    });

    await submitFeedback('apt1', 4, '   ');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ appointmentId: 'apt1', rating: 4 });
  });

  test('duplicate review → 409 ALREADY_REVIEWED (screen marks the card Rated)', async () => {
    mockFetchOnce(
      envelopeError(
        409,
        'ALREADY_REVIEWED',
        'Feedback has already been submitted for this appointment',
      ),
    );

    const err = await submitFeedback('apt1', 5).catch((e: unknown) => e);

    expect((err as ApiError).code).toBe('ALREADY_REVIEWED');
    expect(friendlyMessage(err as ApiError)).toBe('You have already reviewed this visit.');
  });

  test('not completed yet → 409 NOT_COMPLETED', async () => {
    mockFetchOnce(
      envelopeError(
        409,
        'NOT_COMPLETED',
        'Feedback can only be submitted after the appointment is completed',
      ),
    );

    const err = await submitFeedback('apt1', 5).catch((e: unknown) => e);

    expect((err as ApiError).code).toBe('NOT_COMPLETED');
    expect(friendlyMessage(err as ApiError)).toBe(
      'You can review a visit only after it is completed.',
    );
  });
});

// ---------------------------------------------------------------------------
// scheduleId resolution (API GAP workaround)
// ---------------------------------------------------------------------------

describe('resolveScheduleId', () => {
  const appointment = {
    id: 'apt1',
    date: '2026-08-31', // Monday
    queueNumber: 6,
    status: 'CONFIRMED',
    source: 'ONLINE',
    fee: 300,
    doctor: { id: 'doc1', fullName: 'Ananya Rao', specialization: 'Cardiologist' },
    schedule: {
      clinicName: 'Sunrise Clinic',
      clinicAddress: 'MG Road',
      startTime: '09:00',
      endTime: '13:00',
    },
  };

  test('matches the doctor schedule by clinic + weekday of the appointment date', async () => {
    mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          schedules: [
            { id: 'other', dayOfWeek: 3, clinicName: 'Sunrise Clinic' }, // wrong weekday
            { id: 'sch-mon', dayOfWeek: 1, clinicName: 'Sunrise Clinic' }, // Monday ✓
            { id: 'other-clinic', dayOfWeek: 1, clinicName: 'Moonset Clinic' }, // wrong clinic
          ],
        },
      },
    });

    const scheduleId = await resolveScheduleId(appointment as never);

    expect(scheduleId).toBe('sch-mon');
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/doctors/doc1');
  });

  test('returns null when no schedule matches (queue button disabled path)', async () => {
    mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: { schedules: [{ id: 'other', dayOfWeek: 2, clinicName: 'Sunrise Clinic' }] },
      },
    });

    expect(await resolveScheduleId(appointment as never)).toBeNull();
  });
});
