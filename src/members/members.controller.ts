// src/members/members.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Post
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MembersService } from './members.service';
import { PrismaService } from '../prisma.service';

const MAX_MEMBERS = 49;

type Role = 'SUPERADMIN' | 'ADMIN' | 'LEADER' | 'USER';

type JwtUser = {
  sub: string;              // 사용자 id
  role: Role;
  clanId?: string | null;
  loginId?: string;
};

@UseGuards(JwtAuthGuard)
@Controller('v1/members')
export class MembersController {
  constructor(
    private readonly svc: MembersService,
    private readonly prisma: PrismaService,
  ) {}

  private ensureManager(role?: Role) {
    if (role !== 'ADMIN' && role !== 'LEADER' && role !== 'SUPERADMIN') {
      throw new ForbiddenException('권한이 없습니다.');
    }
  }

  private toBigInt(v: any, msg = '잘못된 ID') {
    try { return BigInt(String(v)); } catch { throw new BadRequestException(msg); }
  }

  /**
   * clanId 해석
   * - ADMIN/LEADER: 자신의 혈맹
   * - USER: 자신의 혈맹(토큰의 clanId 필요)
   * - SUPERADMIN: 쿼리로 clanId 강제 (?clanId=...)
   */
  private async resolveClanId(role?: Role, tokenClanId?: any, qClanId?: string, sub?: any) {
    if (role === 'ADMIN' || role === 'LEADER') {
      if (tokenClanId) return String(tokenClanId);
      const u = await this.prisma.user.findUnique({
        where: { id: this.toBigInt(sub) },
        select: { clanId: true },
      });
      if (!u?.clanId) throw new BadRequestException('혈맹이 설정되지 않은 계정입니다.');
      return String(u.clanId);
    }

    if (role === 'USER') {
      if (tokenClanId) return String(tokenClanId);
      throw new BadRequestException('혈맹 정보가 없습니다.');
    }

    if (role === 'SUPERADMIN') {
      if (!qClanId) throw new BadRequestException('SUPERADMIN은 clanId를 지정해야 합니다. (?clanId=...)');
      return qClanId;
    }

    throw new ForbiddenException('권한이 없습니다.');
  }

  // ✅ 조회: 로그인만 되어 있으면 가능 (USER 포함)
  @Post()
  async list(@Req() req: any) {
    const { role, clanId, sub } = req.user as JwtUser;
    const resolved = await this.resolveClanId(role, clanId, req.query?.clanId, sub);
    return this.svc.list(resolved);
  }

  // 생성 (최대 49명 제한) — 관리자/간부만
  @Post()
  async create(@Req() req: any, @Body() body: { loginId: string; password: string; role?: 'USER'|'LEADER' }) {
    const { role, clanId, sub } = req.user as JwtUser;
    if (role !== 'ADMIN' && role !== 'LEADER') throw new ForbiddenException('권한이 없습니다.');
    const resolved = await this.resolveClanId(role, clanId, undefined, sub);
    return this.svc.create(resolved, body, MAX_MEMBERS);
  }

  // USER ↔ LEADER — 관리자/간부만
  @Post(':id/role')
  async changeRole(@Req() req: any, @Param('id') id: string, @Body() body: { role: 'USER'|'LEADER' }) {
    const { role, clanId, sub } = req.user as JwtUser;
    if (role !== 'ADMIN' && role !== 'LEADER') throw new ForbiddenException('권한이 없습니다.');

    // 자기 자신 금지
    const me = await this.prisma.user.findUnique({ where: { id: this.toBigInt(sub) }, select: { loginId: true } });
    const target = await this.prisma.user.findUnique({ where: { id: this.toBigInt(id) }, select: { loginId: true } });
    if (me?.loginId && target?.loginId && me.loginId === target.loginId) {
      throw new BadRequestException('자기 자신은 변경할 수 없습니다.');
    }

    const resolved = await this.resolveClanId(role, clanId, undefined, sub);
    return this.svc.changeRole(resolved, id, body.role);
  }

  // 관리자 위임 — 관리자만
  @Post(':id/assign-admin')
  async assignAdmin(@Req() req: any, @Param('id') id: string) {
    const { role, clanId, sub } = req.user as JwtUser;
    if (role !== 'ADMIN') throw new ForbiddenException('관리자만 위임할 수 있습니다.');

    // 자기 자신 금지
    const meId = this.toBigInt(sub);
    if (meId === this.toBigInt(id)) throw new BadRequestException('자기 자신에게는 위임할 수 없습니다.');

    const resolved = await this.resolveClanId(role, clanId, undefined, sub);
    return this.svc.assignAdmin(resolved, id, meId);
  }

  // 삭제 — 관리자/간부만 (자기 자신 삭제 금지)
  @Post(':id/delete')
  async remove(@Req() req: any, @Param('id') id: string) {
    const { role, clanId, sub } = req.user as JwtUser;
    if (role !== 'ADMIN' && role !== 'LEADER') throw new ForbiddenException('권한이 없습니다.');
    if (this.toBigInt(sub) === this.toBigInt(id)) {
      throw new BadRequestException('자기 자신은 삭제할 수 없습니다.');
    }
    const resolved = await this.resolveClanId(role, clanId, undefined, sub);
    return this.svc.remove(resolved, id);
  }
}