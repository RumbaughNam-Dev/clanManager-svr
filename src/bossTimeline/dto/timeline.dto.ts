import { Transform } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString } from 'class-validator';

export interface TimelineItemDto {
  id: string;
  bossName: string;
  cutAt: string;
  createdBy: string;
  imageIds: string[];
  noGenCount: number;            // 🔵 추가
  items: Array<{
    id: string;
    itemName: string;
    isSold: boolean;
    soldAt: string | null;
    soldPrice: number | null;
    toTreasury: boolean;
    isTreasury: boolean;
    looterLoginId: string | null;
  }>;
  distributions: Array<{
    lootItemId: string | null;
    recipientLoginId: string;
    isPaid: boolean;
    paidAt: string | null;
  }>;
}

export interface TimelineDto extends TimelineItemDto {}
export interface ListTimelinesResp {
  ok: true;
  items: TimelineDto[];
}

export class CreateTimelineDto {
  @IsString()
  bossName!: string;

  @IsISO8601()
  cutAt!: string;

  @IsArray()
  @IsString({ each: true })
  participants!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value, obj }) => {
    const pick = (x: any): string[] | undefined => {
      if (!x) return undefined;
      if (Array.isArray(x)) {
        if (x.length > 0 && typeof x[0] === 'object' && x[0]?.fileName) {
          return x.map((it) => String(it.fileName));
        }
        return x.map((it) => String(it));
      }
      if (typeof x === 'string') return [x];
      return undefined;
    };
    return (
      pick(value) ??
      pick(obj?.imageIds) ??
      pick(obj?.imageIds) ??
      pick(obj?.imageId) ??
      pick(obj?.imageFileName) ??
      undefined
    );
  })
  imageIds?: string[];
}