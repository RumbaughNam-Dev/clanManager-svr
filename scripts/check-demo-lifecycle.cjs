// Run against the release directory: creates only a uniquely named disposable test account.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/allblue-client');
const { ConfigService } = require('@nestjs/config');
const { DemoAuthService } = require('../dist/allblue/demo-auth.service');
const { AllblueService } = require('../dist/allblue/allblue.service');
const { AllblueJwtAuthGuard } = require('../dist/allblue/allblue-jwt-auth.guard');
async function main() {
 const prisma = new PrismaClient();
 const userId = `demo_check_${randomUUID().slice(0, 8)}`;
 const code = randomUUID();
 const config = new ConfigService({ ...process.env, ALLBLUE_DEMO_USER_ID: userId, ALLBLUE_DEMO_CODE_HASH: await bcrypt.hash(code, 4) });
 const auth = new DemoAuthService(prisma, config);
 const service = new AllblueService(prisma, config, {}, {});
 const guard = new AllblueJwtAuthGuard(config, prisma);
 const context = token => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) });
 try {
  const logins = await Promise.all([auth.login(code, 'one'), auth.login(code, 'two')]);
  const first = logins[0];
  assert.equal(first.user.id, logins[1].user.id);
  const id = Number(first.user.id);
  const schedule = await prisma.schedule.create({ data: { title: 'Disposable lifecycle check', scheduleDate: new Date('2026-10-04'), startHour: 12, startMinute: 0, categoryCode: 'TRAINING', instructorId: userId, visibility: 'private' } });
  await prisma.schedule_participant.create({ data: { scheduleId: schedule.id, userId } });
  await prisma.debriefing.create({ data: { scheduleId: schedule.id, participantId: id, createdBy: id, content: 'Disposable log' } });
  await prisma.close_friend.create({ data: { userId, friendId: userId } });
  await prisma.form_submission.create({ data: { uuid: randomUUID(), instructorId: id, formId: 'check', diverName: 'Test', participantUserId: userId, scheduleId: schedule.id } });
  await prisma.app_notification.create({ data: { senderId: userId, receiverId: userId, scheduleId: schedule.id, invitationToken: randomUUID(), title: 'Check', body: 'Check' } });
  await service.registerPushToken(userId, `lifecycle-check-${randomUUID()}`);
  assert.equal(await prisma.push_token.count({ where: { userId } }), 1);
  assert.equal(await guard.canActivate(context(first.token)), true);
  assert.deepEqual(await service.withdraw(userId, id), { success: true });
  await assert.rejects(guard.canActivate(context(first.token)), e => e.status === 401);
  for (const model of ['schedule_participant', 'close_friend', 'push_token']) assert.equal(await prisma[model].count({ where: { userId } }), 0);
  assert.equal(await prisma.schedule.count({ where: { instructorId: userId } }), 0);
  assert.equal(await prisma.debriefing.count({ where: { createdBy: id } }), 0);
  assert.equal(await prisma.form_submission.count({ where: { participantUserId: userId } }), 0);
  assert.equal(await prisma.app_notification.count({ where: { receiverId: userId } }), 0);
  const recreated = await auth.login(code, 'three');
  assert.notEqual(recreated.user.id, first.user.id);
  await assert.rejects(guard.canActivate(context(first.token)), e => e.status === 401);
  assert.equal(await guard.canActivate(context(recreated.token)), true);
  assert.equal((await service.withdraw(userId, id)).success, false);
  assert.equal(await prisma.user.count({ where: { userId } }), 1);
  console.log('PASS: concurrent creation, push registration, complete relational deletion, empty recreation, old-session and stale-deletion rejection');
 } finally {
  await service.withdraw(userId);
  await prisma.$disconnect();
 }
}
main().catch(e => { console.error(e.name, e.code || '', e.message); process.exitCode = 1; });
