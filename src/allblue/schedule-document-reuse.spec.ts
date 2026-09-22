import { AllblueService } from './allblue.service';

function fixture(categoryCode = 'CERTIFICATION') {
  const records = ['liability', 'medical'].map(formId => ({
    formId, participantUserId: 'student', instructorId: 10, licenseId: 20,
    status: 'submitted', uuid: `previous-${formId}`,
  }));
  const schedule = {
    id: 12, title: 'Course', instructorId: 'teacher', categoryCode,
    instructor: { nickname: 'Teacher' }, scheduleDate: new Date('2026-09-22'),
    participants: [{ userId: 'student', user: { id: 2, nickname: 'Student' },
      licenses: [{ userLicenseId: 100, userLicense: { license: { code: 'L2', nameKo: 'Level 2' } } }] }],
    formSubmissions: ['liability', 'medical'].map(formId => ({
      formId, participantUserId: 'student', participantGuestId: null,
      status: 'pending', uuid: `current-${formId}`,
    })),
  };
  const prisma = {
    schedule: { findUnique: jest.fn().mockResolvedValue(schedule) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 10, userId: 'student', nickname: 'Student' }) },
    user_license: { findMany: jest.fn().mockResolvedValue([{ license: { id: 20, associationId: 1 } }]) },
    common_code: { findUnique: jest.fn().mockResolvedValue(null) },
    debriefing: { findMany: jest.fn().mockResolvedValue([]) },
    schedule_participant: { create: jest.fn().mockResolvedValue({ id: 50 }) },
    schedule_participant_license: { createMany: jest.fn() },
    form_submission: {
      findFirst: jest.fn().mockImplementation(({ where }) => Promise.resolve(records.find(record =>
        Object.entries(where).every(([key, value]) => record[key] === value),
      ) ?? null)),
      create: jest.fn(), createMany: jest.fn(),
    },
  };
  const service = Object.assign(Object.create(AllblueService.prototype), { prisma }) as AllblueService;
  return { service, prisma, schedule, records };
}

it.each(['teacher', 'student'])('shows previously submitted course documents despite current pending forms for %s', async viewer => {
  const { service, prisma } = fixture();
  const result = await service.getScheduleDetail(12, viewer);
  expect(result.schedule?.participants[0]).toMatchObject({
    waiverSigned: true, medicalSigned: true, waiverReused: true, medicalReused: true,
    waiverUuid: 'previous-liability', medicalUuid: 'previous-medical',
  });
  expect(prisma.user_license.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId: 'student', id: { in: [100] } },
  })); // Use linked courses even after completion, not all active courses.
});

it.each(['EXPERIENCE', 'TRAINING'])('%s always requires its own documents', async category => {
  const { service, prisma } = fixture(category);
  const result = await service.getScheduleDetail(12, 'teacher');
  expect(result.schedule?.participants[0]).toMatchObject({ waiverSigned: false, medicalSigned: false, waiverReused: false });
  expect(prisma.form_submission.findFirst).not.toHaveBeenCalled();
  await (service as any).processParticipant(prisma, 12, { userId: 2, categoryCode: 'CERTIFICATION', userLicenseIds: [100] }, 'teacher', 10, 'Teacher', category);
  expect(prisma.form_submission.createMany).toHaveBeenCalledTimes(1);
  expect(prisma.form_submission.createMany.mock.calls[0][0].data).toHaveLength(2);
});

it.each(['instructorId', 'licenseId', 'participantUserId', 'status'])('does not reuse documents with a different %s', async key => {
  const { service, records } = fixture();
  records.forEach(record => { record[key] = key === 'status' ? 'saved' : 'different'; });
  const result = await service.getScheduleDetail(12, 'teacher');
  expect(result.schedule?.participants[0]).toMatchObject({ waiverSigned: false, medicalSigned: false });
});

it('reuses each form independently and preserves a submission made for this schedule', async () => {
  const { service, schedule, records } = fixture();
  records[1].status = 'pending';
  let result = await service.getScheduleDetail(12, 'teacher');
  expect(result.schedule?.participants[0]).toMatchObject({ waiverSigned: true, medicalSigned: false });
  schedule.formSubmissions[0].status = 'submitted';
  result = await service.getScheduleDetail(12, 'teacher');
  expect(result.schedule?.participants[0]).toMatchObject({ waiverUuid: 'current-liability', waiverReused: false });
});

