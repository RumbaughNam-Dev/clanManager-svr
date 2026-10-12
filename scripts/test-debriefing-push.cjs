// Run with TYPESCRIPT_PATH pointing to an installed TypeScript module if needed.
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const output = {};
const source = ts.transpileModule(fs.readFileSync('src/allblue/allblue.service.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;
vm.runInNewContext(source, {
  exports: output, console: { error() {} },
  require: name => name === '@nestjs/common'
    ? { Injectable: () => value => value, ForbiddenException: Error }
    : name === './temporary-user-lock' ? { lockTemporaryUser: async () => {} } : {},
});

function fixture(options = {}) {
  const events = [], sent = [], saved = [];
  const author = { userId: 'teacher', nickname: '바다', profile: { level: options.level || '5' } };
  const recipient = { userId: 'student', isTemporary: !!options.temporary };
  const prisma = {
    user: { findUnique: async ({ where }) => where.id === 10 ? author : recipient },
    schedule_participant: { findFirst: async ({ where }) => {
      assert.equal(where.invitationStatus, 'accepted');
      assert.equal(where.user.id, 23);
      return options.missingParticipant ? null : {
        categoryCode: options.category || 'CERTIFICATION',
        schedule: { instructorId: options.owner || 'teacher', categoryCode: 'CERTIFICATION' },
      };
    } },
    debriefing: { create: async ({ data }) => {
      if (options.saveFails) throw Error('save failed');
      saved.push(data); events.push('save');
    } },
    $transaction: async fn => {
      const result = await fn(prisma);
      if (options.commitFails) throw Error('commit failed');
      events.push('commit'); return result;
    },
  };
  const service = Object.assign(Object.create(output.AllblueService.prototype), {
    prisma,
    assertTemporaryUserAccess: async () => {},
    push: { sendPushNotifications: async message => {
      events.push('push'); sent.push(JSON.parse(JSON.stringify(message)));
      if (options.pushFails) throw Error('delivery failed');
      return { success: true };
    } },
  });
  return { service, events, sent, saved };
}
const body = { scheduleId: 42, participantId: 23, content: '  이퀄라이징 연습  ' };
(async () => {
  for (const category of ['EXPERIENCE', 'CERTIFICATION', 'LECTURE', 'TRAINING']) {
    const f = fixture({ category });
    assert.equal((await f.service.createDebriefing(body, 10)).success, true);
    assert.deepEqual(f.events, ['save', 'commit', 'push']);
    assert.deepEqual(f.sent, [{ userIds: ['student'], title: '디브리핑 등록',
      body: '바다 강사님이 디브리핑을 작성했어요. 눌러서 확인해주세요.',
      data: { type: 'schedule', scheduleId: 42 } }]);
    assert.equal(f.saved[0].content, '이퀄라이징 연습');
  }
  for (const options of [{ owner: 'someone-else' }, { level: '4' }, { missingParticipant: true }, { category: 'FUN' }, { saveFails: true }, { commitFails: true }]) {
    const f = fixture(options);
    await assert.rejects(() => f.service.createDebriefing(body, 10));
    assert.equal(f.sent.length, 0);
  }
  const temporary = fixture({ temporary: true });
  await temporary.service.createDebriefing(body, 10);
  assert.equal(temporary.saved.length, 1);
  assert.equal(temporary.sent.length, 0);
  const failedPush = fixture({ pushFails: true });
  const result = await failedPush.service.createDebriefing(body, 10);
  assert.equal(JSON.stringify(result), '{"success":true}');
  assert.equal(failedPush.saved.length, 1);
  const invalid = fixture();
  assert.equal((await invalid.service.createDebriefing({ ...body, scheduleId: 0 }, 10)).success, false);
  assert.equal(invalid.sent.length, 0);
  console.log('Debriefing push checks passed: recipient/message/route, categories, authorization, commit ordering, rollback, temporary users, delivery failure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
