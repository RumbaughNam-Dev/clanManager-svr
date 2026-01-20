// src/pledge-raid/dto/query-raid-items.dto.ts
import { IsInt } from 'class-validator';

export class QueryRaidItemsDto {
  @IsInt()
  year!: number;

  @IsInt()
  month!: number;

  @IsInt()
  week!: number;

  @IsInt()
  clanId!: number;

  @IsInt()
  bossMetaId!: number;
}