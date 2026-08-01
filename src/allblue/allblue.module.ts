import { Module } from '@nestjs/common';
import { AllblueController } from './allblue.controller';
import { AllblueService } from './allblue.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [AllblueController],
  providers: [AllblueService, PrismaService],
})
export class AllblueModule {}
