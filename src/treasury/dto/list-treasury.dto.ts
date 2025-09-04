// src/treasury/dto/list-treasury.dto.ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListTreasuryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size: number = 10;

  // 기본은 전체(필터 없음). 프론트에서 명시적으로 넘길 때만 적용.
  @IsOptional()
  @IsIn(['ALL', 'IN', 'OUT'])
  type?: 'ALL' | 'IN' | 'OUT';

  // 🔹 추적/출처용 쿼리 파라미터가 붙어도 ValidationPipe에서 막지 않도록 허용
  @IsOptional()
  via?: string;
}

export type ListTreasuryResp = {
  ok: true;
  page: number;
  size: number;
  total: number;
  balance: number;
  items: Array<{
    id: string;
    at: string;             // ISO
    type: 'IN' | 'OUT';     // 화면 표시용
    entryType: 'SALE_TREASURY' | 'MANUAL_IN' | 'MANUAL_OUT';
    source: string;         // 출처/용도 (note 대체)
    amount: number;         // 양수
    by: string;             // 작성자
    // (선택) 연계 정보
    bossName?: string | null;
    itemName?: string | null;
  }>;
};