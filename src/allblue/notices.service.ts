import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AllbluePrismaService } from '../allblue-prisma.service';

export function validateNotice(body: unknown) {
  const data = body as Record<string, unknown> | null;
  if (!data || typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 200 ||
    typeof data.content !== 'string' || !data.content.trim() || data.content.trim().length > 20000 ||
    typeof data.pinned !== 'boolean' || typeof data.popup !== 'boolean') {
    throw new BadRequestException('제목(200자 이내), 내용(20,000자 이내), 표시 설정을 확인해주세요.');
  }
  return { title: data.title.trim().replace(/[\r\n]+/g, ' '), content: data.content.trim(), pinned: data.pinned, popup: data.popup };
}

// The global BigInt serializer traverses objects, so return dates as strings first.
export function serializeNotice<T extends { createdAt: Date; updatedAt: Date }>(notice: T) {
  return { ...notice, createdAt: notice.createdAt.toISOString(), updatedAt: notice.updatedAt.toISOString() };
}

@Injectable()
export class NoticesService {
  constructor(private readonly prisma: AllbluePrismaService) {}

  private async viewer(userId: string) {
    return this.prisma.user.findUnique({ where: { userId }, select: { nickname: true, profile: { select: { level: true } } } });
  }
  private async admin(userId: string) {
    const user = await this.viewer(userId);
    if (user?.profile?.level?.toUpperCase() !== 'A') throw new ForbiddenException('관리자만 변경할 수 있습니다.');
    return user;
  }
  async list(userId: string, offset: number) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new BadRequestException('잘못된 페이지입니다.');
    const [rows, user] = await Promise.all([
      this.prisma.notice.findMany({ where: { deleted: false }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], skip: offset, take: 31 }),
      this.viewer(userId),
    ]);
    return { notices: rows.slice(0, 30).map(serializeNotice), hasMore: rows.length > 30, canManage: user?.profile?.level?.toUpperCase() === 'A' };
  }
  async popups() {
    const notices = await this.prisma.notice.findMany({ where: { deleted: false, popup: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, title: true, content: true } });
    return { items: notices.map(notice => ({ ...notice, id: `notice:${notice.id}`, kind: 'notice' as const })) };
  }
  async detail(id: number, userId: string) {
    const [notice, user] = await Promise.all([this.prisma.notice.findFirst({ where: { id, deleted: false } }), this.viewer(userId)]);
    if (!notice) throw new NotFoundException('공지사항을 찾을 수 없습니다.');
    return { notice: serializeNotice(notice), canManage: user?.profile?.level?.toUpperCase() === 'A' };
  }
  async create(userId: string, body: unknown) {
    const author = await this.admin(userId);
    const data = validateNotice(body);
    const notice = await this.prisma.notice.create({ data: { ...data, authorId: userId, authorName: author.nickname } });
    return { notice: serializeNotice(notice) };
  }
  async update(id: number, userId: string, body: unknown) {
    await this.admin(userId);
    const data = validateNotice(body);
    const result = await this.prisma.notice.updateMany({ where: { id, deleted: false }, data });
    if (!result.count) throw new NotFoundException('공지사항을 찾을 수 없습니다.');
    return { success: true };
  }
  async remove(id: number, userId: string) {
    await this.admin(userId);
    const result = await this.prisma.notice.updateMany({ where: { id, deleted: false }, data: { deleted: true } });
    if (!result.count) throw new NotFoundException('공지사항을 찾을 수 없습니다.');
    return { success: true };
  }
}
