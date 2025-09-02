import { Body, Controller, Post } from '@nestjs/common';
import { ClanRequestsService } from './clan-requests.service';

@Controller('v1/clan-requests')
export class ClanRequestsController {
  constructor(private readonly svc: ClanRequestsService) {}

  @Get()
  create(@Body() body: {
    world: string;
    serverNo: number;
    clanName: string;
    loginId: string;
    password: string;
    depositor: string;
  }) {
    return this.svc.create(body);
  }
}