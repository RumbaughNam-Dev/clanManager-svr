// Run after compiling to link-test-dist, against an explicitly provisioned empty test DB.
// This file never reads the application's database environment variable.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/allblue-client');
const { TemporaryUserLinkService } = require('../link-test-dist/allblue/temporary-user-link.service');
const { lockTemporaryUser } = require('../link-test-dist/allblue/temporary-user-lock');
const { AllblueService } = require('../link-test-dist/allblue/allblue.service');
const url = new URL(process.env.ALLBLUE_LINK_TEST_DATABASE_URL || '');
assert.equal(url.hostname, '127.0.0.1', 'Only an isolated loopback database is allowed');
assert.match(url.pathname, /_link_test$/);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const config = { get: (name, fallback) => name === 'JWT_SECRET' ? 'isolated-test-secret' : fallback };
const links = new TemporaryUserLinkService(db, config);
const app = Object.assign(Object.create(AllblueService.prototype), { prisma: db, config });
const stamp = randomUUID().slice(0, 8);
let count = 0;
const passed = label => { count++; console.log(`PASS ${label}`); };
const user = (name, extra = {}) => db.user.create({ data: { userId: `${stamp}-${name}`, nickname: name,
  userName: name, password: 'NO_LOGIN_TEST', status: 'approved', ...extra } });
const schedule = (actor, title) => db.schedule.create({ data: { title, scheduleDate: new Date('2026-09-01'),
  startHour: 10, startMinute: 0, categoryCode: 'EDUCATION', instructorId: actor.userId } });
const participant = (s, u, extra = {}) => db.schedule_participant.create({ data: {
  scheduleId: s.id, userId: u.userId, invitationStatus: 'accepted', categoryCode: 'LECTURE', ...extra } });
const preview = (s, source, target, actor) => links.preview(s.id, source.id, target.id, actor.id);
const commit = (s, source, target, actor, p) => links.link(s.id, source.id, target.id, actor.id, p.confirmationToken);
const rejectsStatus = (promise, status) => assert.rejects(promise, e => e.getStatus?.() === status);

