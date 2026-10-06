import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AllblueJwtAuthGuard } from './allblue-jwt-auth.guard';
import { TemporaryUserLinkService } from './temporary-user-link.service';

@Controller('allblue')
@UseGuards(AllblueJwtAuthGuard)
export class TemporaryUserLinkController {
  constructor(private service: TemporaryUserLinkService) {}

  @Get('schedule/:scheduleId/temporary-users/:sourceId/link-targets')
  targets(@Param('scheduleId') schedule: string, @Param('sourceId') source: string, @Query('q') q: string, @Req() req: any) {
    return this.service.targets(Number(schedule), Number(source), Number(req.user.sub), q);
  }

  @Post('schedule/:scheduleId/temporary-users/:sourceId/link-preview')
  preview(@Param('scheduleId') schedule: string, @Param('sourceId') source: string, @Body() body: { targetId: number }, @Req() req: any) {
    return this.service.preview(Number(schedule), Number(source), body.targetId, Number(req.user.sub));
  }

  @Post('schedule/:scheduleId/temporary-users/:sourceId/link')
  link(@Param('scheduleId') schedule: string, @Param('sourceId') source: string, @Body() body: { targetId: number; confirmationToken: string }, @Req() req: any) {
    return this.service.link(Number(schedule), Number(source), body.targetId, Number(req.user.sub), body.confirmationToken);
  }

}
