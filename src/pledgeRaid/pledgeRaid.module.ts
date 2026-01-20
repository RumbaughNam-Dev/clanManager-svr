// src/pledgeRaid/pledgeRaid.module.ts
import { Module } from '@nestjs/common';
import { PledgeRaidController } from './pledgeRaid.controller';
import { PledgeRaidService } from './pledgeRaid.service';
import { PrismaService } from '../prisma.service';
import { TreasuryModule } from '../treasury/treasury.module'; // ✅ 추가

@Module({
  imports: [TreasuryModule], // ✅ 추가
  controllers: [PledgeRaidController],
  providers: [PledgeRaidService, PrismaService],
  exports: [PrismaService, PledgeRaidService],
})
export class PledgeRaidModule {}