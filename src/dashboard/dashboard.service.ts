// src/dashboard/dashboard.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
  dazeCount: number;          // ⬅️ 클랜별 멍 누계
};

type FixedBossDto = {
  id: string;
  name: string;
  location: string;
  genTime: number | null;     // 0~1439 (자정=0, 23:59=1439)
  respawn: number;
  isRandom: boolean;
  lastCutAt: string | null;   // 최근 컷 (잡힘 여부 판정용)
  nextSpawnAt: string | null;
};

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  // 유예 5분 (서버에서도 동일하게 사용)
  private readonly OVERDUE_GRACE_MS = 5 * 60 * 1000;
  private readonly DAY_MS = 24 * 60 * 60 * 1000;

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
   * - 좌/중(=tracked/forgotten): isFixBoss !== 'Y'만 포함 (랜덤 보스)
   * - 우측(=fixed): isFixBoss === 'Y'만 따로 반환 (고정 보스)
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
      genTime: number | null;
      respawn: number;
      isRandom: boolean;
      lastCutAt: string | null;
      nextSpawnAt: string | null;
    }>;
  }> {
    const metas = await this.prisma.bossMeta.findMany({
      select: {
        id: true,
        name: true,
        location: true,
        respawn: true,
        isRandom: true,   // DB 값 (tinyint 0/1)
        isFixBoss: true,
        genTime: true,
      },
      orderBy: [{ orderNo: 'asc' }, { name: 'asc' }],
    });

    const clanId = this.toBigIntOrNull(clanIdRaw);
    const nowMs = Date.now();

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

    let dazeMap: Map<string, number> = new Map();
    if (clanId) {
      const rows = await this.prisma.$queryRaw<
        { bossName: string; noGenCount: number }[]
      >`
        SELECT t.bossName AS bossName, t.noGenCount AS noGenCount
        FROM BossTimeline t
        INNER JOIN (
          SELECT bossName, MAX(cutAt) AS lastCutAt
          FROM BossTimeline
          WHERE clanId = ${clanId}
          GROUP BY bossName
        ) j
          ON j.bossName = t.bossName
        AND j.lastCutAt = t.cutAt
        WHERE t.clanId = ${clanId}
      `;
      dazeMap = new Map(rows.map(r => [r.bossName, r.noGenCount ?? 0]));
    }

    const isFixed = (v: any) => {
      if (v == null) return false;
      if (typeof v === 'string') {
        const s = v.trim().toUpperCase();
        return s === 'Y' || s === 'YES' || s === 'T' || s === 'TRUE' || s === '1';
      }
      if (typeof v === 'boolean') return v === true;
      if (typeof v === 'number') return v === 1;
      return false;
    };

    const fixedMetas = metas.filter(m => isFixed((m as any).isFixBoss));
    const normalMetas = metas.filter(m => !isFixed((m as any).isFixBoss));

    const tracked: Array<BossDto & { _sortMs: number }> = [];
    const forgotten: Array<BossDto & { _sortMs: number }> = [];

    for (const m of normalMetas) {
      const respawnMinutes = this.toNumber(m.respawn);
      const last = latestByBoss[m.name] ?? null;
      const dazeCount = dazeMap.get(m.name) ?? 0;

      // 👉 DB 값 그대로 boolean 변환
      const derivedIsRandom = !!m.isRandom;

      if (!last) {
        forgotten.push({
          id: String(m.id),
          name: m.name,
          location: m.location,
          respawn: respawnMinutes,
          isRandom: derivedIsRandom,
          lastCutAt: null,
          nextSpawnAt: null,
          overdue: false,
          dazeCount,
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
        isRandom: derivedIsRandom,   // ✅ 여기 반영
        lastCutAt: last.toISOString(),
        nextSpawnAt: new Date(nextMs).toISOString(),
        overdue: nextMs + this.OVERDUE_GRACE_MS < nowMs,
        dazeCount,
        _sortMs: nextMs,
      };

      if (missed >= 1) forgotten.push(row);
      else tracked.push(row);
    }

    tracked.sort((a, b) => a._sortMs - b._sortMs);
    forgotten.sort((a, b) => a._sortMs - b._sortMs);

    const trackedOut: BossDto[] = tracked.map(({ _sortMs, ...rest }) => rest);
    const forgottenOut: BossDto[] = forgotten.map(({ _sortMs, ...rest }) => rest);

const fixed = fixedMetas.map(m => {
  const last = latestByBoss[m.name] ?? null;
  const rawGen = m.genTime ?? null;
  const genTimeNum = rawGen == null ? null : Number(rawGen);
  const safeGenTime = Number.isFinite(genTimeNum) ? genTimeNum : null;

  let nextSpawnAt: string | null = null;
  let sortMs = Number.MAX_SAFE_INTEGER;

  if (m.id.toString() === "36" || m.id.toString() === "37") {
    const next = this.calcGiranNextSpawn(m.id.toString());
    nextSpawnAt = next ? next.toISOString() : null;
    sortMs = next ? next.getTime() : Number.MAX_SAFE_INTEGER;
  } else {
    const nextMs = this.calcFixedNext(m.id.toString(), safeGenTime, nowMs);
    nextSpawnAt = nextMs ? new Date(nextMs).toISOString() : null;
    sortMs = nextMs ?? Number.MAX_SAFE_INTEGER;
  }

  return {
    id: String(m.id),
    name: m.name,
    location: m.location,
    genTime: safeGenTime,
    respawn: this.toNumber(m.respawn),
    isRandom: false,
    lastCutAt: last ? last.toISOString() : null,
    nextSpawnAt,
    _sortMs: sortMs,   // 🔑 정렬용 필드 추가
  };
});

// ✅ 다음 젠 시각 기준 정렬
fixed.sort((a, b) => a._sortMs - b._sortMs);

    // ✅ nextSpawnAt 기준으로 정렬
    fixed.sort((a, b) => {
      const ta = a.nextSpawnAt ? new Date(a.nextSpawnAt).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.nextSpawnAt ? new Date(b.nextSpawnAt).getTime() : Number.MAX_SAFE_INTEGER;
      return (ta || Number.MAX_SAFE_INTEGER) - (tb || Number.MAX_SAFE_INTEGER);
    });

    return {
      ok: true,
      serverTime: this.formatDate(new Date()),
      tracked: trackedOut,
      forgotten: forgottenOut,
      fixed,
    };
  }

  /**
   * 마지막 컷 이후 다음 젠과 미입력 회수를 계산
   * - nextMs: now 이전이면 now 를 넘어설 때까지 step을 더해 미래 젠 시각 산출
   * - missed: last 이후로 지난 주기 수( now ≥ last+step 일 때부터 1, 그 뒤로 주기마다 +1 )
   */
  private rollNextAndMissed(lastMs: number, respawnMin: number, nowMs: number) {
    const step = respawnMin * 60 * 1000;
    if (step <= 0) return { nextMs: lastMs, missed: 0 };
    let next = lastMs + step;
    if (nowMs <= next) return { nextMs: next, missed: 0 };
    const diff = nowMs - next;
    const k = Math.floor(diff / step) + 1; // 지난 주기 수
    next = next + k * step;
    return { nextMs: next, missed: k };
  }

  private formatDate(d: Date): string {
    const z = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  }

  /**
   * 안전 업서트: 복합유니크가 없거나 Client 타입이 구버전이어도 동작
   * - updateMany → (없으면) create → (경합 시) 최종 updateMany 재시도
   */
  private async incrementBossCounter(clanId: bigint, bossName: string, delta: number) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.bossCounter.updateMany({
        where: { clanId, bossName },
        data: { dazeCount: { increment: delta } },
      });
      if (updated.count > 0) return;

      try {
        await tx.bossCounter.create({
          data: { clanId, bossName, dazeCount: Math.max(1, delta) },
        });
      } catch {
        // 동시성으로 create 유니크 충돌 시 마지막 보정
        await tx.bossCounter.updateMany({
          where: { clanId, bossName },
          data: { dazeCount: { increment: delta } },
        });
      }
    });
  }

  /**
   * 보스 컷 생성
   * - BossTimeline 1건, LootItem/Distribution 생성
   * - 컷 성공 시 해당 보스 멍 카운터 0으로 리셋
   */
  async cutBoss(
    clanIdRaw: string | undefined,
    bossMetaId: string,
    body: {
      cutAtIso: string;
      looterLoginId?: string | null;
      items?: string[];
      itemsEx?: Array<{ name: string; lootUserId?: string | null }>;
      mode: 'DISTRIBUTE' | 'TREASURY';
      participants?: string[];
      imageFileName?: string;
      actorLoginId?: string;
      bossName?: string;
    },
    actorLoginIdFromArg?: string,
  ) {
    if (!clanIdRaw) throw new BadRequestException('혈맹 정보가 필요합니다.');
    const clanId = BigInt(clanIdRaw);

    const cutAt = new Date(body.cutAtIso);
    if (isNaN(cutAt.getTime())) {
      throw new BadRequestException('cutAtIso 형식이 올바르지 않습니다.');
    }

    // 보스 메타 조회
    let meta = await this.prisma.bossMeta.findUnique({
      where: { id: BigInt(bossMetaId) },
      select: { name: true },
    });
    if (!meta && body.bossName) {
      meta = await this.prisma.bossMeta.findUnique({
        where: { name: body.bossName },
        select: { name: true },
      });
    }
    if (!meta) throw new BadRequestException('보스 메타를 찾을 수 없습니다.');

    // ✅ bossName 항상 보장
    const bossName = body.bossName ?? meta.name;

    const actor = body.actorLoginId ?? actorLoginIdFromArg ?? 'system';
    const participants = (body.participants ?? []).map(s => s.trim()).filter(Boolean);

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

    const created = await this.prisma.$transaction(async (tx) => {
      const timeline = await tx.bossTimeline.create({
        data: {
          clanId,
          bossName, // ✅ 항상 값 있음
          imageIds: this.normalizeImageIds(body) as Prisma.JsonArray,
          cutAt,
          createdBy: actor,
        },
        select: { id: true },
      });

      const createdItems: { id: bigint; itemName: string }[] = [];
      for (const row of source) {
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
            lootUserId,
            createdBy: actor,
          },
          select: { id: true, itemName: true },
        });
        createdItems.push(it);
      }

      if (body.mode === 'DISTRIBUTE' && createdItems.length > 0 && participants.length > 0) {
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

      return timeline;
    });

    // 컷 시 멍 카운터 0으로 리셋
    await this.resetBossCounter(clanId, bossName);

    return { ok: true, id: String(created.id) };
  }

  private async resetBossCounter(clanId: bigint, bossName: string) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.bossCounter.updateMany({
        where: { clanId, bossName },
        data: { dazeCount: 0 },
      });
      if (updated.count === 0) {
        try {
          await tx.bossCounter.create({ data: { clanId, bossName, dazeCount: 0 } });
        } catch {
          await tx.bossCounter.updateMany({ where: { clanId, bossName }, data: { dazeCount: 0 } });
        }
      }
    });
  }  
  
  /** 멍 +1 (보스 메타 ID 기준, 클랜별) */
  async incDazeByBossMeta(clanIdRaw: any, bossMetaIdRaw: string) {
    const clanId = this.toBigInt(clanIdRaw, '혈맹 정보가 필요합니다.');
    const bossMetaId = this.toBigInt(bossMetaIdRaw, '보스 ID가 올바르지 않습니다.');

    const meta = await this.prisma.bossMeta.findUnique({
      where: { id: bossMetaId },
      select: { name: true },
    });
    if (!meta) throw new NotFoundException('보스 메타를 찾을 수 없습니다.');

    // 원자적 UPSERT (+1)
    const changed = await this.upsertBossCounterRaw(clanId, meta.name, 1);
    console.log('[incDazeByBossMeta] +1', { clanId: String(clanId), bossName: meta.name, changed });

    const row = await this.prisma.bossCounter.findFirst({
      where: { clanId, bossName: meta.name },
      select: { dazeCount: true },
    });
    return { ok: true, dazeCount: row?.dazeCount ?? 0 };
  }

  /** BossCounter 원자적 UPSERT (INSERT ... ON DUPLICATE KEY UPDATE) */
  private async upsertBossCounterRaw(clanId: bigint, bossName: string, delta: number) {
    // ⚠️ 전제: @@unique([clanId, bossName]) 존재
    const res: number = await this.prisma.$executeRaw`
      INSERT INTO \`BossCounter\` (\`clanId\`, \`bossName\`, \`dazeCount\`)
      VALUES (${clanId}, ${bossName}, ${Math.max(1, delta)})
      ON DUPLICATE KEY UPDATE \`dazeCount\` = \`dazeCount\` + ${delta}
    `;
    return res; // 영향받은 행 수
  }

  async importDiscord(clanId: bigint, actorLoginId: string, text: string) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const results: any[] = [];

    for (const line of lines) {
      const m = /^(\d{1,2}:\d{2})\s+(.+?)\s+\(미입력(\d+)회\)$/.exec(line);
      if (!m) continue;

      const hhmm = m[1];
      const bossName = m[2];
      const missedCount = Number(m[3] ?? 0);

      // HH:mm → 오늘 cutAt
      const [hh, mm] = hhmm.split(":").map(Number);
      const cutDate = new Date();
      cutDate.setHours(hh, mm, 0, 0);

      // ✅ bossMetaId도 찾아서 저장
      const bossMeta = await this.prisma.bossMeta.findFirst({
        where: { name: bossName },
        select: { id: true, name: true },
      });
      if (!bossMeta) {
        results.push({ bossName, status: "보스 메타 없음" });
        continue;
      }

      const timeline = await this.prisma.bossTimeline.create({
        data: {
          clanId,
          bossName: bossMeta.name,
          cutAt: cutDate,
          createdBy: actorLoginId,
          noGenCount: missedCount,
        }
      })

      results.push({
        bossName,
        cutAt: cutDate.toISOString(),
        missedCount,
        timelineId: String(timeline.id),
      });
    }

    return { ok: true, results };
  }

  private async cutBossForDiscord(
    clanId: bigint,
    bossName: string,
    cutAt: Date,
    miss: number,
    actorLoginId: string,
  ) {
    // 1) 컷 기록
    const bossMeta = await this.prisma.bossMeta.findFirst({ where: { name: bossName } });
    if (!bossMeta) {
      console.warn("[importDiscord] unknown boss:", bossName);
      return;
    }

    const timeline = await this.prisma.bossTimeline.create({
      data: {
        clanId,
        bossName,
        cutAt,
        createdBy: actorLoginId,
        noGenCount: miss,
        imageIds: [],
      },
    });

    // miss > 0 인 경우 noGenCount 반영 → 이미 DB에 필드 있음
    return timeline;
  } 
  
  // 고정보스 nextSpawn 계산 with 예외 처리
  private calcFixedNext(metaId: string, genTime: number | null, nowMs: number): number | null {
    const d = new Date(nowMs);
    const day = d.getDay(); // 0=일, 6=토

    // 기란감옥 보스 ID → 주말엔 스폰 없음
    const jailBossIds = ["32", "36", "37", "38"];
    if (jailBossIds.includes(metaId) && (day === 0 || day === 6)) {
      return null;
    }

    // 기감 1층: 6, 12, 18, 24시
    if (metaId === "36") {
      return this.calcGiranNextSpawn("36", d)?.getTime() ?? null;
    }

    // 기감 2층: 7, 14, 21시
    if (metaId === "37") {
      return this.calcGiranNextSpawn("37", d)?.getTime() ?? null;
    }

    // 기본 고정보스 로직
    const n = genTime == null ? NaN : Number(genTime);
    if (!Number.isFinite(n)) return null;
    const cycleStart = this.cycleStartMs(nowMs);
    const offsetMin = ((Math.floor(n) - 300 + 1440) % 1440);
    return cycleStart + offsetMin * 60 * 1000;
  }

  private cycleStartMs(nowMs: number) {
    const d = new Date(nowMs);
    const base = new Date(d);
    base.setSeconds(0, 0);
    if (d.getHours() >= 5) base.setHours(5, 0, 0, 0);
    else { base.setDate(base.getDate() - 1); base.setHours(5, 0, 0, 0); }
    return base.getTime();
  }

  // 기감 보스 1층, 2층만 예외처리
  private calcGiranNextSpawn(id: string, now = new Date()): Date | null {
    const hourSets: Record<string, number[]> = {
      "36": [6, 12, 18, 24], // 기감 1층
      "37": [7, 14, 21],     // 기감 2층
    };

    const hours = hourSets[id];
    if (!hours) return null;

    // 주말 제외
    const day = now.getDay(); // 0=일, 6=토
    if (day === 0 || day === 6) return null;

    for (const h of hours) {
      const hh = h === 24 ? 0 : h;
      const d = new Date(now);
      d.setHours(hh, 0, 0, 0);
      if (h === 24) d.setDate(d.getDate() + 1);

      if (d.getTime() > now.getTime()) {
        return d;
      }
    }

    // 오늘 다 지났으면 내일 첫 번째 시간
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const hh = hours[0] === 24 ? 0 : hours[0];
    tomorrow.setHours(hh, 0, 0, 0);
    return tomorrow;
  }
}