import { Module } from '@nestjs/common';
import { AllblueController } from './allblue.controller';
import { AllblueService } from './allblue.service';
import { AllbluePrismaService } from '../allblue-prisma.service';

@Module({
  controllers: [AllblueController],
  providers: [AllblueService, AllbluePrismaService],
})
export class AllblueModule {}
