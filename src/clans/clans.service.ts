import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type Role = 'SUPERADMIN' | 'ADMIN' | 'LEADER' | 'USER';

@Injectable()
export class ClansService {
  constructor(private readonly prisma: PrismaService) {}

  private toBigInt(v: any, msg = '잘못된 ID') {
    try {
      return BigInt(String(v));
    } catch {
      throw new BadRequestException(msg);
    }
  }

  private normalizeDiscordLink(input?: string | null) {
    const value = String(input ?? '').trim();
    if (!value) return null;

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('discordLink 형식이 올바르지 않습니다.');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('discordLink는 http:// 또는 https:// 형식이어야 합니다.');
    }

    const host = url.hostname.toLowerCase();
    const allowedHosts = new Set([
      'discord.gg',
      'www.discord.gg',
      'discord.com',
      'www.discord.com',
      'ptb.discord.com',
      'canary.discord.com',
    ]);
    if (!allowedHosts.has(host)) {
      throw new BadRequestException('Discord URL만 저장할 수 있습니다.');
    }

    const path = url.pathname;
    const validPath =
      (host.includes('discord.gg') && /^\/[^/]+/.test(path)) ||
      /^\/invite\/[^/]+/.test(path) ||
      /^\/channels\/[^/]+\/[^/]+(\/[^/]+)?/.test(path);

    if (!validPath) {
      throw new BadRequestException('허용되지 않는 Discord URL 형식입니다.');
    }

    return url.toString();
  }

  private ensureReadable(targetClanId: bigint, user: { role?: Role; clanId?: any }) {
    if (user.role === 'SUPERADMIN') return;
    if (!user.clanId || this.toBigInt(user.clanId) !== targetClanId) {
      throw new ForbiddenException('같은 혈맹 소속 사용자만 조회할 수 있습니다.');
    }
  }

  private ensureWritable(targetClanId: bigint, user: { role?: Role; clanId?: any }) {
    if (user.role === 'SUPERADMIN') return;
    if (!['LEADER', 'ADMIN'].includes(String(user.role))) {
      throw new ForbiddenException('권한이 없습니다.');
    }
    if (!user.clanId || this.toBigInt(user.clanId) !== targetClanId) {
      throw new ForbiddenException('같은 혈맹만 수정할 수 있습니다.');
    }
  }

  async getDiscordLink(clanIdRaw: string, user: { role?: Role; clanId?: any }) {
    const clanId = this.toBigInt(clanIdRaw, 'clanId가 올바르지 않습니다.');
    this.ensureReadable(clanId, user);

    const clan = await this.prisma.clan.findUnique({
      where: { id: clanId },
      select: { id: true, discordLink: true },
    });
    if (!clan) throw new NotFoundException('혈맹을 찾을 수 없습니다.');

    return {
      ok: true,
      clanId: String(clan.id),
      discordLink: clan.discordLink ?? null,
    };
  }

  async updateDiscordLink(
    clanIdRaw: string,
    user: { role?: Role; clanId?: any },
    discordLink?: string | null,
  ) {
    const clanId = this.toBigInt(clanIdRaw, 'clanId가 올바르지 않습니다.');
    this.ensureWritable(clanId, user);

    const normalized = this.normalizeDiscordLink(discordLink);
    const clan = await this.prisma.clan.update({
      where: { id: clanId },
      data: { discordLink: normalized },
      select: { id: true, discordLink: true },
    });

    return {
      ok: true,
      clanId: String(clan.id),
      discordLink: clan.discordLink ?? null,
    };
  }
}
