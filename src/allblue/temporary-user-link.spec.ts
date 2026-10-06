import { TemporaryUserLinkController } from './temporary-user-link.controller';
import { PATH_METADATA } from '@nestjs/common/constants';
import { buildLinkPlan, maskLinkPhone, TemporaryUserLinkService } from './temporary-user-link.service';
import { lockTemporaryUser } from './temporary-user-lock';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import jwt from 'jsonwebtoken';

function data(): any {
  return { source: { id: 2, userId: 'temp' }, target: { id: 3, userId: 'member' },
    participants: [], courses: [], courseLinks: [], achievements: [], forms: [], debriefings: [], friends: [], groups: [], buddies: [], blocks: [] };
}
const course = (id: number, userId: string, overrides: any = {}) => ({ id, userId, licenseId: 10, instructorId: 'teacher', certificateNumber: null,
  status: 'IN_PROGRESS', startedAt: null, completedAt: null, ...overrides });

it('exposes only candidate, preview and link routes; audits have no app endpoint', () => {
  const prototype = TemporaryUserLinkController.prototype;
  const routes = Object.getOwnPropertyNames(prototype).filter(key => key !== 'constructor')
    .map(key => Reflect.getMetadata(PATH_METADATA, prototype[key]));
  expect(routes).toEqual([
    'schedule/:scheduleId/temporary-users/:sourceId/link-targets',
    'schedule/:scheduleId/temporary-users/:sourceId/link-preview',
    'schedule/:scheduleId/temporary-users/:sourceId/link',
  ]);
});

it('moves all nonduplicate records using both string and numeric identity keys', () => {
  const d = data();
  d.participants = [{ id: 1, userId: 'temp', scheduleId: 1 }];
  d.courses = [course(2, 'temp')];
  d.achievements = [{ id: 3, userId: 2, requirementId: 5, isCompleted: 1 }];
  d.forms = [{ id: 4, participantUserId: 'temp', uuid: 'signed' }];
  d.debriefings = [{ id: 5, participantId: 2 }];
  const { actions } = buildLinkPlan(d);
  expect(actions.find(a => a.table === 'schedule_participant')?.data).toEqual({ userId: 'member', invitationToken: null });
  expect(actions.find(a => a.table === 'form_submission')?.data).toEqual({ participantUserId: 'member' });
  expect(actions.find(a => a.table === 'form_submission')?.metadataOnly).toBe(true);
  expect(actions.find(a => a.table === 'debriefing')?.data).toEqual({ participantId: 3 });
  expect(actions.filter(a => a.action === 'delete')).toHaveLength(0);
});

it('keeps the destination schedule status/category and unions course links without duplicate keys', () => {
  const d = data();
  d.participants = [{ id: 1, userId: 'temp', scheduleId: 10, invitationStatus: 'accepted', categoryCode: 'LECTURE' },
    { id: 2, userId: 'member', scheduleId: 10, invitationStatus: 'rejected', categoryCode: 'TRAINING' }];
  d.courses = [course(20, 'temp', { status: 'COMPLETED', completedAt: new Date() }), course(21, 'member')];
  d.courseLinks = [{ id: 1, scheduleParticipantId: 1, userLicenseId: 20 }, { id: 2, scheduleParticipantId: 2, userLicenseId: 21 }];
  const plan = buildLinkPlan(d);
  expect(plan.duplicates).toMatchObject({ schedules: 1, courses: 1 });
  expect(plan.actions.some(a => a.table === 'schedule_participant' && a.action === 'update')).toBe(false);
  expect(plan.actions.find(a => a.table === 'schedule_participant_license')).toMatchObject({ id: 1, action: 'delete' });
  expect(plan.actions.find(a => a.table === 'user_license' && a.action === 'update')?.data.status).toBe('COMPLETED');
  expect(plan.actions.findIndex(a => a.table === 'schedule_participant_license')).toBeLessThan(plan.actions.findIndex(a => a.table === 'schedule_participant'));
});

it.each([{ instructorId: 'other' }, { certificateNumber: 'different' }])('preserves distinct instructor/certificate histories: %p', overrides => {
  const d = data(); d.courses = [course(1, 'temp', { certificateNumber: 'first' }), course(2, 'member', overrides)];
  expect(buildLinkPlan(d).duplicates.courses).toBe(0);
});

it('keeps an unchanged link key when two source courses merge regardless of link creation order', () => {
  const d = data();
  d.participants = [{ id: 1, userId: 'temp', scheduleId: 10 }];
  d.courses = [course(20, 'temp'), course(21, 'temp')];
  d.courseLinks = [{ id: 1, scheduleParticipantId: 1, userLicenseId: 21 }, { id: 2, scheduleParticipantId: 1, userLicenseId: 20 }];
  const { actions } = buildLinkPlan(d);
  const links = actions.filter(a => a.table === 'schedule_participant_license');
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({ id: 1, action: 'delete' });
});

