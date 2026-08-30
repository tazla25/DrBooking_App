import { POST as registerDevice } from '@/app/api/devices/route';
import { db } from '@/lib/db';
import {
  postRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createPatientFixture,
} from './helpers';

describe('POST /api/devices (#33)', () => {
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;

  beforeAll(async () => {
    await resetDb();
    patient = await createPatientFixture({ phone: '9827000010', name: 'Device Patient' });
    doctor = await createDoctorFixture({ phone: '9827000001', name: 'Device Doctor' });
  });

  function devices(body: Record<string, unknown>, token?: string) {
    return registerDevice(postRequest(`${API}/api/devices`, body, token));
  }

  it('creates a device token for the caller (any role)', async () => {
    const body = await readResponse(
      await devices({ token: 'fcm-token-abcdefghij', platform: 'android' }, patient.token),
    );
    expect(body.status).toBe(200);
    expect((body.data as { id: string }).id).toBeTruthy();

    const rows = await db.deviceToken.findMany({ where: { token: 'fcm-token-abcdefghij' } });
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(patient.userId);
    expect(rows[0].platform).toBe('android');
  });

  it('re-registering the SAME token under a DIFFERENT user moves it (1 row, updated)', async () => {
    const body = await readResponse(
      await devices({ token: 'fcm-token-abcdefghij', platform: 'ios' }, doctor.token),
    );
    expect(body.status).toBe(200);

    const rows = await db.deviceToken.findMany({ where: { token: 'fcm-token-abcdefghij' } });
    expect(rows.length).toBe(1); // upsert, never a duplicate
    expect(rows[0].userId).toBe(doctor.userId); // moved to the new account
    expect(rows[0].platform).toBe('ios');
    expect((body.data as { id: string }).id).toBe(rows[0].id);
  });

  it('validates the body (token length, platform enum) and requires auth', async () => {
    const shortToken = await readResponse(
      await devices({ token: 'short', platform: 'ios' }, patient.token),
    );
    expect(shortToken.status).toBe(422);

    const longToken = await readResponse(
      await devices({ token: 'x'.repeat(513), platform: 'ios' }, patient.token),
    );
    expect(longToken.status).toBe(422);

    const badPlatform = await readResponse(
      await devices({ token: 'apns-token-1234567890', platform: 'web' }, patient.token),
    );
    expect(badPlatform.status).toBe(422);

    const missingBody = await readResponse(
      await devices({ platform: 'ios' }, patient.token),
    );
    expect(missingBody.status).toBe(422);

    const anonymous = await readResponse(
      await devices({ token: 'apns-token-1234567890', platform: 'ios' }),
    );
    expect(anonymous.status).toBe(401);
  });
});
