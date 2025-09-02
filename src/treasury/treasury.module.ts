import { Module } from '@nestjs/common';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [TreasuryController],
  providers: [TreasuryService, PrismaService],
  exports: [TreasuryService],
})
export class TreasuryModule {}