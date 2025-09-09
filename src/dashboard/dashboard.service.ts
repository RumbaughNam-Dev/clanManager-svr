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

type FixedBossDto = {
  id: string;
  name: string;
  location: string;
  genTime: number | null;     // 0~1439 (자정=0, 23:59=1439)
  respawn: number;
  isRandom: boolean;
  lastCutAt: string | null;   // 최근 컷 (잡힘 여부 판정용)
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

  private normalizeImageIds(body: any): string[] {
    const pick = (x: any): string[] | undefined => {
      if (!x) return undefined;
      if (Array.isArray(x)) {
        if (x.length > 0 && typeof x[0] === 'object' && x[0]?.fileName) {
          return x.map((it: any) => String(it.fileName));
        }
        return x.map((it: any) => String(it));
      }
      if (typeof x === 'string') return [x];
      return undefined;
    };
    return (
      pick(body.imageIds) ??
      pick(body.imageIds) ??
      pick(body.imageId) ??
      pick(body.imageFileName) ?? []
    );
  }

  /**
   * 보스 목록 + (선택) 혈맹별 최신컷으로 nextSpawn 계산
   * - 좌/중(=tracked/forgotten): isFixBoss !== 'Y'만 포함
   * - 우측(=fixed): isFixBoss === 'Y'만 따로 반환
   */
  async listBossesForClan(clanIdRaw?: any): Promise<{
    ok: true;
    serverTime: string;
    tracked: BossDto[];
    forgotten: BossDto[];
    fixed: Array<{
      id: string;
      name: string;
      location: string;
      genTime: number | null;   // 0~1439 (HH*60+mm), null이면 표시 '—'
      respawn: number;
      isRandom: boolean;
      lastCutAt: string | null; // 최근 컷(있으면 파랑 판정에 사용)
    }>;
  }> {
    // 고정보스 판단/젠시간을 위해 isFixBoss, genTime까지 선택
    const metas = await this.prisma.bossMeta.findMany({
      select: {
        id: true,
        name: true,
        location: true,
        respawn: true,
        isRandom: true,
        isFixBoss: true,  // "Y" | "N"
        genTime: true,    // Int? (0~1439)
      },
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

    const isFixed = (v: any) => {
      if (v == null) return false;
      if (typeof v === 'string') {
        const s = v.trim().toUpperCase();        // ← 'Y ', '\r', '\n' 등 제거
        return s === 'Y' || s === 'YES' || s === 'T' || s === 'TRUE' || s === '1';
      }
      if (typeof v === 'boolean') return v === true;
      if (typeof v === 'number') return v === 1;
      return false;
    };

    // 메타 분리
    const fixedMetas = metas.filter(m => isFixed((m as any).isFixBoss));
    const normalMetas = metas.filter(m => !isFixed((m as any).isFixBoss));

    if (process.env.NODE_ENV === 'production' && metas.length > 0 && fixedMetas.length === 0) {
      // 샘플 5건만 찍어보자
      const samples = metas.slice(0, 5).map(m => ({
        id: String(m.id),
        name: m.name,
        isFixBoss_raw: (m as any).isFixBoss,
        typeof_isFixBoss: typeof (m as any).isFixBoss,
      }));
      console.warn('[BossMeta fixed filter zero] metas=', metas.length, 'samples=', samples);
    }

    // ── 비고정: tracked / forgotten 계산 ──
    const tracked: Array<BossDto & { _sortMs: number }> = [];
    const forgotten: Array<BossDto & { _sortMs: number }> = [];

    for (const m of normalMetas) {
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

    // ── 고정: fixed 목록 생성 ──
    const fixed = fixedMetas.map(m => {
      const last = latestByBoss[m.name] ?? null;

      // ✅ genTime을 어떤 이름으로 오더라도 안전하게 숫자로 변환
      const rawGen =
        (m as any).genTime ??
        (m as any).genTimeMin ??   // 혹시 과거 이름이 남아있는 경우 대비
        (m as any).gen_time ??     // DB 스네이크 케이스 대비
        null;

      const genTimeNum = rawGen == null ? null : Number(rawGen);
      const safeGenTime = Number.isFinite(genTimeNum) ? genTimeNum : null;

      return {
        id: String(m.id),
        name: m.name,
        location: m.location,
        genTime: safeGenTime,                       // ← 반드시 number|null
        respawn: this.toNumber((m as any).respawn),
        isRandom: !!m.isRandom,
        lastCutAt: last ? last.toISOString() : null,
      };
    });

    return {
      ok: true,
      serverTime: this.formatDate(new Date()),
      tracked: trackedOut,
      forgotten: forgottenOut,
      fixed, // 프론트 우측 섹션에서 사용
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
   * - imageFileName 은 imageIds(JSON 배열)로 저장
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
          // ✅ 여러 입력을 하나로 통합해서 저장
          imageIds: this.normalizeImageIds(body) as Prisma.JsonArray,
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
