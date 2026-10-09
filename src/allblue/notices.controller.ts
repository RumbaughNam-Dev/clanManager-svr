import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AllblueJwtAuthGuard } from './allblue-jwt-auth.guard';
import { NoticesService } from './notices.service';

@Controller('allblue/notices')
@UseGuards(AllblueJwtAuthGuard)
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}
  @Get()
  list(@Req() req: any, @Query('offset') offset = '0') { return this.notices.list(req.user.userId, Number(offset)); }
  @Get('popups')
  popups() { return this.notices.popups(); }
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number, @Req() req: any) { return this.notices.detail(id, req.user.userId); }
  @Post()
  create(@Req() req: any, @Body() body: unknown) { return this.notices.create(req.user.userId, body); }
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body() body: unknown) { return this.notices.update(id, req.user.userId, body); }
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) { return this.notices.remove(id, req.user.userId); }
}