it('keeps the original completion author and never downgrades a completed achievement', () => {
  const d = data(); d.achievements = [
    { id: 1, userId: 2, requirementId: 10, isCompleted: 1, completedBy: 4 },
    { id: 2, userId: 3, requirementId: 10, isCompleted: 1, completedBy: 5 },
    { id: 3, userId: 2, requirementId: 20, isCompleted: 1, completedBy: 4 },
    { id: 4, userId: 3, requirementId: 20, isCompleted: 0, completedBy: null },
  ];
  const { actions } = buildLinkPlan(d);
  expect(actions.some(a => a.id === 2)).toBe(false);
  expect(actions.find(a => a.id === 4)?.data.completedBy).toBe(4);
});

it('merges contact keys while keeping memos and the latest dive date', () => {
  const d = data();
  d.friends = [{ id: 1, userId: 'teacher', friendId: 'temp', memo: 'source memo', pinned: 1 },
    { id: 2, userId: 'teacher', friendId: 'member', memo: 'target memo', pinned: 0 }];
  d.buddies = [{ id: 3, userId: 'teacher', buddyId: 'temp', lastDiveDate: new Date('2026-10-01'), scheduleId: 2 },
    { id: 4, userId: 'teacher', buddyId: 'member', lastDiveDate: new Date('2026-09-01'), scheduleId: 1 }];
  d.groups = [{ id: 5, groupId: 1, userId: 'temp' }, { id: 6, groupId: 1, userId: 'member' }];
  const { actions } = buildLinkPlan(d);
  expect(actions.find(a => a.id === 2)?.data).toEqual({ pinned: 1, memo: 'target memo\nsource memo' });
  expect(actions.find(a => a.id === 4)?.data.scheduleId).toBe(2);
  expect(actions.find(a => a.id === 5)?.action).toBe('delete');
});

it('retains the complete old memo in the audit plan when the destination memo cannot fit both', () => {
  const d = data(); d.friends = [{ id: 1, userId: 'teacher', friendId: 'temp', memo: 'a'.repeat(200), pinned: 0 },
    { id: 2, userId: 'teacher', friendId: 'member', memo: 'b'.repeat(200), pinned: 0 }];
  const { actions } = buildLinkPlan(d);
  expect(actions.find(a => a.id === 2)?.data.memo).toHaveLength(200);
  expect(actions.find(a => a.id === 1)?.before.memo).toBe('a'.repeat(200));
});

it('checks ownership before returning candidate accounts', async () => {
  const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue({ id: 1, userId: 'other', isTemporary: false, status: 'approved' }), findMany: jest.fn() },
    schedule: { findUnique: jest.fn().mockResolvedValue({ instructorId: 'teacher' }) } };
  const service = new TemporaryUserLinkService(prisma, { get: () => undefined } as any);
  await expect(service.targets(1, 2, 3, 'name')).rejects.toThrow(ForbiddenException);
  expect(prisma.user.findMany).not.toHaveBeenCalled();
});

it('rejects an invalid confirmation token before any transaction', async () => {
  const prisma: any = { $transaction: jest.fn() };
  const service = new TemporaryUserLinkService(prisma, { get: () => 'secret' } as any);
  await expect(service.link(1, 2, 3, 4, 'invalid')).rejects.toThrow(ConflictException);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it('checks link state after taking the shared identity lock', async () => {
  const tx: any = { user: { findUnique: jest.fn().mockResolvedValue({ id: 2, isTemporary: true }) },
    $queryRaw: jest.fn().mockResolvedValue([{ temporary_linked_at: new Date() }]) };
  await expect(lockTemporaryUser(tx, { id: 2 })).rejects.toThrow(ConflictException);
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
});

it.each(['1020', '1205', '1213'])('returns a recheck conflict for database lock error %s', async code => {
  const prisma: any = { $transaction: jest.fn().mockRejectedValue({ code: 'P2010', meta: { code } }) };
  const token = jwt.sign({ purpose: 'temporary-user-link', scheduleId: 1, sourceId: 2, targetId: 3, actorId: 4 }, 'secret');
  const service = new TemporaryUserLinkService(prisma, { get: () => 'secret' } as any);
  await expect(service.link(1, 2, 3, 4, token)).rejects.toThrow(ConflictException);
});


it.each([
  ['01012345142', '010-****-5142'], ['010-1234-5142', '010-****-5142'],
  ['+82 10 1234 5142', '010-****-5142'], ['0111235142', '011-****-5142'],
  ['02-1234-5142', '02-****-5142'], [null, null], ['', null], ['5142', null],
])('masks a link candidate phone %s as %s', (input, expected) => {
  expect(maskLinkPhone(input)).toBe(expected);
});
