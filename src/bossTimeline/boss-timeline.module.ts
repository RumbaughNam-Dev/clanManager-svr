import { Module } from '@nestjs/common';
import { BossTimelineController } from './boss-timeline.controller';
import { BossTimelineService } from './boss-timeline.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [BossTimelineController],
  providers: [BossTimelineService, PrismaService],
  exports: [BossTimelineService],
})
export class BossTimelineModule {}