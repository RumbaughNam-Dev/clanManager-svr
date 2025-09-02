import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AdminClanRequestsService } from './admin-clan-requests.service';

@Controller('v1/admin/clan-requests')
export class AdminClanRequestsController {
  constructor(private readonly svc: AdminClanRequestsService) {}

  @Get()
  async listAll() {
    return this.svc.listAll(); // { ok, pending, processed }
  }

  @Get(':id/approve')
  async approve(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.svc.updateStatus(BigInt(id), 'APPROVED', body?.note);
  }

  @Get(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.svc.updateStatus(BigInt(id), 'REJECTED', body?.note);
  }
}