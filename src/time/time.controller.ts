import { Controller, All } from '@nestjs/common';

@Controller('v1/time')
export class TimeController {
  @Post('now')
  now() {
    return { nowIso: new Date().toISOString() };
  }
}