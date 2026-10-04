import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DemoAuthService } from './demo-auth.service';

@Controller('allblue/auth')
export class DemoAuthController {
  constructor(private readonly demoAuth: DemoAuthService) {}

  @Post('demo')
  login(@Body() body: { code?: unknown }, @Req() req: Request) {
    // Do not trust caller-supplied forwarding headers for the rate limit.
    return this.demoAuth.login(body?.code, req.ip ?? req.socket.remoteAddress ?? 'unknown');
  }
}
