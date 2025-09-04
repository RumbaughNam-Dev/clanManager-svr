import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { ListTimelinesResp, TimelineDto } from './dto/timeline.dto';
import { TreasuryEntryType } from '@prisma/client';

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
  async listForClan(clanIdRaw: any): Promise<ListTimelinesResp> {
    const clanId = this.toBigIntOrNull(clanIdRaw);
    if (!clanId) throw new BadRequestException('혈맹 정보가 없습니다.');

    const rows = await this.prisma.bossTimeline.findMany({
      where: { clanId },
      orderBy: { cutAt: 'desc' },
      select: {
        id: true,
        bossName: true,
        cutAt: true,
        createdBy: true,
        imageIds: true,
        lootItems: {
          select: {
            id: true,
            itemName: true,
            isSold: true,
            soldAt: true,
            soldPrice: true,
            toTreasury: true,
            lootUserId: true, // DB 컬럼
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

    const items: TimelineDto[] = rows.map((t) => ({
      id: String(t.id),
      bossName: t.bossName,
      cutAt: t.cutAt.toISOString(),
      createdBy: t.createdBy,
      imageIds: Array.isArray(t.imageIds) ? (t.imageIds as string[]) : [],
      items: (t.lootItems ?? []).map((it) => ({
        id: String(it.id),
        itemName: it.itemName,
        isSold: !!it.isSold,
        soldAt: it.soldAt ? it.soldAt.toISOString() : null,
        soldPrice: it.soldPrice ?? null,
        toTreasury: !!it.toTreasury,
        isTreasury: !!it.toTreasury, // 프론트 호환
        looterLoginId: it.lootUserId ?? null, // API 필드명
      })),
      distributions: (t.distributions ?? []).map((d) => ({
        lootItemId: d.lootItemId != null ? String(d.lootItemId) : null,
        recipientLoginId: d.recipientLoginId,
        isPaid: !!d.isPaid,
        paidAt: d.paidAt ? d.paidAt.toISOString() : null,
      })),
    }));

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
      include: {
        lootItems: {
          select: {
            id: true,
            itemName: true,
            isSold: true,
            soldAt: true,
            soldPrice: true,
            toTreasury: true,
            lootUserId: true, // DB 필드
          },
          orderBy: { id: 'asc' },
        },
        distributions: true,
      },
    });
    if (!t) throw new NotFoundException('타임라인을 찾을 수 없습니다.');

    return {
      ok: true,
      item: {
        id: String(t.id),
        bossName: t.bossName,
        cutAt: t.cutAt.toISOString(),
        createdBy: t.createdBy,
        items: (t.lootItems ?? []).map((it) => ({
          id: String(it.id),
          itemName: it.itemName,
          isSold: !!it.isSold,
          isTreasury: !!it.toTreasury,
          toTreasury: !!it.toTreasury,
          soldPrice: it.soldPrice ?? null,
          soldAt: it.soldAt ? it.soldAt.toISOString() : null,
          looterLoginId: it.lootUserId ?? null, // API 필드명
        })),
        distributions: (t.distributions ?? []).map((d) => ({
          id: String(d.id),
          lootItemId: d.lootItemId ? String(d.lootItemId) : null,
          recipientLoginId: d.recipientLoginId,
          isPaid: !!d.isPaid,
          paidAt: d.paidAt ? d.paidAt.toISOString() : null,
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
}