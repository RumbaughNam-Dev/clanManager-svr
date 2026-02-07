// src/pledgeRaid/dto/add-participants.dto.ts
import { IsInt, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ParticipantItemDto {
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
  userId: number;
}

export class AddParticipantsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParticipantItemDto)
  participants: ParticipantItemDto[];
}