async function run() {
  const actor = await user('teacher'), target = await user('member', { phone: '01012345678' }), stranger = await user('stranger');
  const source = await user('temporary', { isTemporary: true, temporaryOwnerId: actor.id });
  const first = await schedule(actor, 'source only'), duplicate = await schedule(actor, 'duplicate');
  const p1 = await participant(first, source), p2 = await participant(duplicate, source);
  const p3 = await participant(duplicate, target, { invitationStatus: 'rejected', categoryCode: 'TRAINING', invitationToken: 'existing-token' });
  const association = await db.association.create({ data: { code: stamp, name: 'Test association' } });
  const license = await db.license.create({ data: { associationId: association.id, name: 'Test course', levelOrder: 1 } });
  const course = (u, extra = {}) => db.user_license.create({ data: { userId: u.userId, licenseId: license.id, instructorId: actor.userId, ...extra } });
  const c1 = await course(source, { status: 'COMPLETED', certificateNumber: 'ABC', completedAt: new Date('2026-09-01') });
  const c2 = await course(target);
  const c3 = await course(source, { instructorId: stranger.userId });
  const c4 = await course(source, { certificateNumber: 'DIFFERENT' });
  for (const [p, c] of [[p1, c1], [p2, c1], [p3, c2], [p1, c3], [p2, c4]]) {
    await db.schedule_participant_license.create({ data: { scheduleParticipantId: p.id, userLicenseId: c.id } });
  }
  const requirement = await db.license_requirement.create({ data: { licenseId: license.id, reqGroup: 'WATER', reqType: 'SKILL', name: 'Test skill' } });
  await db.user_license_achievement.create({ data: { userId: source.id, requirementId: requirement.id, isCompleted: 1, completedBy: actor.id, completedAt: new Date('2026-09-01') } });
  const achievement = await db.user_license_achievement.create({ data: { userId: target.id, requirementId: requirement.id, isCompleted: 0 } });
  const form = await db.form_submission.create({ data: { uuid: randomUUID(), instructorId: actor.id, formId: 'medical', diverName: 'Original signed name',
    signatureData: 'ORIGINAL_SIGNATURE', checkboxData: { private: true }, status: 'completed', scheduleId: first.id, participantUserId: source.userId } });
  const detachedForm = await db.form_submission.create({ data: { uuid: randomUUID(), instructorId: actor.id, formId: 'medical', diverName: 'Detached original', participantUserId: source.userId } });
  const debrief = await db.debriefing.create({ data: { scheduleId: first.id, participantId: source.id, createdBy: actor.id, content: 'PRIVATE ORIGINAL CONTENT' } });
  await db.close_friend.create({ data: { userId: actor.userId, friendId: source.userId, memo: 'source-private', pinned: 1 } });
  const friend = await db.close_friend.create({ data: { userId: actor.userId, friendId: target.userId, memo: 'target-private' } });
  const group = await db.friend_group.create({ data: { userId: actor.userId, name: 'Test group' } });
  for (const u of [source, target]) await db.friend_group_member.create({ data: { groupId: group.id, userId: u.userId } });
  await db.dive_buddy.create({ data: { userId: actor.userId, buddyId: source.userId, lastDiveDate: new Date('2026-09-20'), scheduleId: first.id } });
  const buddy = await db.dive_buddy.create({ data: { userId: actor.userId, buddyId: target.userId, lastDiveDate: new Date('2026-08-01'), scheduleId: duplicate.id } });
  await db.blocked_user.create({ data: { userId: stranger.userId, blockedId: source.userId } });

  await rejectsStatus(links.targets(first.id, source.id, stranger.id, 'member'), 403);
  assert.deepEqual(await links.targets(first.id, source.id, actor.id, ''), { users: [] });
  const candidates = await links.targets(first.id, source.id, actor.id, 'member');
  assert.equal(candidates.users.find(u => u.id === target.id).phoneHint, '010-xxxx-5678');
  assert.ok(!JSON.stringify(candidates).includes('0101234'));
  await db.blocked_user.create({ data: { userId: target.userId, blockedId: actor.userId } });
  await rejectsStatus(preview(first, source, target, actor), 403);
  await db.blocked_user.deleteMany({ where: { userId: target.userId, blockedId: actor.userId } });
  passed('ownership, empty search, masked phone and blocked account checks');

  const old = await preview(first, source, target, actor);
  assert.deepEqual(old.counts, { schedules: 2, forms: 2, debriefings: 1, courses: 3, achievements: 1 });
  assert.deepEqual(old.duplicates, { schedules: 1, courses: 1, achievements: 1, contacts: 3 });
  assert.ok(!JSON.stringify(old).includes('ORIGINAL_SIGNATURE'));
  await db.debriefing.update({ where: { id: debrief.id }, data: { content: 'UPDATED PRIVATE CONTENT', updatedAt: new Date(Date.now() + 1000) } });
  await rejectsStatus(commit(first, source, target, actor, old), 409);
  assert.equal((await db.schedule_participant.findUnique({ where: { id: p1.id } })).userId, source.userId);
  passed('stale preview rejected without partial updates');

  const confirmed = await preview(first, source, target, actor);
  const result = await commit(first, source, target, actor, confirmed);
  assert.equal(result.success, true);
  assert.equal((await db.schedule_participant.findUnique({ where: { id: p1.id } })).userId, target.userId);
  assert.equal(await db.schedule_participant.findUnique({ where: { id: p2.id } }), null);
  assert.deepEqual(await db.schedule_participant.findUnique({ where: { id: p3.id } }), p3);
  assert.equal(await db.user_license.findUnique({ where: { id: c1.id } }), null);
  assert.equal((await db.user_license.findUnique({ where: { id: c2.id } })).status, 'COMPLETED');
  for (const c of [c3, c4]) assert.equal((await db.user_license.findUnique({ where: { id: c.id } })).userId, target.userId);
  assert.equal(await db.schedule_participant_license.count({ where: { scheduleParticipantId: { in: [p1.id, p3.id] } } }), 4);
  const movedAchievement = await db.user_license_achievement.findUnique({ where: { id: achievement.id } });
  assert.equal(movedAchievement.isCompleted, 1); assert.equal(movedAchievement.completedBy, actor.id);
  const movedForm = await db.form_submission.findUnique({ where: { id: form.id } });
  for (const key of ['uuid', 'diverName', 'signatureData', 'checkboxData', 'status', 'createdAt']) assert.deepEqual(movedForm[key], form[key]);
  assert.equal(movedForm.participantUserId, target.userId);
  assert.equal((await db.form_submission.findUnique({ where: { id: detachedForm.id } })).participantUserId, target.userId);
  const movedDebrief = await db.debriefing.findUnique({ where: { id: debrief.id } });
  assert.equal(movedDebrief.participantId, target.id); assert.equal(movedDebrief.content, 'UPDATED PRIVATE CONTENT');
  assert.equal(movedDebrief.createdBy, actor.id);
  assert.equal((await db.close_friend.findUnique({ where: { id: friend.id } })).memo, 'target-private\nsource-private');
  assert.equal((await db.dive_buddy.findUnique({ where: { id: buddy.id } })).scheduleId, first.id);
  assert.equal(await db.friend_group_member.count({ where: { groupId: group.id } }), 1);
  assert.equal(await db.blocked_user.count({ where: { userId: stranger.userId, blockedId: target.userId } }), 1);
  passed('all record transfers, duplicate constraints, signed form preservation and completion authors');

  const audit = await db.temporary_user_link_audit.findUnique({ where: { sourceId: source.id } });
  assert.equal(audit.actorId, actor.id); assert.equal(audit.targetId, target.id);
  assert.ok(audit.details.changes.some(c => c.table === 'close_friend' && c.before.memo === 'source-private'));
  assert.ok(!JSON.stringify(audit).includes('UPDATED PRIVATE CONTENT'));
  assert.ok(!JSON.stringify(audit).includes('ORIGINAL_SIGNATURE'));
  for (const viewer of [actor, target]) {
    const history = await links.history(first.id, viewer.id);
    assert.equal(history.items.length, 1);
    assert.ok(!JSON.stringify(history).includes('source-private'));
    assert.ok(!JSON.stringify(history).includes('existing-token'));
    assert.equal((await links.history(duplicate.id, viewer.id)).items.length, 1);
  }
  const targetHistory = await links.history(first.id, target.id);
  assert.ok(!JSON.stringify(targetHistory.items[0].details.changes.filter(c => c.table === 'blocked_user')).includes(stranger.userId));
  assert.equal((await links.history(first.id, stranger.id)).items.length, 0);
  assert.equal((await commit(first, source, target, actor, confirmed)).auditId, result.auditId);
  assert.equal(await db.temporary_user_link_audit.count({ where: { sourceId: source.id } }), 1);
  assert.equal((await db.user.findUnique({ where: { id: source.id } })).temporaryLinkedToId, target.id);
  await rejectsStatus(db.$transaction(tx => lockTemporaryUser(tx, { id: source.id })), 409);
  assert.equal((await app.searchUsers('temporary', actor.id)).users.some(u => u.id === source.id), false);
  const detail = await app.getScheduleDetail(first.id, target.userId);
  assert.equal(detail.schedule.id, first.id);
  const debriefs = await app.getUserDebriefings(target.id, 1, 20, target.id);
  assert.ok(JSON.stringify(debriefs).includes('UPDATED PRIVATE CONTENT'));
  passed('auditable authorized history, private fields hidden, idempotence, source disabled and member reads');

  const rollbackSource = await user('rollback', { isTemporary: true, temporaryOwnerId: actor.id });
  const rollbackSchedule = await schedule(actor, 'rollback');
  const rollbackParticipant = await participant(rollbackSchedule, rollbackSource);
  const rollbackPreview = await preview(rollbackSchedule, rollbackSource, target, actor);
  const failingDb = new Proxy(db, { get(client, key) {
    if (key !== '$transaction') return Reflect.get(client, key);
    return (fn, options) => client.$transaction(tx => fn(new Proxy(tx, { get(transaction, model) {
      if (model === 'temporary_user_link_audit') return new Proxy(transaction[model], { get(delegate, operation) {
        return operation === 'create' ? async () => { throw new Error('injected audit storage failure'); } : Reflect.get(delegate, operation);
      } });
      return Reflect.get(transaction, model);
    } })), options);
  } });
  const failingLinks = new TemporaryUserLinkService(failingDb, config);
  await assert.rejects(failingLinks.link(rollbackSchedule.id, rollbackSource.id, target.id, actor.id, rollbackPreview.confirmationToken), /injected audit/);
  assert.equal((await db.schedule_participant.findUnique({ where: { id: rollbackParticipant.id } })).userId, rollbackSource.userId);
  assert.equal((await db.user.findUnique({ where: { id: rollbackSource.id } })).temporaryLinkedAt, null);
  assert.equal(await db.temporary_user_link_audit.count({ where: { sourceId: rollbackSource.id } }), 0);
  passed('audit failure rolls back every ownership change');

  const otherTarget = await user('other-member');
  const raceSource = await user('race', { isTemporary: true, temporaryOwnerId: actor.id });
  const raceSchedule = await schedule(actor, 'race'); await participant(raceSchedule, raceSource);
  const a = await preview(raceSchedule, raceSource, target, actor), b = await preview(raceSchedule, raceSource, otherTarget, actor);
  const racing = await Promise.allSettled([commit(raceSchedule, raceSource, target, actor, a), commit(raceSchedule, raceSource, otherTarget, actor, b)]);
  assert.equal(racing.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(racing.map(r => r.status === 'rejected' ? { code: r.reason.code, message: r.reason.message } : r.value)));
  assert.equal(racing.filter(r => r.status === 'rejected' && r.reason.getStatus?.() === 409).length, 1,
    JSON.stringify(racing.map(r => r.status === 'rejected' ? { code: r.reason.code, message: r.reason.message, meta: r.reason.meta } : r.value)));
  assert.equal(await db.temporary_user_link_audit.count({ where: { sourceId: raceSource.id } }), 1);
  const retry = await preview(rollbackSchedule, rollbackSource, target, actor);
  await commit(rollbackSchedule, rollbackSource, target, actor, retry);
  assert.ok(await db.temporary_user_link_audit.count({ where: { targetId: target.id } }) >= 2);
  passed('concurrent targets have one winner, multiple temporary identities can link to one member');

  const repeatedSource = await user('repeated-courses', { isTemporary: true, temporaryOwnerId: actor.id });
  const repeatedTarget = await user('repeated-member');
  const repeatedSchedule = await schedule(actor, 'repeated courses');
  const repeatedParticipant = await participant(repeatedSchedule, repeatedSource);
  const originalCourse = await course(repeatedSource), duplicateCourse = await course(repeatedSource);
  // Reverse link creation order must not trigger a unique-key collision.
  for (const c of [duplicateCourse, originalCourse]) await db.schedule_participant_license.create({ data: { scheduleParticipantId: repeatedParticipant.id, userLicenseId: c.id } });
  const repeatedPreview = await preview(repeatedSchedule, repeatedSource, repeatedTarget, actor);
  await commit(repeatedSchedule, repeatedSource, repeatedTarget, actor, repeatedPreview);
  assert.equal(await db.user_license.count({ where: { userId: repeatedTarget.userId } }), 1);
  const courseLinks = await db.schedule_participant_license.findMany({ where: { scheduleParticipantId: repeatedParticipant.id } });
  assert.equal(courseLinks.length, 1); assert.equal(courseLinks[0].userLicenseId, originalCourse.id);
  passed('multiple source courses deduplicate safely with reverse link creation order');
  console.log(`${count} integration scenarios passed; database=${url.pathname.slice(1)}`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
