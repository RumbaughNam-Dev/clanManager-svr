// src/pledge-raid/dto/save-raid-items.dto.ts
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RaidItemDto {
	@IsOptional()
	@IsString()
	id?: string;

	@IsString()
	itemName: string;

  @IsInt()
  @Type(() => Number)
  rootUserId: number;

	@IsBoolean()
	isSold: boolean;

	@Type(() => Number)
	@IsInt()
	@Min(0)
	soldPrice: number;

	@IsOptional()
	@IsBoolean()
	isTreasury?: boolean; // (나중에 프론트에서 제거하면 됨)
}

export class SaveRaidItemsDto {
	@Type(() => Number)
	@IsInt()
	year: number;

	@Type(() => Number)
	@IsInt()
	month: number;

	@Type(() => Number)
	@IsInt()
	week: number;

	@Type(() => Number)
	@IsInt()
	clanId: number;

	@Type(() => Number)
	@IsInt()
	bossMetaId: number;

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => RaidItemDto)
	items: RaidItemDto[];
}