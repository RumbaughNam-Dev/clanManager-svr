import { Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
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

  @Post('instructorRegisterRequest')
  @UseInterceptors(FileInterceptor('certImage'))
  registerRequest(@Body() body: { name: string; phone: string }, @UploadedFile() file: Express.Multer.File) {
    return this.allblueService.registerRequest(body.name, body.phone, file);
  }

  @Post('refreshToken')
  refreshToken(@Body() body: { refreshToken: string }) {
    return this.allblueService.refreshToken(body.refreshToken);
  }
}
