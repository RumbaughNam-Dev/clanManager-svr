import { AllblueService } from './allblue.service';

const participant = (levels: number[], overrides = {}) => ({
  userId: 'student', invitationStatus: 'accepted', categoryCode: 'CERTIFICATION',
  user: { nickname: 'Student', profile: { level: '0' } },
  licenses: levels.map(levelOrder => ({ userLicense: { license: { levelOrder, isInstructor: 0 } } })),
  ...overrides,
});

async function monthly(participants: ReturnType<typeof participant>[]) {
  const prisma = {
    schedule: { findMany: jest.fn().mockResolvedValue([{
      id: 1, title: 'Course', scheduleDate: new Date(2026, 9, 8), categoryCode: 'CERTIFICATION',
      instructor: { nickname: 'Instructor', profile: { level: '5' } }, participants,
    }]) },
    common_code: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = Object.assign(Object.create(AllblueService.prototype), { prisma });
  const result = await service.getMonthlySchedules('2026', '10', 'owner');
  expect(prisma.schedule.findMany.mock.calls[0][0].include.participants.include.licenses).toBeDefined();
  return result.schedules[0];
}

it('uses the lowest enrolled course across participants and associations, not held qualifications', async () => {
  const result = await monthly([participant([4, 3]), participant([2])]);
  expect(result.minCourseLevel).toBe(2);
  expect(result.minLevel).toBe('0');
});

it('ignores removed/rejected students and non-certification participation', async () => {
  const result = await monthly([
    participant([4]), participant([2], { invitationStatus: 'rejected' }),
    participant([2], { invitationStatus: 'removed' }), participant([2], { categoryCode: 'TRAINING' }),
  ]);
  expect(result.minCourseLevel).toBe(4);
});

it('includes pending course invitations and inherited schedule categories', async () => {
  expect((await monthly([participant([3], { invitationStatus: 'pending', categoryCode: null })])).minCourseLevel).toBe(3);
});

it('normalizes instructor courses to level 5', async () => {
  const licenses = [{ userLicense: { license: { levelOrder: 8, isInstructor: 1 } } }];
  expect((await monthly([participant([], { licenses })])).minCourseLevel).toBe(5);
});

it('does not substitute held levels for missing courses', async () => {
  expect((await monthly([participant([])])).minCourseLevel).toBeNull();
});
