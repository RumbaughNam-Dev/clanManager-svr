// src/treasury/treasury.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ListTreasuryQueryDto, ListTreasuryResp } from './dto/list-treasury.dto';
import { TreasuryEntryType } from '@prisma/client';

@Injectable()
export class TreasuryService {
  constructor(private prisma: PrismaService) {}

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
      where.entryType = { in: [TreasuryEntryType.SALE_TREASURY, TreasuryEntryType.MANUAL_IN] };
    } else if (q.type === 'OUT') {
      where.entryType = TreasuryEntryType.MANUAL_OUT;
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
      const type: 'IN' | 'OUT' =
        r.entryType === TreasuryEntryType.MANUAL_OUT ? 'OUT' : 'IN';
      return {
        id: String(r.id),
        at: r.createdAt.toISOString(),
        type,
        entryType: r.entryType,
        // 프론트에서 SALE_TREASURY를 고정 라벨로 바꿔 그리므로 여기선 원문 유지
        source:
          r.entryType === TreasuryEntryType.SALE_TREASURY
            ? `보스판매 (${r.timelineId ?? '-'} / ${r.lootItemId ?? '-'})`
            : (r.note ?? (type === 'IN' ? '기타 유입' : '기타 지출')),
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
        entryType: TreasuryEntryType.MANUAL_IN,
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
        entryType: TreasuryEntryType.MANUAL_OUT,
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
}