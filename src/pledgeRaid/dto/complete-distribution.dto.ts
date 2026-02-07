import { IsNumber, IsNotEmpty, Min } from 'class-validator';

export class CompleteDistributionDto {
  @IsNumber()
  @IsNotEmpty()
  year: number;

  @IsNumber()
  @IsNotEmpty()
  month: number;

  @IsNumber()
  @IsNotEmpty()
  week: number;

  @IsNumber()
  @IsNotEmpty()
  clanId: number;

  @IsNumber()
  @IsNotEmpty()
  bossMetaId: number;

  @IsNumber()
  @IsNotEmpty()
  itemId: number; // ← 추가

  @IsNumber()
  @IsNotEmpty()
  userId: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  distributionAmount: number; // ← 이 필드명 유지
}
