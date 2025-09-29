import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { ListTimelinesResp, TimelineDto } from './dto/timeline.dto';
import { TreasuryEntryType, Prisma } from '@prisma/client';

@Injectable()
export class BossTimelineService {
  constructor(private prisma: PrismaService) {}

  private toBigIntOrNull(v: any) {
    if (v == null) return null;
    try { return BigInt(String(v)); } catch { return null; }
  }
  private toBigInt(v: any, msg = '잘못된 ID') {
    try { return BigInt(String(v)); } catch { throw new BadRequestException(msg); }
  }

  /** 혈맹별 보스 컷 타임라인 목록 */
  async listForClan(
    clanIdRaw: any,
    fromDate?: string,
    toDate?: string,
  ): Promise<ListTimelinesResp> {
    const clanId = this.toBigIntOrNull(clanIdRaw);
    if (!clanId) throw new BadRequestException('혈맹 정보가 없습니다.');

    // 기간 조건 만들기
    let dateFilter: Prisma.BossTimelineWhereInput = {};
    if (fromDate || toDate) {
      const from = fromDate ? new Date(fromDate) : undefined;
      const to = toDate ? new Date(toDate) : undefined;

      // 유효성 체크
      if (from && to && (to.getTime() - from.getTime()) > 1000 * 60 * 60 * 24 * 31) {
        throw new BadRequestException('검색 기간은 최대 31일까지만 가능합니다.');
      }

      dateFilter.cutAt = {};
      if (from) dateFilter.cutAt.gte = from;
      if (to) {
        // toDate를 포함시키려면 23:59:59까지 확장
        to.setHours(23, 59, 59, 999);
        dateFilter.cutAt.lte = to;
      }
    }

    const rows = await this.prisma.bossTimeline.findMany({
      where: {
        clanId,
        ...dateFilter,   // ⬅️ 추가된 기간 조건
      },
      orderBy: { cutAt: 'desc' },
      select: {
        id: true,
        bossName: true,
        cutAt: true,
        createdBy: true,
        imageIds: true,
        noGenCount: true,   // ✅ noGenCount 선택
        lootItems: {
          select: {
            id: true,
            itemName: true,
            isSold: true,
            soldAt: true,
            soldPrice: true,
            toTreasury: true,
            lootUserId: true,
          },
          orderBy: { id: 'asc' },
        },
        distributions: {
          select: {
            lootItemId: true,
            recipientLoginId: true,
            isPaid: true,
            paidAt: true,
          },
          orderBy: [{ lootItemId: 'asc' }, { recipientLoginId: 'asc' }],
        },
      },
    });

    const items: TimelineDto[] = rows.map((t) => {
      // JsonValue → string[] 안전 변환
      const raw = t.imageIds as unknown;
      const imageIds = Array.isArray(raw)
        ? (raw.filter((x) => typeof x === 'string') as string[])
        : [];

      return {
        id: String(t.id),
        bossName: t.bossName,
        cutAt: t.cutAt.toISOString(),   // ✅
        createdBy: t.createdBy,
        imageIds,
        noGenCount: t.noGenCount ?? 0,
        items: (t.lootItems ?? []).map((it) => ({
          id: String(it.id),
          itemName: it.itemName,
          isSold: !!it.isSold,
          soldAt: it.soldAt ? it.soldAt.toISOString() : null,   // ✅
          soldPrice: it.soldPrice ?? null,
          toTreasury: !!it.toTreasury,
          isTreasury: !!it.toTreasury,
          looterLoginId: it.lootUserId ?? null,
        })),
        distributions: (t.distributions ?? []).map((d) => ({
          lootItemId: d.lootItemId != null ? String(d.lootItemId) : null,
          recipientLoginId: d.recipientLoginId,
          isPaid: !!d.isPaid,
          paidAt: d.paidAt ? d.paidAt.toISOString() : null,   // ✅
        })),
      };
    });

    return { ok: true, items };
  }

  /** 타 혈맹 접근 방지 공통 검증 */
  private async ensureTimelineInClan(timelineId: bigint, clanIdRaw?: any) {
    const clanId = this.toBigIntOrNull(clanIdRaw);
    if (!clanId) throw new ForbiddenException('혈맹 정보가 없습니다.');
    const tl = await this.prisma.bossTimeline.findUnique({
      where: { id: timelineId },
      select: { id: true, clanId: true, createdBy: true },
    });
    if (!tl) throw new NotFoundException('타임라인을 찾을 수 없습니다.');
    if (tl.clanId !== clanId) throw new ForbiddenException('권한이 없습니다(혈맹 불일치).');
    return tl;
  }

  /** 최근 혈비 잔액 (현재 미사용) */
  private async getLatestTreasuryBalance(clanId: bigint): Promise<number> {
    const last = await this.prisma.treasuryLedger.findFirst({
      where: { clanId },
      orderBy: { createdAt: 'desc' },
      select: { balance: true },
    });
    return last?.balance ?? 0;
  }

