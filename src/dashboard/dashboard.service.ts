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
  nextSpawnAt: string | null; // ISO
  overdue: boolean;
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
   * 보스 목록 + (선택) 혈맹별 최신컷으로 nextSpawn 계산
   */
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

    // 보스명 기준 최근 컷
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
      const respawnMinutes = this.toNumber((m as any).respawn);
      const last = latestByBoss[m.name] ?? null;

      if (!last) {
        forgotten.push({
          id: String(m.id),
          name: m.name,
          location: m.location,
          respawn: respawnMinutes,
          isRandom: !!m.isRandom,
          lastCutAt: null,
          nextSpawnAt: null,
          overdue: false,
          _sortMs: Number.MAX_SAFE_INTEGER,
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
        overdue: nextMs < nowMs,
        _sortMs: nextMs,
      };

      if (missed >= 5) forgotten.push(row);
      else tracked.push(row);
    }

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
    const k = Math.floor(diff / step) + 1;
    next = next + k * step;
    return { nextMs: next, missed: k };
  }

  private formatDate(d: Date): string {
    const z = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  }

  /**
   * 보스 컷 생성
   * - BossTimeline 1건
   * - LootItem N건 (각 아이템에 lootUserId 저장)
   * - 분배 모드면 LootDistribution 사전생성
   * - imageFileName 은 imageIds JSON 배열에 1건으로 저장
   */
  async cutBoss(
    clanIdRaw: string | undefined,
    bossMetaId: string,
    body: {
      cutAtIso: string;
      // 레거시 공통(있을 수도/없을 수도)
      looterLoginId?: string | null;
      // 레거시: 아이템 이름 배열
      items?: string[];

      // 확장: 아이템+루팅자 1:1
      itemsEx?: Array<{ name: string; lootUserId?: string | null }>;

      mode: 'DISTRIBUTE' | 'TREASURY';
      participants?: string[];
      imageFileName?: string;
      actorLoginId?: string;
    },
    actorLoginIdFromArg?: string,
  ) {
    if (!clanIdRaw) throw new BadRequestException('혈맹 정보가 필요합니다.');
    const clanId = BigInt(clanIdRaw);

    const meta = await this.prisma.bossMeta.findUnique({
      where: { id: BigInt(bossMetaId) },
      select: { name: true },
    });
    if (!meta) throw new BadRequestException('보스 메타를 찾을 수 없습니다.');

    const cutAt = new Date(body.cutAtIso);
    if (isNaN(cutAt.getTime())) {
      throw new BadRequestException('cutAtIso 형식이 올바르지 않습니다.');
    }

    const actor = body.actorLoginId ?? actorLoginIdFromArg ?? 'system';

    // 참여자 정리
    const participants = (body.participants ?? []).map(s => s.trim()).filter(Boolean);

    // 입력 소스 정규화: itemsEx 우선, 없으면 (items + lootUsers/looterLoginId) 조합
    type SourceRow = { itemName: string; lootUserIdRaw?: string | null };
    let source: SourceRow[] = [];

    if (Array.isArray(body.itemsEx) && body.itemsEx.length > 0) {
      source = body.itemsEx
        .map(r => ({
          itemName: (r?.name ?? '').trim(),
          lootUserIdRaw: (r?.lootUserId ?? '').trim() || null,
        }))
        .filter(r => !!r.itemName);
    } else {
      const items = (body.items ?? []).map(s => s.trim()).filter(Boolean);
      // (선택) 클라이언트에서 보낸 parallel 배열이 있다면 쓰고, 없으면 null로
      const lootUsers: (string | null)[] =
        (body as any).lootUsers && Array.isArray((body as any).lootUsers)
          ? (body as any).lootUsers.map((s: any) => (typeof s === 'string' ? s.trim() : '') || null)
          : [];

      source = items.map((name, idx) => ({
        itemName: name,
        lootUserIdRaw: lootUsers[idx] ?? (body.looterLoginId ?? null),
      }));
    }

    if (source.length > 0 && body.mode === 'DISTRIBUTE' && participants.length === 0) {
      throw new BadRequestException('분배 모드에서는 참여자를 1명 이상 입력해야 합니다.');
    }

    // 트랜잭션
    const created = await this.prisma.$transaction(async (tx) => {
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

      // 2) 아이템 생성 (❗ lootUserId는 무조건 문자열로 확정해서 저장)
      const createdItems: { id: bigint; itemName: string }[] = [];
      for (const row of source) {
        // 우선순위: per-item → 공통 → actor
        const lootUserId =
          (row.lootUserIdRaw ?? '').trim() ||
          (body.looterLoginId ?? '').trim() ||
          actor;

        const it = await tx.lootItem.create({
          data: {
            timelineId: timeline.id,
            itemName: row.itemName,
            isSold: false,
            soldAt: null,
            soldPrice: null,
            toTreasury: body.mode === 'TREASURY',
            lootUserId,            // ✅ NOT NULL 보장
            createdBy: actor,
          },
          select: { id: true, itemName: true },
        });
        createdItems.push(it);
      }

      // 3) 분배 레코드 (분배 모드인 경우)
      if (body.mode === 'DISTRIBUTE' && createdItems.length > 0) {
        // 루팅자도 참여자로 포함하려면 아래처럼 per-item 루팅자를 모아서 합칠 수 있음
        // 여기서는 ‘입력된 참여자만’ 분배 대상으로 사용
        if (participants.length > 0) {
          const rows = createdItems.flatMap((it) =>
            participants.map((loginId) => ({
              timelineId: timeline.id,
              lootItemId: it.id,
              recipientLoginId: loginId,
              amount: null,
              isPaid: false,
              paidAt: null,
              createdBy: actor,
            })),
          );
          if (rows.length > 0) await tx.lootDistribution.createMany({ data: rows });
        }
      }

      return timeline;
    });

    return { ok: true, id: String(created.id) };
  }
}