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
    where: { userId: 'student', instructorId: 'teacher', id: { in: [100] } },
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
