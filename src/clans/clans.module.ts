import { Module } from '@nestjs/common';
import { ClansController } from './clans.controller';
import { ClansService } from './clans.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [ClansController],
  providers: [ClansService, PrismaService],
  exports: [ClansService],
})
export class ClansModule {}
