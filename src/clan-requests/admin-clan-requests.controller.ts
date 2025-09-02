import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AdminClanRequestsService } from './admin-clan-requests.service';

@Controller('v1/admin/clan-requests')
export class AdminClanRequestsController {
  constructor(private readonly svc: AdminClanRequestsService) {}

  @All()
  async listAll() {
    return this.svc.listAll(); // { ok, pending, processed }
  }

  @All(':id/approve')
  async approve(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.svc.updateStatus(BigInt(id), 'APPROVED', body?.note);
  }

  @All(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.svc.updateStatus(BigInt(id), 'REJECTED', body?.note);
  }
}