import { AllblueService } from './allblue.service';

const accepted = (userId: string) => ({ userId, invitationStatus: 'accepted' });
function fixture() {
  const schedules = [
    { id: 1, scheduleDate: new Date('2026-10-08'), startHour: 22, startMinute: 0, instructorId: 'viewer', participants: [accepted('past'), accepted('both'), { userId: 'pending', invitationStatus: 'pending' }, accepted('blocked')] },
    { id: 2, scheduleDate: new Date('2026-10-09'), startHour: 9, startMinute: 59, instructorId: 'teacher', participants: [accepted('viewer'), accepted('today')] },
    { id: 3, scheduleDate: new Date('2026-10-09'), startHour: 10, startMinute: 1, instructorId: 'viewer', participants: [accepted('future'), accepted('both')] },
    { id: 4, scheduleDate: new Date('2026-10-10'), startHour: 0, startMinute: 0, instructorId: 'viewer', participants: [accepted('tomorrow')] },
    { id: 5, scheduleDate: new Date('2026-10-08'), startHour: 12, startMinute: 0, instructorId: 'stranger', participants: [{ userId: 'viewer', invitationStatus: 'pending' }] },
  ];
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every(w => matches(row, w));
    if (key === 'OR') return value.some(w => matches(row, w));
    if (value instanceof Date) return +row[key] === +value;
    if (value && typeof value === 'object') {
      if ('some' in value) return row[key].some(p => matches(p, value.some));
      if ('lt' in value) return row[key] < value.lt;
      if ('not' in value) return row[key] !== value.not;
    }
    return row[key] === value;
  });
  const prisma = {
    blocked_user: { findMany: jest.fn().mockResolvedValue([{ blockedId: 'blocked' }]) },
    schedule: { findMany: jest.fn(async query => schedules.filter(s => matches(s, query.where))
      .sort((a, b) => +b.scheduleDate - +a.scheduleDate || b.startHour - a.startHour || b.startMinute - a.startMinute)
      .map(s => ({ ...s, participants: s.participants.filter(p => matches(p, query.select.participants.where)) }))) },
    user: { findMany: jest.fn(async query => query.where.userId.in.map(userId => ({ userId, nickname: userId, isTemporary: false }))) },
  };
  const service = Object.assign(Object.create(AllblueService.prototype), { prisma }) as AllblueService;
  return { service, prisma, schedules };
}

afterEach(() => jest.restoreAllMocks());
it('uses past Korean-local start times, keeping past companions even if they also have future bookings', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-09T01:00:00Z'));
  const { service, prisma } = fixture();
  const result = await service.getBuddies('viewer', 1, 50);
  expect(result.buddies.map(b => b.userId)).toEqual(['teacher', 'today', 'past', 'both']);
  expect(result.buddies.find(b => b.userId === 'both')?.lastDiveDate).toBe('2026-10-08');
  expect(prisma.user.findMany.mock.calls[0][0].where.OR).toEqual([{ isTemporary: false }, { temporaryOwner: { userId: 'viewer' } }]);
});
it('adds a scheduled companion only after the start instant has passed', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-09T01:01:00Z'));
  const { service } = fixture();
  expect((await service.getBuddies('viewer', 1, 50)).buddies.some(b => b.userId === 'future')).toBe(false);
  clock.mockReturnValue(Date.parse('2026-10-09T01:01:01Z'));
  expect((await service.getBuddies('viewer', 1, 50)).buddies.some(b => b.userId === 'future')).toBe(true);
});
it('paginates after excluding ineligible schedules and users', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-09T01:00:00Z'));
  const { service } = fixture();
  const first = await service.getBuddies('viewer', 1, 2);
  const second = await service.getBuddies('viewer', 2, 2);
  expect(first.buddies.map(b => b.userId)).toEqual(['teacher', 'today']);
  expect(second.buddies.map(b => b.userId)).toEqual(['past', 'both']);
  expect(first.hasMore).toBe(true);
  expect(second.hasMore).toBe(false);
});
