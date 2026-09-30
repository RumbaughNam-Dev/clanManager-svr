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
for (const [name, options] of [
  ['unqualified schedule creator', { level: '0' }],
  ['certified non-instructor', { level: '4' }],
  ['instructor with no lessons', { history: false }],
  ['pending invitation', { status: 'pending' }],
  ['rejected invitation', { status: 'rejected' }],
  ['removed participant', { status: 'removed' }],
  ['future lesson', { days: 1 }],
  ['another instructor lesson', { owner: 'other' }],
  ['personal fun dive in education schedule', { category: 'FUN_DIVE' }],
  ['legacy training category', { category: null, overall: 'TRAINING' }],
]) {
  test(`rejects ${name} at both direct log endpoints and achievement writes`, async () => {
    const f = fixture(options);
    await assert.rejects(() => f.service.getUserAchievements(2, 1), ForbiddenException);
    await assert.rejects(() => f.service.getUserDebriefings(2, 1, 10, 1), ForbiddenException);
    await assert.rejects(() => f.service.toggleAchievement({ userId: 2, requirementId: 3, completed: true }, 1), ForbiddenException);
    assert.equal(f.reads(), 0, 'No private log data should be queried');
  });
}
for (const [name, options] of [
  ['accepted past lesson', {}],
  ['personal lecture in a training schedule', { category: 'LECTURE', overall: 'TRAINING' }],
  ['legacy education category', { category: null }],
]) {
  test(`allows instructor with ${name}`, async () => {
    const f = fixture(options);
    assert.equal((await f.service.getUserAchievements(2, 1)).licenses.length, 0);
    assert.equal((await f.service.getUserDebriefings(2, 1, 10, 1)).debriefings.length, 0);
    assert.equal(f.reads(), 3);
  });
}
test('allows own log without instructor qualification', async () => {
  const f = fixture({ level: '0', history: false });
  await f.service.getUserAchievements(2, 2);
  await f.service.getUserDebriefings(2, 1, 10, 2);
  assert.equal(f.reads(), 3);
});
test('fails closed when a caller ID is missing', async () => {
  const f = fixture();
  await assert.rejects(() => f.service.getUserDebriefings(2, 1, 10), ForbiddenException);
  assert.equal(f.reads(), 0);
});
