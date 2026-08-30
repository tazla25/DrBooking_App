import { PATCH as availabilityRoute } from '@/app/api/availability/route';
import { db } from '@/lib/db';
import {
  patchRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createCompounderFixture,
  createPatientFixture,
} from './helpers';

describe('PATCH /api/availability (#25)', () => {
  let doctorA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let compounderA: Awaited<ReturnType<typeof createCompounderFixture>>;

  beforeAll(async () => {
    await resetDb();
    doctorA = await createDoctorFixture({ phone: '9810000091', name: 'Dr Avail', isAvailableNow: false });
    compounderA = await createCompounderFixture({ phone: '9810000092', doctorId: doctorA.doctorId });
  });

  it('DOCTOR toggles their own availability', async () => {
    const body = await readResponse(
      await availabilityRoute(
        patchRequest(`${API}/api/availability`, { isAvailableNow: true }, doctorA.token),
      ),
    );
    expect(body.status).toBe(200);
    expect(body.data).toEqual({ isAvailableNow: true });

    const profile = await db.doctorProfile.findUnique({ where: { id: doctorA.doctorId } });
    expect(profile!.isAvailableNow).toBe(true);
  });

  it('COMPOUNDER toggles the DELEGATED doctor profile', async () => {
    const body = await readResponse(
      await availabilityRoute(
        patchRequest(`${API}/api/availability`, { isAvailableNow: false }, compounderA.token),
      ),
    );
    expect(body.status).toBe(200);
    expect((body.data as { isAvailableNow: boolean }).isAvailableNow).toBe(false);

    const profile = await db.doctorProfile.findUnique({ where: { id: doctorA.doctorId } });
    expect(profile!.isAvailableNow).toBe(false); // A's profile, changed by A's compounder
  });

  it('rejects patients (403), anonymous (401) and invalid bodies (422)', async () => {
    const patient = await createPatientFixture({ phone: '9810000093' });

    const asPatient = await readResponse(
      await availabilityRoute(
        patchRequest(`${API}/api/availability`, { isAvailableNow: true }, patient.token),
      ),
    );
    expect(asPatient.status).toBe(403);

    const anon = await readResponse(
      await availabilityRoute(patchRequest(`${API}/api/availability`, { isAvailableNow: true })),
    );
    expect(anon.status).toBe(401);

    const invalid = await readResponse(
      await availabilityRoute(
        patchRequest(`${API}/api/availability`, { isAvailableNow: 'yes' }, doctorA.token),
      ),
    );
    expect(invalid.status).toBe(422);
  });
});
