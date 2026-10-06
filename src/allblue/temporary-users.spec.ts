import { AllblueService } from './allblue.service';
import { AllblueJwtAuthGuard } from './allblue-jwt-auth.guard';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';

const temporary = { id: 23, userId: 'temporary-test', nickname: '동명이인', isTemporary: true, temporaryOwnerId: 10,
  temporaryOwner: { userId: 'teacher' }, status: 'approved' };
function fixture() {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(temporary), findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 23, ...data })) },
    schedule_participant: { create: jest.fn().mockImplementation(async ({ data }) => ({ id: 50, ...data })),
      update: jest.fn().mockImplementation(async ({ data }) => ({ id: 50, ...data })), findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ schedule: { instructorId: 'teacher', categoryCode: 'LECTURE' } }) },
    schedule_participant_license: { deleteMany: jest.fn(), createMany: jest.fn() },
    form_submission: { findMany: jest.fn().mockResolvedValue([{ formId: 'liability' }, { formId: 'medical' }]), createMany: jest.fn() },
    user_license: { findMany: jest.fn().mockResolvedValue([]) },
    app_notification: { create: jest.fn() },
    debriefing: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    dive_buddy: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
  };
  prisma.$queryRaw = jest.fn().mockResolvedValue([]);
  prisma.$transaction = async fn => fn(prisma);
  const service: any = Object.assign(Object.create(AllblueService.prototype), { prisma });
  return { service, prisma };
}
it('creates distinct name-only identities; never merges equal names or stores a phone', async () => {
  const { service, prisma } = fixture();
  const a = await service.createTemporaryUser(' 동명이인 ', 10);
  const b = await service.createTemporaryUser('동명이인', 10);
  expect(a.user.userId).not.toBe(b.user.userId);
  expect(a.user).toMatchObject({ nickname: '동명이인', isTemporary: true });
  expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ temporaryOwnerId: 10, profile: { create: { level: '0' } } });
  expect(prisma.user.create.mock.calls[0][0].data.phone).toBeUndefined();
});
it.each([null, '', '   ', '가'.repeat(51)])('rejects invalid temporary name %p', async name => {
  const { service, prisma } = fixture();
  await expect(service.createTemporaryUser(name, 10)).rejects.toThrow(BadRequestException);
  expect(prisma.user.create).not.toHaveBeenCalled();
});
it('limits search to regular users and the viewer’s temporary users', async () => {
  const { service, prisma } = fixture();
  prisma.user.findMany.mockResolvedValue([temporary]);
  const result = await service.searchUsers('동명', 10);
  expect(prisma.user.findMany.mock.calls[0][0].where.AND[1]).toEqual({ OR: [{ isTemporary: false }, { temporaryOwnerId: 10 }] });
  expect(result.users[0].isTemporary).toBe(true);
});
it('accepts the owner’s temporary participant immediately without an invitation', async () => {
  const { service, prisma } = fixture();
  await service.processParticipant(prisma, 1, { userId: 23, categoryCode: 'LECTURE' }, 'teacher', 10, '강사', 'LECTURE');
  expect(prisma.schedule_participant.create.mock.calls[0][0].data).toMatchObject({ userId: 'temporary-test', invitationStatus: 'accepted', invitationToken: null });
  expect(prisma.app_notification.create).not.toHaveBeenCalled();
  expect(prisma.form_submission.createMany.mock.calls[0][0].data).toHaveLength(2);
  expect(prisma.form_submission.createMany.mock.calls[0][0].data[0].participantUserId).toBe('temporary-test');
});
it('retains the same participant and signed form identities when editing', async () => {
  const { service, prisma } = fixture();
  await service.processParticipant(prisma, 1, { userId: 23, categoryCode: 'LECTURE' }, 'teacher', 10, '강사', 'LECTURE', [], { id: 50, invitationStatus: 'accepted' });
  expect(prisma.schedule_participant.update.mock.calls[0][0].where).toEqual({ id: 50 });
  expect(prisma.schedule_participant.create).not.toHaveBeenCalled();
  expect(prisma.form_submission.createMany).not.toHaveBeenCalled();
});
it('rejects another creator’s temporary participant even if its ID is known', async () => {
  const { service, prisma } = fixture();
  await expect(service.processParticipant(prisma, 1, { userId: 23 }, 'other', 11, '', 'LECTURE')).rejects.toThrow(ForbiddenException);
  expect(prisma.schedule_participant.create).not.toHaveBeenCalled();
});
it.each(['getProfileByUserId', 'getInProgressLicenses', 'getAvailableLicenses'])('protects temporary profile/license endpoint %s', async method => {
  const { service } = fixture();
  const args = method === 'getProfileByUserId' ? ['temporary-test', 'other'] : method === 'getAvailableLicenses' ? [23, 1, 'other'] : [23, 'other'];
  await expect(service[method](...args)).rejects.toThrow(ForbiddenException);
});
it('allows owner debriefing creation and retrieval through the ordinary user ID', async () => {
  const { service, prisma } = fixture();
  prisma.user.findUnique.mockImplementation(async ({ where }) => where.id === 10 ? { userId: 'teacher', profile: { level: '5' } } : temporary);
  service.getDivingLogStudentIds = jest.fn().mockResolvedValue(new Set(['temporary-test']));
  await service.createDebriefing({ scheduleId: 1, participantId: 23, content: '기록' }, 10);
  expect(prisma.debriefing.create.mock.calls[0][0].data).toMatchObject({ participantId: 23, createdBy: 10 });
  await service.getUserDebriefings(23, 1, 10, 10);
  expect(prisma.debriefing.findMany.mock.calls[0][0].where).toEqual({ participantId: 23 });
});
it('does not create a buddy relationship exposing the temporary user to other attendees', async () => {
  const { service, prisma } = fixture();
  prisma.user.findMany.mockResolvedValue([temporary]);
  await service.updateDiveBuddies(prisma, 1, new Date(), 'teacher', ['temporary-test', 'other']);
  const pairs = prisma.dive_buddy.upsert.mock.calls.map(([arg]) => [arg.create.userId, arg.create.buddyId]);
  expect(pairs).toContainEqual(['teacher', 'temporary-test']);
  expect(pairs).not.toContainEqual(['other', 'temporary-test']);
  expect(pairs.some(([id]) => id === 'temporary-test')).toBe(false);
});
it('rejects password login for a temporary identity', async () => {
  const { service } = fixture();
  expect(await service.login('temporary-test', 'NO_LOGIN')).toMatchObject({ success: false });
});
it('rejects a validly signed JWT for a temporary identity', async () => {
  const { prisma } = fixture();
  const guard = new AllblueJwtAuthGuard({ get: () => 'test-secret' } as any, prisma);
  const token = jwt.sign({ userId: temporary.userId, sub: '23' }, 'test-secret');
  await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) } as any)).rejects.toThrow(UnauthorizedException);
});
it('rejects a license belonging to a different participant', async () => {
  const { service, prisma } = fixture();
  await expect(service.processParticipant(prisma, 1, { userId: 23, userLicenseIds: [99] }, 'teacher', 10, '', 'LECTURE')).rejects.toThrow(BadRequestException);
});

