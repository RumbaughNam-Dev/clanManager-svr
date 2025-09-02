// src/bossTimeline/boss-timeline.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { ListTimelinesResp, TimelineDto } from './dto/timeline.dto';
// Prisma enum 사용 (schema.prisma에 정의됨)
import { TreasuryEntryType } from '@prisma/client';

@Injectable()
export class BossTimelineService {
  constructor(private prisma: PrismaService) {}

  private toBigIntOrNull(v: any) {
    if (v == null) return null;
    try {
      return BigInt(String(v));
    } catch {
      return null;
    }
  }

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
        imageIds: true, // Json|null
        lootItems: {
          select: {
            id: true,
            itemName: true,
            isSold: true,
            soldAt: true,
            soldPrice: true,
            toTreasury: true,
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

  private toBigInt(v: any, msg = '잘못된 ID') {
    try {
      return BigInt(String(v));
    } catch {
      throw new BadRequestException(msg);
    }
  }

  /** 타 혈맹 접근, 잘못된 경로 보호를 위한 공통 검증 */
  private async ensureTimelineInClan(timelineId: bigint, clanIdRaw?: any) {
    const clanId = this.toBigIntOrNull(clanIdRaw);
    if (!clanId) throw new ForbiddenException('혈맹 정보가 없습니다.');
    const tl = await this.prisma.bossTimeline.findUnique({
      where: { id: timelineId },
      select: { id: true, clanId: true, createdBy: true },
    });
    if (!tl) throw new NotFoundException('타임라인을 찾을 수 없습니다.');
    if (tl.clanId !== clanId)
      throw new ForbiddenException('권한이 없습니다(혈맹 불일치).');
    return tl;
  }

  /**
   * 최근 혈비 잔액 조회 (없으면 0)
   */
  private async getLatestTreasuryBalance(clanId: bigint): Promise<number> {
    const last = await this.prisma.treasuryLedger.findFirst({
      where: { clanId },
      orderBy: { createdAt: 'desc' },
      select: { balance: true },
    });
    return last?.balance ?? 0;
  }

  /**
   * 아이템 판매 상태 즉시 반영
   * - 판매가 > 0 검증
   * - 아이템 소속/중복 판매 방지
   * - toTreasury === true 이면 TreasuryLedger에 SALE_TREASURY로 적립 + 누적 잔액 스냅샷
   *
   * ※ 시그니처 확장: clanIdRaw(선택) 추가. 컨트롤러에서 넘겨오면 혈맹 일치 검증에 사용.
   */
  async markItemSold(
    timelineId: string,
    itemId: string,
    soldPrice: number,
    actorLoginId?: string,
    clanIdRaw?: any,
  ) {
    if (!soldPrice || soldPrice <= 0) {
      throw new BadRequestException('판매가는 0보다 커야 합니다.');
    }

    const tId = this.toBigInt(timelineId, '잘못된 타임라인 ID');
    const iId = this.toBigInt(itemId, '잘못된 아이템 ID');

    // 아이템 + 타임라인 + 혈비 여부까지 한번에 조회
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
    if (!found || found.timelineId !== tId) {
      throw new NotFoundException('해당 아이템이 없습니다.');
    }
    if (found.isSold) {
      throw new BadRequestException('이미 판매 완료된 아이템입니다.');
    }

    // (선택) 요청자가 같은 혈맹인지 확인
    if (clanIdRaw != null) {
      await this.ensureTimelineInClan(tId, clanIdRaw);
    }

    const now = new Date();
    const actor = actorLoginId ?? 'system';
    const clanId = found.timeline?.clanId;
    const toTreasury = !!found.toTreasury;

    // 트랜잭션: 1) 아이템 판매 처리  2) (혈비) 원장 적립
    await this.prisma.$transaction(async (tx) => {
      // 1) 아이템 업데이트
      await tx.lootItem.update({
        where: { id: iId },
        data: {
          isSold: true,
          soldPrice,
          soldAt: now,
        },
      });

      // 2) 혈비 귀속이라면 TreasuryLedger 적립
      if (toTreasury && clanId != null) {
        const prevBalance = await tx.treasuryLedger.findFirst({
          where: { clanId },
          orderBy: { createdAt: 'desc' },
          select: { balance: true },
        });

        const before = prevBalance?.balance ?? 0;
        const after = before + soldPrice;

        await tx.treasuryLedger.create({
          data: {
            clanId,
            timelineId: tId,
            lootItemId: iId,
            entryType: TreasuryEntryType.SALE_TREASURY,
            amount: soldPrice, // 세금 제외 정산가 그대로 적립
            note: '드랍 아이템 판매금 혈비 귀속',
            balance: after,
            createdBy: actor,
          },
        });
      }
    });

    return { ok: true };
  }

  /** 분배 지급 상태 즉시 반영 (본인 or 루팅자 or 관리자만) */
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

    // 분배 + 아이템(루팅자)까지 같이 조회(루팅자 권한 체크 추가하려면 스키마 확장 필요)
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

    // 권한 확인: 수령자 본인 또는 관리자
    const isAdmin =
      input.actorRole === 'ADMIN' || input.actorRole === 'SUPERADMIN';
    let allowed = false;
    if (dist.recipientLoginId === input.actorLoginId) allowed = true;
    if (isAdmin) allowed = true;

    if (!allowed) {
      throw new ForbiddenException(
        '본인/루팅자/관리자만 분배 체크를 변경할 수 있습니다.',
      );
    }

    const now = new Date();
    const updated = await this.prisma.lootDistribution.update({
      where: { id: distId },
      data: {
        isPaid: input.isPaid,
        paidAt: input.isPaid ? now : null,
      },
      select: {
        id: true,
        lootItemId: true,
        recipientLoginId: true,
        isPaid: true,
        paidAt: true,
      },
    });

    return { ok: true, distribution: updated };
  }

  async getTimelineDetail(clanIdRaw: any, idRaw: string) {
    const clanId = this.toBigIntOrNull(clanIdRaw);
    if (!clanId) throw new BadRequestException('혈맹 정보가 필요합니다.');
    const id = this.toBigInt(idRaw);

    const t = await this.prisma.bossTimeline.findFirst({
      where: { id, clanId },
      include: {
        lootItems: true, // LootItem[]
        distributions: true, // LootDistribution[]
      },
    });

    if (!t) throw new NotFoundException('타임라인을 찾을 수 없습니다.');

    // ✅ 프론트 DTO에 맞게 매핑
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
          isTreasury: !!it.toTreasury, // 프론트는 isTreasury 사용
          toTreasury: !!it.toTreasury, // (구 호환 필드도 함께)
          soldPrice: it.soldPrice ?? null,
          soldAt: it.soldAt ? it.soldAt.toISOString() : null,
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

  async setDistributionPaid(params: {
    timelineId: string; // path param
    itemId: string; // path param
    recipientLoginId: string; // path param
    isPaid: boolean; // body
    actorLoginId: string; // req.user.loginId
  }) {
    const { timelineId, itemId, recipientLoginId, isPaid } = params;

    // 존재 확인 (분배 레코드)
    const dist = await this.prisma.lootDistribution.findFirst({
      where: {
        timelineId: BigInt(timelineId),
        lootItemId: BigInt(itemId),
        recipientLoginId,
      },
      select: { id: true, isPaid: true },
    });
    if (!dist) {
      throw new NotFoundException('분배 대상이 존재하지 않습니다.');
    }

    // 업데이트
    const updated = await this.prisma.lootDistribution.update({
      where: { id: dist.id },
      data: {
        isPaid,
        paidAt: isPaid ? new Date() : null,
      },
    });

    return {
      ok: true,
      item: { id: updated.id, isPaid: updated.isPaid, paidAt: updated.paidAt },
    };
  }
}