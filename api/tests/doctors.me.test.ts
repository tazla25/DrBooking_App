import { GET as getMe, PATCH as patchMe } from '@/app/api/doctors/me/route';
import { db } from '@/lib/db';
import { AVATAR_MAX_CHARS } from '@/lib/validation';
import {
  patchRequest,
  getRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createCompounderFixture,
  createPatientFixture,
} from './helpers';

/**
 * Phase 11 A2 — doctor self-service profile:
 *   GET/PATCH /api/doctors/me
 *
 * Validation matrix (per the phase spec):
 *   - 401 unauthenticated
 *   - 403 COMPOUNDER (doctor-only), 403 unverified doctor, 403 patient
 *   - 400 AVATAR_TOO_LARGE (oversize), 400 AVATAR_INVALID (wrong mime)
 *   - 400 REGISTRATION_NUMBER_INVALID (charset / length)
 *   - happy path persists + audits the changed KEYS only (never values)
 *   - unknown keys rejected (zod .strict()), empty body rejected
 */

/** A tiny valid data-URL avatar (1x1 transparent PNG payload). */
const PNG_AVATAR = `data:image/png;base64,${'A'.repeat(64)}`;

describe('GET /api/doctors/me', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({ phone: '9844000011', name: 'Dr Me' });
    await db.doctorProfile.update({
      where: { id: doctor.doctorId },
      data: { specialization: 'Cardiology', registrationNumber: 'BMDC-A-12345' },
    });
  });

  it('returns the session doctor own profile in publicDoctorView shape', async () => {
    const body = await readResponse(
      await getMe(getRequest(`${API}/api/doctors/me`, doctor.token)),
    );
    expect(body.status).toBe(200);
    const data = body.data as {
      id: string;
      specialization: string | null;
      registrationNumber: string | null;
      avatarUrl: string | null;
    };
    expect(data.id).toBe(doctor.doctorId);
    expect(data.specialization).toBe('Cardiology');
    expect(data.registrationNumber).toBe('BMDC-A-12345');
    expect(data.avatarUrl).toBeNull();
  });

  it('401 unauthenticated, 403 COMPOUNDER, 403 PATIENT', async () => {
    const anon = await readResponse(await getMe(getRequest(`${API}/api/doctors/me`)));
    expect(anon.status).toBe(401);

    const compounder = await createCompounderFixture({
      phone: '9844000012',
      doctorId: doctor.doctorId,
    });
    const asCompounder = await readResponse(
      await getMe(getRequest(`${API}/api/doctors/me`, compounder.token)),
    );
    expect(asCompounder.status).toBe(403);

    const patient = await createPatientFixture({ phone: '9844000013' });
    const asPatient = await readResponse(
      await getMe(getRequest(`${API}/api/doctors/me`, patient.token)),
    );
    expect(asPatient.status).toBe(403);
  });

  it('403 DOCTOR_NOT_VERIFIED for a PENDING doctor', async () => {
    const pending = await createDoctorFixture({
      phone: '9844000014',
      verificationStatus: 'PENDING',
    });
    const body = await readResponse(
      await getMe(getRequest(`${API}/api/doctors/me`, pending.token)),
    );
    expect(body.status).toBe(403);
    expect(body.error?.code).toBe('DOCTOR_NOT_VERIFIED');
  });
});

