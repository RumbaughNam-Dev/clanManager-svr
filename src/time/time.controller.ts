import { Controller, All } from '@nestjs/common';

@Controller('v1/time')
export class TimeController {
  @All('now')
  now() {
    return { nowIso: new Date().toISOString() };
  }
}