it('does not create new course documents when both were submitted with the same instructor', async () => {
  const { service, prisma } = fixture();
  await (service as any).processParticipant(prisma, 12, { userId: 2, userLicenseIds: [100] }, 'teacher', 10, 'Teacher', 'CERTIFICATION');
  expect(prisma.form_submission.create).not.toHaveBeenCalled();
  expect(prisma.form_submission.createMany).not.toHaveBeenCalled();
});

it('does not guess a course from unrelated active licenses when no course is linked', async () => {
  const { service, prisma, schedule } = fixture();
  schedule.participants[0].licenses = [];
  const result = await service.getScheduleDetail(12, 'teacher');
  expect(result.schedule?.participants[0].waiverSigned).toBe(false);
  expect(prisma.user_license.findMany).not.toHaveBeenCalled();
});

it('shares the student course across instructors but requires one submission per instructor', async () => {
  const { service, prisma, schedule, records } = fixture();
  const course = { id: 100, userId: 'student', instructorId: 'teacher', status: 'IN_PROGRESS', license: { id: 20, associationId: 1 } };
  prisma.user_license.findMany.mockImplementation(async ({ where }) =>
    course.userId === where.userId && where.id.in.includes(course.id) &&
    (!where.instructorId || where.instructorId === course.instructorId) ? [course] : [],
  );
  prisma.user.findUnique.mockImplementation(async ({ where }) => ({
    id: where.userId === 'teacher-b' ? 11 : 10, userId: 'student', nickname: 'Student',
  }));
  const participant = { userId: 2, userLicenseIds: [100] };
  // A's second lesson reuses A's submitted AIDA course documents.
  await (service as any).processParticipant(prisma, 12, participant, 'teacher', 10, 'A', 'CERTIFICATION');
  expect(prisma.form_submission.create).not.toHaveBeenCalled();

  // B can select A's course, but must obtain new documents for B.
  await (service as any).processParticipant(prisma, 13, participant, 'teacher-b', 11, 'B', 'CERTIFICATION');
  expect(prisma.form_submission.create).toHaveBeenCalledTimes(2);
  for (const [args] of prisma.form_submission.create.mock.calls) {
    expect(args.data).toMatchObject({ instructorId: 11, licenseId: 20, participantUserId: 'student' });
  }
  schedule.instructorId = 'teacher-b';
  let result = await service.getScheduleDetail(12, 'teacher-b');
  expect(result.schedule?.participants[0]).toMatchObject({ waiverSigned: false, medicalSigned: false });

  // After submitting to B, B's later lessons reuse only B's documents.
  records.push(...['liability', 'medical'].map(formId => ({
    formId, participantUserId: 'student', instructorId: 11, licenseId: 20,
    status: 'submitted', uuid: `b-${formId}`,
  })));
  prisma.form_submission.create.mockClear();
  await (service as any).processParticipant(prisma, 14, participant, 'teacher-b', 11, 'B', 'CERTIFICATION');
  expect(prisma.form_submission.create).not.toHaveBeenCalled();
  result = await service.getScheduleDetail(12, 'student');
  expect(result.schedule?.participants[0]).toMatchObject({
    waiverSigned: true, medicalSigned: true, waiverUuid: 'b-liability', medicalUuid: 'b-medical',
  });
  schedule.instructorId = 'teacher';
  result = await service.getScheduleDetail(12, 'teacher');
  expect(result.schedule?.participants[0]).toMatchObject({ waiverUuid: 'previous-liability', medicalUuid: 'previous-medical' });
});

it('lists all active courses for the selected student, regardless of the registering instructor', async () => {
  const { service, prisma } = fixture();
  const courses = [
    { id: 100, userId: 'student', instructorId: 'teacher-a', status: 'IN_PROGRESS' },
    { id: 101, userId: 'student', instructorId: 'teacher-b', status: 'IN_PROGRESS' },
    { id: 102, userId: 'student', instructorId: 'teacher-a', status: 'COMPLETED' },
    { id: 103, userId: 'someone-else', instructorId: 'teacher-a', status: 'IN_PROGRESS' },
  ].map(course => ({ ...course, licenseId: 20, license: { code: 'AIDA3', association: { name: 'AIDA' } } }));
  prisma.user_license.findMany.mockImplementation(async ({ where }) => courses.filter(course =>
    Object.entries(where).every(([key, value]) => course[key] === value),
  ));
  const result = await service.getInProgressLicenses(2);
  expect(result.licenses.map(license => license.userLicenseId)).toEqual([100, 101]);
  expect(prisma.user_license.findMany.mock.calls[0][0].where).toEqual({ userId: 'student', status: 'IN_PROGRESS' });
});
