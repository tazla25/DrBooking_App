import { GET as listDoctors } from '@/app/api/doctors/route';
import { GET as doctorDetail } from '@/app/api/doctors/[id]/route';
import { db } from '@/lib/db';
import { istTodayISO, addDaysISO } from '@/lib/time';
import {
  getRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createScheduleFixture,
  routeContext,
} from './helpers';

interface PublicDoctor {
  id: string;
  fullName: string;
  specialization: string | null;
  fee: number | null;
  yearsExperience: number | null;
  bio?: string;
  avgRating: number;
  reviewCount: number;
  isAvailableNow: boolean;
}

/** Visit every key of a parsed JSON structure. */
function deepVisit(node: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => deepVisit(child, visit));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      visit(key, value);
      deepVisit(value, visit);
    }
  }
}

describe('GET /api/doctors (public list, #6)', () => {
  let anil: Awaited<ReturnType<typeof createDoctorFixture>>;
  let bina: Awaited<ReturnType<typeof createDoctorFixture>>;
  let charlie: Awaited<ReturnType<typeof createDoctorFixture>>;
  let gita: Awaited<ReturnType<typeof createDoctorFixture>>;

  beforeAll(async () => {
    await resetDb();

    anil = await createDoctorFixture({ phone: '9824000001', name: 'Dr Anil Verma', fee: 300 });
    bina = await createDoctorFixture({ phone: '9824000002', name: 'Dr Bina Rao', fee: 500 });
    charlie = await createDoctorFixture({ phone: '9824000003', name: 'Dr Charlie Sen', fee: 200 });
    gita = await createDoctorFixture({ phone: '9824000004', name: 'Dr Gita Devi', fee: null });

    // Distinct public profiles.
    await db.doctorProfile.update({
      where: { id: anil.doctorId },
      data: { specialization: 'Cardiology', avgRating: 4.5, reviewCount: 10, yearsExperience: 12, bio: 'Heart specialist' },
    });
    await db.doctorProfile.update({
      where: { id: bina.doctorId },
      data: { specialization: 'Dermatology', avgRating: 4.8, reviewCount: 20, isAvailableNow: true },
    });
    await db.doctorProfile.update({
      where: { id: charlie.doctorId },
      data: { specialization: 'Cardiology', avgRating: 4.5, reviewCount: 8 },
    });
    // gita: null fee, null specialization, no rating (defaults 0/0).

    // NEVER listable: pending, rejected, disabled-account.
    await createDoctorFixture({ phone: '9824000091', name: 'Dr Pending', verificationStatus: 'PENDING' });
    await createDoctorFixture({ phone: '9824000092', name: 'Dr Rejected', verificationStatus: 'REJECTED' });
    const disabled = await createDoctorFixture({ phone: '9824000093', name: 'Dr Disabled' });
    await db.user.update({ where: { id: disabled.userId }, data: { isActive: false } });

    // pinCode filter fixture: only Anil operates at 560001.
    await createScheduleFixture(anil.doctorId, { pinCode: '560001' });
  });

  function list(query = '') {
    return listDoctors(getRequest(`${API}/api/doctors${query}`));
  }

  it('lists ONLY verified doctors with active accounts; PENDING/REJECTED/disabled absent', async () => {
    const body = await readResponse(await list());
    expect(body.status).toBe(200);
    const data = body.data as { total: number; doctors: PublicDoctor[] };
    expect(data.total).toBe(4);
    const names = data.doctors.map((d) => d.fullName);
    expect(names).not.toContain('Dr Pending');
    expect(names).not.toContain('Dr Rejected');
    expect(names).not.toContain('Dr Disabled');
  });

  it('default sort = rating desc with deterministic name tiebreak (Anil before Charlie at 4.5)', async () => {
    const body = await readResponse(await list());
    const data = body.data as { doctors: PublicDoctor[] };
    expect(data.doctors.map((d) => d.fullName)).toEqual([
      'Dr Bina Rao', // 4.8
      'Dr Anil Verma', // 4.5, name tiebreak asc
      'Dr Charlie Sen', // 4.5
      'Dr Gita Devi', // 0
    ]);
  });

  it('public fields only: no userId, no phone, no account fields anywhere', async () => {
    const body = await readResponse(await list());
    const serialized = JSON.stringify(body.data);
    deepVisit(body.data, (key) => {
      expect(['userId', 'phone', 'passwordHash', 'verificationStatus', 'isActive'].includes(key)).toBe(false);
    });
    for (const doctor of [anil, bina, charlie, gita]) {
      expect(serialized.includes(doctor.userId)).toBe(false); // user ids never leak
      expect(serialized.includes(doctor.phone)).toBe(false); // phones never leak
    }
    // bio included when present, absent when null.
    const data = body.data as { doctors: PublicDoctor[] };
    const anilView = data.doctors.find((d) => d.fullName === 'Dr Anil Verma')!;
    expect(anilView.bio).toBe('Heart specialist');
    expect(anilView.specialization).toBe('Cardiology');
    expect(data.doctors.find((d) => d.fullName === 'Dr Gita Devi')!.bio).toBeUndefined();
  });

  it('?q= matches name or specialization, case-insensitive', async () => {
    const bySpec = await readResponse(await list('?q=cardio'));
    expect((bySpec.data as { total: number }).total).toBe(2); // Anil + Charlie

    const byNameUpper = await readResponse(await list('?q=BINA'));
    expect((byNameUpper.data as { total: number }).total).toBe(1);

    const none = await readResponse(await list('?q=Neurology'));
    expect((none.data as { total: number }).total).toBe(0);
  });

  it('?sort=fee_asc / fee_desc with null fees last', async () => {
    const asc = await readResponse(await list('?sort=fee_asc'));
    expect(
      (asc.data as { doctors: PublicDoctor[] }).doctors.map((d) => d.fullName),
    ).toEqual(['Dr Charlie Sen', 'Dr Anil Verma', 'Dr Bina Rao', 'Dr Gita Devi']);

    const desc = await readResponse(await list('?sort=fee_desc'));
    expect(
      (desc.data as { doctors: PublicDoctor[] }).doctors.map((d) => d.fullName),
    ).toEqual(['Dr Bina Rao', 'Dr Anil Verma', 'Dr Charlie Sen', 'Dr Gita Devi']);
  });

  it('?pinCode= filters on active schedules (exact match)', async () => {
    const body = await readResponse(await list('?pinCode=560001'));
    const data = body.data as { total: number; doctors: PublicDoctor[] };
    expect(data.total).toBe(1);
    expect(data.doctors[0].fullName).toBe('Dr Anil Verma');
  });

  it('paginates: page/pageSize/total over the filtered set', async () => {
    const page1 = await readResponse(await list('?pageSize=2&page=1'));
    const p1 = page1.data as { total: number; page: number; pageSize: number; doctors: PublicDoctor[] };
    expect(p1.doctors.length).toBe(2);
    expect(p1.total).toBe(4);
    expect(p1.page).toBe(1);

    const page2 = await readResponse(await list('?pageSize=2&page=2'));
    const p2 = page2.data as { doctors: PublicDoctor[] };
    expect(p2.doctors.length).toBe(2);
    expect(p2.doctors[0].fullName).not.toBe(p1.doctors[0].fullName);

    const overSize = await readResponse(await list('?pageSize=51'));
    expect(overSize.status).toBe(422);
  });
});