describe('PATCH /api/doctors/me', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let compounder: { userId: string; token: string };

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({ phone: '9844000021', name: 'Dr Patcher', fee: 300 });
    compounder = await createCompounderFixture({
      phone: '9844000022',
      doctorId: doctor.doctorId,
    });
  });

  function patch(body: unknown, token?: string) {
    return patchMe(patchRequest(`${API}/api/doctors/me`, body, token));
  }

  it('401 unauthenticated', async () => {
    const body = await readResponse(
      await patch({ specialization: 'Cardiology' }),
    );
    expect(body.status).toBe(401);
  });

  it('403 for a COMPOUNDER (doctor-only route)', async () => {
    const body = await readResponse(
      await patch({ specialization: 'Cardiology' }, compounder.token),
    );
    expect(body.status).toBe(403);
  });

  it('400 AVATAR_TOO_LARGE for an avatar above the 300,000-char cap', async () => {
    const huge = `data:image/png;base64,${'A'.repeat(AVATAR_MAX_CHARS)}`; // 300,022 chars
    const body = await readResponse(await patch({ avatarUrl: huge }, doctor.token));
    expect(body.status).toBe(400);
    expect(body.error?.code).toBe('AVATAR_TOO_LARGE');
  });

  it('400 AVATAR_INVALID for a wrong-mime / malformed data URL', async () => {
    const webp = await readResponse(
      await patch({ avatarUrl: 'data:image/webp;base64,AAAA' }, doctor.token),
    );
    expect(webp.status).toBe(400);
    expect(webp.error?.code).toBe('AVATAR_INVALID');

    const notAUrl = await readResponse(await patch({ avatarUrl: 'https://x/y.png' }, doctor.token));
    expect(notAUrl.status).toBe(400);
    expect(notAUrl.error?.code).toBe('AVATAR_INVALID');
  });

  it('400 REGISTRATION_NUMBER_INVALID for bad charset or length', async () => {
    const charset = await readResponse(
      await patch({ registrationNumber: 'BMDC-A-12#45' }, doctor.token),
    );
    expect(charset.status).toBe(400);
    expect(charset.error?.code).toBe('REGISTRATION_NUMBER_INVALID');

    const tooShort = await readResponse(
      await patch({ registrationNumber: 'AB' }, doctor.token),
    );
    expect(tooShort.status).toBe(400);
    expect(tooShort.error?.code).toBe('REGISTRATION_NUMBER_INVALID');

    const tooLong = await readResponse(
      await patch({ registrationNumber: 'A'.repeat(41) }, doctor.token),
    );
    expect(tooLong.status).toBe(400);
    expect(tooLong.error?.code).toBe('REGISTRATION_NUMBER_INVALID');
  });

  it('422 for unknown keys (zod .strict()) and for an empty body', async () => {
    const unknownKey = await readResponse(
      await patch({ fullName: 'Dr Renamed', specialization: 'X' }, doctor.token),
    );
    expect(unknownKey.status).toBe(422); // fullName is NOT editable (A2 scope)

    const empty = await readResponse(await patch({}, doctor.token));
    expect(empty.status).toBe(422);
  });

  it('happy path: persists every editable field + audits CHANGED KEYS ONLY', async () => {
    const body = await readResponse(
      await patch(
        {
          specialization: 'Dermatology',
          fee: 550,
          yearsExperience: 9,
          bio: 'Skin specialist',
          registrationNumber: 'BMDC-D-99887',
          avatarUrl: PNG_AVATAR,
        },
        doctor.token,
      ),
    );
    expect(body.status).toBe(200);
    const data = body.data as {
      id: string;
      specialization: string;
      fee: number;
      yearsExperience: number;
      bio?: string;
      registrationNumber: string;
      avatarUrl: string;
    };
    expect(data.id).toBe(doctor.doctorId);
    expect(data.specialization).toBe('Dermatology');
    expect(data.fee).toBe(550);
    expect(data.yearsExperience).toBe(9);
    expect(data.bio).toBe('Skin specialist');
    expect(data.registrationNumber).toBe('BMDC-D-99887');
    expect(data.avatarUrl).toBe(PNG_AVATAR);

    // DB persisted.
    const stored = await db.doctorProfile.findUnique({ where: { id: doctor.doctorId } });
    expect(stored?.registrationNumber).toBe('BMDC-D-99887');
    expect(stored?.avatarUrl).toBe(PNG_AVATAR);
    expect(stored?.fullName).toBe('Dr Patcher'); // fullName NOT editable

    // Audit: DOCTOR_PROFILE_UPDATED, target doctor:<id>, detail = changed KEYS.
    const audit = await db.auditLog.findFirst({
      where: { action: 'DOCTOR_PROFILE_UPDATED', target: `doctor:${doctor.doctorId}` },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(doctor.userId);
    const detail = JSON.parse(audit!.detail ?? '{}') as { changedKeys?: string[] };
    expect(detail.changedKeys).toEqual([
      'specialization',
      'fee',
      'yearsExperience',
      'bio',
      'registrationNumber',
      'avatarUrl',
    ]);
  });

  it('resends of UNCHANGED values audit an empty changedKeys list (keys only, never values)', async () => {
    const body = await readResponse(
      await patch({ specialization: 'Dermatology' }, doctor.token), // already Dermatology
    );
    expect(body.status).toBe(200);

    const audit = await db.auditLog.findFirst({
      where: { action: 'DOCTOR_PROFILE_UPDATED', target: `doctor:${doctor.doctorId}` },
      orderBy: { createdAt: 'desc' },
    });
    const detail = JSON.parse(audit!.detail ?? '{}') as { changedKeys?: string[] };
    expect(detail.changedKeys).toEqual([]);
    // No avatar blob, no fee value — anywhere in the detail string.
    expect(audit?.detail ?? '').not.toContain(PNG_AVATAR);
    expect(audit?.detail ?? '').not.toContain('550');
  });

  it('null clears registrationNumber/avatarUrl (additive clear semantics)', async () => {
    const body = await readResponse(
      await patch({ registrationNumber: null, avatarUrl: null }, doctor.token),
    );
    expect(body.status).toBe(200);
    const data = body.data as { registrationNumber: string | null; avatarUrl: string | null };
    expect(data.registrationNumber).toBeNull();
    expect(data.avatarUrl).toBeNull();

    const audit = await db.auditLog.findFirst({
      where: { action: 'DOCTOR_PROFILE_UPDATED', target: `doctor:${doctor.doctorId}` },
      orderBy: { createdAt: 'desc' },
    });
    const detail = JSON.parse(audit!.detail ?? '{}') as { changedKeys?: string[] };
    expect(detail.changedKeys).toEqual(['registrationNumber', 'avatarUrl']);
  });
});

