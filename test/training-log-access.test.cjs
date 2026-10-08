const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');

// Exercise the actual service methods without booting Nest or connecting to a database.
const source = readFileSync(require('node:path').join(__dirname, '../src/allblue/allblue.service.ts'), 'utf8');
function method(name) {
  const start = source.search(new RegExp(`^  (?:private )?async ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const tail = source.slice(start + 1);
  const end = tail.search(/^  (?:private )?async /m);
  return source.slice(start, end < 0 ? undefined : start + 1 + end);
}
class ForbiddenException extends Error {}
const context = { ForbiddenException };
const methods = ['getDivingLogStudentIds', 'assertDivingLogAccess', 'getUserAchievements', 'getUserDebriefings', 'toggleAchievement'];
vm.runInNewContext(stripTypeScriptTypes(`class Service { ${methods.map(method).join('\n')} };globalThis.Service = Service;`), context);

function matches(value, where) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return condition.some(c => matches(value, c));
    const actual = value?.[key];
    if (condition === null || typeof condition !== 'object') return actual === condition;
    if (condition instanceof Date || Object.prototype.toString.call(condition) === '[object Date]') return +actual === +condition;
    if ('in' in condition) return condition.in.includes(actual);
    if ('not' in condition) return actual !== condition.not;
    if ('lt' in condition) return actual < condition.lt;
    if ('lte' in condition) return actual <= condition.lte;
    return matches(actual, condition);
  });
}
function fixture({ level = '5', status = 'accepted', category = 'CERTIFICATION', overall = 'CERTIFICATION', days = -1, owner = 'teacher', history = true } = {}) {
  const yesterday = new Date(Date.now() + days * 86400000);
  const rows = history ? [{ userId: 'student', invitationStatus: status, categoryCode: category,
    schedule: { instructorId: owner, categoryCode: overall, scheduleDate: yesterday, startHour: 0, startMinute: 0 } }] : [];
  let reads = 0;
  const service = new context.Service();
  service.assertTemporaryUserAccess = async () => {};
  service.prisma = {
    user: { findUnique: async ({ where }) => where.userId ? { profile: { level } } :
      where.id === 1 ? { userId: 'teacher' } : where.id === 2 ? { userId: 'student' } : null },
    schedule_participant: { findMany: async ({ where }) => rows.filter(row => matches(row, where)) },
    user_license: { findMany: async () => { reads++; return []; } },
    user_license_achievement: { findMany: async () => { reads++; return []; }, findUnique: async () => { reads++; return null; } },
    debriefing: { findMany: async () => { reads++; return []; } },
  };
  return { service, reads: () => reads };
}
for (const level of ['5', 'A']) {
  test(`training owner ${level} can read logs before the session starts`, async () => {
    const f = fixture({ level, category: 'TRAINING', days: 1 });
    assert.ok((await f.service.getDivingLogStudentIds('teacher', true)).has('student'));
    assert.equal((await f.service.getUserAchievements(2, 1)).licenses.length, 0);
    assert.equal((await f.service.getUserDebriefings(2, 1, 10, 1)).debriefings.length, 0);
  });
}
for (const [name, options] of [
  ['non instructor', { level: '0' }],
  ['other schedule owner', { owner: 'other' }],
  ['pending participant', { status: 'pending' }],
  ['rejected participant', { status: 'rejected' }],
  ['removed participant', { status: 'removed' }],
  ['personal fun dive overrides overall training', { category: 'FUN_DIVE', overall: 'TRAINING' }],
  ['future education remains restricted', { category: 'CERTIFICATION' }],
]) {
  test(`training log access denies ${name}`, async () => {
    const f = fixture({ category: 'TRAINING', days: 1, ...options });
    await assert.rejects(() => f.service.getUserAchievements(2, 1), ForbiddenException);
    await assert.rejects(() => f.service.getUserDebriefings(2, 1, 10, 1), ForbiddenException);
    assert.equal(f.reads(), 0);
  });
}
test('legacy participant uses schedule training category', async () => {
  const f = fixture({ category: null, overall: 'TRAINING', days: 1 });
  assert.ok((await f.service.getDivingLogStudentIds('teacher', true)).has('student'));
  await f.service.getUserAchievements(2, 1);
});
test('training relationship does not grant achievement editing', async () => {
  const f = fixture({ category: 'TRAINING', days: 1 });
  await assert.rejects(() => f.service.assertDivingLogAccess(1, 2, false), ForbiddenException);
});
test('existing past education and self log access remain available', async () => {
  await fixture().service.getUserAchievements(2, 1);
  await fixture({ level: '0', history: false }).service.getUserAchievements(2, 2);
});