describe('GET /api/doctors/:id (public profile, #6)', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  const today = istTodayISO();

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({ phone: '9824000101', name: 'Dr Profile', fee: 450 });
    await db.doctorProfile.update({
      where: { id: doctor.doctorId },
      data: { specialization: 'Pediatrics', avgRating: 4.7, reviewCount: 33, yearsExperience: 9, bio: 'Kids doctor' },
    });

    // Active schedule (with an override today) + inactive one + far-future override.
    const active = await createScheduleFixture(doctor.doctorId, {
      pinCode: '700001',
      landmark: 'Near park',
      avgMinutesPerPatient: 12,
    });
    await createScheduleFixture(doctor.doctorId, { clinicName: 'Hidden Clinic', isActive: false });
    await db.scheduleOverride.create({
      data: { scheduleId: active.id, date: today, type: 'MODIFIED_HOURS', newStartTime: '10:00', newEndTime: '12:00', reason: 'Short day' },
    });
    await db.scheduleOverride.create({
      data: { scheduleId: active.id, date: addDaysISO(today, 3), type: 'CLOSED', reason: 'Holiday' },
    });
    await db.scheduleOverride.create({
      data: { scheduleId: active.id, date: addDaysISO(today, 12), type: 'CLOSED', reason: 'Out of window' },
    });
  });

  function detail(id: string) {
    return doctorDetail(getRequest(`${API}/api/doctors/${id}`), routeContext({ id }));
  }

  it('returns the public profile + active schedules + overrides within [today, today+7]', async () => {
    const body = await readResponse(await detail(doctor.doctorId));
    expect(body.status).toBe(200);

    const data = body.data as {
      id: string;
      fullName: string;
      specialization: string | null;
      bio?: string;
      avgRating: number;
      reviewCount: number;
      schedules: { id: string; clinicName: string; pinCode: string | null; landmark: string | null; avgMinutesPerPatient: number }[];
      overrides: { scheduleId: string; date: string; type: string; reason: string | null }[];
    };
    expect(data.id).toBe(doctor.doctorId); // DoctorProfile id
    expect(data.fullName).toBe('Dr Profile');
    expect(data.specialization).toBe('Pediatrics');
    expect(data.avgRating).toBe(4.7);
    expect(data.reviewCount).toBe(33);

    expect(data.schedules.length).toBe(1); // inactive schedule hidden
    expect(data.schedules[0].pinCode).toBe('700001');
    expect(data.schedules[0].avgMinutesPerPatient).toBe(12);

    expect(data.overrides.length).toBe(2); // +12-day override excluded
    expect(data.overrides.map((o) => o.date).sort()).toEqual(
      [today, addDaysISO(today, 3)].sort(),
    );

    // No account-level fields leak.
    const serialized = JSON.stringify(body.data);
    deepVisit(body.data, (key) => {
      expect(['userId', 'phone', 'passwordHash', 'isActive'].includes(key)).toBe(false);
    });
    expect(serialized.includes(doctor.userId)).toBe(false);
    expect(serialized.includes(doctor.phone)).toBe(false);
  });

  it('404 for unknown, PENDING, and disabled doctors — pending doctors are never revealed', async () => {
    const unknown = await readResponse(await detail('no-such-doctor'));
    expect(unknown.status).toBe(404);

    const pending = await createDoctorFixture({ phone: '9824000191', verificationStatus: 'PENDING' });
    expect((await readResponse(await detail(pending.doctorId))).status).toBe(404);

    const disabled = await createDoctorFixture({ phone: '9824000192' });
    await db.user.update({ where: { id: disabled.userId }, data: { isActive: false } });
    expect((await readResponse(await detail(disabled.doctorId))).status).toBe(404);
  });
});
