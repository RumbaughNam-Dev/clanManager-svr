// src/pledgeRaid/dto/update-participant-distribution.dto.ts
import { IsInt, IsNotEmpty, Min } from 'class-validator';

export class UpdateParticipantDistributionDto {
  @IsInt()
  @IsNotEmpty()
  year: number;

  @IsInt()
  @IsNotEmpty()
  month: number;

  @IsInt()
  @IsNotEmpty()
  week: number;

  @IsInt()
  @IsNotEmpty()
  clanId: number;

  @IsInt()
  @IsNotEmpty()
  bossMetaId: number;

  @IsInt()
  @IsNotEmpty()
  userId: number;

  @IsInt()
  @IsNotEmpty()
  @Min(0)
  distributionAmount: number;
}
