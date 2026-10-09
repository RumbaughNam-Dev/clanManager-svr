const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const code = ts.transpileModule(fs.readFileSync('src/allblue/notices.service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
const exportsObject = {};
vm.runInNewContext(code, { exports: exportsObject, require: name => name === '@nestjs/common' ? { Injectable: () => value => value, BadRequestException: Error, ForbiddenException: Error, NotFoundException: Error } : {} });
const { NoticesService, validateNotice } = exportsObject;
const dates = { createdAt: new Date('2026-10-09T01:00:00Z'), updatedAt: new Date('2026-10-09T02:00:00Z') };
let detailRow = null;
let level = 'A', changed = [], query, rows = [], count = 1;
const db = { user: { findUnique: async () => ({ nickname: 'admin', profile: { level } }) }, notice: {
  findMany: async args => { query = args; return rows; }, findFirst: async () => detailRow,
  create: async args => { changed.push(args); return { id: 1, ...dates }; }, updateMany: async args => { changed.push(args); return { count }; },
} };
const input = { title: ' Title ', content: ' Body\nText ', pinned: true, popup: true };
(async () => {
  const service = new NoticesService(db);
  for (const body of [null, {}, {...input,title:' '}, {...input,content:'x'.repeat(20001)}, {...input,popup:'false'}]) assert.throws(() => validateNotice(body));
  level = '5';
  for (const fn of [() => service.create('u', input), () => service.update(1,'u',input), () => service.remove(1,'u')]) await assert.rejects(fn, /관리자/);
  assert.equal(changed.length, 0); level = 'A';
  await service.create('u', {...input,authorName:'forged'}); assert.equal(changed[0].data.authorName, 'admin'); assert.equal(changed[0].data.title, 'Title');
  await service.remove(1,'u'); assert.equal(changed[1].data.deleted,true); assert.equal(changed[1].where.deleted,false);
  count = 0; await assert.rejects(() => service.update(1,'u',input), /찾을 수/); await assert.rejects(() => service.detail(1,'u'), /찾을 수/);
  rows = Array.from({length:31},(_,id)=>({id, ...dates})); const list = await service.list('u',30);
  assert.equal(list.notices.length,30); assert.equal(list.hasMore,true); assert.equal(query.orderBy[0].pinned,'desc'); assert.equal(query.where.deleted,false); assert.equal(query.skip,30);
  await assert.rejects(() => service.list('u',-1));
  rows = [{id:1,title:'A',content:'B'}]; const popup = await service.popups();
  assert.equal(query.where.popup,true); assert.equal(query.where.deleted,false); assert.equal(popup.items[0].kind,'notice'); assert.equal(popup.items[0].id,'notice:1');
  detailRow = { id: 1, ...dates }; rows = [detailRow];
  const interceptorExports = {};
  const interceptorCode = ts.transpileModule(fs.readFileSync('src/common/interceptors/bigint-serializer.interceptor.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(interceptorCode, { exports: interceptorExports, require: name => name === '@nestjs/common' ? { Injectable: () => value => value } : { map: fn => fn } });
  const interceptor = new interceptorExports.BigIntSerializerInterceptor();
  for (const notice of [(await service.list('u',0)).notices[0], (await service.detail(1,'u')).notice, (await service.create('u',input)).notice]) {
    const wire = interceptor.intercept({}, { handle: () => ({ pipe: transform => transform({ notice }) }) });
    assert.equal(wire.notice.createdAt, dates.createdAt.toISOString());
    assert.equal(wire.notice.updatedAt, dates.updatedAt.toISOString());
  }
  console.log('Notice dates survive the actual global response serializer for list, detail and create.');
  console.log('Notice service checks passed: validation, admin authorization, author integrity, pinned ordering, pagination, soft deletion, popup filtering.');
})().catch(error => { console.error(error); process.exitCode=1; });
