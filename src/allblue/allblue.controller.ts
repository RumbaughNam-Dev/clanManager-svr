import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AllblueService } from './allblue.service';
import { AllblueJwtAuthGuard } from './allblue-jwt-auth.guard';

@Controller('allblue')
export class AllblueController {
  constructor(private readonly allblueService: AllblueService) {}

  @Post('doInstructorLogin')
  login(@Body() body: { userId: string; password: string }, @Req() req: any) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    return this.allblueService.login(body.userId, body.password, ip);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Post('doInstructorLogout')
  logout(@Req() req: any) {
    return this.allblueService.logout(req.user.sub);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('form/items')
  getFormItems(@Query('formId') formId: string, @Req() req: any) {
    return this.allblueService.getFormItems(formId, Number(req.user.sub));
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Post('form/submission')
  createSubmission(@Body() body: { formId: string; diverName: string }, @Req() req: any) {
    return this.allblueService.createSubmission(body.formId, body.diverName, Number(req.user.sub));
  }

  @Get('form/submission/:uuid')
  getSubmission(@Param('uuid') uuid: string) {
    return this.allblueService.getSubmission(uuid);
  }

  @Post('refreshToken')
  refreshToken(@Body() body: { refreshToken: string }) {
    return this.allblueService.refreshToken(body.refreshToken);
  }
}
