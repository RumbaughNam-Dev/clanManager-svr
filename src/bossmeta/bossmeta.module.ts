import { Module } from '@nestjs/common';
import { BossMetaController } from './bossmeta.controller';
import { BossMetaService } from './bossmeta.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [BossMetaController],
  providers: [BossMetaService, PrismaService],
  exports: [BossMetaService],
})
export class BossMetaModule {}