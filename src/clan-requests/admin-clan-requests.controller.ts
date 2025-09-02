import { Body, Controller, Post, Param } from '@nestjs/common';
import { AdminClanRequestsService } from './admin-clan-requests.service';

@Controller('v1/admin/clan-requests')
export class AdminClanRequestsController {
  constructor(private readonly svc: AdminClanRequestsService) {}

  @Post()
  async listAll() {
    return this.svc.listAll(); // { ok, pending, processed }
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.svc.updateStatus(BigInt(id), 'APPROVED', body?.note);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.svc.updateStatus(BigInt(id), 'REJECTED', body?.note);
  }
}