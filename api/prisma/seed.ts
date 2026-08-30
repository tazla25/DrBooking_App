/* eslint-disable no-console */
/**
 * Dr_Booking v2 — development seed.
 *
 * Creates (idempotently — wipes and re-seeds):
 *   - 1 SUPER_ADMIN                       +91 99990 00001
 *   - 2 VERIFIED doctors                  +91 98765 43210 / +91 98765 43211 (schedules incl. TODAY)
 *   - 1 PENDING doctor                    +91 98765 43299
 *   - 1 COMPOUNDER                        +91 98765 43220 (mustChangePassword=true, delegated to doctor 1)
 *   - 5 PATIENTs                          +91 98123 4560X
 *   - Sample appointments for TODAY (IST) + one feedback on a completed visit
 *
 * Every account uses password: Test@1234
 *
 * Run: bun run db:seed   (or `bun prisma/seed.ts` from api/)
 */

import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { addDaysISO, dayOfWeekIST, istTodayISO } from '../src/lib/time';

const db = new PrismaClient();

const PASSWORD = 'Test@1234';

async function main(): Promise<void> {
  const today = istTodayISO(); // IST business date — never toISOString()
  const todayDow = dayOfWeekIST(today);
  console.log(`Seeding with IST today = ${today} (dayOfWeek ${todayDow})`);

  // ---- wipe (children first) -------------------------------------------------
  await db.failedLogin.deleteMany();
  await db.auditLog.deleteMany();
  await db.deviceToken.deleteMany();
  await db.session.deleteMany();
  await db.feedback.deleteMany();
  await db.patientNote.deleteMany();
  await db.appointment.deleteMany();
  await db.scheduleOverride.deleteMany();
  await db.schedule.deleteMany();
  await db.doctorProfile.deleteMany();
  await db.user.deleteMany();

  const passwordHash = await hash(PASSWORD, 10);

  // ---- SUPER_ADMIN ------------------------------------------------------------
  const admin = await db.user.create({
    data: {
      phone: '+919999000001',
      passwordHash,
      name: 'Platform Admin',
      role: 'SUPER_ADMIN',
      verificationStatus: 'VERIFIED',
    },
  });
  console.log(`SUPER_ADMIN  ${admin.phone}`);

  // ---- Doctors ------------------------------------------------------------------
  const dr1User = await db.user.create({
    data: {
      phone: '+919876543210',
      passwordHash,
      name: 'Ananya Sharma',
      role: 'DOCTOR',
      verificationStatus: 'VERIFIED',
    },
  });
  const dr1 = await db.doctorProfile.create({
    data: {
      userId: dr1User.id,
      fullName: 'Dr. Ananya Sharma',
      specialization: 'General Physician',
      fee: 500,
      yearsExperience: 12,
      bio: 'Family medicine and preventive care. MBBS, MD (Internal Medicine).',
      avgRating: 4.8,
      reviewCount: 1, // one seeded feedback below
      appointmentCount: 4,
      isAvailableNow: true,
    },
  });

  const dr2User = await db.user.create({
    data: {
      phone: '+919876543211',
      passwordHash,
      name: 'Rohan Mehta',
      role: 'DOCTOR',
      verificationStatus: 'VERIFIED',
    },
  });
  const dr2 = await db.doctorProfile.create({
    data: {
      userId: dr2User.id,
      fullName: 'Dr. Rohan Mehta',
      specialization: 'Dermatologist',
      fee: 700,
      yearsExperience: 8,
      bio: 'Skin, hair and nail care. MBBS, MD (Dermatology).',
      avgRating: 4.5,
      reviewCount: 0,
      appointmentCount: 2,
      isAvailableNow: true,
    },
  });

  const pendingDoctor = await db.user.create({
    data: {
      phone: '+919876543299',
      passwordHash,
      name: 'Kavita Rao',
      role: 'DOCTOR',
      verificationStatus: 'PENDING', // awaiting SUPER_ADMIN verification
    },
  });
  await db.doctorProfile.create({
    data: {
      userId: pendingDoctor.id,
      fullName: 'Dr. Kavita Rao',
      specialization: 'Pediatrician',
      isAvailableNow: false,
    },
  });
  console.log(`DOCTORS     ${dr1User.phone} (VERIFIED)  ${dr2User.phone} (VERIFIED)  ${pendingDoctor.phone} (PENDING)`);

  // ---- COMPOUNDER (delegated to doctor 1) -----------------------------------------
  const compounder = await db.user.create({
    data: {
      phone: '+919876543220',
      passwordHash,
      name: 'Suresh Patil',
      role: 'COMPOUNDER',
      verificationStatus: 'VERIFIED',
      mustChangePassword: true, // onboarding: forced password change at first login
      delegatedDoctorId: dr1.id,
    },
  });
  console.log(`COMPOUNDER  ${compounder.phone} (delegated to ${dr1.fullName}, mustChangePassword=true)`);

  // ---- Patients ---------------------------------------------------------------------
  const patientPhones = ['+919812345601', '+919812345602', '+919812345603', '+919812345604', '+919812345605'];
  const patientNames = [
    'Priya Nair',
    'Amit Verma',
    'Sneha Kulkarni',
    'Rahul Singh',
    'Meera Iyer',
  ];
  const patients = [];
  for (let i = 0; i < patientPhones.length; i += 1) {
    patients.push(
      await db.user.create({
        data: {
          phone: patientPhones[i],
          passwordHash,
          name: patientNames[i],
          role: 'PATIENT',
          verificationStatus: 'VERIFIED',
        },
      }),
    );
  }
  console.log(`PATIENTS    ${patients.length} (${patientPhones[0]} … ${patientPhones[4]})`);

  // ---- Schedules (each doctor has a slot TODAY and later this week) ------------------
  const clinicA = {
    clinicName: 'Sharma Family Clinic',
    clinicAddress: '12, MG Road, near Trinity Circle, Bengaluru',
    pinCode: '560001',
    landmark: 'Opposite Metro Gate 2',
    mapLink: 'https://maps.google.com/?q=Sharma+Family+Clinic+MG+Road+Bengaluru',
  };
  const clinicB = {
    clinicName: 'Mehta Skin & Hair Studio',
    clinicAddress: '3rd Floor, Orion Mall Tower B, Bengaluru',
    pinCode: '560055',
    landmark: 'Next to Orion Food Court',
    mapLink: 'https://maps.google.com/?q=Orion+Mall+Rajarajeshwari+Nagar+Bengaluru',
  };

  // Doctor 1: mornings today, plus two more weekday slots.
  const dr1Today = await db.schedule.create({
    data: {
      doctorId: dr1.id,
      dayOfWeek: todayDow,
      startTime: '09:00',
      endTime: '13:00',
      ...clinicA,
      avgMinutesPerPatient: 10,
    },
  });
  await db.schedule.create({
    data: {
      doctorId: dr1.id,
      dayOfWeek: (todayDow + 2) % 7,
      startTime: '09:00',
      endTime: '13:00',
      ...clinicA,
      avgMinutesPerPatient: 10,
    },
  });
  await db.schedule.create({
    data: {
      doctorId: dr1.id,
      dayOfWeek: (todayDow + 4) % 7,
      startTime: '17:00',
      endTime: '20:00',
      ...clinicA,
      avgMinutesPerPatient: 12,
    },
  });

  // Doctor 2: evenings today, plus one next-week slot.
  const dr2Today = await db.schedule.create({
    data: {
      doctorId: dr2.id,
      dayOfWeek: todayDow,
      startTime: '16:00',
      endTime: '19:00',
      ...clinicB,
      avgMinutesPerPatient: 15,
    },
  });
  await db.schedule.create({
    data: {
      doctorId: dr2.id,
      dayOfWeek: dayOfWeekIST(addDaysISO(today, 3)),
      startTime: '16:00',
      endTime: '19:00',
      ...clinicB,
      avgMinutesPerPatient: 15,
    },
  });
  console.log(`SCHEDULES   5 created (both doctors have a slot TODAY=${today})`);

  // ---- Appointments TODAY (mixed statuses/sources) -------------------------------------
  const appts = [
    {
      schedule: dr1Today,
      doctorId: dr1.id,
      patient: patients[0],
      patientName: patientNames[0],
      patientPhone: patientPhones[0],
      queueNumber: 1,
      status: 'COMPLETED',
      source: 'ONLINE',
      fee: 500,
      notes: 'Follow-up: blood pressure review.',
    },
    {
      schedule: dr1Today,
      doctorId: dr1.id,
      patient: patients[1],
      patientName: patientNames[1],
      patientPhone: patientPhones[1],
      queueNumber: 2,
      status: 'CALLED',
      source: 'ONLINE',
      fee: 500,
      notes: null,
    },
    {
      schedule: dr1Today,
      doctorId: dr1.id,
      patient: null,
      patientName: 'Devendra Joshi',
      patientPhone: '+919812345609',
      queueNumber: 3,
      status: 'CONFIRMED',
      source: 'WALK_IN',
      fee: 500,
      notes: 'Walk-in, no online account.',
    },
    {
      schedule: dr1Today,
      doctorId: dr1.id,
      patient: patients[2],
      patientName: patientNames[2],
      patientPhone: patientPhones[2],
      queueNumber: 4,
      status: 'CANCELLED',
      source: 'ONLINE',
      fee: 500,
      notes: null,
    },
    {
      schedule: dr1Today,
      doctorId: dr1.id,
      patient: patients[3],
      patientName: patientNames[3],
      patientPhone: patientPhones[3],
      queueNumber: 5,
      status: 'NO_SHOW',
      source: 'ONLINE',
      fee: 500,
      notes: null,
    },
    {
      schedule: dr2Today,
      doctorId: dr2.id,
      patient: patients[4],
      patientName: patientNames[4],
      patientPhone: patientPhones[4],
      queueNumber: 1,
      status: 'CONFIRMED',
      source: 'ONLINE',
      fee: 700,
      notes: 'First consultation — acne.',
    },
    {
      schedule: dr2Today,
      doctorId: dr2.id,
      patient: null,
      patientName: 'Farida Sheikh',
      patientPhone: '+919812345608',
      queueNumber: 2,
      status: 'CONFIRMED',
      source: 'WALK_IN',
      fee: 700,
      notes: null,
    },
  ];

  const createdAppts = [];
  for (const a of appts) {
    createdAppts.push(
      await db.appointment.create({
        data: {
          scheduleId: a.schedule.id,
          doctorId: a.doctorId,
          patientId: a.patient ? a.patient.id : null,
          patientName: a.patientName,
          patientPhone: a.patientPhone,
          date: today,
          queueNumber: a.queueNumber,
          status: a.status,
          source: a.source,
          fee: a.fee,
          notes: a.notes,
        },
      }),
    );
  }
  console.log(`APPOINTMENTS ${createdAppts.length} on ${today} (CONFIRMED/CALLED/COMPLETED/CANCELLED/NO_SHOW)`);

  // ---- Feedback on the completed visit + a doctor note ----------------------------------
  await db.feedback.create({
    data: {
      appointmentId: createdAppts[0].id,
      rating: 5,
      comment: 'Dr. Sharma explained everything clearly. Very satisfied!',
    },
  });
  await db.patientNote.create({
    data: {
      patientPhone: patientPhones[0],
      authorId: dr1User.id,
      note: 'Patient prefers evening calls for reminders.',
      isImportant: false,
    },
  });

  console.log(`DONE. Login with any seeded phone + password "${PASSWORD}"`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
