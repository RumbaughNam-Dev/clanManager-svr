const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const output = {};
const source = ts.transpileModule(fs.readFileSync('src/allblue/allblue.service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
vm.runInNewContext(source, { exports: output, require: name => name === '@nestjs/common' ? { Injectable: () => value => value, BadRequestException: Error, ForbiddenException: Error, ConflictException: Error } : {} });
const { AllblueService } = output;
let existing = null, written, claimed = 1;
const license = { id: 9, name: 'AIDA 4', nameKo: null, levelOrder: 4, isInstructor: 0 };
const request = { id: 7, userId: 2, status: 'pending', imageUrl: 'https://example.com/cert.jpg' };
const tx = {
  cert_request: { findUnique: async () => request, updateMany: async () => ({ count: claimed }) },
  license: { findUnique: async () => license },
  user: { findUnique: async () => ({ id: 2, userId: 'diver', profile: { level: '4' } }) },
  user_license: { findFirst: async () => existing, create: async args => { written = args.data; }, update: async args => { written = args.data; } },
  user_profile: { upsert: async () => {} },
};
const service = Object.assign(Object.create(AllblueService.prototype), { prisma: { ...tx, $transaction: fn => fn(tx) } });
(async () => {
  assert.equal((await service.approveCertRequest(7, 9)).success, true);
  assert.equal(written.certRequestId, 7);
  const completedAt = new Date('2026-01-01'); existing = { id: 5, completedAt };
  await service.approveCertRequest(7, 9); assert.equal(written.certRequestId, 7); assert.equal(written.completedAt, completedAt);
  claimed = 0; written = null; await service.approveCertRequest(7, 9); assert.equal(written, null);
  for (const [status, owner, image, expected] of [['approved', 2, 'cert.jpg', 'cert.jpg'], ['pending', 2, 'cert.jpg', undefined], ['approved', 3, 'cert.jpg', undefined], ['approved', 2, '', undefined]]) {
    service.prisma.user.findUnique = async () => ({ id: 2, userId: 'diver', profile: null, licenses: [{ license, certRequest: { ...request, status, userId: owner, imageUrl: image } }] });
    assert.equal((await service.getProfile(2)).certifications[0].imageUrl, expected);
    assert.equal((await service.getProfile(2, false)).certifications[0].imageUrl, undefined);
  }
  service.prisma.user.findUnique = async () => ({ id: 2, userId: 'diver', profile: null, licenses: [{ license, certRequest: null }, { license, certRequest: { ...request, status: 'approved' } }, { license, certRequest: null }] });
  const profile = await service.getProfile(2);
  assert.equal(profile.certifications.length, 1); assert.equal(profile.certifications[0].imageUrl, request.imageUrl);
  console.log('Certificate checks passed: new/existing approval linkage, concurrency guard, approved owner-only image visibility, legacy records and duplicate courses.');
})().catch(error => { console.error(error); process.exitCode = 1; });