  /** 아이템 판매 처리 및(필요 시) 혈비 적립 */
  async markItemSold(
    timelineId: string,
    itemId: string,
    soldPrice: number,
    actorLoginId?: string,
    clanIdRaw?: any,
  ) {
    if (!soldPrice || soldPrice <= 0) throw new BadRequestException('판매가는 0보다 커야 합니다.');

    const tId = this.toBigInt(timelineId, '잘못된 타임라인 ID');
    const iId = this.toBigInt(itemId, '잘못된 아이템 ID');

    const found = await this.prisma.lootItem.findUnique({
      where: { id: iId },
      select: {
        id: true,
        timelineId: true,
        isSold: true,
        toTreasury: true,
        timeline: { select: { id: true, clanId: true } },
      },
    });
    if (!found || found.timelineId !== tId) throw new NotFoundException('해당 아이템이 없습니다.');
    if (found.isSold) throw new BadRequestException('이미 판매 완료된 아이템입니다.');

    if (clanIdRaw != null) await this.ensureTimelineInClan(tId, clanIdRaw);

    const now = new Date();
    const actor = actorLoginId ?? 'system';
    const clanId = found.timeline?.clanId;
    const toTreasury = !!found.toTreasury;

    await this.prisma.$transaction(async (tx) => {
      await tx.lootItem.update({
        where: { id: iId },
        data: { isSold: true, soldPrice, soldAt: now },
      });

      if (toTreasury && clanId != null) {
        const prev = await tx.treasuryLedger.findFirst({
          where: { clanId },
          orderBy: { createdAt: 'desc' },
          select: { balance: true },
        });
        const before = prev?.balance ?? 0;
        const after = before + soldPrice;

        await tx.treasuryLedger.create({
          data: {
            clanId,
            timelineId: tId,
            lootItemId: iId,
            entryType: TreasuryEntryType.SALE_TREASURY,
            amount: soldPrice,
            note: '드랍 아이템 판매금 혈비 귀속',
            balance: after,
            createdBy: actor,
          },
        });
      }
    });

    return { ok: true };
  }

  /** 분배 지급 상태 즉시 반영 */
  async markDistributionPaid(input: {
    timelineId: string;
    distId: string;
    isPaid: boolean;
    actorLoginId: string;
    actorRole: 'SUPERADMIN' | 'ADMIN' | 'LEADER' | 'USER';
    clanId?: any;
  }) {
    const timelineId = this.toBigInt(input.timelineId);
    const distId = this.toBigInt(input.distId);

    await this.ensureTimelineInClan(timelineId, input.clanId);

    const dist = await this.prisma.lootDistribution.findUnique({
      where: { id: distId },
      select: {
        id: true,
        timelineId: true,
        lootItemId: true,
        recipientLoginId: true,
        isPaid: true,
        paidAt: true,
        lootItem: { select: { id: true } },
      },
    });
    if (!dist || dist.timelineId !== timelineId) {
      throw new NotFoundException('분배 정보를 찾을 수 없거나 타임라인 불일치입니다.');
    }

    const isAdmin = input.actorRole === 'ADMIN' || input.actorRole === 'SUPERADMIN';
    let allowed = false;
    if (dist.recipientLoginId === input.actorLoginId) allowed = true;
    if (isAdmin) allowed = true;
    if (!allowed) throw new ForbiddenException('본인/루팅자/관리자만 분배 체크를 변경할 수 있습니다.');

    const now = new Date();
    const updated = await this.prisma.lootDistribution.update({
      where: { id: distId },
      data: { isPaid: input.isPaid, paidAt: input.isPaid ? now : null },
      select: { id: true, lootItemId: true, recipientLoginId: true, isPaid: true, paidAt: true },
    });

    return { ok: true, distribution: updated };
  }

