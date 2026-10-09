import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';
import { TemporaryUserLinkController } from './temporary-user-link.controller';
import { TemporaryUserLinkService } from './temporary-user-link.service';
import { DemoAuthController } from './demo-auth.controller';
import { DemoAuthService } from './demo-auth.service';
import { Module } from '@nestjs/common';
import { AllblueController } from './allblue.controller';
import { AllblueService } from './allblue.service';
import { AllbluePrismaService } from '../allblue-prisma.service';
import { AllblueS3Service } from './allblue-s3.service';
import { AllbluePushService } from './allblue-push.service';

@Module({
  controllers: [NoticesController, TemporaryUserLinkController, AllblueController, DemoAuthController],
  providers: [NoticesService, TemporaryUserLinkService, DemoAuthService, AllblueService, AllbluePrismaService, AllblueS3Service, AllbluePushService],
})
export class AllblueModule {}
