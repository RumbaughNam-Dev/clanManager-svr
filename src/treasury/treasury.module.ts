import { Module } from '@nestjs/common';
import { TreasuryService } from './treasury.service';
import { TreasuryController } from './treasury.controller';
import { PrismaService } from '../prisma.service';

// PrismaModule 등 필요한 거 이미 있을 거면 그대로 두고

@Module({
  imports: [
  ],
  providers: [TreasuryService, PrismaService],
  controllers: [TreasuryController],
  exports: [TreasuryService], // ✅ 이 줄 추가
})
export class TreasuryModule {}