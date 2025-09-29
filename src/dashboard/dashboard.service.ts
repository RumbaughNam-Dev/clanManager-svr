// src/dashboard/dashboard.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Prisma } from '@prisma/client';

type BossDto = {
  id: string;
  name: string;
  location: string;
  respawn: number;
  isRandom: boolean;
  lastCutAt: string | null;   // KST 문자열
  nextSpawnAt: string | null; // KST 문자열
  overdue: boolean;
  dazeCount: number;
};

type FixedBossDto = {
  id: string;
  name: string;
  location: string;
  genTime: number | null;
  respawn: number;
  isRandom: boolean;
  lastCutAt: string | null;   // KST 문자열
  nextSpawnAt: string | null; // KST 문자열
};

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

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

  private toKST(date: Date | null): string | null {
    if (!date) return null;
    return date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  }

  async listBossesForClan(clanIdRaw?: any): Promise<{
    ok: true;
    serverTime: string;
    tracked: BossDto[];
    forgotten: BossDto[];
    fixed: FixedBossDto[];
  }> {
    const metas = await this.prisma.bossMeta.findMany({
      select: {
        id: true,
        name: true,
        location: true,
        respawn: true,
        isRandom: true,
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
        return ['Y','YES','T','TRUE','1'].includes(s);
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
        isRandom: derivedIsRandom,
        lastCutAt: this.toKST(last),
        nextSpawnAt: this.toKST(new Date(nextMs)),
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
        nextSpawnAt = this.toKST(next ?? null);
        sortMs = next ? next.getTime() : Number.MAX_SAFE_INTEGER;
      } else {
        const nextMs = this.calcFixedNext(m.id.toString(), safeGenTime, nowMs);
        nextSpawnAt = this.toKST(nextMs ? new Date(nextMs) : null);
        sortMs = nextMs ?? Number.MAX_SAFE_INTEGER;
      }

      return {
        id: String(m.id),
        name: m.name,
        location: m.location,
        genTime: safeGenTime,
        respawn: this.toNumber(m.respawn),
        isRandom: false,
        lastCutAt: this.toKST(last),
        nextSpawnAt,
        _sortMs: sortMs,
      };
    });

    fixed.sort((a, b) => a._sortMs - b._sortMs);

    return {
      ok: true,
      serverTime: this.toKST(new Date()) ?? "",
      tracked: trackedOut,
      forgotten: forgottenOut,
      fixed,
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
    return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  }

  private async incrementBossCounter(clanId: bigint, bossName: string, delta: number) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.bossCounter.updateMany({
        where: { clanId, bossName },
        data: { dazeCount: { increment: delta } },
      });
      if (updated.count > 0) return;

      try {
        await tx.bossCounter.create({ data: { clanId, bossName, dazeCount: Math.max(1, delta) } });
      } catch {
        await tx.bossCounter.updateMany({
          where: { clanId, bossName },
          data: { dazeCount: { increment: delta } },
        });
      }
    });
  }

  async cutBoss(
    clanIdRaw: string | undefined,
    bossMetaId: string,
    body: { cutAtIso: string; looterLoginId?: string | null; items?: string[]; itemsEx?: Array<{ name: string; lootUserId?: string | null }>; mode: 'DISTRIBUTE' | 'TREASURY'; participants?: string[]; imageFileName?: string; actorLoginId?: string; bossName?: string; },
    actorLoginIdFromArg?: string,
  ) {
    if (!clanIdRaw) throw new BadRequestException('혈맹 정보가 필요합니다.');
    const clanId = BigInt(clanIdRaw);

    const cutAt = new Date(body.cutAtIso);
    if (isNaN(cutAt.getTime())) {
      throw new BadRequestException('cutAtIso 형식이 올바르지 않습니다.');
    }

    let meta = await this.prisma.bossMeta.findUnique({ where: { id: BigInt(bossMetaId) }, select: { name: true } });
    if (!meta && body.bossName) {
      meta = await this.prisma.bossMeta.findUnique({ where: { name: body.bossName }, select: { name: true } });
    }
    if (!meta) throw new BadRequestException('보스 메타를 찾을 수 없습니다.');

    const bossName = body.bossName ?? meta.name;
    const actor = body.actorLoginId ?? actorLoginIdFromArg ?? 'system';
    const participants = (body.participants ?? []).map(s => s.trim()).filter(Boolean);

    type SourceRow = { itemName: string; lootUserIdRaw?: string | null };
    let source: SourceRow[] = [];

    if (Array.isArray(body.itemsEx) && body.itemsEx.length > 0) {
      source = body.itemsEx
        .map(r => ({ itemName: (r?.name ?? '').trim(), lootUserIdRaw: (r?.lootUserId ?? '').trim() || null }))
        .filter(r => !!r.itemName);
    } else {
      const items = (body.items ?? []).map(s => s.trim()).filter(Boolean);
      const lootUsers: (string | null)[] =
        (body as any).lootUsers && Array.isArray((body as any).lootUsers)
          ? (body as any).lootUsers.map((s: any) => (typeof s === 'string' ? s.trim() : '') || null)
          : [];
      source = items.map((name, idx) => ({ itemName: name, lootUserIdRaw: lootUsers[idx] ?? (body.looterLoginId ?? null) }));
    }

    if (source.length > 0 && body.mode === 'DISTRIBUTE' && participants.length === 0) {
      throw new BadRequestException('분배 모드에서는 참여자를 1명 이상 입력해야 합니다.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const timeline = await tx.bossTimeline.create({
        data: {
          clanId,
          bossName,
          imageIds: this.normalizeImageIds(body) as Prisma.JsonArray,
          cutAt,
          createdBy: actor,
        },
        select: { id: true },
      });

      const createdItems: { id: bigint; itemName: string }[] = [];
      for (const row of source) {
        const lootUserId = (row.lootUserIdRaw ?? '').trim() || (body.looterLoginId ?? '').trim() || actor;

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

    await this.resetBossCounter(clanId, bossName);

    return { ok: true, id: String(created.id) };
  }

  private async resetBossCounter(clanId: bigint, bossName: string) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.bossCounter.updateMany({ where: { clanId, bossName }, data: { dazeCount: 0 } });
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

      const [hh, mm] = m[1].split(":").map(Number);
      const bossName = m[2];
      const missedCount = Number(m[3] ?? 0);

      // ✅ cutDate를 KST로 맞춤
      const cutDate = new Date();
      cutDate.setHours(hh, mm, 0, 0);

      const bossMeta = await this.prisma.bossMeta.findFirst({ where: { name: bossName } });
      if (!bossMeta) continue;

      const timeline = await this.prisma.bossTimeline.create({
        data: {
          clanId,
          bossName: bossMeta.name,
          cutAt: cutDate,  // DB 저장 (UTC 저장되지만 KST 시각 기반)
          createdBy: actorLoginId,
          noGenCount: missedCount,
        }
      });

      results.push({
        bossName,
        cutAt: this.toKST(cutDate),   // ✅ 응답은 KST 문자열
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
    const now = new Date(nowMs);

    // 기란감옥 보스 주말 제외
    const jailBossIds = ["32", "37", "38"]; // <-- 여기서도 변경
    const day = now.getDay(); // 0=일, 6=토
    if (jailBossIds.includes(metaId) && (day === 0 || day === 6)) {
      return null;
    }

    // 기감 1층: 6, 12, 18, 24시
    if (metaId === "37") {
      return this.calcGiranNextSpawn("37", now)?.getTime() ?? null;
    }

    // 기감 2층: 7, 14, 21시
    if (metaId === "38") {
      return this.calcGiranNextSpawn("38", now)?.getTime() ?? null;
    }

    // 일반 고정보스 (DB genTime 분 단위 그대로 사용)
    if (genTime == null || !Number.isFinite(genTime)) return null;

    const base = new Date(now);
    base.setHours(0, 0, 0, 0);  // 오늘 자정
    base.setMinutes(genTime);

    if (base.getTime() <= now.getTime()) {
      base.setDate(base.getDate() + 1);
    }

    return base.getTime();
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
      "37": [6, 12, 18, 24], // 기감 1층
      "38": [7, 14, 21],     // 기감 2층
    };

    const hours = hourSets[id];
    if (!hours) return null;

    // 주말 제외
    const day = now.getDay();
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

    // 오늘 다 지났으면 내일 첫 시간
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const hh = hours[0] === 24 ? 0 : hours[0];
    tomorrow.setHours(hh, 0, 0, 0);
    return tomorrow;
  }
}