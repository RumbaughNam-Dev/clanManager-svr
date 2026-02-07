// src/pledgeRaid/dto/user-list.dto.ts
import { IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UserListQueryDto {
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

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  searchGbn?: number;
}

export class ParticipantDto {
  name: string;
  distributionAmount?: string | number;
  status?: 'Y' | 'N';
}

export class UserListResponseDto {
  participants: ParticipantDto[];
}
