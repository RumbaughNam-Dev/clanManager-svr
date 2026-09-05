import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @UseGuards(AllblueJwtAuthGuard)
  @Get('form/submissions')
  getSubmissions(@Req() req: any) {
    return this.allblueService.getSubmissions(Number(req.user.sub));
  }

  @Get('form/submission/:uuid')
  getSubmission(@Param('uuid') uuid: string) {
    return this.allblueService.getSubmission(uuid);
  }

  @Patch('form/submission/:uuid/save')
  saveSubmission(@Param('uuid') uuid: string, @Body() body: any) {
    return this.allblueService.saveSubmission(uuid, body);
  }

  @Patch('form/submission/:uuid/submit')
  submitSubmission(@Param('uuid') uuid: string, @Body() body: any) {
    return this.allblueService.submitSubmission(uuid, body);
  }

  @Patch('form/submission/:uuid/print')
  printSubmission(@Param('uuid') uuid: string) {
    return this.allblueService.printSubmission(uuid);
  }

  @Get('checkUserId')
  checkUserId(@Query('userId') userId: string) {
    return this.allblueService.checkUserId(userId);
  }

  @Post('registerRequest')
  @UseInterceptors(FileInterceptor('certImage'))
  registerRequest(@Body() body: any, @UploadedFile() file: Express.Multer.File) {
    return this.allblueService.registerRequest(body, file);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('profile')
  getProfile(@Req() req: any) {
    return this.allblueService.getProfile(Number(req.user.sub));
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Put('profile')
  updateProfile(@Req() req: any, @Body() body: any) {
    return this.allblueService.updateProfile(Number(req.user.sub), body);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Post('profile/image')
  @UseInterceptors(FileInterceptor('file'))
  uploadProfileImage(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.allblueService.uploadProfileImage(Number(req.user.sub), file);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Post('cert/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadCert(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.allblueService.uploadCert(Number(req.user.sub), file);
  }

  @Get('codes')
  getCodes(@Query('group') group: string) {
    return this.allblueService.getCodes(group);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('diving-pools')
  getDivingPools() {
    return this.allblueService.getDivingPools();
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('users/search')
  searchUsers(@Query('q') q: string, @Req() req: any) {
    return this.allblueService.searchUsers(q, Number(req.user.sub));
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Post('schedule')
  createSchedule(@Body() body: any, @Req() req: any) {
    return this.allblueService.createSchedule(body, req.user.userId);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('schedule/daily')
  getDailySchedules(@Query('date') date: string, @Req() req: any) {
    return this.allblueService.getDailySchedules(date, req.user.userId);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('schedule/monthly')
  getMonthlySchedules(@Query('year') year: string, @Query('month') month: string, @Req() req: any) {
    return this.allblueService.getMonthlySchedules(year, month, req.user.userId);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('schedule/:id')
  getScheduleDetail(@Param('id') id: string, @Req() req: any) {
    return this.allblueService.getScheduleDetail(Number(id), req.user.userId);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Put('schedule/:id')
  updateSchedule(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.allblueService.updateSchedule(Number(id), body, req.user.userId);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Delete('schedule/:id')
  deleteSchedule(@Param('id') id: string, @Req() req: any) {
    return this.allblueService.deleteSchedule(Number(id), req.user.userId);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('user/:id/achievements')
  getUserAchievements(@Param('id') id: string) {
    return this.allblueService.getUserAchievements(Number(id));
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Post('achievement/toggle')
  toggleAchievement(@Body() body: { requirementId: number; userId: number; completed: boolean }, @Req() req: any) {
    return this.allblueService.toggleAchievement(body, Number(req.user.sub));
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Post('debriefing')
  createDebriefing(@Body() body: { scheduleId: number; participantId: number; content: string }, @Req() req: any) {
    return this.allblueService.createDebriefing(body, Number(req.user.sub));
  }

  @Get('associations')
  getAssociations() {
    return this.allblueService.getAssociations();
  }

  @Get('licenses')
  getLicenses(@Query('associationCode') associationCode?: string) {
    return this.allblueService.getLicenses(associationCode);
  }

  @Get('licenses/:code/requirements')
  getLicenseRequirements(@Param('code') code: string) {
    return this.allblueService.getLicenseRequirements(code);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('cert/pending-count')
  getCertPendingCount() {
    return this.allblueService.getCertPendingCount();
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('cert/requests')
  getCertRequests() {
    return this.allblueService.getCertRequests();
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Patch('cert/requests/:id/approve')
  approveCertRequest(@Param('id') id: string, @Body() body: { level: string }) {
    return this.allblueService.approveCertRequest(Number(id), body.level);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Patch('cert/requests/:id/reject')
  rejectCertRequest(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.allblueService.rejectCertRequest(Number(id), body.reason);
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('cert/last-reject')
  getCertLastReject(@Req() req: any) {
    return this.allblueService.getCertLastReject(Number(req.user.sub));
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Get('admin/registerRequests')
  getRegisterRequests(@Req() req: any) {
    if (req.user.userId !== 'expoool') throw new ForbiddenException();
    return this.allblueService.getRegisterRequests();
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Patch('admin/registerRequests/:id/approve')
  approveRegisterRequest(@Param('id') id: string, @Req() req: any) {
    if (req.user.userId !== 'expoool') throw new ForbiddenException();
    return this.allblueService.updateRegisterRequestStatus(Number(id), 'approved');
  }

  @UseGuards(AllblueJwtAuthGuard)
  @Patch('admin/registerRequests/:id/reject')
  rejectRegisterRequest(@Param('id') id: string, @Req() req: any) {
    if (req.user.userId !== 'expoool') throw new ForbiddenException();
    return this.allblueService.updateRegisterRequestStatus(Number(id), 'rejected');
  }

  @Get('auth/kakao/callback')
  async kakaoCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    const result = await this.allblueService.kakaoAuthCallback(code);
    let redirectUrl: string;

    if (result.error) {
      redirectUrl = `${state}?error=${encodeURIComponent(result.message)}`;
    } else if (result.isNewUser) {
      redirectUrl = `${state}?isNewUser=true&tempToken=${encodeURIComponent(result.tempToken ?? '')}&nickname=${encodeURIComponent(result.nickname ?? '')}&profileImage=${encodeURIComponent(result.profileImage ?? '')}`;
    } else {
      redirectUrl = `${state}?isNewUser=false&token=${encodeURIComponent(result.token ?? '')}&userId=${encodeURIComponent(result.userId ?? '')}&name=${encodeURIComponent(result.name ?? '')}&profileImage=${encodeURIComponent(result.profileImage ?? '')}`;
    }

    res.type('html').send(
      `<html><body><script>window.location.href="${redirectUrl}";</script><p>앱으로 이동 중...</p></body></html>`,
    );
  }

  @Get('auth/google/callback')
  async googleCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    const result = await this.allblueService.googleAuthCallback(code);
    let redirectUrl: string;

    if (result.error) {
      redirectUrl = `${state}?error=${encodeURIComponent(result.message)}`;
    } else if (result.isNewUser) {
      redirectUrl = `${state}?isNewUser=true&tempToken=${encodeURIComponent(result.tempToken ?? '')}&nickname=${encodeURIComponent(result.nickname ?? '')}&profileImage=${encodeURIComponent(result.profileImage ?? '')}`;
    } else {
      redirectUrl = `${state}?isNewUser=false&token=${encodeURIComponent(result.token ?? '')}&userId=${encodeURIComponent(result.userId ?? '')}&name=${encodeURIComponent(result.name ?? '')}&profileImage=${encodeURIComponent(result.profileImage ?? '')}`;
    }

    res.type('html').send(
      `<html><body><script>window.location.href="${redirectUrl}";</script><p>앱으로 이동 중...</p></body></html>`,
    );
  }

  @Get('auth/naver/callback')
  async naverCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    const result = await this.allblueService.naverAuthCallback(code, state);
    let redirectUrl: string;

    if (result.error) {
      redirectUrl = `${state}?error=${encodeURIComponent(result.message)}`;
    } else if (result.isNewUser) {
      redirectUrl = `${state}?isNewUser=true&tempToken=${encodeURIComponent(result.tempToken ?? '')}&nickname=${encodeURIComponent(result.nickname ?? '')}&profileImage=${encodeURIComponent(result.profileImage ?? '')}`;
    } else {
      redirectUrl = `${state}?isNewUser=false&token=${encodeURIComponent(result.token ?? '')}&userId=${encodeURIComponent(result.userId ?? '')}&name=${encodeURIComponent(result.name ?? '')}&profileImage=${encodeURIComponent(result.profileImage ?? '')}`;
    }

    res.type('html').send(
      `<html><body><script>window.location.href="${redirectUrl}";</script><p>앱으로 이동 중...</p></body></html>`,
    );
  }

  @Post('auth/apple/callback')
  async appleCallback(@Body() body: any, @Res() res: any) {
    const { code, state, user } = body;
    const result = await this.allblueService.appleAuthCallback(code, user);
    let redirectUrl: string;

    if (result.error) {
      redirectUrl = `${state}?error=${encodeURIComponent(result.message)}`;
    } else if (result.isNewUser) {
      redirectUrl = `${state}?isNewUser=true&tempToken=${encodeURIComponent(result.tempToken ?? '')}&nickname=${encodeURIComponent(result.nickname ?? '')}`;
    } else {
      redirectUrl = `${state}?isNewUser=false&token=${encodeURIComponent(result.token ?? '')}&userId=${encodeURIComponent(result.userId ?? '')}&name=${encodeURIComponent(result.name ?? '')}`;
    }

    res.type('html').send(
      `<html><body><script>window.location.href="${redirectUrl}";</script><p>앱으로 이동 중...</p></body></html>`,
    );
  }

  @Post('auth/register')
  authRegister(@Body() body: any, @Req() req: any) {
    const authHeader = req.headers['authorization'];
    const tempToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    return this.allblueService.authRegister(tempToken, body);
  }

  @Post('refreshToken')
  refreshToken(@Body() body: { refreshToken: string }) {
    return this.allblueService.refreshToken(body.refreshToken);
  }
}
