import { Transform } from 'class-transformer';
import { IsArray, IsISO8601, IsIn, IsOptional, IsString } from 'class-validator';

export class CutBossDto {
  @IsISO8601()
  cutAtIso!: string;

  @IsIn(['DISTRIBUTE', 'TREASURY'])
  mode!: 'DISTRIBUTE' | 'TREASURY';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value, obj }) => normalizeImageIds(value, obj))
  imageIds?: string[];

  @IsOptional()
  @IsArray()
  items?: Array<{ name: string; looterLoginId?: string | null; price?: number | null }>;

  /** 아이템별 루팅자 확장 입력(있으면 우선 사용) */
  @IsOptional()
  @IsArray()
  itemsEx?: Array<{ name: string; lootUserId?: string | null }>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participants?: string[];
}

function normalizeImageIds(value: any, obj: any): string[] | undefined {
  const pick = (x: any): string[] | undefined => {
    if (!x) return undefined;
    if (Array.isArray(x)) {
      // [{fileName:"a.png"}] 형태 지원
      if (x.length > 0 && typeof x[0] === 'object' && x[0]?.fileName) {
        return x.map((it: any) => String(it.fileName));
      }
      return x.map((it: any) => String(it));
    }
    if (typeof x === 'string') return [x];
    return undefined;
  };
  return (
    pick(value) ??
    pick(obj?.imageIds) ??   // 표준
    pick(obj?.imageIds) ??     // 과거 키
    pick(obj?.imageId) ??    // 단건
    pick(obj?.imageFileName) // 단건(파일명)
  );
}
