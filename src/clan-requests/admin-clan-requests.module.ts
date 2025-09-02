import { Module } from '@nestjs/common';
import { AdminClanRequestsController } from './admin-clan-requests.controller';
import { AdminClanRequestsService } from './admin-clan-requests.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [AdminClanRequestsController],
  providers: [AdminClanRequestsService, PrismaService],
})
export class AdminClanRequestsModule {}