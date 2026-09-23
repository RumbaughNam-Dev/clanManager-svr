import { AllblueService } from './allblue.service';

function fixture() {
  const schedule = {
    id: 12, title: 'Training', instructorId: 'owner', visibility: 'public',
    scheduleDate: new Date('2026-09-14'), categoryCode: 'TRAINING',
    instructor: { nickname: 'Owner' },
    participants: [{ userId: 'other', user: { id: 3, nickname: 'Other', profile: { level: '2' } }, licenses: [] }],
    formSubmissions: [{ formId: 'medical', participantUserId: 'other', uuid: 'private-document', status: 'submitted' }],
  };
  const prisma = {
    schedule: { findUnique: jest.fn().mockResolvedValue(schedule), findFirst: jest.fn().mockResolvedValue({ id: 12 }) },
    schedule_participant: { findMany: jest.fn().mockResolvedValue([{ schedule: { instructorId: 'owner' } }]) },
    close_friend: { findMany: jest.fn().mockResolvedValue([{ friendId: 'other', userId: 'other' }]) },
    friend_group: { findUnique: jest.fn().mockResolvedValue({ userId: 'viewer' }) },
    friend_group_member: { findMany: jest.fn().mockResolvedValue([{ userId: 'owner' }]) },
    common_code: { findUnique: jest.fn().mockResolvedValue(null) },
    debriefing: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = Object.assign(Object.create(AllblueService.prototype), { prisma }) as AllblueService;
  return { service, prisma };
}

it.each(['instructor', 'closeFriend', 'group_7'])('allows a schedule visible through %s without exposing documents', async (filter) => {
  const { service, prisma } = fixture();
  const result = await service.getScheduleDetail(12, 'viewer', filter);
  expect(result.schedule?.id).toBe(12);
  expect(result.schedule?.isOwner).toBe(false);
  expect(result.schedule?.participants[0].nickname).toBe('Other');
  expect(result.schedule?.participants[0].medicalUuid).toBeNull();
  expect(JSON.stringify(result)).not.toContain('private-document');
  const where = prisma.schedule.findFirst.mock.calls[0][0].where;
  expect(where.id).toBe(12);
  if (filter === 'instructor') {
    expect(where.visibility).toBe('public');
    expect(where.instructorId).toEqual({ in: ['owner'] });
    expect(where.instructor.profile.level.in).toContain('5');
  } else if (filter === 'closeFriend') {
    expect(where.OR[1].participants.some.userId.in).toEqual(['other']);
    expect(where.OR[1].participants.some.invitationStatus).toBe('accepted');
  } else {
    expect(where.visibility).toBe('public');
    expect(where.instructorId.in).toEqual(['owner']);
  }
});

it('denies a schedule outside the selected scope', async () => {
  const { service, prisma } = fixture();
  prisma.schedule.findFirst.mockResolvedValue(null);
  expect((await service.getScheduleDetail(12, 'viewer', 'instructor')).statusCode).toBe(403);
});

it('denies another user\'s group before querying schedule access', async () => {
  const { service, prisma } = fixture();
  prisma.friend_group.findUnique.mockResolvedValue({ userId: 'someone-else' });
  expect((await service.getScheduleDetail(12, 'viewer', 'group_7')).statusCode).toBe(403);
  expect(prisma.schedule.findFirst).not.toHaveBeenCalled();
});

it('preserves owner access without a social filter', async () => {
  const { service, prisma } = fixture();
  const result = await service.getScheduleDetail(12, 'owner');
  expect(result.schedule?.isOwner).toBe(true);
  expect(result.schedule?.participants[0].medicalUuid).toBe('private-document');
  expect(prisma.schedule.findFirst).not.toHaveBeenCalled();
});
