import { IsInt, IsPositive, IsString, Min, MaxLength } from 'class-validator';

export class CreateManualInDto {
  @IsInt()
  @IsPositive()
  @Min(1)
  amount!: number;

  @IsString()
  @MaxLength(255)
  source!: string;
}