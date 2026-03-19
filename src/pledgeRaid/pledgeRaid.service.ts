import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SaveRaidItemsDto, RaidItemDto } from './dto/save-raid-items.dto';
import { QueryRaidItemsDto } from './dto/query-raid-items.dto';
import { UserListQueryDto, ParticipantDto } from './dto/user-list.dto';
import { CompleteDistributionDto } from './dto/complete-distribution.dto';
import { ParticipantItemDto } from './dto/add-participants.dto';
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

    const participantCount = await this.prisma.pledgeRaidParticipant.count({
      where: { year, month, week, clanId, bossMetaId },
    });

    const distCountsByItemId = new Map<string, number>();
    if (participantCount > 0) {
      const distRows = await this.prisma.pledgeRaidDistributeStatus.findMany({
        where: {
          year,
          month,
          week,
          clanId,
          bossMetaId,
          distYn: 'Y',
        },
        select: {
          dropItemId: true,
        },
      });

      for (const row of distRows) {
        const key = String(row.dropItemId);
        distCountsByItemId.set(key, (distCountsByItemId.get(key) ?? 0) + 1);
      }
    }

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
      isDistributed:
        participantCount > 0 &&
        (distCountsByItemId.get(String(r.id)) ?? 0) >= participantCount,
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

  /**
   * 혈맹원 목록 조회 (searchGbn: 1=목록만, 2=분배정보포함)
   * searchGbn이 1: 혈맹원 목록만 가나다 순
   * searchGbn이 2: 혈맹원 + 분배받아야할 분배금액 + 분배완료 여부
   */
  async getUserList(params: {
    year: number;
    month: number;
    week: number;
    clanId: number;
    bossMetaId: number;
    searchGbn: number;
  }) {
    const { year, month, week, clanId, bossMetaId, searchGbn } = params;

    // 1) 해당 주차/보스의 참여자 목록 조회
    const participants = await this.prisma.pledgeRaidParticipant.findMany({
      where: {
        year,
        month,
        week,
        clanId,
        bossMetaId,
      },
      select: {
        userId: true,
      },
    });

    const userIds = participants.map((p) => p.userId);

    if (userIds.length === 0) {
      return { participants: [] };
    }

    // 2) 사용자 정보 조회 (User 테이블에서 id, loginId, clanId 사용)
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: userIds.map((id) => BigInt(id)),
        },
      },
      select: {
        id: true,
        loginId: true,
      },
    });

    // 3) searchGbn이 2인 경우 분배정보 조회
    let distributionMap: Map<number, any> = new Map();

    if (searchGbn === 2) {
      // 해당 주차/보스의 드랍 아이템 조회
      const dropItems = await this.prisma.pledgeRaidDropItem.findMany({
        where: {
          year,
          month,
          week,
          clanId,
          bossMetaId,
        },
      });

      // 각 사용자별로 분배받아야 할 금액 계산
      // 판매완료된 아이템의 판매금액을 1/n으로 분할
      for (const item of dropItems) {
        if (item.isSold === 1 && item.soldPrice && item.soldPrice > 0) {
          const distributionPerUser = Math.floor(
            item.soldPrice / userIds.length,
          );

          for (const userId of userIds) {
            const current = distributionMap.get(userId) || {
              distributionAmount: 0,
              isDistributed: false,
            };
            current.distributionAmount += distributionPerUser;
            distributionMap.set(userId, current);
          }
        }
      }

      // 모든 드랍 아이템이 분배완료 상태인지 확인
      const allDistributed = dropItems.length > 0
        ? dropItems.every((item) => item.isDistributed === 1)
        : false;

      for (const [userId, info] of distributionMap.entries()) {
        info.isDistributed = allDistributed;
      }
    }

    // 4) 결과 구성 (가나다 순 정렬)
    const result: ParticipantDto[] = users
      .map((user) => {
        const userId = Number(user.id);
        const distInfo =
          searchGbn === 2 ? distributionMap.get(userId) : undefined;

        const participant: ParticipantDto = {
          name: user.loginId,
        };

        if (searchGbn === 2 && distInfo) {
          // 분배금액: 0이면 "-", 아니면 숫자
          participant.distributionAmount =
            distInfo.distributionAmount === 0 ? '-' : distInfo.distributionAmount;
          // 분배상태: "Y" 또는 "N"
          participant.status = distInfo.isDistributed ? 'Y' : 'N';
        }

        return participant;
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { participants: result };
  }

  /**
   * 내 혈맹의 전체 혈맹원 목록 조회
   */
  async getClanMembers(loginId: string) {
    // 1) 로그인 사용자 조회
    const currentUser = await this.prisma.user.findFirst({
      where: { loginId },
      select: {
        clanId: true,
      },
    });

    if (!currentUser || !currentUser.clanId) {
      return { members: [] };
    }

    // 2) 해당 혈맹의 모든 사용자 조회
    const members = await this.prisma.user.findMany({
      where: {
        clanId: currentUser.clanId,
      },
      select: {
        id: true,
        loginId: true,
        role: true,
      },
      orderBy: {
        loginId: 'asc',
      },
    });

    // 3) 응답 형식으로 변환
    const result = members.map((member) => ({
      userId: Number(member.id),
      loginId: member.loginId,
      nickname: null,
      role:
        member.role === 'LEADER'
          ? 'LEADER'
          : member.role === 'ADMIN'
            ? 'ADMIN'
            : 'MEMBER',
    }));

    return { members: result };
  }

  /**
   * 보스 레이드 참여자 목록 조회
   */
  async getParticipants(params: {
    year: number;
    month: number;
    week: number;
    clanId: number;
    bossMetaId: number;
    itemId?: number;
  }) {
    const { year, month, week, clanId, bossMetaId, itemId } = params;

    // 1) 해당 주차/보스의 참여자 조회
    const participants = await this.prisma.pledgeRaidParticipant.findMany({
      where: {
        year,
        month,
        week,
        clanId,
        bossMetaId,
      },
      select: {
        userId: true,
      },
    });

    const userIds = participants.map((p) => p.userId);

    if (userIds.length === 0) {
      return { participants: [] };
    }

    // 2) 사용자 정보 조회
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: userIds.map((id) => BigInt(id)),
        },
      },
      select: {
        id: true,
        loginId: true,
        role: true,
      },
      orderBy: {
        loginId: 'asc',
      },
    });

    // 3) 아이템 분배 정보 조회 (itemId가 있는 경우만)
    let distributionByUserId: Map<number, { distAmount: bigint | null; distYn: string | null }> =
      new Map();

    if (itemId != null) {
      const distRows = await this.prisma.pledgeRaidDistributeStatus.findMany({
        where: {
          year,
          month,
          week,
          clanId,
          bossMetaId,
          dropItemId: BigInt(itemId),
        },
        select: {
          userId: true,
          distAmount: true,
          distYn: true,
        },
      });

      for (const row of distRows) {
        distributionByUserId.set(row.userId, {
          distAmount: row.distAmount ?? null,
          distYn: row.distYn ?? null,
        });
      }
    }

    // 4) 응답 형식으로 변환
    const result = users.map((user) => {
      const base = {
        userId: Number(user.id),
        loginId: user.loginId,
        nickname: null,
        role:
          user.role === 'LEADER'
            ? 'LEADER'
            : user.role === 'ADMIN'
              ? 'ADMIN'
              : 'MEMBER',
      };

      if (itemId == null) {
        return base;
      }

      const dist = distributionByUserId.get(Number(user.id));
      return {
        ...base,
        distAmount: dist?.distAmount != null ? Number(dist.distAmount) : null,
        distYn: dist?.distYn === 'Y' ? 'Y' : 'N',
      };
    });

    return { participants: result };
  }

  /**
   * 참여자 저장 (기존 데이터 삭제 후 새로 삽입)
   * 같은 year, month, week, clanId, bossMetaId의 모든 참여자 데이터를 삭제하고
   * 새로운 참여자 데이터를 한 번에 삽입
   */
  async addParticipants(participants: ParticipantItemDto[]) {
    if (!participants || participants.length === 0) {
      return { ok: true, count: 0 };
    }

    // 첫 번째 항목에서 컨텍스트 정보 추출
    const { year, month, week, clanId, bossMetaId } = participants[0];

    // 트랜잭션: 기존 데이터 삭제 → 새 데이터 삽입
    const result = await this.prisma.$transaction(async (tx) => {
      // 1) 기존 데이터 모두 삭제
      await tx.pledgeRaidParticipant.deleteMany({
        where: {
          year,
          month,
          week,
          clanId,
          bossMetaId,
        },
      });

      // 2) 새 데이터 한 번에 삽입
      const created = await tx.pledgeRaidParticipant.createMany({
        data: participants.map((p) => ({
          year: p.year,
          month: p.month,
          week: p.week,
          clanId: p.clanId,
          bossMetaId: p.bossMetaId,
          userId: p.userId,
        })),
      });

      return created;
    });

    return { ok: true, count: result.count };
  }

  /**
   * 분배 완료 처리
   * 특정 아이템(itemId)을 특정 사용자(userId)에게 분배금액(distributionAmount)만큼 처리
   * PledgeRaidDistributeStatus 테이블에 분배 정보를 기록
   */
  async completeDistribution(params: {
    year: number;
    month: number;
    week: number;
    clanId: number;
    bossMetaId: number;
    itemId: number;
    userId: number;
    distributionAmount: number;
  }) {
    const { year, month, week, clanId, bossMetaId, itemId, userId, distributionAmount } = params;

    // PledgeRaidDistributeStatus에 분배 정보 저장
    const result = await this.prisma.pledgeRaidDistributeStatus.upsert({
      where: {
        year_month_week_clanId_bossMetaId_userId_dropItemId: {
          year,
          month,
          week,
          clanId,
          bossMetaId,
          userId,
          dropItemId: BigInt(itemId),
        },
      },
      create: {
        year,
        month,
        week,
        clanId,
        bossMetaId,
        userId,
        dropItemId: BigInt(itemId),
        distAmount: BigInt(distributionAmount),
        distYn: 'Y',
      },
      update: {
        distAmount: BigInt(distributionAmount),
        distYn: 'Y',
      },
    });

    console.log(
      `[completeDistribution] Item ${itemId} distribution completed for user ${userId}: ${distributionAmount}`,
    );

    return {
      ok: true,
      message: '분배가 완료되었습니다',
      itemId,
      userId,
      distributionAmount,
    };
  }

  /**
   * 참여자 분배 정보 업데이트 (사용자별 분배 완료)
   * PledgeRaidDistributeStatus 테이블의 모든 아이템에 대해 분배 정보 업데이트
   * 모든 분배가 완료되면 해당 보스의 아이템들도 isDistributed = 1로 설정
   */
  async updateParticipantDistribution(params: {
    year: number;
    month: number;
    week: number;
    clanId: number;
    bossMetaId: number;
    userId: number;
    distributionAmount: number;
  }) {
    const { year, month, week, clanId, bossMetaId, userId, distributionAmount } = params;

    // 해당 사용자가 이 레이드에서 받은 모든 아이템에 대해 분배 정보 업데이트
    const distributionRecords = await this.prisma.pledgeRaidDistributeStatus.findMany({
      where: {
        year,
        month,
        week,
        clanId,
        bossMetaId,
        userId,
      },
    });

    // 모든 분배 레코드 업데이트
    for (const record of distributionRecords) {
      await this.prisma.pledgeRaidDistributeStatus.update({
        where: {
          year_month_week_clanId_bossMetaId_userId_dropItemId: {
            year,
            month,
            week,
            clanId,
            bossMetaId,
            userId,
            dropItemId: record.dropItemId,
          },
        },
        data: {
          distAmount: BigInt(distributionAmount),
          distYn: 'Y',
        },
      });
    }

    // 현재 보스에 대해 모든 분배가 완료했는지 확인
    const allDistributeRecords = await this.prisma.pledgeRaidDistributeStatus.findMany({
      where: {
        year,
        month,
        week,
        clanId,
        bossMetaId,
      },
    });

    const allDistributed = allDistributeRecords.every(r => r.distYn === 'Y');
    const totalRecords = allDistributeRecords.length;
    console.log(`[updateParticipantDistribution] Boss ${bossMetaId}: ${totalRecords} distribution records, all completed: ${allDistributed}`);

    // 모든 분배가 완료되었다면 해당 보스의 판매된 아이템들을 isDistributed = 1로 설정
    if (allDistributed && totalRecords > 0) {
      console.log(`[updateParticipantDistribution] Marking items as distributed for boss ${bossMetaId}`);

      const updatedItems = await this.prisma.pledgeRaidDropItem.updateMany({
        where: {
          year,
          month,
          week,
          clanId,
          bossMetaId,
          isSold: 1,
        },
        data: {
          isDistributed: 1,
        },
      });

      console.log(`[updateParticipantDistribution] Updated ${updatedItems.count} items as distributed`);
    }

    return {
      ok: true,
      message: '참여자 분배 정보가 업데이트되었습니다',
      userId,
      distributionAmount,
      isDistributed: 'Y',
    };
  }
}
