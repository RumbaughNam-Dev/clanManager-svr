import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SaveRaidItemsDto, RaidItemDto } from './dto/save-raid-items.dto';
import { QueryRaidItemsDto } from './dto/query-raid-items.dto';
import { TreasuryService } from '../treasury/treasury.service';

type GetRaidResultsParams = {
  year: number;
  month: number;
  week: number;
  clanId: number;
};

type CutBossParams = GetRaidResultsParams & {
  bossMetaId: number;
	distributionMode?: "ITEM" | "TREASURY";
};

@Injectable()
export class PledgeRaidService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly treasuryService: TreasuryService,
  ) {}

  /**
   * 혈맹 레이드 보스 메타 정보 조회
   * PledgeBossRaidMeta 기준
   */
  async getBossMetas() {
    const rows = await this.prisma.pledgeBossRaidMeta.findMany({
      select: {
        bossMetaId: true,
        bossName: true,
        raidLevel: true,
        howManyKey: true,
      },
      orderBy: {
        raidLevel: 'asc',
      },
    });

    // 프론트는 bossMetaId, bossName 위주로 쓰고,
    // 나머지는 나중에 쓸 수도 있으니 그대로 내려줌
    return rows;
  }

  /**
   * 특정 주차의 레이드 컷 결과 조회
   * → 어떤 보스들이 잡혔는지 여부 확인용
   */
  async getRaidResults(params: GetRaidResultsParams) {
    const { year, month, week, clanId } = params;

    const rows = await this.prisma.pledgeRaidResult.findMany({
      where: {
        year,
        month,
        week,
        clanId,
      },
      select: {
        bossMetaId: true,
      },
    });

    // 프론트에서는 bossMetaId 리스트만 필요해서 그대로 리턴
    return rows;
  }

  /**
   * 보스 컷 처리
   * PledgeRaidResult에 한 줄 넣어주면 "잡았다"로 인정
   * 이미 기록이 있으면 upsert로 중복 에러 없이 무시
   */
  async cutBoss(params: CutBossParams, actorLoginId: string) {
    const { year, month, week, clanId, bossMetaId, distributionMode } = params;

    const isTreasury = distributionMode === "TREASURY";

    await this.prisma.pledgeRaidResult.upsert({
      where: {
        year_month_week_clanId_bossMetaId: { year, month, week, clanId, bossMetaId },
      },
      create: {
        year,
        month,
        week,
        clanId,
        bossMetaId,
        isTreasury,
        createdBy: actorLoginId,
      },
      update: {
        isTreasury,
        updatedBy: actorLoginId,
      },
    });

    return { ok: true };
  }

  // src/pledge-raid/pledge-raid.service.ts
  async saveRaidItems(dto: SaveRaidItemsDto, actorLoginId: string) {
    const { year, month, week, clanId, bossMetaId } = dto;
    const nextItems = dto.items ?? [];

    // ✅ 보스 분배모드
    const result = await this.prisma.pledgeRaidResult.findUnique({
      where: { year_month_week_clanId_bossMetaId: { year, month, week, clanId, bossMetaId } },
      select: { isTreasury: true },
    });
    const resultIsTreasury = result?.isTreasury ?? false;

    // ✅ 기존 아이템
    const existing = await this.prisma.pledgeRaidDropItem.findMany({
      where: { year, month, week, clanId, bossMetaId },
    });
    const existingById = new Map<string, (typeof existing)[number]>();
    for (const r of existing) existingById.set(String(r.id), r);

    // 보스명 1회
    const bossMeta = await this.prisma.pledgeBossRaidMeta.findUnique({
      where: { bossMetaId },
      select: { bossName: true },
    });
    const bossName = bossMeta?.bossName ?? `#${bossMetaId}`;

    // ✅ 들어온 id 목록 (기존 것은 id가 있고, 신규는 id 없음)
    const incomingIds = new Set<string>(
      nextItems.filter((x) => x.id != null && String(x.id).length > 0).map((x) => String(x.id))
    );

    // ✅ 삭제 대상: 기존에 있는데 이번에 없는 id
    const deleted = existing.filter((r) => !incomingIds.has(String(r.id)));

    // 1) DB 반영 (업서트 + delete)
    await this.prisma.$transaction(async (tx) => {
      // 업데이트/신규
      for (const it of nextItems) {
        const data = {
          year, month, week, clanId, bossMetaId,
          itemName: it.itemName,
          rootUserId: String(it.rootUserId),
          isSold: it.isSold ? 1 : 0,
          soldPrice: it.soldPrice ?? 0,
          // isTreasury는 이제 의미 없음(보스단위)
        };

        // ✅ id가 "유효한 숫자"일 때만 update 시도
        const hasId = it.id != null && String(it.id).trim() !== "" && String(it.id) !== "0";

        if (hasId) {
          const id = BigInt(String(it.id));
          const exists = await tx.pledgeRaidDropItem.findUnique({ where: { id } });

          if (exists) {
            await tx.pledgeRaidDropItem.update({
              where: { id },
              data,
            });
          } else {
            await tx.pledgeRaidDropItem.create({ data });
          }
        } else {
          await tx.pledgeRaidDropItem.create({ data });
        }
      }

      // 누락된 것 삭제
      if (deleted.length > 0) {
        await tx.pledgeRaidDropItem.deleteMany({
          where: { id: { in: deleted.map((x) => x.id) } },
        });
      }
    });

    // ✅ 여기 추가: 트랜잭션 이후 "현재 DB 상태" 재조회 (신규 id 반영)
    const current = await this.prisma.pledgeRaidDropItem.findMany({
      where: { year, month, week, clanId, bossMetaId },
    });
    const currentById = new Map<string, (typeof current)[number]>();
    for (const r of current) currentById.set(String(r.id), r);

    // 2) 혈비 원장 diff (보스가 혈비귀속일 때만)
    if (resultIsTreasury) {
      // ✅ now는 "요청(nextItems)"이 아니라 "DB 현재 상태(currentById)"를 기준으로 본다.

      // (A) 업데이트된/남아있는 것: prev vs now 비교
      for (const [id, prev] of existingById.entries()) {
        const now = currentById.get(id); // ✅ 변경
        const prevWasSold = prev.isSold === 1 && (prev.soldPrice ?? 0) > 0;

        // 삭제된 항목은 (B)에서 처리
        if (!now) continue;

        const nowIsSold = now.isSold === 1 && (now.soldPrice ?? 0) > 0; // ✅ 변경 (DB row)

        // +: 이전 미판매 -> 판매완료
        if (!prevWasSold && nowIsSold) {
          await this.treasuryService.recordPledgeRaidSale({
            clanId,
            actor: actorLoginId,
            amount: Number(now.soldPrice ?? 0),
            note: `혈맹레이드 템 판매 (${bossName}-${now.itemName})`,
            timelineId: null,
            lootItemId: null,
            entryType: "PLEDGE_RAID",
          });
        }

        // -: 이전 판매완료 -> 미판매(취소) 또는 금액 0
        if (prevWasSold && !nowIsSold) {
          await this.treasuryService.recordPledgeRaidSale({
            clanId,
            actor: actorLoginId,
            amount: -Number(prev.soldPrice ?? 0),
            note: `혈맹레이드 템 판매취소 (${bossName}-${prev.itemName})`,
            timelineId: null,
            lootItemId: null,
            entryType: "PLEDGE_RAID_CANCEL",
          });
        }

        // 판매금액 변경 케이스: prev 1000 -> now 1200
        if (prevWasSold && nowIsSold) {
          const delta = Number(now.soldPrice ?? 0) - Number(prev.soldPrice ?? 0);
          if (delta !== 0) {
            await this.treasuryService.recordPledgeRaidSale({
              clanId,
              actor: actorLoginId,
              amount: delta,
              note: `[혈맹 레이드 정정 - ${bossName}] ${now.itemName}`,
              timelineId: null,
              lootItemId: null,
              entryType: "PLEDGE_RAID",
            });
          }
        }
      }

      // (B) 삭제된 항목: 판매완료였으면 취소(-)  (이건 기존대로 OK)
      for (const prev of deleted) {
        const prevWasSold = prev.isSold === 1 && (prev.soldPrice ?? 0) > 0;
        if (!prevWasSold) continue;

        await this.treasuryService.recordPledgeRaidSale({
          clanId,
          actor: actorLoginId,
          amount: -Number(prev.soldPrice ?? 0),
          note: `[혈맹 레이드 취소 - ${bossName}] ${prev.itemName}`,
          timelineId: null,
          lootItemId: null,
          entryType: "PLEDGE_RAID_CANCEL",
        });
      }
    }

    return { ok: true };
  }

  /**
   * 특정 주차 / 보스의 드랍 아이템 목록 조회
   * (팝업 열 때 초기 데이터 로딩용)
   */
  async listRaidItems(query: QueryRaidItemsDto) {
    const { year, month, week, clanId, bossMetaId } = query;

    const result = await this.prisma.pledgeRaidResult.findUnique({
      where: { year_month_week_clanId_bossMetaId: { year, month, week, clanId, bossMetaId } },
      select: { isTreasury: true },
    });

    const rows = await this.prisma.pledgeRaidDropItem.findMany({
      where: { year, month, week, clanId, bossMetaId },
      orderBy: { itemName: 'asc' },
    });

    const items = rows.map((r) => ({
      id: String(r.id),            // ✅ 핵심
      itemName: r.itemName,
      rootUserId: r.rootUserId,
      isSold: r.isSold === 1,
      soldPrice: r.soldPrice ?? 0,
      isDistributed: r.isDistributed === 1, // 있으면
    }));

    return { ok: true, isTreasury: result?.isTreasury ?? false, items };
  }

  /**
   * 개별 아이템의 판매/혈비 상태만 부분 업데이트 하고 싶을 때용 (선택)
   */
  async updateItemStatus(
	id: string | bigint,
	payload: { isSold?: boolean; soldPrice?: number }) {
	const updated = await this.prisma.pledgeRaidDropItem.update({
		where: { id: BigInt(String(id)) },
		data: {
			...(payload.isSold !== undefined && { isSold: payload.isSold ? 1 : 0 }),
			...(payload.soldPrice !== undefined && { soldPrice: payload.soldPrice ?? 0 }),
		},
	});

	return { ok: true, item: updated };
  }

  // ✅ DTO 재사용
  async saveItems(dto: SaveRaidItemsDto, actorLoginId: string) {
    const { year, month, week, clanId, bossMetaId, items } = dto;

    // 기존 아이템 읽기
    const existing = await this.prisma.pledgeRaidDropItem.findMany({
      where: { year, month, week, clanId, bossMetaId },
    });

    const existingMap = new Map<string, typeof existing[number]>();
    for (const row of existing) {
      existingMap.set(row.itemName, row);
    }

    for (const item of items) {
      const prev = existingMap.get(item.itemName);

      const isSoldInt = item.isSold ? 1 : 0;
      const isTreasuryInt = item.isTreasury ? 1 : 0;

      const data = {
        year,
        month,
        week,
        clanId,
        bossMetaId,
        itemName: item.itemName,
        rootUserId: String(item.rootUserId),
        isSold: item.isSold ? 1 : 0,
        soldPrice: item.soldPrice ?? 0,
        isTreasury: item.isTreasury ? 1 : 0, // (나중에 제거 예정이면 0 고정)
      };

      if (item.id) {
        await this.prisma.pledgeRaidDropItem.update({
          where: { id: BigInt(String(item.id)) },
          data,
        });
      } else {
        await this.prisma.pledgeRaidDropItem.create({ data });
      }

      // 🔹 여기부터 조건만 살짝 강화해서 사용하자

      // 이전 상태: 이미 "혈비귀속+판매완료" 였는지
      const wasSoldTreasuryBefore =
        !!prev && prev.isSold === 1 && prev.isTreasury === 1;

      // 현재 상태: 혈비귀속 + 판매완료 + 판매금액 > 0 인지
      const isSoldTreasuryNow =
        item.isSold === true &&
        item.isTreasury === true &&
        item.soldPrice != null &&
        item.soldPrice > 0;
    }

    return { ok: true };
  }
}