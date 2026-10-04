import { DemoAuthService } from './demo-auth.service';
import { AllblueJwtAuthGuard } from './allblue-jwt-auth.guard';
import { AllblueController } from './allblue.controller';
import * as bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const secret = 'unit-test-signing-secret-not-for-production';
let hash: string;
beforeAll(async () => { hash = await bcrypt.hash('review-code', 4); });
function fixture(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { ALLBLUE_DEMO_USER_ID: 'demo-review', ALLBLUE_DEMO_CODE_HASH: hash, JWT_SECRET: secret, ...overrides };
  const user = { id: 42, userId: 'demo-review', nickname: '데모 다이버', userType: 'instructor', status: 'approved', profile: { level: '0' } };
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user), create: jest.fn().mockResolvedValue(user) } };
  return { service: new DemoAuthService(prisma as any, { get: (key: string) => values[key] } as any), prisma, user };
}
it('issues a short-lived token only for the server-selected account', async () => {
  const { service, prisma } = fixture();
  const result = await service.login('review-code', 'client');
  const claims = jwt.verify(result.token, secret) as jwt.JwtPayload;
  expect(claims).toMatchObject({ sub: '42', userId: 'demo-review', userType: 'instructor', demo: true });
  expect(claims.exp! - claims.iat!).toBe(86400);
  expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { userId: 'demo-review' }, include: { profile: true } });
  expect(result.user).toMatchObject({ id: '42', demo: true });
  expect(result).not.toHaveProperty('password');
});
it.each([undefined, null, {}, '', 'wrong', 'x'.repeat(129)])('rejects invalid credentials before querying an account: %p', async (code) => {
  const { service, prisma } = fixture();
  await expect(service.login(code, 'client')).rejects.toMatchObject({ status: 401 });
  expect(prisma.user.findUnique).not.toHaveBeenCalled();
});
it.each(['ALLBLUE_DEMO_USER_ID', 'ALLBLUE_DEMO_CODE_HASH', 'JWT_SECRET'])('fails closed without %s', async (key) => {
  const { service } = fixture({ [key]: undefined });
  await expect(service.login('review-code', 'client')).rejects.toMatchObject({ status: 503 });
});
it.each([{ status: 'suspended' }, { userType: 'admin' }, { profile: { level: 'A' } }, { googleId: 'real-google-user' }])('refuses unsafe or inactive demo accounts: %p', async (overrides) => {
  const { service, prisma, user } = fixture();
  prisma.user.findUnique.mockResolvedValue({ ...user, ...overrides } as any);
  await expect(service.login('review-code', 'client')).rejects.toMatchObject({ status: 503 });
});
it('rate-limits repeated attempts and permits retry after the window', async () => {
  const { service } = fixture();
  const time = jest.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    for (let i = 0; i < 10; i++) await expect(service.login('wrong', 'client')).rejects.toMatchObject({ status: 401 });
    await expect(service.login('review-code', 'client')).rejects.toMatchObject({ status: 429 });
    time.mockReturnValue(61001);
    await expect(service.login('review-code', 'client')).resolves.toHaveProperty('token');
  } finally { time.mockRestore(); }
});
it('protects the shared account while preserving ordinary account operations', () => {
  const service = { withdraw: jest.fn(), registerPushToken: jest.fn(), updateProfile: jest.fn() };
  const controller = new AllblueController(service as any);
  const demo = { user: { sub: '42', userId: 'demo-review', demo: true } };
  controller.withdraw(demo);
  expect(service.withdraw).toHaveBeenCalledWith('demo-review', 42);
  expect(() => controller.updateProfile(demo, { level: 'A' })).toThrow('권한');
  controller.registerPushToken({ token: 'device' }, demo);
  expect(service.registerPushToken).toHaveBeenCalledWith('demo-review', 'device');
  const ordinary = { user: { sub: '1', userId: 'ordinary' } };
  controller.withdraw(ordinary);
  controller.registerPushToken({ token: 'device' }, ordinary);
  expect(service.withdraw).toHaveBeenCalledWith('ordinary', undefined);
  expect(service.registerPushToken).toHaveBeenCalledWith('ordinary', 'device');
});

it('recreates a deleted demo account with a new identity and inaccessible password', async () => {
  const { service, prisma, user } = fixture();
  prisma.user.findUnique.mockResolvedValue(null as any);
  prisma.user.create.mockResolvedValue({ ...user, id: 43 });
  const result = await service.login('review-code', 'client');
  expect(result.user.id).toBe('43');
  const data = prisma.user.create.mock.calls[0][0].data;
  expect(data).toMatchObject({ userId: 'demo-review', userType: 'instructor', status: 'approved', profile: { create: { level: '5' } } });
  expect(await bcrypt.compare('review-code', data.password)).toBe(false);
});
it('reuses the account created by a concurrent valid login', async () => {
  const { service, prisma, user } = fixture();
  prisma.user.findUnique.mockResolvedValueOnce(null as any).mockResolvedValueOnce(user);
  prisma.user.create.mockRejectedValue({ code: 'P2002' });
  await expect(service.login('review-code', 'client')).resolves.toHaveProperty('user.id', '42');
});
it('rejects old demo sessions after deletion and recreation', async () => {
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 43, status: 'approved' }) } };
  const guard = new AllblueJwtAuthGuard({ get: () => secret } as any, prisma as any);
  const token = jwt.sign({ sub: '42', userId: 'demo-review', demo: true }, secret);
  const context = { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) };
  await expect(guard.canActivate(context as any)).rejects.toMatchObject({ status: 401 });
  prisma.user.findUnique.mockResolvedValue(null as any);
  await expect(guard.canActivate(context as any)).rejects.toMatchObject({ status: 401 });
  prisma.user.findUnique.mockResolvedValue({ id: 42, status: 'approved' });
  await expect(guard.canActivate(context as any)).resolves.toBe(true);
});
