// src/treasury/treasury.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ListTreasuryQueryDto, ListTreasuryResp } from './dto/list-treasury.dto';

@Injectable()
export class TreasuryService {
  constructor(
    private prisma: PrismaService,
  ) {}

  private toBigInt(v: any) {
    try {
      return BigInt(String(v));
    } catch {
      throw new BadRequestException('잘못된 ID');
    }
  }

  /** 최신 잔액(없으면 0) */
  private async getLastBalance(clanId: bigint): Promise<number> {
    const last = await this.prisma.treasuryLedger.findFirst({
      where: { clanId },
      orderBy: { createdAt: 'desc' },
      select: { balance: true },
    });
    return last?.balance ?? 0;
  }

  /** 금액 검증 (정수, 양수) */
  private ensurePositiveAmount(amount: any): number {
    if (amount == null) throw new BadRequestException('금액은 필수입니다.');
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      throw new BadRequestException('금액은 0보다 큰 숫자여야 합니다.');
    }
    if (!Number.isInteger(n)) {
      // 소수 허용하려면 이 검증 제거
      throw new BadRequestException('금액은 정수여야 합니다.');
    }
    return n;
  }

  /** 혈비 원장 조회 (페이징) */
  async list(clanIdRaw: any, q: ListTreasuryQueryDto): Promise<ListTreasuryResp> {
    const clanId = this.toBigInt(clanIdRaw);
    const page = q.page ?? 1;
    const size = q.size ?? 10;
    const skip = (page - 1) * size;

    // 기본: 전체. (선택) IN/OUT 단순 필터
    const where: any = { clanId };
    if (q.type === 'IN') {
      // 유입: 판매 혈비귀속 + 수동 유입
      where.entryType = { in: ['SALE_TREASURY', 'MANUAL_IN', 'PLEDGE_RAID'] };
    } else if (q.type === 'OUT') {
      // 유출: 수동 출금
      where.entryType = 'MANUAL_OUT';
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.treasuryLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: size,
        include: {
          timeline: true,
          lootItem: true,
        },
      }),
      this.prisma.treasuryLedger.count({ where }),
    ]);

    const balance = await this.getLastBalance(clanId);

    const items = rows.map((r) => {
      const type: 'IN' | 'OUT' = r.amount < 0 ? 'OUT' : (r.entryType === 'MANUAL_OUT' ? 'OUT' : 'IN');
      
      return {
        id: String(r.id),
        at: r.createdAt.toString(),
        type,
        entryType: r.entryType,
        // 프론트에서 SALE_TREASURY를 고정 라벨로 바꿔 그리므로 여기선 원문 유지
        source:
          r.note ?? (
            r.entryType === 'SALE_TREASURY'
              ? `보스판매 (${r.timelineId ?? '-'} / ${r.lootItemId ?? '-'})`
              : (type === 'IN' ? '기타 유입' : '기타 지출')
          ),
        amount: r.amount,
        by: r.createdBy,
        bossName: r.timeline?.bossName ?? null,
        itemName: r.lootItem?.itemName ?? null,
      };
    });

    return { ok: true, page, size, total, balance, items };
  }

  /** 혈비 수동 유입 */
  async manualIn(input: { clanId: bigint; actor: string; amount: number; note?: string }) {
    const clanId = this.toBigInt(input.clanId);
    const amt = this.ensurePositiveAmount(input.amount);

    const lastBalance = await this.getLastBalance(clanId);
    const newBalance = lastBalance + amt;

    const created = await this.prisma.treasuryLedger.create({
      data: {
        clanId,
        entryType: 'MANUAL_IN',
        amount: amt,
        note: input.note ?? null,             // ✅ 출처/메모 저장
        balance: newBalance,                  // ✅ 스냅샷
        createdBy: input.actor ?? 'system',
        // 수동 입력은 특정 타임라인/아이템과 무관
        timelineId: null,
        lootItemId: null,
      },
    });

    return created;
  }

  /** 혈비 수동 사용(출금) */
  async manualOut(input: { clanId: bigint; actor: string; amount: number; note?: string }) {
    const clanId = this.toBigInt(input.clanId);
    const amt = this.ensurePositiveAmount(input.amount);

    const lastBalance = await this.getLastBalance(clanId);
    if (lastBalance < amt) {
      throw new BadRequestException('잔액이 부족합니다.');
    }
    const newBalance = lastBalance - amt;

    const created = await this.prisma.treasuryLedger.create({
      data: {
        clanId,
        entryType: 'MANUAL_OUT',
        amount: amt,
        note: input.note ?? null,             // ✅ 용도/메모 저장
        balance: newBalance,                  // ✅ 스냅샷
        createdBy: input.actor ?? 'system',
        timelineId: null,
        lootItemId: null,
      },
    });

    return created;
  }

  /**
   * 혈맹 레이드(혈비 귀속) 아이템이 판매되었을 때 혈비 테이블에 기록
   * → 같은 금액/메모/작성자가 짧은 시간(5초) 안에 두 번 들어오면 한 번만 기록
   */
  async recordPledgeRaidSale(input: {
    clanId;
    actor: string;
    amount: number;
    note: string;
    timelineId: bigint | null;
    lootItemId: bigint | null;
	  entryType?: "PLEDGE_RAID" | "PLEDGE_RAID_CANCEL";
  }) {
      const raw = Number(input.amount);
      const clanId = this.toBigInt(input.clanId);
      if (!Number.isFinite(raw) || raw === 0) throw new BadRequestException("금액은 0이 될 수 없습니다.");

      const actor = input.actor || "system";
      const note = input.note ?? null;

      const lastBalance = await this.getLastBalance(clanId);

      let entryType: "MANUAL_IN" | "MANUAL_OUT";
      let amountAbs: number;
      let newBalance: number;

      if (raw > 0) {
        entryType = "MANUAL_IN";
        amountAbs = raw;
        newBalance = lastBalance + amountAbs;
      } else {
        entryType = "MANUAL_OUT";
        amountAbs = Math.abs(raw);
        newBalance = lastBalance - amountAbs;
      }

      return await this.prisma.treasuryLedger.create({
        data: {
          clanId,
          timelineId: input.timelineId ?? null,
          lootItemId: input.lootItemId ?? null,
          entryType,
          amount: amountAbs,
          note,
          balance: newBalance,
          createdBy: actor,
        },
      });
  }
}