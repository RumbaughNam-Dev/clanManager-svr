const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
function load(file, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => modules[name] || {} });
  return exports;
}
const badge = load('src/allblue/badge-level.ts');
const qualification = (levelOrder, isInstructor = 0) => ({ license: { levelOrder, isInstructor } });
assert.equal(badge.BADGE_PROFILE_SELECT.user.select.licenses.where.status, 'COMPLETED');
assert.equal(badge.badgeLevel({ level: 'A' }, []), '0');
assert.equal(badge.badgeLevel({ level: 'A' }, [qualification(2), qualification(4), qualification(3)]), '4');
assert.equal(badge.badgeLevel({ level: 'A' }, [qualification(2, 1), qualification(4)]), '5');
assert.equal(badge.badgeLevel({ level: 'A', user: { licenses: [qualification(3)] } }), '3');
assert.equal(badge.badgeLevel({ level: '3' }, [qualification(5)]), '3');
const { AllblueService } = load('src/allblue/allblue.service.ts', {
  './badge-level': badge, '@nestjs/common': { Injectable: () => value => value },
});
(async () => {
  const service = Object.assign(Object.create(AllblueService.prototype), { prisma: {
    user: { findUnique: async () => ({ id: 1, userId: 'admin', profile: { level: 'A' }, licenses: [qualification(4)] }) },
    close_friend: { findMany: async () => [{ friend: { userId: 'admin', profile: { level: 'A', user: { licenses: [qualification(2, 1)] } }, licenses: [] } }] },
  } });
  const profile = await service.getProfile(1);
  assert.equal(profile.profile.level, 'A');
  assert.equal(profile.profile.badgeLevel, '4');
  const friends = await service.getCloseFriends('viewer');
  assert.equal(friends.friends[0].level, 'A');
  assert.equal(friends.friends[0].badgeLevel, '5');
  console.log('Badge checks passed: completed qualifications, highest level, instructor, no qualifications, ordinary levels, profile/friends retain admin role.');
})().catch(error => { console.error(error); process.exitCode = 1; });
