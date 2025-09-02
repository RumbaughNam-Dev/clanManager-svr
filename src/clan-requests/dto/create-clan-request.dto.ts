import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateClanRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  world!: string;

  @IsInt() @Min(1) @Max(10)
  serverNo!: number;

  @IsString() @IsNotEmpty() @MaxLength(100)
  clanName!: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  loginId!: string;

  @IsString() @IsNotEmpty()
  password!: string;

  // 프론트와 맞춤: depositor
  @IsString() @IsNotEmpty() @MaxLength(50)
  depositor!: string;
}