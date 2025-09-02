// src/auth/auth.service.ts
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcrypt';
import { TokensService } from './tokens.service';

type Role = 'SUPERADMIN' | 'ADMIN' | 'LEADER' | 'USER';

@Injectable()
export class AuthService {
  
  constructor(
    private prisma: PrismaService,
    private tokens: TokensService,
  ) {}

  private roleFrom(input?: string): Role {
    const allowed: Role[] = ['SUPERADMIN', 'ADMIN', 'LEADER', 'USER'];
    const r = (input ? input.toUpperCase() : 'USER') as Role;
    if (!allowed.includes(r)) throw new BadRequestException('role must be one of SUPERADMIN|ADMIN|LEADER|USER');
    return r;
  }

  async validateUser(loginId: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { loginId },
      select: { id: true, loginId: true, passwordHash: true, role: true, clanId: true },
    });
    if (!user) throw new UnauthorizedException('아이디 또는 비밀번호가 올바르지 않습니다.');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('아이디 또는 비밀번호가 올바르지 않습니다.');
    return user;
  }

  // ✅ 컨트롤러에서 호출하는 형태 유지: (loginId, password)
  async login(loginId: string, password: string) {
    const user = await this.validateUser(loginId, password);

    // clan 정보까지 조인해서 서버 표시용 문자열 생성
    const withClan = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        loginId: true,
        role: true,
        clanId: true,
        clan: { select: { world: true, serverNo: true, name: true } },
      },
    });
    if (!withClan) throw new UnauthorizedException();

    const payload = {
      sub: String(withClan.id),
      role: withClan.role as Role,
      loginId: withClan.loginId,
      clanId: withClan.clanId ? String(withClan.clanId) : null,
    };

    const accessToken = this.tokens.signAccess(payload);
    const refreshToken = this.tokens.signRefresh({ sub: payload.sub });

    const serverDisplay =
      withClan.clan ? `${withClan.clan.world} ${withClan.clan.serverNo}서버` : null;

    return {
      ok: true,
      user: {
        id: String(withClan.id),
        loginId: withClan.loginId,
        role: withClan.role as Role,
        clanId: withClan.clanId ? String(withClan.clanId) : null,
        // 프론트 편의를 위해 포함(옵션)
        clanName: withClan.clan?.name ?? null,
        serverDisplay,
      },
      accessToken,
      refreshToken,
      // 별도로 내려도 되고 위 user에 포함해도 됩니다
      clanName: withClan.clan?.name ?? null,
      serverDisplay,
    };
  }

  async me(userJwt: { sub: string }) {
    const u = await this.prisma.user.findUnique({
      where: { id: BigInt(userJwt.sub) },
      select: {
        id: true,
        loginId: true,
        role: true,
        clanId: true,
        clan: { select: { name: true, world: true, serverNo: true } }, // ← 여기서 clan join
      },
    });
    if (!u) throw new UnauthorizedException();

    const serverDisplay = u.clan ? `${u.clan.world} ${u.clan.serverNo}서버` : null;

    return {
      ok: true,
      user: {
        id: String(u.id),
        loginId: u.loginId,
        role: u.role as Role,
        clanId: u.clanId ? String(u.clanId) : null,
        clanName: u.clan?.name ?? null,
        serverDisplay,
      },
    };
  }

  async refresh(refreshToken: string) {
    const decoded = this.tokens.verifyRefresh(refreshToken) as any;
    const u = await this.prisma.user.findUnique({
      where: { id: BigInt(decoded.sub) },
      select: { id: true, loginId: true, role: true, clanId: true },
    });
    if (!u) throw new UnauthorizedException();
    const payload = { sub: String(u.id), role: u.role, loginId: u.loginId, clanId: u.clanId ? String(u.clanId) : null };
    const accessToken = this.tokens.signAccess(payload);
    return { ok: true, accessToken };
  }

  private toBigIntOrUnauthorized(v: unknown): bigint {
    if (v === null || v === undefined) {
      throw new UnauthorizedException('Invalid token');
    }
    try {
      return BigInt(String(v));
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  async signup(loginId: string, password: string, role?: string) {
    const hash = await bcrypt.hash(password, 10);
    const finalRole = this.roleFrom(role);

    const user = await this.prisma.user.create({
      data: {
        loginId,
        passwordHash: hash,
        role: finalRole,
      },
      select: {
        id: true,
        loginId: true,
        role: true,
        clanId: true,
        clan: { select: { name: true } },
      },
    });

    return {
      ok: true,
      user: {
        id: String(user.id),
        loginId: user.loginId,
        role: user.role,
        clanId: user.clanId ? String(user.clanId) : null,
        clanName: user.clan?.name ?? null,
      },
    };
  }

  async logout() {
    return { ok: true };
  }
}