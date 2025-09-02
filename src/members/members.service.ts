import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';

@Injectable()
export class MembersService {
  constructor(private prisma: PrismaService) {}

  private toBigInt(v: any, msg = '잘못된 ID') {
    try { return BigInt(String(v)); } catch { throw new BadRequestException(msg); }
  }

  async list(clanId: string) {
    const cid = this.toBigInt(clanId);
    const rows = await this.prisma.user.findMany({
      where: { clanId: cid },
      select: { id: true, loginId: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ok: true,
      count: rows.length,
      members: rows.map(r => ({
        id: String(r.id),
        loginId: r.loginId,
        role: r.role as any,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      })),
    };
  }

  async create(clanId: string, body: { loginId: string; password: string; role?: 'USER'|'LEADER' }, max: number) {
    const cid = this.toBigInt(clanId);

    const cnt = await this.prisma.user.count({ where: { clanId: cid } });
    if (cnt >= max) {
      throw new ConflictException({ ok: false, code: 'MAX_MEMBERS', message: `혈맹원은 최대 ${max}명까지 등록할 수 있습니다.` });
    }

    const hash = await bcrypt.hash(body.password, 10);
    const created = await this.prisma.user.create({
      data: {
        clanId: cid,
        loginId: body.loginId,
        passwordHash: hash,
        role: body.role ?? 'USER',
      },
      select: { id: true },
    });
    return { ok: true, id: String(created.id) };
  }

  async changeRole(clanId: string, id: string, role: 'USER'|'LEADER') {
    const cid = this.toBigInt(clanId);
    const uid = this.toBigInt(id);

    // 대상이 같은 혈맹인지 + 현재 ADMIN인 사람은 여기서 변경 금지 (위임에서만)
    const u = await this.prisma.user.findFirst({
      where: { id: uid, clanId: cid },
      select: { id: true, role: true },
    });
    if (!u) throw new BadRequestException('대상을 찾을 수 없습니다.');
    if (u.role === 'ADMIN') {
      throw new BadRequestException('관리자 권한은 위임 기능으로만 변경할 수 있습니다.');
    }

    await this.prisma.user.update({ where: { id: uid }, data: { role } });
    return { ok: true };
  }

  async assignAdmin(clanId: string, targetId: string, actorId: bigint) {
    const cid = this.toBigInt(clanId);
    const tid = this.toBigInt(targetId);

    const target = await this.prisma.user.findFirst({
      where: { id: tid, clanId: cid },
      select: { id: true, role: true },
    });
    if (!target) throw new BadRequestException('대상을 찾을 수 없습니다.');
    if (target.id === actorId) throw new BadRequestException('자기 자신에게는 위임할 수 없습니다.');

    const result = await this.prisma.$transaction(async (tx) => {
      const demote = await tx.user.updateMany({
        where: { clanId: cid, role: UserRole.ADMIN },
        data: { role: UserRole.LEADER },
      });

      const promote = await tx.user.update({
        where: { id: tid },
        data: { role: UserRole.ADMIN },
        select: { id: true, role: true },
      });

      return { demoted: demote.count, promotedId: String(promote.id), newRole: promote.role };
    });

    return { ok: true, ...result };
  }

  async remove(clanId: string, id: string) {
    const cid = this.toBigInt(clanId);
    const uid = this.toBigInt(id);
    const u = await this.prisma.user.findFirst({ where: { id: uid, clanId: cid }, select: { id: true } });
    if (!u) throw new BadRequestException('대상을 찾을 수 없습니다.');
    await this.prisma.user.delete({ where: { id: uid } });
    return { ok: true };
  }
}