  /** 단건 상세 */
  async getTimelineDetail(clanIdRaw: any, idRaw: string) {
    const clanId = this.toBigIntOrNull(clanIdRaw);
    if (!clanId) throw new BadRequestException('혈맹 정보가 필요합니다.');
    const id = this.toBigInt(idRaw);

    const t = await this.prisma.bossTimeline.findFirst({
      where: { id, clanId },
      // include는 관계만 가능 → 스칼라(imageIds)와 함께 가져오려면 select 사용
      select: {
        id: true,
        bossName: true,
        cutAt: true,
        createdBy: true,
        noGenCount: true,
        imageIds: true, // ✅
        lootItems: {
          select: {
            id: true,
            itemName: true,
            isSold: true,
            soldAt: true,
            soldPrice: true,
            toTreasury: true,
            lootUserId: true,
          },
          orderBy: { id: 'asc' },
        },
        distributions: {
          select: {
            id: true,
            timelineId: true,
            lootItemId: true,
            recipientLoginId: true,
            isPaid: true,
            paidAt: true,
          },
          orderBy: [{ lootItemId: 'asc' }, { recipientLoginId: 'asc' }],
        },
      },
    });
    if (!t) throw new NotFoundException('타임라인을 찾을 수 없습니다.');

    const raw = t.imageIds as unknown;
    const imageIds = Array.isArray(raw)
      ? (raw.filter((x) => typeof x === 'string') as string[])
      : [];

    return {
      ok: true,
      item: {
        id: String(t.id),
        bossName: t.bossName,
        cutAt: t.cutAt.toISOString(),   // ✅
        createdBy: t.createdBy,
        imageIds,
        noGenCount: t.noGenCount ?? 0,
        items: (t.lootItems ?? []).map((it) => ({
          id: String(it.id),
          itemName: it.itemName,
          isSold: !!it.isSold,
          isTreasury: !!it.toTreasury,
          toTreasury: !!it.toTreasury,
          soldPrice: it.soldPrice ?? null,
          soldAt: it.soldAt ? it.soldAt.toISOString() : null,   // ✅
          looterLoginId: it.lootUserId ?? null,
        })),
        distributions: (t.distributions ?? []).map((d) => ({
          id: String(d.id),
          lootItemId: d.lootItemId ? String(d.lootItemId) : null,
          recipientLoginId: d.recipientLoginId,
          isPaid: !!d.isPaid,
          paidAt: d.paidAt ? d.paidAt.toISOString() : null,   // ✅
        })),
      },
    };
  }

  /** (구) 특정 아이템-참여자 지급 상태 갱신 */
  async setDistributionPaid(params: {
    timelineId: string;
    itemId: string;
    recipientLoginId: string;
    isPaid: boolean;
    actorLoginId: string;
  }) {
    const { timelineId, itemId, recipientLoginId, isPaid } = params;

    const dist = await this.prisma.lootDistribution.findFirst({
      where: {
        timelineId: BigInt(timelineId),
        lootItemId: BigInt(itemId),
        recipientLoginId,
      },
      select: { id: true, isPaid: true },
    });
    if (!dist) throw new NotFoundException('분배 대상이 존재하지 않습니다.');

    const updated = await this.prisma.lootDistribution.update({
      where: { id: dist.id },
      data: { isPaid, paidAt: isPaid ? new Date() : null },
    });

    return { ok: true, item: { id: updated.id, isPaid: updated.isPaid, paidAt: updated.paidAt } };
  }

  /** 🔵 멍(노젠) +1 */
  async addDaze(input: {
    timelineId: string;
    clanId?: any;
    actorLoginId?: string;
    atIso?: string;
  }) {
    const tId = this.toBigInt(input.timelineId, '잘못된 타임라인 ID');

    // 혈맹 권한 확인
    await this.ensureTimelineInClan(tId, input.clanId);

    const updated = await this.prisma.bossTimeline.update({
      where: { id: tId },
      data: {
        noGenCount: { increment: 1 },
      },
      select: { id: true, noGenCount: true },
    });

    return {
      ok: true,
      timelineId: String(updated.id),
      noGenCount: updated.noGenCount,
    };
  }

  /** (권장) 컷 처리 시 noGenCount 리셋용 helper */
  async resetNoGenOnCut(timelineId: bigint) {
    await this.prisma.bossTimeline.update({
      where: { id: timelineId },
      data: { noGenCount: 0 },
    });
  }

  /** 보스 컷 삭제 */
  async deleteTimeline(clanIdRaw: any, timelineIdRaw: string) {
    const clanId = this.toBigIntOrNull(clanIdRaw);
    const timelineId = this.toBigInt(timelineIdRaw, "잘못된 타임라인 ID");

    // 권한 체크
    await this.ensureTimelineInClan(timelineId, clanId);

    // 관련된 lootItems, distributions도 함께 삭제 (CASCADE 또는 수동 처리)
    await this.prisma.$transaction(async (tx) => {
      await tx.lootDistribution.deleteMany({ where: { timelineId } });
      await tx.lootItem.deleteMany({ where: { timelineId } });
      await tx.bossTimeline.delete({ where: { id: timelineId } });
    });

    return { ok: true };
  }

  async cancelDaze(timelineId: string) {
    const tId = BigInt(timelineId);
    const tl = await this.prisma.bossTimeline.findUnique({ where: { id: tId } });
    if (!tl) throw new NotFoundException('타임라인을 찾을 수 없습니다.');
    if ((tl.noGenCount ?? 0) <= 0) throw new BadRequestException('멍 기록이 없습니다.');
    return this.prisma.bossTimeline.update({
      where: { id: tId },
      data: { noGenCount: { decrement: 1 } },
      select: { id: true, noGenCount: true },
    });
  }
}
