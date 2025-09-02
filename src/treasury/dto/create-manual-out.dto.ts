import { IsInt, IsPositive, Min, IsString, MaxLength } from 'class-validator';

export class CreateManualOutDto {
  @IsInt()
  @IsPositive()
  @Min(1)
  amount!: number;

  @IsString()
  @MaxLength(255)
  note!: string;
}