describe('PATCH /api/doctors/me — null clears EVERY editable field (fix1)', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;

  /** All-six-values seed (the blank-field clear tests start from here). */
  const FULL = {
    specialization: 'Cardiology',
    fee: 500,
    yearsExperience: 12,
    bio: 'Heart doctor',
    registrationNumber: 'BMDC-C-10001',
    avatarUrl: PNG_AVATAR,
  };

  async function seedFull() {
    await db.doctorProfile.update({ where: { id: doctor.doctorId }, data: FULL });
  }

  async function storedProfile() {
    return db.doctorProfile.findUnique({ where: { id: doctor.doctorId } });
  }

  async function lastAuditDetail(): Promise<string | null | undefined> {
    const audit = await db.auditLog.findFirst({
      where: { action: 'DOCTOR_PROFILE_UPDATED', target: `doctor:${doctor.doctorId}` },
      orderBy: { createdAt: 'desc' },
    });
    return audit?.detail;
  }

  function patch(body: unknown, token?: string) {
    return patchMe(patchRequest(`${API}/api/doctors/me`, body, token));
  }

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({ phone: '9844000031', name: 'Dr Nuller' });
  });

  it('full-null payload clears ALL six fields (response view + stored row)', async () => {
    await seedFull();
    const body = await readResponse(
      await patch(
        {
          specialization: null,
          fee: null,
          yearsExperience: null,
          bio: null,
          registrationNumber: null,
          avatarUrl: null,
        },
        doctor.token,
      ),
    );
    expect(body.status).toBe(200);
    const data = body.data as {
      specialization: string | null;
      fee: number | null;
      yearsExperience: number | null;
      bio?: string;
      registrationNumber: string | null;
      avatarUrl: string | null;
    };
    expect(data.specialization).toBeNull();
    expect(data.fee).toBeNull();
    expect(data.yearsExperience).toBeNull();
    expect(data.bio).toBeUndefined(); // bio is only-when-present in the view
    expect(data.registrationNumber).toBeNull();
    expect(data.avatarUrl).toBeNull();

    const stored = await storedProfile();
    expect(stored?.specialization).toBeNull();
    expect(stored?.fee).toBeNull();
    expect(stored?.yearsExperience).toBeNull();
    expect(stored?.bio).toBeNull();
    expect(stored?.registrationNumber).toBeNull();
    expect(stored?.avatarUrl).toBeNull();

    const detail = JSON.parse((await lastAuditDetail()) ?? '{}') as { changedKeys?: string[] };
    expect(detail.changedKeys).toEqual([
      'specialization',
      'fee',
      'yearsExperience',
      'bio',
      'registrationNumber',
      'avatarUrl',
    ]);
  });

  it.each([
    ['specialization', 'Cardiology'],
    ['fee', 500],
    ['yearsExperience', 12],
    ['bio', 'Heart doctor'],
  ] as const)(
    'clearing %s INDIVIDUALLY nulls only that field',
    async (field, seededValue) => {
      await seedFull();
      const body = await readResponse(await patch({ [field]: null }, doctor.token));
      expect(body.status).toBe(200);

      const stored = await storedProfile();
      // Only the patched field is null; every other field keeps its value.
      expect((stored as Record<string, unknown> | null)?.[field]).toBeNull();
      const otherFields = Object.keys(FULL).filter((k) => k !== field);
      for (const key of otherFields) {
        expect((stored as Record<string, unknown> | null)?.[key]).toBe(
          (FULL as Record<string, unknown>)[key],
        );
      }
      expect(seededValue).not.toBeNull(); // sanity: the seed really had a value

      const detail = JSON.parse((await lastAuditDetail()) ?? '{}') as { changedKeys?: string[] };
      expect(detail.changedKeys).toEqual([field]);
    },
  );

  it('NO-OP guard: full-null PATCH on an all-null profile audits changedKeys: []', async () => {
    await seedFull();
    // First PATCH clears everything…
    const first = await readResponse(
      await patch(
        {
          specialization: null,
          fee: null,
          yearsExperience: null,
          bio: null,
          registrationNumber: null,
          avatarUrl: null,
        },
        doctor.token,
      ),
    );
    expect(first.status).toBe(200);

    // …so this second, identical full-null PATCH is a complete no-op.
    const second = await readResponse(
      await patch(
        {
          specialization: null,
          fee: null,
          yearsExperience: null,
          bio: null,
          registrationNumber: null,
          avatarUrl: null,
        },
        doctor.token,
      ),
    );
    expect(second.status).toBe(200);

    const audit = await db.auditLog.findFirst({
      where: { action: 'DOCTOR_PROFILE_UPDATED', target: `doctor:${doctor.doctorId}` },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(doctor.userId);
    const detail = JSON.parse(audit!.detail ?? '{}') as { changedKeys?: string[] };
    expect(detail.changedKeys).toEqual([]);
  });

  it('REGRESSION: setting real values still works after a null clear', async () => {
    const body = await readResponse(
      await patch(
        {
          specialization: 'Cardiology',
          fee: 750,
          yearsExperience: 20,
          bio: 'Senior cardiologist',
          registrationNumber: 'BMDC-C-20002',
          avatarUrl: PNG_AVATAR,
        },
        doctor.token,
      ),
    );
    expect(body.status).toBe(200);
    const data = body.data as {
      specialization: string | null;
      fee: number | null;
      yearsExperience: number | null;
      bio?: string;
      registrationNumber: string | null;
      avatarUrl: string | null;
    };
    expect(data.specialization).toBe('Cardiology');
    expect(data.fee).toBe(750);
    expect(data.yearsExperience).toBe(20);
    expect(data.bio).toBe('Senior cardiologist');
    expect(data.registrationNumber).toBe('BMDC-C-20002');
    expect(data.avatarUrl).toBe(PNG_AVATAR);

    const stored = await storedProfile();
    expect(stored?.specialization).toBe('Cardiology');
    expect(stored?.fee).toBe(750);
    expect(stored?.bio).toBe('Senior cardiologist');
  });

  it('REGRESSION: empty-string specialization/bio still clear to null (and audit as changes)', async () => {
    const body = await readResponse(
      await patch({ specialization: '', bio: '' }, doctor.token),
    );
    expect(body.status).toBe(200);

    const stored = await storedProfile();
    expect(stored?.specialization).toBeNull();
    expect(stored?.bio).toBeNull();

    const detail = JSON.parse((await lastAuditDetail()) ?? '{}') as { changedKeys?: string[] };
    expect(detail.changedKeys).toEqual(['specialization', 'bio']);
  });

  it('SPURIOUS-EDGE guards: "" over stored NULL and null over stored NULL are no-ops', async () => {
    // Profile is all-null at this point (previous test cleared it).
    const body = await readResponse(await patch({ specialization: '', bio: null }, doctor.token));
    expect(body.status).toBe(200);
    const stored = await storedProfile();
    expect(stored?.specialization).toBeNull();
    expect(stored?.bio).toBeNull();
    const detail = JSON.parse((await lastAuditDetail()) ?? '{}') as { changedKeys?: string[] };
    expect(detail.changedKeys).toEqual([]);
  });
});
