// src/dashboard/dashboard.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Prisma } from '@prisma/client';

type BossDto = {
  id: string;
  name: string;
  location: string;
  respawn: number;            // 분 단위
  isRandom: boolean;
  lastCutAt: string | null;   // ISO
  nextSpawnAt: string | null; // ISO (롤링 후 “다음” 한 번)
  overdue: boolean;           // nextSpawnAt < now
};

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private toBigIntOrNull(v: any) {
    if (v == null) return null;
    try { return BigInt(String(v)); } catch { return null; }
  }

  private toBigInt(v: any, msg = '잘못된 ID') {
    try { return BigInt(String(v)); } catch { throw new BadRequestException(msg); }
  }

  private toNumber(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * 로그인 여부와 관계없이:
   * - 모든 보스 메타를 가져온다.
   * - clanId가 있으면 해당 혈맹의 최신 컷을 붙여서 nextSpawn(가장 최근 컷 + respawn분) 계산
   * - 최신 컷 있는 보스 먼저(nextSpawn 가까운 순), 그 다음 컷 없는 보스(respawn 짧은 순)
   */
  // 꼭: respawn은 "분" 단위라고 가정
  async listBossesForClan(clanIdRaw?: any): Promise<{
    ok: true;
    serverTime: string;
    tracked: BossDto[];
    forgotten: BossDto[];
  }> {
    const metas = await this.prisma.bossMeta.findMany({
      select: { id: true, name: true, location: true, respawn: true, isRandom: true },
      orderBy: [{ orderNo: 'asc' }, { name: 'asc' }],
    });

    const clanId = this.toBigIntOrNull(clanIdRaw);
    const nowMs = Date.now();

    // 최근 컷(보스명 기준)
    const latestByBoss: Record<string, Date> = {};
    if (clanId) {
      const grouped = await this.prisma.bossTimeline.groupBy({
        by: ['bossName'],
        where: { clanId },
        _max: { cutAt: true },
      });
      for (const g of grouped) {
        if (g._max?.cutAt) latestByBoss[g.bossName] = g._max.cutAt;
      }
    }

    const tracked: Array<BossDto & { _sortMs: number }> = [];
    const forgotten: Array<BossDto & { _sortMs: number }> = [];

    for (const m of metas) {
      const respawnMinutes = this.toNumber((m as any).respawn); // 분
      const last = latestByBoss[m.name] ?? null;

      if (!last) {
        // 컷 기록 없음 → 중앙 섹션
        forgotten.push({
          id: String(m.id),
          name: m.name,
          location: m.location,
          respawn: respawnMinutes,
          isRandom: !!m.isRandom,
          lastCutAt: null,
          nextSpawnAt: null,
          overdue: false,
          _sortMs: Number.MAX_SAFE_INTEGER, // 정렬 맨 뒤
        });
        continue;
      }

      const lastMs = last.getTime();
      const { nextMs, missed } = this.rollNextAndMissed(lastMs, respawnMinutes, nowMs);

      const row: BossDto & { _sortMs: number } = {
        id: String(m.id),
        name: m.name,
        location: m.location,
        respawn: respawnMinutes,
        isRandom: !!m.isRandom,
        lastCutAt: last.toISOString(),
        nextSpawnAt: new Date(nextMs).toISOString(),
        overdue: nextMs < nowMs, // 이론상 false(rollNext 이후는 항상 미래), 안전상 유지
        _sortMs: nextMs,
      };

      if (missed >= 5) {
        // 5회 이상 놓침 → 중앙 섹션
        forgotten.push(row);
      } else {
        // 추적 중 → 좌측 섹션
        tracked.push(row);
      }
    }

    // 정렬: 가까운 nextSpawn 순
    tracked.sort((a, b) => a._sortMs - b._sortMs);
    forgotten.sort((a, b) => a._sortMs - b._sortMs);

    const trackedOut: BossDto[] = tracked.map(({ _sortMs, ...rest }) => rest);
    const forgottenOut: BossDto[] = forgotten.map(({ _sortMs, ...rest }) => rest);

    return {
      ok: true,
      serverTime: this.formatDate(new Date()),
      tracked: trackedOut,
      forgotten: forgottenOut,
    };
  }

  private rollNextAndMissed(lastMs: number, respawnMin: number, nowMs: number) {
    const step = respawnMin * 60 * 1000;
    if (step <= 0) return { nextMs: lastMs, missed: 0 };
    let next = lastMs + step;
    if (nowMs <= next) return { nextMs: next, missed: 0 };
    const diff = nowMs - next;
    const k = Math.floor(diff / step) + 1; // 지나간 사이클 수
    next = next + k * step;
    return { nextMs: next, missed: k };
  }

  private formatDate(d: Date): string {
    // "YYYY-MM-DD HH:mm:ss"
    const z = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  }

  private toMinutes(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * 보스 컷 + (선택) 세부정보 저장
   * - 필수: BossTimeline
   * - 참여자: LootDistribution에 “lootItemId: null” 로 참여기록 초기화
   * - 아이템: LootItem 생성
   * - 분배 모드면: 아이템 × 참여자 조합으로 LootDistribution 레코드도 미리 생성(금액/지급은 추후 업데이트)
   * - 이미지 파일명은 imageIds(JSON 배열)로 저장
   */
  async cutBoss(
    clanIdRaw: string | undefined,
    bossMetaId: string,
    body: {
      cutAtIso: string;
      looterLoginId?: string | null;
      items?: string[];
      mode: 'DISTRIBUTE' | 'TREASURY';
      participants?: string[];
      imageFileName?: string;
      actorLoginId?: string;
    },
    actorLoginIdFromArg?: string,
  ) {
    if (!clanIdRaw) throw new BadRequestException('혈맹 정보가 필요합니다.');
    const clanId = this.toBigInt(clanIdRaw);

    const meta = await this.prisma.bossMeta.findUnique({
      where: { id: this.toBigInt(bossMetaId) },
      select: { name: true },
    });
    if (!meta) throw new BadRequestException('보스 메타를 찾을 수 없습니다.');

    // 컷 시간
    const cutAt = new Date(body.cutAtIso);
    if (isNaN(cutAt.getTime())) throw new BadRequestException('cutAtIso 형식이 올바르지 않습니다.');

    // 입력 정리
    const rawParticipants = (body.participants ?? []).map(s => s.trim()).filter(Boolean);
    const items = (body.items ?? []).map(s => s.trim()).filter(Boolean);
    const rawLooter = (body.looterLoginId ?? '').trim() || null;

    // 🔎 혈맹원 목록 조회(루팅자 검증용)
    const clanMembers = await this.prisma.user.findMany({
      where: { clanId },
      select: { loginId: true },
    });
    const memberSet = new Set(clanMembers.map(u => u.loginId));

    // ✅ 루팅자 검증: 혈맹에 없으면 null 처리(=> 나중에 프론트에서 "미가입 회원" 표기)
    const looter: string | null = rawLooter && memberSet.has(rawLooter) ? rawLooter : null;

    // ⛳ 검증: 아이템이 있고 분배 모드면 참여자 최소 1명 필요
    // (루팅자만 있고 참여자 0명인 경우도 허용하려면 아래 검증을 제거/완화하세요)
    if (items.length > 0 && body.mode === 'DISTRIBUTE' && rawParticipants.length === 0) {
      throw new BadRequestException('분배 모드에서는 참여자를 1명 이상 입력해야 합니다.');
    }

    const actor = body.actorLoginId ?? actorLoginIdFromArg ?? 'system';

    const created = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1) 타임라인
      const timeline = await tx.bossTimeline.create({
        data: {
          clanId,
          bossName: meta.name,
          imageIds: body.imageFileName ? [body.imageFileName] : [],
          cutAt,
          createdBy: actor,
        },
        select: { id: true },
      });

      // 2) 아이템 생성
      let createdItems: { id: bigint; itemName: string }[] = [];
      if (items.length > 0) {
        createdItems = [];
        for (const itemName of items) {
          const it = await tx.lootItem.create({
            data: {
              timelineId: timeline.id,
              itemName,
              isSold: false,
              soldAt: null,
              soldPrice: null,
              toTreasury: body.mode === 'TREASURY',
              createdBy: actor,
            },
            select: { id: true, itemName: true },
          });
          createdItems.push(it);
        }
      }

      // 3) 분배 모드면: 아이템 × (참여자 ∪ 루팅자) 생성 (중복 제거)
      if (body.mode === 'DISTRIBUTE' && createdItems.length > 0) {
        const everyoneSet = new Set<string>(rawParticipants);
        if (looter) everyoneSet.add(looter); // 루팅자 포함 + 자동 중복 제거
        const everyone = Array.from(everyoneSet);

        if (everyone.length > 0) {
          const rows = createdItems.flatMap((it) =>
            everyone.map((loginId) => ({
              timelineId: timeline.id,
              lootItemId: it.id,
              recipientLoginId: loginId,
              amount: null,
              isPaid: false,
              paidAt: null,
              createdBy: actor,
            })),
          );
          await tx.lootDistribution.createMany({ data: rows });
        }
      }

      return timeline;
    });

    return { ok: true, id: String(created.id) };
  }
}