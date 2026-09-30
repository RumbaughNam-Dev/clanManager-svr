import { AllblueService } from './allblue.service';

function fixture(level = '4') {
  const tx = {
    cert_request: {
      findUnique: jest.fn().mockResolvedValue({ id: 1, userId: 2, status: 'pending' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    license: { findUnique: jest.fn().mockResolvedValue({ id: 9, levelOrder: 4, isInstructor: 0 }) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 2, userId: 'diver', profile: { level } }) },
    user_license: {
      findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn(),
    },
    user_profile: { upsert: jest.fn() },
    user_setting: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn) => fn(tx)) };
  const service = Object.assign(Object.create(AllblueService.prototype), { prisma }) as AllblueService;
  return { service, tx, prisma };
}

it('returns only completed database certifications, without duplicate qualifications', async () => {
  const { service, tx } = fixture();
  const license = { id: 9, name: 'PADI Master Freediver', nameKo: 'PADI 마스터 프리다이버' };
  tx.user.findUnique.mockResolvedValue({ id: 2, userId: 'diver', profile: null, licenses: [{ license }, { license }] } as any);
  const result = await service.getProfile(2);
  expect(result.certifications).toEqual([license]);
  expect((tx.user.findUnique.mock.calls[0] as any)[0].select.licenses.where).toEqual({ status: 'COMPLETED' });
});

it('does not guess certifications from a legacy level', async () => {
  const { service, tx } = fixture();
  tx.user.findUnique.mockResolvedValue({ id: 2, userId: 'diver', profile: { level: '5' }, licenses: [] } as any);
  expect((await service.getProfile(2)).certifications).toEqual([]);
});

it('records the selected qualification as completed when approving', async () => {
  const { service, tx } = fixture();
  expect(await service.approveCertRequest(1, 9)).toEqual({ success: true });
  expect(tx.user_license.create).toHaveBeenCalledWith({ data: {
    userId: 'diver', licenseId: 9, status: 'COMPLETED', completedAt: expect.any(Date),
  } });
  expect(tx.user_profile.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { level: '4' } }));
});

it('completes an existing course without replacing its completion date', async () => {
  const { service, tx } = fixture();
  const completedAt = new Date('2026-01-01');
  tx.user_license.findFirst.mockResolvedValue({ id: 10, completedAt } as never);
  await service.approveCertRequest(1, 9);
  expect(tx.user_license.create).not.toHaveBeenCalled();
  expect(tx.user_license.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { status: 'COMPLETED', completedAt } });
});

it.each(['5', 'A'])('preserves higher level or admin access (%s)', async (level) => {
  const { service, tx } = fixture(level);
  await service.approveCertRequest(1, 9);
  expect(tx.user_profile.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { level } }));
});

it('sets instructor access from the selected database qualification', async () => {
  const { service, tx } = fixture('2');
  tx.license.findUnique.mockResolvedValue({ id: 10, levelOrder: 5, isInstructor: 1 });
  await service.approveCertRequest(1, 10);
  expect(tx.user_profile.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { level: '5' } }));
  expect(tx.user_setting.create).toHaveBeenCalled();
});

it('rejects legacy level-only approval without changing data', async () => {
  const { service, prisma } = fixture();
  expect((await service.approveCertRequest(1, undefined as any)).success).toBe(false);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it('does not grant a qualification when a concurrent approval already handled the request', async () => {
  const { service, tx } = fixture();
  tx.cert_request.updateMany.mockResolvedValue({ count: 0 });
  expect((await service.approveCertRequest(1, 9)).success).toBe(false);
  expect(tx.user_license.create).not.toHaveBeenCalled();
  expect(tx.user_profile.upsert).not.toHaveBeenCalled();
});

it('rejects a nonexistent qualification before changing the request', async () => {
  const { service, tx } = fixture();
  tx.license.findUnique.mockResolvedValue(null as any);
  expect((await service.approveCertRequest(1, 999)).success).toBe(false);
  expect(tx.cert_request.updateMany).not.toHaveBeenCalled();
});
