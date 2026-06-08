import { Controller, Post } from '@nestjs/common';

@Controller('time')
export class TimeController {
  @Post('now')
  now() {
    return { nowIso: new Date().toISOString() };
  }
}