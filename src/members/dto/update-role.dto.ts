import { IsIn } from 'class-validator';

export class UpdateRoleDto {
  @IsIn(['USER', 'LEADER'])
  role!: 'USER' | 'LEADER';
}