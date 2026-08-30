import {
  addPatientNote,
  callNextPatient,
  createCompounder,
  createOverride,
  createSchedule,
  createWalkIn,
  deactivateCompounder,
  deactivateSchedule,
  deleteOverride,
  fetchCompounders,
  fetchOverrides,
  fetchPatientNotes,
  fetchPatients,
  fetchStaffSchedules,
  fetchTodayQueue,
  queueNextMessage,
  setAppointmentStatus,
  setAvailability,
  updateSchedule,
} from '../staff';
import { ApiError, friendlyMessage } from '../errors';

/**
 * Staff console wrapper tests — every call goes through the ONE api client,
 * so fetch is mocked at the envelope boundary. Covers the exact URLs,
 * methods and bodies the frozen api/ routes expect, plus the error mapping
 * the screens rely on.
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

const APPOINTMENT = {
  id: 'apt1',
  scheduleId: 'sch1',
  doctorId: 'doc1',
  patientId: null,
  patientName: 'Ravi Kumar',
  patientPhone: '+919812345601',
  date: '2026-08-30',
  queueNumber: 4,
  status: 'CONFIRMED',
  source: 'WALK_IN',
  fee: 300,
  notes: null,
  createdAt: '2026-08-30T04:00:00.000Z',
  updatedAt: '2026-08-30T04:00:00.000Z',
};

// ---------------------------------------------------------------------------
// §3.1 GET /api/queue/today
// ---------------------------------------------------------------------------

describe('fetchTodayQueue', () => {
  test('passes the full staff queue shape through (full names + phones by design)', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          date: '2026-08-30',
          doctor: { id: 'doc1', fullName: 'Ananya Rao' },
          counts: { confirmed: 2, called: 1, completed: 1, cancelled: 0, noShow: 1 },
          appointments: [
            {
              id: 'apt1',
              queueNumber: 3,
              status: 'CALLED',
              source: 'ONLINE',
              patientName: 'Priya Nair',
              patientPhone: '+919812345601',
              patientId: 'user1',
              notes: 'Bring old reports',
              fee: 300,
              estWaitMin: 20,
              createdAt: '2026-08-30T03:00:00.000Z',
            },
          ],
        },
      },
    });

    const data = await fetchTodayQueue('2026-08-30');

    expect(data.doctor.fullName).toBe('Ananya Rao');
    expect(data.counts).toEqual({ confirmed: 2, called: 1, completed: 1, cancelled: 0, noShow: 1 });
    expect(data.appointments[0].patientName).toBe('Priya Nair'); // UNMASKED by design
    expect(data.appointments[0].patientPhone).toBe('+919812345601');
    expect(data.appointments[0].estWaitMin).toBe(20);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/queue/today?date=2026-08-30');
    expect(init.method).toBe('GET');
  });

  test('omits the date param when absent (server defaults to IST today)', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          date: '2026-08-30',
          doctor: { id: 'doc1', fullName: 'X' },
          counts: { confirmed: 0, called: 0, completed: 0, cancelled: 0, noShow: 0 },
          appointments: [],
        },
      },
    });
    await fetchTodayQueue();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).not.toContain('date=');
  });

  test('never sends a doctorId (scoping law — the server derives scope)', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          date: '2026-08-30',
          doctor: { id: 'doc1', fullName: 'X' },
          counts: { confirmed: 0, called: 0, completed: 0, cancelled: 0, noShow: 0 },
          appointments: [],
        },
      },
    });
    await fetchTodayQueue('2026-08-30');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).not.toContain('doctorId');
  });
});

// ---------------------------------------------------------------------------
// §3.2 POST /api/queue/next
// ---------------------------------------------------------------------------

describe('callNextPatient + queueNextMessage', () => {
  test('posts with no body and passes the transaction result through', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          completed: { ...APPOINTMENT, queueNumber: 4, status: 'COMPLETED' },
          called: { ...APPOINTMENT, id: 'apt2', queueNumber: 5, status: 'CALLED' },
          queueEmpty: false,
        },
      },
    });

    const result = await callNextPatient();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/queue/next');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined(); // the server needs nothing
    expect(result.completed?.queueNumber).toBe(4);
    expect(result.called?.queueNumber).toBe(5);
    expect(result.queueEmpty).toBe(false);
    expect(queueNextMessage(result)).toBe('Completed #4, called #5');
  });

  test('message covers every outcome shape', () => {
    expect(
      queueNextMessage({
        completed: null,
        called: { ...APPOINTMENT, queueNumber: 7 },
        queueEmpty: false,
      }),
    ).toBe('Called #7');
    expect(
      queueNextMessage({
        completed: { ...APPOINTMENT, queueNumber: 4 },
        called: null,
        queueEmpty: true,
      }),
    ).toBe('Completed #4 — queue is empty');
    expect(queueNextMessage({ completed: null, called: null, queueEmpty: true })).toBe(
      'Queue is empty',
    );
  });
});

// ---------------------------------------------------------------------------
// §3.3 POST /api/appointments/:id/status
// ---------------------------------------------------------------------------

describe('setAppointmentStatus', () => {
  test('posts the status body to the scoped appointment', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: { ok: true, data: { appointment: { ...APPOINTMENT, status: 'CALLED' } } },
    });

    const { appointment } = await setAppointmentStatus('apt1', 'CALLED');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/appointments/apt1/status');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'CALLED' });
    expect(appointment.status).toBe('CALLED');
  });

  test('illegal transitions reject with a typed 409 INVALID_TRANSITION', async () => {
    mockFetchOnce(
      envelopeError(409, 'INVALID_TRANSITION', 'Cannot transition from COMPLETED to CALLED'),
    );
    await expect(setAppointmentStatus('apt1', 'CALLED')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      status: 409,
    });
  });

  test('out-of-scope appointment rejects with 404', async () => {
    mockFetchOnce(envelopeError(404, 'NOT_FOUND', 'Appointment not found'));
    await expect(setAppointmentStatus('other-doctor-apt', 'CANCELLED')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// §3.4 POST /api/appointments/walk-in
// ---------------------------------------------------------------------------

describe('createWalkIn', () => {
  test('201 success — sends exactly the walk-in body (blank fee/notes omitted)', async () => {
    const fetchMock = mockFetchOnce({
      status: 201,
      body: { ok: true, data: { appointment: APPOINTMENT } },
    });

    const { appointment } = await createWalkIn({
      scheduleId: 'sch1',
      date: '2026-08-30',
      patientName: ' Ravi Kumar ',
      patientPhone: '+919812345601',
      notes: '  ',
      fee: undefined,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/appointments/walk-in');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      scheduleId: 'sch1',
      date: '2026-08-30',
      patientName: 'Ravi Kumar',
      patientPhone: '+919812345601',
    });
    expect(appointment.queueNumber).toBe(4);
  });

  test('explicit fee (incl. 0) and trimmed notes are sent', async () => {
    const fetchMock = mockFetchOnce({
      status: 201,
      body: { ok: true, data: { appointment: APPOINTMENT } },
    });
    await createWalkIn({
      scheduleId: 'sch1',
      date: '2026-08-30',
      patientName: 'Ravi Kumar',
      patientPhone: '+919812345601',
      notes: ' Walk-in, charged less ',
      fee: 0,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      scheduleId: 'sch1',
      date: '2026-08-30',
      patientName: 'Ravi Kumar',
      patientPhone: '+919812345601',
      notes: 'Walk-in, charged less',
      fee: 0,
    });
  });

  test('409 ALREADY_IN_QUEUE maps to a friendly message', async () => {
    mockFetchOnce(envelopeError(409, 'ALREADY_IN_QUEUE', 'This patient is already in the queue'));
    await expect(
      createWalkIn({
        scheduleId: 'sch1',
        date: '2026-08-30',
        patientName: 'Ravi Kumar',
        patientPhone: '+919812345601',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_IN_QUEUE', status: 409 });
  });

  test('409 SCHEDULE_INACTIVE maps to a friendly message', async () => {
    const err = new ApiError(409, 'SCHEDULE_INACTIVE', 'This schedule has been deactivated');
    expect(friendlyMessage(err)).toBe('This schedule has been deactivated. Reactivate it first.');
  });

  test('409 CAPACITY_FULL keeps its friendly mapping', async () => {
    mockFetchOnce(envelopeError(409, 'CAPACITY_FULL', 'Schedule is full'));
    await expect(
      createWalkIn({
        scheduleId: 'sch1',
        date: '2026-08-30',
        patientName: 'Ravi Kumar',
        patientPhone: '+919812345601',
      }),
    ).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    expect(friendlyMessage({ code: 'CAPACITY_FULL', status: 409 })).toBe(
      'This schedule is fully booked for that day.',
    );
  });
});

// ---------------------------------------------------------------------------
// §3.5/3.6/3.7 schedules CRUD
// ---------------------------------------------------------------------------

const SCHEDULE_BODY = {
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '13:00',
  clinicName: 'Sunrise Clinic',
  clinicAddress: 'MG Road',
  pinCode: '560001',
  landmark: 'Near metro',
  mapLink: 'https://maps.example.com',
  avgMinutesPerPatient: 10,
};

describe('schedules CRUD', () => {
  test('GET /api/schedules — staff list includes inactive + today context', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          today: '2026-08-30',
          schedules: [
            {
              id: 'sch1',
              doctorId: 'doc1',
              dayOfWeek: 1,
              startTime: '09:00',
              endTime: '13:00',
              clinicName: 'Sunrise Clinic',
              clinicAddress: 'MG Road',
              pinCode: '560001',
              landmark: null,
              mapLink: null,
              avgMinutesPerPatient: 10,
              isActive: false,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              doctor: { id: 'doc1', fullName: 'Ananya Rao' },
              todayOverride: null,
              todayQueueCount: 3,
            },
          ],
        },
      },
    });

    const data = await fetchStaffSchedules();

    expect(data.today).toBe('2026-08-30');
    expect(data.schedules[0].isActive).toBe(false); // inactive ones included
    expect(data.schedules[0].todayQueueCount).toBe(3);
    expect(data.schedules[0].doctor.fullName).toBe('Ananya Rao');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/schedules');
    expect(String(url)).not.toContain('doctorId');
    expect(init.method).toBe('GET');
  });

  test('POST /api/schedules — full body, blank optional fields omitted', async () => {
    const fetchMock = mockFetchOnce({
      status: 201,
      body: { ok: true, data: { schedule: { ...SCHEDULE_BODY, id: 'sch2', isActive: true } } },
    });

    await createSchedule({
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '13:00',
      clinicName: 'Sunrise Clinic',
      clinicAddress: 'MG Road',
      pinCode: '',
      landmark: '',
      mapLink: '',
      avgMinutesPerPatient: 10,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/schedules');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '13:00',
      clinicName: 'Sunrise Clinic',
      clinicAddress: 'MG Road',
      avgMinutesPerPatient: 10,
    });
  });

  test('PUT /api/schedules/:id — FULL body (omit nothing)', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: { ok: true, data: { schedule: { ...SCHEDULE_BODY, id: 'sch1', isActive: true } } },
    });

    const fullInput = {
      dayOfWeek: 2,
      startTime: '10:00',
      endTime: '14:30',
      clinicName: 'Sunrise Clinic',
      clinicAddress: 'New Address',
      pinCode: '560002',
      landmark: 'Near park',
      mapLink: 'https://maps.example.com/x',
      avgMinutesPerPatient: 15,
    };
    await updateSchedule('sch1', fullInput);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/schedules/sch1');
    expect(init.method).toBe('PUT');
    // FULL replace: every field present in the body, nothing omitted.
    expect(JSON.parse(String(init.body))).toEqual(fullInput);
  });

  test('DELETE /api/schedules/:id — soft delete call', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: { ok: true, data: { schedule: { ...SCHEDULE_BODY, id: 'sch1', isActive: false } } },
    });

    const { schedule } = await deactivateSchedule('sch1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/schedules/sch1');
    expect(init.method).toBe('DELETE');
    expect(schedule.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3.8 overrides
// ---------------------------------------------------------------------------

describe('overrides', () => {
  test('GET lists a schedule\u2019s overrides', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          overrides: [
            {
              id: 'ov1',
              scheduleId: 'sch1',
              date: '2026-09-01',
              type: 'CLOSED',
              newStartTime: null,
              newEndTime: null,
              reason: 'Holiday',
              createdById: 'u1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      },
    });
    const data = await fetchOverrides('sch1');
    expect(data.overrides[0].type).toBe('CLOSED');
    expect(data.overrides[0].reason).toBe('Holiday');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/schedules/sch1/overrides');
    expect(init.method).toBe('GET');
  });

  test('POST CLOSED carries NO times even if passed', async () => {
    const fetchMock = mockFetchOnce({
      status: 201,
      body: {
        ok: true,
        data: {
          override: {
            id: 'ov2',
            scheduleId: 'sch1',
            date: '2026-09-02',
            type: 'CLOSED',
            newStartTime: null,
            newEndTime: null,
            reason: null,
            createdById: 'u1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });

    await createOverride('sch1', {
      date: '2026-09-02',
      type: 'CLOSED',
      // Defensive: even with times passed, a CLOSED override must not carry them.
      newStartTime: '09:00',
      newEndTime: '13:00',
      reason: '  ',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/schedules/sch1/overrides');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ date: '2026-09-02', type: 'CLOSED' });
  });

  test('POST MODIFIED_HOURS sends both times + trimmed reason', async () => {
    const fetchMock = mockFetchOnce({
      status: 201,
      body: {
        ok: true,
        data: {
          override: {
            id: 'ov3',
            scheduleId: 'sch1',
            date: '2026-09-03',
            type: 'MODIFIED_HOURS',
            newStartTime: '10:00',
            newEndTime: '12:00',
            reason: 'Short day',
            createdById: 'u1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });

    await createOverride('sch1', {
      date: '2026-09-03',
      type: 'MODIFIED_HOURS',
      newStartTime: '10:00',
      newEndTime: '12:00',
      reason: ' Short day ',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      date: '2026-09-03',
      type: 'MODIFIED_HOURS',
      newStartTime: '10:00',
      newEndTime: '12:00',
      reason: 'Short day',
    });
  });

  test('409 OVERRIDE_EXISTS maps to the delete-it-first message', async () => {
    mockFetchOnce(
      envelopeError(409, 'OVERRIDE_EXISTS', 'An override already exists for this date'),
    );
    await expect(
      createOverride('sch1', { date: '2026-09-02', type: 'CLOSED' }),
    ).rejects.toMatchObject({ code: 'OVERRIDE_EXISTS', status: 409 });
    expect(friendlyMessage({ code: 'OVERRIDE_EXISTS', status: 409 })).toBe(
      'An override already exists for this date — delete it first.',
    );
  });

  test('DELETE removes the override for a date', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: { ok: true, data: { deleted: true, date: '2026-09-02' } },
    });
    const data = await deleteOverride('sch1', '2026-09-02');
    expect(data).toEqual({ deleted: true, date: '2026-09-02' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/schedules/sch1/overrides/2026-09-02');
    expect(init.method).toBe('DELETE');
  });
});

// ---------------------------------------------------------------------------
// §3.9 GET /api/patients
// ---------------------------------------------------------------------------

describe('fetchPatients', () => {
  test('sends q + pagination and passes the grouped rows through', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          total: 1,
          page: 1,
          pageSize: 20,
          patients: [
            {
              name: 'Priya Nair',
              phone: '+919812345601',
              lastVisit: '2026-08-30',
              lastStatus: 'COMPLETED',
              totalVisits: 3,
            },
          ],
        },
      },
    });

    const data = await fetchPatients(' priya ', 1, 20);

    expect(data.patients[0].totalVisits).toBe(3);
    expect(data.patients[0].lastStatus).toBe('COMPLETED');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('q=priya');
    expect(String(url)).toContain('page=1');
    expect(String(url)).toContain('pageSize=20');
  });

  test('blank q is omitted (list everyone)', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: { ok: true, data: { total: 0, page: 1, pageSize: 20, patients: [] } },
    });
    await fetchPatients('   ', 1, 20);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).not.toContain('q=');
  });
});

// ---------------------------------------------------------------------------
// §3.10 patient notes (encoded phone!)
// ---------------------------------------------------------------------------

describe('patient notes', () => {
  test('GET encodes the phone in the URL (phones contain +)', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          notes: [
            {
              id: 'n1',
              note: 'Allergic to penicillin',
              isImportant: true,
              author: { id: 'u1', name: 'Ananya Rao', role: 'DOCTOR' },
              createdAt: '2026-08-30T05:00:00.000Z',
            },
          ],
        },
      },
    });

    const data = await fetchPatientNotes('+919812345601');

    expect(data.notes[0].author?.role).toBe('DOCTOR');
    expect(data.notes[0].isImportant).toBe(true);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/patients/+919812345601/notes'.replace('+', '%2B'));
  });

  test('POST sends the note body with the encoded phone', async () => {
    const fetchMock = mockFetchOnce({
      status: 201,
      body: {
        ok: true,
        data: {
          note: {
            id: 'n2',
            note: 'Follow-up in 2 weeks',
            isImportant: false,
            author: { id: 'u2', name: 'Comp One', role: 'COMPOUNDER' },
            createdAt: '2026-08-30T06:00:00.000Z',
          },
        },
      },
    });

    const { note } = await addPatientNote('+919812345601', ' Follow-up in 2 weeks ', false);

    expect(note.note).toBe('Follow-up in 2 weeks');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('%2B919812345601');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      note: 'Follow-up in 2 weeks',
      isImportant: false,
    });
  });

  test('isImportant: true is sent explicitly', async () => {
    const fetchMock = mockFetchOnce({
      status: 201,
      body: {
        ok: true,
        data: {
          note: {
            id: 'n3',
            note: 'Important',
            isImportant: true,
            author: null,
            createdAt: '2026-08-30T06:00:00.000Z',
          },
        },
      },
    });
    await addPatientNote('+919812345601', 'Important', true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ note: 'Important', isImportant: true });
  });
});

// ---------------------------------------------------------------------------
// §3.11 PATCH /api/availability
// ---------------------------------------------------------------------------

describe('setAvailability', () => {
  test('patches the boolean body and returns the new state', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: { ok: true, data: { isAvailableNow: true } },
    });

    const data = await setAvailability(true);

    expect(data.isAvailableNow).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/availability');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ isAvailableNow: true });
  });
});

// ---------------------------------------------------------------------------
// §3.12 compounders (DOCTOR only)
// ---------------------------------------------------------------------------

describe('compounders', () => {
  test('GET lists compounders with the must-change-password hint fields', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          compounders: [
            {
              id: 'u2',
              name: 'Comp One',
              phone: '+919876543220',
              isActive: true,
              mustChangePassword: true,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      },
    });

    const data = await fetchCompounders();

    expect(data.compounders[0].mustChangePassword).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/compounders');
    expect(init.method).toBe('GET');
  });

  test('POST 201 surfaces the ONE-TIME tempPassword', async () => {
    const fetchMock = mockFetchOnce({
      status: 201,
      body: {
        ok: true,
        data: {
          user: {
            id: 'u9',
            phone: '+919812345699',
            name: 'New Comp',
            role: 'COMPOUNDER',
            verificationStatus: 'VERIFIED',
            mustChangePassword: true,
            isActive: true,
            delegatedDoctorId: 'doc1',
            createdAt: '2026-08-30T00:00:00.000Z',
          },
          tempPassword: 'Abcdefgh2345',
        },
      },
    });

    const data = await createCompounder(' New Comp ', '+919812345699');

    expect(data.tempPassword).toHaveLength(12); // shown exactly once by the UI
    expect(data.user.mustChangePassword).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/compounders');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'New Comp', phone: '+919812345699' });
  });

  test('409 PHONE_EXISTS maps to a friendly message', async () => {
    mockFetchOnce(envelopeError(409, 'PHONE_EXISTS', 'An account with this phone exists'));
    await expect(createCompounder('Dup', '+919876543220')).rejects.toMatchObject({
      code: 'PHONE_EXISTS',
      status: 409,
    });
    expect(friendlyMessage({ code: 'PHONE_EXISTS', status: 409 })).toBe(
      'An account with this phone number already exists.',
    );
  });

  test('403 for a compounder caller maps to a friendly message', async () => {
    mockFetchOnce(envelopeError(403, 'FORBIDDEN', 'Only doctors may manage compounders'));
    await expect(fetchCompounders()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(friendlyMessage({ code: 'FORBIDDEN', status: 403 })).toBe(
      'You do not have access to this.',
    );
  });

  test('DELETE deactivates (soft) with the session-revoking endpoint', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      body: {
        ok: true,
        data: {
          user: {
            id: 'u2',
            name: 'Comp One',
            phone: '+919876543220',
            isActive: false,
            mustChangePassword: true,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });

    const { user } = await deactivateCompounder('u2');

    expect(user.isActive).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/compounders/u2');
    expect(init.method).toBe('DELETE');
  });
});