it('uses the same user ID for temporary student progress and diving-log retrieval', async () => {
  const { service, prisma } = fixture();
  prisma.user.findUnique.mockImplementation(async ({ where }) => where.id === 10 ? { userId: 'teacher', profile: { level: '5' } } : temporary);
  service.getDivingLogStudentIds = jest.fn().mockResolvedValue(new Set(['temporary-test']));
  prisma.user_license_achievement = { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() };
  await service.toggleAchievement({ requirementId: 7, userId: 23, completed: true }, 10);
  expect(prisma.user_license_achievement.create.mock.calls[0][0].data).toMatchObject({ userId: 23, completedBy: 10, requirementId: 7 });
  await service.getUserAchievements(23, 10);
  expect(prisma.user_license.findMany.mock.calls[0][0].where).toEqual({ userId: 'temporary-test' });
  expect(prisma.user_license_achievement.findMany.mock.calls[0][0].where).toEqual({ userId: 23 });
});

it('deletes creator-owned temporary identities in the same withdrawal transaction', async () => {
  const { service, prisma } = fixture();
  prisma.$transaction = async fn => fn(prisma);
  prisma.$queryRaw = jest.fn().mockResolvedValue([{ id: 10 }]);
  prisma.user.findMany.mockResolvedValue([temporary]);
  service.deleteUserData = jest.fn();
  expect(await service.withdraw('teacher', 10)).toEqual({ success: true });
  expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ isTemporary: true, temporaryOwnerId: 10 });
  expect(service.deleteUserData.mock.calls.map(([, user, id]) => [user.id, id])).toEqual([[23, 'temporary-test'], [10, 'teacher']]);
});
