import { Module } from '@nestjs/common';
import { AllblueController } from './allblue.controller';
import { AllblueService } from './allblue.service';
import { AllbluePrismaService } from '../allblue-prisma.service';
import { AllblueS3Service } from './allblue-s3.service';

@Module({
  controllers: [AllblueController],
  providers: [AllblueService, AllbluePrismaService, AllblueS3Service],
})
export class AllblueModule {}
