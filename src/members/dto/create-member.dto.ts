import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateMemberDto {
  @IsInt() @Min(1)
  clanId!: number;

  @IsString() @IsNotEmpty() @MaxLength(50)
  loginId!: string;

  @IsString() @IsNotEmpty()
  password!: string;

  @IsOptional() @IsIn(['USER', 'LEADER']) // 기본 USER, 필요 시 LEADER로 생성 가능
  role?: 'USER' | 'LEADER';
}