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

  private normalizeReason(input?: string | null) {
    const value = String(input ?? '').trim();
    if (!value) {
      throw new BadRequestException('reason은 필수입니다.');
    }
    if (value.length > 500) {
      throw new BadRequestException('reason은 500자 이하여야 합니다.');
    }
    return value;
  }

  private normalizeHostileClanName(input?: string | null) {
    const value = String(input ?? '').trim();
    if (!value) return null;
    if (value.length > 100) {
      throw new BadRequestException('hostileClanName은 100자 이하여야 합니다.');
    }
    return value;
  }

  private normalizeHostileAt(input?: string | null) {
    if (input == null || String(input).trim() === '') return new Date();
    const dt = new Date(input);
    if (Number.isNaN(dt.getTime())) {
      throw new BadRequestException('hostileAt 형식이 올바르지 않습니다.');
    }
    return dt;
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

  async listHostiles(clanIdRaw: string, user: { role?: Role; clanId?: any }) {
    const clanId = this.toBigInt(clanIdRaw, 'clanId가 올바르지 않습니다.');
    this.ensureReadable(clanId, user);

    const items = await this.prisma.clanHostile.findMany({
      where: {
        clanId,
        OR: [{ delYn: null }, { delYn: 'N' }],
      },
      orderBy: [{ hostileAt: 'desc' }, { seq: 'desc' }],
      select: {
        seq: true,
        clanId: true,
        userId: true,
        hostileClanName: true,
        reason: true,
        delYn: true,
        hostileAt: true,
        createdAt: true,
      },
    });

    const userIds = [...new Set(items.map((item) => String(item.userId)))];
    const users =
      userIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: userIds.map((id) => BigInt(id)) } },
            select: { id: true, loginId: true },
          })
        : [];
    const userLoginIdMap = new Map(users.map((u) => [String(u.id), u.loginId]));

    return {
      ok: true,
      items: items.map((item) => ({
        seq: Number(item.seq),
        clanId: Number(item.clanId),
        userId: Number(item.userId),
        userLoginId: userLoginIdMap.get(String(item.userId)) ?? null,
        hostileClanName: item.hostileClanName ?? null,
        reason: item.reason,
        hostileAt: item.hostileAt.toISOString(),
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  async createHostile(
    clanIdRaw: string,
    user: { role?: Role; clanId?: any; sub?: any; id?: any },
    body: {
      userId?: string | number;
      hostileClanName?: string | null;
      reason?: string | null;
      hostileAt?: string | null;
    },
  ) {
    const clanId = this.toBigInt(clanIdRaw, 'clanId가 올바르지 않습니다.');
    this.ensureWritable(clanId, user);
    const userIdRaw = body.userId ?? user.sub ?? user.id;
    if (!userIdRaw) throw new BadRequestException('userId가 없습니다.');
    const userId = this.toBigInt(userIdRaw, 'userId가 올바르지 않습니다.');

    const created = await this.prisma.clanHostile.create({
      data: {
        clanId,
        userId,
        hostileClanName: this.normalizeHostileClanName(body.hostileClanName),
        reason: this.normalizeReason(body.reason),
        delYn: null,
        hostileAt: this.normalizeHostileAt(body.hostileAt),
      },
      select: {
        seq: true,
        clanId: true,
        userId: true,
        hostileClanName: true,
        reason: true,
        delYn: true,
        hostileAt: true,
        createdAt: true,
      },
    });

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { loginId: true },
    });

    return {
      ok: true,
      item: {
        seq: Number(created.seq),
        clanId: Number(created.clanId),
        userId: Number(created.userId),
        userLoginId: actor?.loginId ?? null,
        hostileClanName: created.hostileClanName ?? null,
        reason: created.reason,
        hostileAt: created.hostileAt.toISOString(),
        createdAt: created.createdAt.toISOString(),
      },
    };
  }

  async deleteHostile(
    clanIdRaw: string,
    seqRaw: string,
    user: { role?: Role; clanId?: any },
  ) {
    const clanId = this.toBigInt(clanIdRaw, 'clanId가 올바르지 않습니다.');
    const seq = this.toBigInt(seqRaw, 'seq가 올바르지 않습니다.');
    this.ensureWritable(clanId, user);

    const item = await this.prisma.clanHostile.findUnique({
      where: { seq },
      select: { seq: true, clanId: true, delYn: true },
    });
    if (!item) throw new NotFoundException('적대 항목을 찾을 수 없습니다.');
    if (user.role !== 'SUPERADMIN' && item.clanId !== clanId) {
      throw new ForbiddenException('같은 혈맹만 삭제할 수 있습니다.');
    }
    if (item.delYn === 'Y') {
      return { ok: true, seq: Number(item.seq) };
    }

    await this.prisma.clanHostile.update({
      where: { seq },
      data: { delYn: 'Y' },
    });
    return { ok: true, seq: Number(item.seq) };
  }
}
