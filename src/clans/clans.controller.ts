import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClansService } from './clans.service';

@Controller('v1/clans')
@UseGuards(JwtAuthGuard)
export class ClansController {
  constructor(private readonly clansService: ClansService) {}

  @Get(':clanId/discord-link')
  getDiscordLink(@Param('clanId') clanId: string, @Req() req: any) {
    return this.clansService.getDiscordLink(clanId, req.user ?? {});
  }

  @Put(':clanId/discord-link')
  updateDiscordLink(
    @Param('clanId') clanId: string,
    @Req() req: any,
    @Body() body: { discordLink?: string | null },
  ) {
    return this.clansService.updateDiscordLink(
      clanId,
      req.user ?? {},
      body?.discordLink,
    );
  }
}
