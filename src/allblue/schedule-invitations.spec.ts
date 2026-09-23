import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AllblueService } from './allblue.service';

function fixture() {
  const participant: any = { id: 1, scheduleId: 12, userId: 'student', invitationStatus: 'pending', invitationToken: 'token-1', licenses: [] };
  const notifications: any[] = [{ id: 1, senderId: 'teacher', receiverId: 'student', scheduleId: 12, invitationToken: 'token-1', readAt: null, deletedAt: null }];
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'user') return value.id === 2;
    if (value && typeof value === 'object') {
      return (!('not' in value) || row[key] !== value.not) && (!('lt' in value) || row[key] < value.lt) &&
        (!('gt' in value) || row[key] > value.gt) && (!('lte' in value) || row[key] <= value.lte) && (!('in' in value) || value.in.includes(row[key]));
    }
    return row[key] === value;
  });
  const prisma: any = {
    schedule: { findUnique: jest.fn().mockResolvedValue({ id: 12, title: 'Course', instructorId: 'teacher', scheduleDate: new Date() }), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 12, instructorId: 'teacher', scheduleDate: new Date() }) },
    user: { findUnique: jest.fn().mockResolvedValue({ userId: 'teacher', nickname: 'Teacher', profile: { level: '5' } }) },
    user_license: { updateMany: jest.fn() },
    schedule_participant: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => matches(participant, where) ? participant : null),
      findFirstOrThrow: jest.fn().mockResolvedValue(participant),
      findMany: jest.fn().mockResolvedValue([{ userId: 'student' }]),
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        if (!matches(participant, where)) return { count: 0 };
        Object.assign(participant, data); return { count: 1 };
      }),
    },
    app_notification: {
      create: jest.fn().mockImplementation(async ({ data }) => { const row = { id: notifications.length + 1, readAt: null, deletedAt: null, ...data }; notifications.push(row); return row; }),
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        const rows = notifications.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
      }),
      count: jest.fn().mockImplementation(async ({ where }) => notifications.filter(row => matches(row, where)).length),
      findMany: jest.fn().mockImplementation(async ({ where, orderBy, take }) => notifications.filter(row => matches(row, where)).sort((a, b) => orderBy?.id === 'asc' ? a.id - b.id : b.id - a.id).slice(0, take)),
    },
    $transaction: jest.fn(async callback => callback(prisma)),
  };
  const push = { sendPushNotifications: jest.fn().mockResolvedValue({ success: false, error: 'NO_TOKENS' }) };
  const service = Object.assign(Object.create(AllblueService.prototype), { prisma, push, updateDiveBuddies: jest.fn() }) as AllblueService;
  return { service, prisma, participant, notifications, push };
}

it('only the current recipient can accept; repeated or old-token responses are rejected', async () => {
  const { service, participant, notifications, prisma } = fixture();
  await expect(service.respondToSchedule(12, 'someone-else', 'accept', 'token-1')).rejects.toThrow(ConflictException);
  await expect(service.respondToSchedule(12, 'student', 'accept', 'expired-token')).rejects.toThrow(ConflictException);
  expect(participant.invitationStatus).toBe('pending');
  await service.respondToSchedule(12, 'student', 'accept', 'token-1');
  expect(participant.invitationStatus).toBe('accepted');
  expect(notifications[0].readAt).toBeInstanceOf(Date);
  await expect(service.respondToSchedule(12, 'student', 'reject', 'token-1')).rejects.toThrow(ConflictException);
});

it('rejection is retained, resend rotates the token and persists a new sender/receiver notification even without push tokens', async () => {
  const { service, participant, notifications, push } = fixture();
  await service.respondToSchedule(12, 'student', 'reject', 'token-1');
  expect(participant.invitationStatus).toBe('rejected');
  await expect(service.manageScheduleInvitation(12, 2, 'outsider', 'resend')).rejects.toThrow(ForbiddenException);
  await service.manageScheduleInvitation(12, 2, 'teacher', 'resend');
  expect(participant.invitationStatus).toBe('pending');
  expect(participant.invitationToken).not.toBe('token-1');
  expect(notifications).toHaveLength(2);
  expect(notifications[1]).toMatchObject({ senderId: 'teacher', receiverId: 'student', scheduleId: 12, readAt: null });
  expect(push.sendPushNotifications).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['student'], data: { type: 'schedule', scheduleId: 12, notificationId: 2 } }));
  await expect(service.respondToSchedule(12, 'student', 'accept', 'token-1')).rejects.toThrow(ConflictException);
});

it('removing a rejected request preserves its notification and cannot remove accepted participants', async () => {
  const { service, participant, notifications } = fixture();
  await expect(service.manageScheduleInvitation(12, 2, 'teacher', 'remove')).rejects.toThrow(ConflictException);
  await service.respondToSchedule(12, 'student', 'reject', 'token-1');
  await service.manageScheduleInvitation(12, 2, 'teacher', 'remove');
  expect(participant.invitationStatus).toBe('removed');
  expect(notifications).toHaveLength(1);
});

it('isolates inbox/read/delete by recipient and permits soft deletion only after reading', async () => {
  const { service, notifications } = fixture();
  await service.readNotification(1, 'outsider');
  expect(notifications[0].readAt).toBeNull();
  await expect(service.hideNotification(1, 'student')).rejects.toThrow(BadRequestException);
  expect((await service.listNotifications('outsider', {})).items).toEqual([]);
  expect((await service.listNotifications('student', {})).unreadCount).toBe(1);
  await service.readNotification(1, 'student');
  expect((await service.listNotifications('student', {})).items).toEqual([]);
  expect((await service.listNotifications('student', { all: 'true' })).items).toHaveLength(1);
  await service.hideNotification(1, 'student');
  expect(notifications[0].deletedAt).toBeInstanceOf(Date);
  expect((await service.listNotifications('student', { all: 'true' })).items).toEqual([]);
  expect(notifications).toHaveLength(1);
});

it('pages both ways in stable groups of ten and excludes newly arrived rows above the snapshot ceiling', async () => {
  const { service, notifications } = fixture();
  const template = notifications[0];
  for (let id = 2; id <= 75; id++) notifications.push({ ...template, id });
  const first = await service.listNotifications('student', {});
  expect(first.items.map(x => x.id)).toEqual([75,74,73,72,71,70,69,68,67,66]);
  notifications.push({ ...template, id: 76 });
  const older = await service.listNotifications('student', { before: '66', ceiling: '75' });
  expect(older.items.map(x => x.id)).toEqual([65,64,63,62,61,60,59,58,57,56]);
  const newer = await service.listNotifications('student', { after: '65', ceiling: '75' });
  expect(newer.items.map(x => x.id)).toEqual(first.items.map(x => x.id));
  expect(newer.hasMore).toBe(false);
  expect((await service.listNotifications('student', { before: '6' })).hasMore).toBe(false);
});

it.each(['EXPERIENCE', 'CERTIFICATION', 'LECTURE'])('restricts %s to instructors on the server', async category => {
  const { service, prisma } = fixture();
  prisma.user.findUnique.mockResolvedValue({ profile: { level: '4' } });
  await expect((service as any).requireTeachingAccess('student', [category])).rejects.toThrow(ForbiddenException);
  await expect((service as any).requireTeachingAccess('student', ['TRAINING', 'FUN_DIVE'])).resolves.toBeUndefined();
  prisma.user.findUnique.mockResolvedValue({ profile: { level: '5' } });
  await expect((service as any).requireTeachingAccess('teacher', [category])).resolves.toBeUndefined();
});
