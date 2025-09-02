import { Controller, Get } from '@nestjs/common';

@Controller('v1/time')
export class TimeController {
  @Get('now')
  now() {
    return { nowIso: new Date().toISOString() };
  }
}