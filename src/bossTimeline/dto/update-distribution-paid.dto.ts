// src/bossTimeline/dto/update-distribution-paid.dto.ts
import { IsBoolean } from "class-validator";

export class UpdateDistributionPaidDto {
  @IsBoolean()
  isPaid!: boolean;
}