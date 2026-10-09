import { NoticesService, validateNotice } from './notices.service';

const dates = { createdAt: new Date('2026-10-09T01:00:00Z'), updatedAt: new Date('2026-10-09T02:00:00Z') };
const input = { title: ' 공지 ', content: ' 내용\n두 번째 줄 ', pinned: true, popup: true };
function fixture(level = 'A') {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ nickname: '관리자', profile: { level } }) },
    notice: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 1, ...dates }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  return { prisma, service: new NoticesService(prisma as any) };
}
it('rejects non-admin writes without touching notices', async () => {
  const { service, prisma } = fixture('5');
  await expect(service.create('user', input)).rejects.toThrow('관리자');
  await expect(service.update(1, 'user', input)).rejects.toThrow('관리자');
  await expect(service.remove(1, 'user')).rejects.toThrow('관리자');
  expect(prisma.notice.create).not.toHaveBeenCalled();
  expect(prisma.notice.updateMany).not.toHaveBeenCalled();
});
it('validates required strings, limits and actual booleans', () => {
  for (const data of [null, {}, { ...input, title: ' ' }, { ...input, content: '' }, { ...input, title: 'x'.repeat(201) }, { ...input, content: 'x'.repeat(20001) }, { ...input, popup: 'false' }]) {
    expect(() => validateNotice(data)).toThrow();
  }
  expect(validateNotice(input)).toEqual({ ...input, title: '공지', content: '내용\n두 번째 줄' });
});
it('creates using the authenticated author and ignores forged metadata', async () => {
  const { service, prisma } = fixture();
  await service.create('admin', { ...input, authorName: 'fake', deleted: true });
  expect(prisma.notice.create).toHaveBeenCalledWith({ data: { title: '공지', content: '내용\n두 번째 줄', pinned: true, popup: true, authorId: 'admin', authorName: '관리자' } });
});
it('lists nondeleted notices pinned first, with stable newest ordering and pagination', async () => {
  const { service, prisma } = fixture('2');
  prisma.notice.findMany.mockResolvedValue(Array.from({ length: 31 }, (_, id) => ({ id, ...dates })) as never);
  const result = await service.list('user', 30);
  expect(result.notices).toHaveLength(30); expect(result.hasMore).toBe(true); expect(result.canManage).toBe(false);
  expect(prisma.notice.findMany).toHaveBeenCalledWith({ where: { deleted: false }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], skip: 30, take: 31 });
  await expect(service.list('user', -1)).rejects.toThrow();
});
it('popup feed includes only enabled, nondeleted notices', async () => {
  const { service, prisma } = fixture();
  prisma.notice.findMany.mockResolvedValue([{ id: 1, title: '공지', content: '내용' }] as never);
  expect(await service.popups()).toEqual({ items: [{ id: 'notice:1', kind: 'notice', title: '공지', content: '내용' }] });
  expect(prisma.notice.findMany.mock.calls[0][0].where).toEqual({ deleted: false, popup: true });
});
it('soft deletion cannot be reversed by an edit and deleted details are unavailable', async () => {
  const { service, prisma } = fixture();
  await service.remove(1, 'admin');
  expect(prisma.notice.updateMany).toHaveBeenCalledWith({ where: { id: 1, deleted: false }, data: { deleted: true } });
  prisma.notice.updateMany.mockResolvedValue({ count: 0 });
  await expect(service.update(1, 'admin', input)).rejects.toThrow('찾을 수');
  await expect(service.detail(1, 'user')).rejects.toThrow('찾을 수');
});

it('serializes both dates for list, detail and creation responses', async () => {
  const { service, prisma } = fixture();
  const row = { id: 1, ...dates };
  prisma.notice.findMany.mockResolvedValue([row] as never);
  prisma.notice.findFirst.mockResolvedValue(row as never);
  const responses = [
    (await service.list('admin', 0)).notices[0],
    (await service.detail(1, 'admin')).notice,
    (await service.create('admin', input)).notice,
  ];
  for (const notice of responses) {
    expect(notice.createdAt).toBe('2026-10-09T01:00:00.000Z');
    expect(notice.updatedAt).toBe('2026-10-09T02:00:00.000Z');
  }
});
