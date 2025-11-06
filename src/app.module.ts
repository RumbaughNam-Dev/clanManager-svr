import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { ClanRequestsModule } from './clan-requests/clan-requests.module';
import { AdminClanRequestsModule } from './clan-requests/admin-clan-requests.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { MembersModule } from './members/members.module';
import { BossMetaModule } from './bossmeta/bossmeta.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TimeController } from './time/time.controller';
import { FilesModule } from './files/files.module';
import { BossTimelineModule } from './bossTimeline/boss-timeline.module';
import { TreasuryModule } from './treasury/treasury.module';
import { FeedbackModule } from './feedback/feedback.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    MembersModule,
    ClanRequestsModule,
    AdminClanRequestsModule,
    BossMetaModule,
    DashboardModule,
    FilesModule,
    BossTimelineModule,
    TreasuryModule,
    FeedbackModule
  ],
  controllers: [AppController, TimeController],
  providers: [AppService, PrismaService],
})
export class AppModule {}