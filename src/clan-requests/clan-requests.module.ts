import { Module } from '@nestjs/common';
import { ClanRequestsController } from './clan-requests.controller';
import { ClanRequestsService } from './clan-requests.service';
import { PrismaService } from '../prisma.service'; // ← 추가

@Module({
  imports: [],
  controllers: [ClanRequestsController],
  providers: [ClanRequestsService, PrismaService], // ← PrismaService 등록
})
export class ClanRequestsModule {}