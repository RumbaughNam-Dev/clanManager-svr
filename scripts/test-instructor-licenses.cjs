const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/allblue/allblue.service.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText, { exports: exportsObject, require: name => name === '@nestjs/common' ? { Injectable: () => value => value } : {} });
const catalog = [
  { id: 4, levelOrder: 4, isInstructor: 0 },
  { id: 5, levelOrder: 5, isInstructor: 1 },
  { id: 6, levelOrder: 5, isInstructor: 1, code: 'AIDA-YOUTH-INST' },
  { id: 7, levelOrder: 5, isInstructor: 1, code: 'AIDA-INST-TRAINER' },
  { id: 8, levelOrder: 5, isInstructor: 1, code: 'AIDA-MASTER-INST' },
];
let held = [5];
const service = Object.assign(Object.create(exportsObject.AllblueService.prototype), {
  assertTemporaryUserAccess: async () => {},
  prisma: {
    user: { findUnique: async () => ({ userId: 'teacher' }) },
    user_license: { findMany: async () => held.map(id => ({ licenseId: id, license: catalog.find(l => l.id === id) })) },
    license: { findMany: async ({ where }) => {
      assert.equal(where.associationId, 1);
      return catalog.filter(l => !where.id.notIn.includes(l.id) && where.OR.some(condition =>
        condition.levelOrder ? l.levelOrder > condition.levelOrder.gt : l.isInstructor === condition.isInstructor));
    } },
  },
});
(async () => {
  assert.equal(JSON.stringify((await service.getAvailableLicenses(1, 1)).licenses.map(l => l.licenseId)), '[6,7,8]');
  held = [5, 6, 7, 8];
  assert.equal((await service.getAvailableLicenses(1, 1)).licenses.length, 0);
  console.log('Instructor course selection passed: same-level qualifications remain available, held qualifications and lower diver courses excluded.');
})().catch(error => { console.error(error); process.exitCode = 1; });
